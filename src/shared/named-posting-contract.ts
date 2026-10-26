import { createHash } from 'node:crypto'
import { z } from 'zod'

const timestamp = z.string().datetime({ offset: true })
const boundedText = z.string().trim().min(1).max(100_000)
const source = z.enum(['lever', 'greenhouse'])

export type NamedPostingIdentity = { source: 'lever' | 'greenhouse'; board: string; postingId: string; canonicalUrl: string }

/** Accept only known public single-posting paths; no query/fragment/credentials/custom hosts. */
export function parseNamedPostingUrl(input: string): NamedPostingIdentity {
  if (typeof input !== 'string' || input.trim() !== input || Buffer.byteLength(input, 'utf8') > 2048) throw new Error('Unsupported named posting URL.')
  let url: URL
  try { url = new URL(input) } catch { throw new Error('Unsupported named posting URL.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) throw new Error('Unsupported named posting URL.')
  const host = url.hostname.toLowerCase()
  const lever = host === 'jobs.lever.co' && url.pathname.match(/^\/([A-Za-z0-9_-]{1,100})\/([A-Za-z0-9_-]{1,150})\/?$/)
  if (lever) return { source: 'lever', board: lever[1], postingId: lever[2], canonicalUrl: `https://jobs.lever.co/${lever[1]}/${lever[2]}` }
  const greenhouse = ['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(host) && url.pathname.match(/^\/([A-Za-z0-9_-]{1,100})\/jobs\/([0-9]{1,20})(?:\/[^/?#]*)?\/?$/)
  if (greenhouse) return { source: 'greenhouse', board: greenhouse[1], postingId: greenhouse[2], canonicalUrl: `https://${host}/${greenhouse[1]}/jobs/${greenhouse[2]}` }
  throw new Error('Unsupported named posting URL.')
}

export const namedPostingReferenceSchema = z.object({ source, board: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), postingId: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/), submittedUrl: z.string().url().max(2048), canonicalUrl: z.string().url().max(2048) }).strict().superRefine((value, ctx) => {
  try { const parsed = parseNamedPostingUrl(value.submittedUrl); if (parsed.source !== value.source || parsed.board !== value.board || parsed.postingId !== value.postingId || parsed.canonicalUrl !== value.canonicalUrl) throw new Error() }
  catch { ctx.addIssue({ code: 'custom', message: 'Reference must exactly match a supported named posting URL.' }) }
})
export type NamedPostingReference = z.infer<typeof namedPostingReferenceSchema>

export const namedPostingAttemptSchema = z.discriminatedUnion('status', [
  z.object({ id: z.string().uuid(), reference: namedPostingReferenceSchema, startedAt: timestamp, status: z.literal('retrieved'), expiresAt: timestamp }).strict(),
  z.object({ id: z.string().uuid(), reference: namedPostingReferenceSchema, startedAt: timestamp, status: z.literal('failed'), reason: z.enum(['not-found', 'expired', 'login-required', 'incomplete', 'unsafe-redirect', 'unsafe-address', 'cancelled', 'deadline', 'ambiguous', 'opt-in-required', 'source-error']) }).strict(),
])
export type NamedPostingAttempt = z.infer<typeof namedPostingAttemptSchema>

export const namedPostingCandidateSchema = z.object({ version: z.literal(1), attemptId: z.string().uuid(), reference: namedPostingReferenceSchema, returnedBoard: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), returnedPostingId: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/), title: z.string().trim().min(1).max(500), employer: z.string().trim().min(1).max(500), text: boundedText, completeness: z.enum(['full', 'partial']), capturedAt: timestamp, sourceUpdatedAt: timestamp.nullable(), provenanceUrl: z.string().url().max(2048) }).strict().superRefine((candidate, ctx) => {
  try { if (parseNamedPostingUrl(candidate.provenanceUrl).canonicalUrl !== candidate.reference.canonicalUrl) throw new Error() }
  catch { ctx.addIssue({ code: 'custom', message: 'Provenance must be the selected canonical posting.' }) }
  if (candidate.returnedBoard !== candidate.reference.board || candidate.returnedPostingId !== candidate.reference.postingId) ctx.addIssue({ code: 'custom', message: 'Returned identity does not match selected posting.' })
  if (candidate.completeness !== 'full' || candidate.text.length < 80) ctx.addIssue({ code: 'custom', message: 'Incomplete posting cannot be accepted.' })
})
export type NamedPostingCandidate = z.infer<typeof namedPostingCandidateSchema>

export const namedPostingAcceptanceSchema = z.object({ version: z.literal(1), attemptId: z.string().uuid(), acceptedAt: timestamp, source: z.enum(['lever', 'greenhouse']), board: z.string(), postingId: z.string(), title: z.string(), employer: z.string(), text: boundedText, provenanceUrl: z.string().url(), capturedAt: timestamp, sourceUpdatedAt: timestamp.nullable(), evidenceHash: z.string().regex(/^[a-f0-9]{64}$/), userReviewedExactRole: z.literal(true), userReviewedCompleteness: z.literal(true) }).strict()
export type NamedPostingAcceptance = z.infer<typeof namedPostingAcceptanceSchema>

/** Shape/hash alone is insufficient: call with the app-held temporary candidate and attempt. */
export function acceptNamedPosting(candidateInput: unknown, attemptInput: unknown, reviewed: { exactRole: boolean; completeness: boolean }, now = Date.now()): NamedPostingAcceptance {
  const candidate = namedPostingCandidateSchema.parse(candidateInput), attempt = namedPostingAttemptSchema.parse(attemptInput)
  if (attempt.status !== 'retrieved' || attempt.id !== candidate.attemptId || attempt.reference.canonicalUrl !== candidate.reference.canonicalUrl || attempt.reference.source !== candidate.reference.source) throw new Error('Candidate is not bound to the retrieved attempt.')
  if (Date.parse(attempt.expiresAt) <= now || Date.parse(candidate.capturedAt) > now) throw new Error('Temporary posting candidate is expired or from the future.')
  if (!reviewed.exactRole || !reviewed.completeness) throw new Error('Explicit exact-role and completeness review is required.')
  const value = { version: 1 as const, attemptId: attempt.id, acceptedAt: new Date(now).toISOString(), source: candidate.reference.source, board: candidate.reference.board, postingId: candidate.reference.postingId, title: candidate.title, employer: candidate.employer, text: candidate.text, provenanceUrl: candidate.reference.canonicalUrl, capturedAt: candidate.capturedAt, sourceUpdatedAt: candidate.sourceUpdatedAt, userReviewedExactRole: true as const, userReviewedCompleteness: true as const }
  return namedPostingAcceptanceSchema.parse({ ...value, evidenceHash: createHash('sha256').update(JSON.stringify(value)).digest('hex') })
}
