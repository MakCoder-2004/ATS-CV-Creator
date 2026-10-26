import { z } from 'zod'

const timestamp = z.string().datetime({ offset: true })
const boundedText = z.string().trim().min(1).max(100_000)
const source = z.enum(['lever', 'greenhouse'])
const ttlMs = 10 * 60_000
export type NamedPostingIdentity = { source: 'lever' | 'greenhouse'; board: string; postingId: string; canonicalUrl: string }

/** Public board/page URL identity; deliberately excludes EU Lever and unknown variants. */
export function parseNamedPostingUrl(input: string): NamedPostingIdentity {
  if (typeof input !== 'string' || input.trim() !== input || /[\u0000-\u001f\u007f\\?#]/.test(input) || new TextEncoder().encode(input).byteLength > 2048) throw new Error('Unsupported named posting URL.')
  let url: URL
  try { url = new URL(input) } catch { throw new Error('Unsupported named posting URL.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) throw new Error('Unsupported named posting URL.')
  const host = url.hostname.toLowerCase()
  const lever = host === 'jobs.lever.co' && url.pathname.match(/^\/([A-Za-z0-9_-]{1,100})\/([A-Za-z0-9_-]{1,150})\/?$/)
  if (lever) return { source: 'lever', board: lever[1], postingId: lever[2], canonicalUrl: `https://jobs.lever.co/${lever[1]}/${lever[2]}` }
  const greenhouse = ['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(host) && url.pathname.match(/^\/([A-Za-z0-9_-]{1,100})\/jobs\/([0-9]{1,20})(?:\/[A-Za-z0-9_-]{1,200})?\/?$/)
  if (greenhouse) return { source: 'greenhouse', board: greenhouse[1], postingId: greenhouse[2], canonicalUrl: `https://${host}/${greenhouse[1]}/jobs/${greenhouse[2]}` }
  throw new Error('Unsupported named posting URL.')
}

export const namedPostingReferenceSchema = z.object({ source, board: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), postingId: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/), submittedUrl: z.string().url().max(2048), canonicalUrl: z.string().url().max(2048) }).strict().superRefine((value, ctx) => {
  try { const parsed = parseNamedPostingUrl(value.submittedUrl); if (JSON.stringify(parsed) !== JSON.stringify({ source: value.source, board: value.board, postingId: value.postingId, canonicalUrl: value.canonicalUrl })) throw new Error() }
  catch { ctx.addIssue({ code: 'custom', message: 'Reference must exactly match a supported named posting URL.' }) }
})
export type NamedPostingReference = z.infer<typeof namedPostingReferenceSchema>

export const namedPostingRetrievedAttemptSchema = z.object({ id: z.string().uuid(), reference: namedPostingReferenceSchema, startedAt: timestamp, status: z.literal('retrieved'), expiresAt: timestamp, eligibility: z.object({ personalLocalOptIn: z.literal(true), source, scope: z.literal('personal-local'), optedInAt: timestamp }).strict() }).strict().superRefine((attempt, ctx) => {
  if (attempt.eligibility.source !== attempt.reference.source || Date.parse(attempt.eligibility.optedInAt) > Date.parse(attempt.startedAt)) ctx.addIssue({ code: 'custom', message: 'Retrieved attempt requires prior source-specific personal-local opt-in.' })
  const start = Date.parse(attempt.startedAt), expiry = Date.parse(attempt.expiresAt)
  if (!(start < expiry) || expiry - start > ttlMs) ctx.addIssue({ code: 'custom', message: 'Attempt expiry must be after start and within the bounded TTL.' })
})
export const namedPostingAttemptSchema = z.discriminatedUnion('status', [
  namedPostingRetrievedAttemptSchema,
  z.object({ id: z.string().uuid(), reference: namedPostingReferenceSchema, startedAt: timestamp, status: z.literal('failed'), reason: z.enum(['not-found', 'expired', 'login-required', 'incomplete', 'unsafe-redirect', 'unsafe-address', 'cancelled', 'deadline', 'ambiguous', 'opt-in-required', 'source-error']) }).strict(),
])
export type NamedPostingAttempt = z.infer<typeof namedPostingAttemptSchema>

function expectedApiRoute(reference: NamedPostingReference) {
  return reference.source === 'lever'
    ? { method: 'lever-postings-api-v0' as const, url: `https://api.lever.co/v0/postings/${reference.board}/${reference.postingId}` }
    : { method: 'greenhouse-job-board-api-v1' as const, url: `https://boards-api.greenhouse.io/v1/boards/${reference.board}/jobs/${reference.postingId}` }
}

export const namedPostingCandidateSchema = z.object({ version: z.literal(1), attemptId: z.string().uuid(), reference: namedPostingReferenceSchema, returnedBoard: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).nullable(), returnedPostingId: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/), title: z.string().trim().min(1).max(200), employer: z.string().trim().min(1).max(200), text: boundedText, completeness: z.enum(['full', 'partial']), capturedAt: timestamp, sourceUpdatedAt: timestamp.nullable(), retrievalMethod: z.enum(['lever-postings-api-v0', 'greenhouse-job-board-api-v1']), retrievalUrl: z.string().url().max(2048) }).strict().superRefine((candidate, ctx) => {
  const route = expectedApiRoute(candidate.reference)
  if (candidate.reference.source === 'lever' && candidate.returnedBoard !== candidate.reference.board || candidate.reference.source === 'greenhouse' && candidate.returnedBoard !== null || candidate.returnedPostingId !== candidate.reference.postingId) ctx.addIssue({ code: 'custom', message: 'Returned identity does not match selected posting.' })
  if (candidate.retrievalMethod !== route.method || candidate.retrievalUrl !== route.url) ctx.addIssue({ code: 'custom', message: 'Retrieval provenance must identify the documented named API route.' })
  if (candidate.completeness !== 'full' || candidate.text.length < 80) ctx.addIssue({ code: 'custom', message: 'Incomplete posting cannot be accepted.' })
})
export type NamedPostingCandidate = z.infer<typeof namedPostingCandidateSchema>

export const namedPostingPreviewReplySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('loading'), expiresAt: timestamp }).strict(),
  z.object({ status: z.literal('ready'), attempt: namedPostingAttemptSchema, candidate: namedPostingCandidateSchema, expiresAt: timestamp }).strict(),
  z.object({ status: z.literal('failed'), attempt: namedPostingAttemptSchema, expiresAt: timestamp }).strict(),
  z.object({ status: z.literal('expired') }).strict(),
])
export type NamedPostingPreviewReply = z.infer<typeof namedPostingPreviewReplySchema>

export const namedPostingAcceptanceSchema = z.object({ version: z.literal(1), attemptId: z.string().uuid(), acceptedAt: timestamp, source: z.enum(['lever', 'greenhouse']), board: z.string(), postingId: z.string(), title: z.string().max(200), employer: z.string().max(200), text: boundedText, provenanceUrl: z.string().url(), retrievalMethod: z.enum(['lever-postings-api-v0', 'greenhouse-job-board-api-v1']), retrievalUrl: z.string().url(), capturedAt: timestamp, sourceUpdatedAt: timestamp.nullable(), evidenceHash: z.string().regex(/^[a-f0-9]{64}$/), userReviewedExactRole: z.literal(true), userReviewedCompleteness: z.literal(true) }).strict()
export type NamedPostingAcceptance = z.infer<typeof namedPostingAcceptanceSchema>
export const namedPostingReviewSchema = z.object({ attemptId: z.string().uuid(), candidateHash: z.string().regex(/^[a-f0-9]{64}$/), reviewedAt: timestamp, exactRole: z.literal(true), completeness: z.literal(true) }).strict()
export type NamedPostingReview = z.infer<typeof namedPostingReviewSchema>
