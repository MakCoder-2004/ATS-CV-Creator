import { createHash } from 'node:crypto'
import { z } from 'zod'

const timestamp = z.string().datetime({ offset: true })
const boundedText = z.string().trim().min(1).max(100_000)
const source = z.enum(['lever', 'greenhouse'])
const ttlMs = 10 * 60_000
export type NamedPostingIdentity = { source: 'lever' | 'greenhouse'; board: string; postingId: string; canonicalUrl: string }

/** Public board/page URL identity; deliberately excludes EU Lever and unknown variants. */
export function parseNamedPostingUrl(input: string): NamedPostingIdentity {
  if (typeof input !== 'string' || input.trim() !== input || /[\u0000-\u001f\u007f\\]/.test(input) || new TextEncoder().encode(input).byteLength > 2048) throw new Error('Unsupported named posting URL.')
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

const retrievedAttemptSchema = z.object({ id: z.string().uuid(), reference: namedPostingReferenceSchema, startedAt: timestamp, status: z.literal('retrieved'), expiresAt: timestamp, eligibility: z.object({ personalLocalOptIn: z.literal(true), source, scope: z.literal('personal-local'), optedInAt: timestamp }).strict() }).strict().superRefine((attempt, ctx) => {
  if (attempt.eligibility.source !== attempt.reference.source || Date.parse(attempt.eligibility.optedInAt) >= Date.parse(attempt.startedAt)) ctx.addIssue({ code: 'custom', message: 'Retrieved attempt requires prior source-specific personal-local opt-in.' })
  const start = Date.parse(attempt.startedAt), expiry = Date.parse(attempt.expiresAt)
  if (!(start < expiry) || expiry - start > ttlMs) ctx.addIssue({ code: 'custom', message: 'Attempt expiry must be after start and within the bounded TTL.' })
})
export const namedPostingAttemptSchema = z.discriminatedUnion('status', [
  retrievedAttemptSchema,
  z.object({ id: z.string().uuid(), reference: namedPostingReferenceSchema, startedAt: timestamp, status: z.literal('failed'), reason: z.enum(['not-found', 'expired', 'login-required', 'incomplete', 'unsafe-redirect', 'unsafe-address', 'cancelled', 'deadline', 'ambiguous', 'opt-in-required', 'source-error']) }).strict(),
])
export type NamedPostingAttempt = z.infer<typeof namedPostingAttemptSchema>

function expectedApiRoute(reference: NamedPostingReference) {
  return reference.source === 'lever'
    ? { method: 'lever-postings-api-v0' as const, url: `https://api.lever.co/v0/postings/${reference.board}/${reference.postingId}` }
    : { method: 'greenhouse-job-board-api-v1' as const, url: `https://boards-api.greenhouse.io/v1/boards/${reference.board}/jobs/${reference.postingId}` }
}

export const namedPostingCandidateSchema = z.object({ version: z.literal(1), attemptId: z.string().uuid(), reference: namedPostingReferenceSchema, returnedBoard: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), returnedPostingId: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/), title: z.string().trim().min(1).max(200), employer: z.string().trim().min(1).max(200), text: boundedText, completeness: z.enum(['full', 'partial']), capturedAt: timestamp, sourceUpdatedAt: timestamp.nullable(), retrievalMethod: z.enum(['lever-postings-api-v0', 'greenhouse-job-board-api-v1']), retrievalUrl: z.string().url().max(2048) }).strict().superRefine((candidate, ctx) => {
  const route = expectedApiRoute(candidate.reference)
  if (candidate.returnedBoard !== candidate.reference.board || candidate.returnedPostingId !== candidate.reference.postingId) ctx.addIssue({ code: 'custom', message: 'Returned identity does not match selected posting.' })
  if (candidate.retrievalMethod !== route.method || candidate.retrievalUrl !== route.url) ctx.addIssue({ code: 'custom', message: 'Retrieval provenance must identify the documented named API route.' })
  if (candidate.completeness !== 'full' || candidate.text.length < 80) ctx.addIssue({ code: 'custom', message: 'Incomplete posting cannot be accepted.' })
})
export type NamedPostingCandidate = z.infer<typeof namedPostingCandidateSchema>

export const namedPostingAcceptanceSchema = z.object({ version: z.literal(1), attemptId: z.string().uuid(), acceptedAt: timestamp, source: z.enum(['lever', 'greenhouse']), board: z.string(), postingId: z.string(), title: z.string().max(200), employer: z.string().max(200), text: boundedText, provenanceUrl: z.string().url(), retrievalMethod: z.enum(['lever-postings-api-v0', 'greenhouse-job-board-api-v1']), retrievalUrl: z.string().url(), capturedAt: timestamp, sourceUpdatedAt: timestamp.nullable(), evidenceHash: z.string().regex(/^[a-f0-9]{64}$/), userReviewedExactRole: z.literal(true), userReviewedCompleteness: z.literal(true) }).strict()
export type NamedPostingAcceptance = z.infer<typeof namedPostingAcceptanceSchema>
export const namedPostingReviewSchema = z.object({ attemptId: z.string().uuid(), candidateHash: z.string().regex(/^[a-f0-9]{64}$/), reviewedAt: timestamp, exactRole: z.literal(true), completeness: z.literal(true) }).strict()
export type NamedPostingReview = z.infer<typeof namedPostingReviewSchema>

function acceptanceFor(candidate: NamedPostingCandidate, attempt: z.infer<typeof retrievedAttemptSchema>, acceptedAt: string): NamedPostingAcceptance {
  const record = { version: 1 as const, attemptId: attempt.id, acceptedAt, source: candidate.reference.source, board: candidate.reference.board, postingId: candidate.reference.postingId, title: candidate.title, employer: candidate.employer, text: candidate.text, provenanceUrl: candidate.reference.canonicalUrl, retrievalMethod: candidate.retrievalMethod, retrievalUrl: candidate.retrievalUrl, capturedAt: candidate.capturedAt, sourceUpdatedAt: candidate.sourceUpdatedAt, userReviewedExactRole: true as const, userReviewedCompleteness: true as const }
  return namedPostingAcceptanceSchema.parse({ ...record, evidenceHash: createHash('sha256').update(JSON.stringify(record)).digest('hex') })
}

/** Builder only; the result is not trusted until verified against app-held attempt and candidate. */
export function createNamedPostingAcceptance(candidateInput: unknown, attemptInput: unknown, reviewInput: unknown, now = Date.now()): NamedPostingAcceptance {
  const candidate = namedPostingCandidateSchema.parse(candidateInput), attempt = retrievedAttemptSchema.parse(attemptInput), review = namedPostingReviewSchema.parse(reviewInput)
  assertBoundAndFresh(candidate, attempt, now)
  const candidateHash = createHash('sha256').update(JSON.stringify(candidate)).digest('hex')
  if (review.attemptId !== attempt.id || review.candidateHash !== candidateHash || Date.parse(review.reviewedAt) < Date.parse(candidate.capturedAt) || Date.parse(review.reviewedAt) > now) throw new Error('Review record is not bound to this candidate or has invalid timing.')
  return acceptanceFor(candidate, attempt, review.reviewedAt)
}

function assertBoundAndFresh(candidate: NamedPostingCandidate, attempt: z.infer<typeof retrievedAttemptSchema>, now: number) {
  if (attempt.id !== candidate.attemptId || JSON.stringify(attempt.reference) !== JSON.stringify(candidate.reference)) throw new Error('Candidate is not bound to the app-held retrieved attempt.')
  const start = Date.parse(attempt.startedAt), capture = Date.parse(candidate.capturedAt), expiry = Date.parse(attempt.expiresAt)
  if (start > capture || capture > now || now >= expiry || (candidate.sourceUpdatedAt && Date.parse(candidate.sourceUpdatedAt) > now)) throw new Error('Posting temporal order is invalid or temporary data expired.')
  if (!(start < expiry) || expiry - start > ttlMs) throw new Error('Attempt expiry is outside the bounded TTL.')
}

/** Verify stored acceptance by recomputation against independently app-held immutable objects. */
export function verifyNamedPostingAcceptance(acceptanceInput: unknown, appHeldCandidateInput: unknown, appHeldAttemptInput: unknown, appHeldReviewInput: unknown, now = Date.now()): NamedPostingAcceptance {
  const acceptance = namedPostingAcceptanceSchema.parse(acceptanceInput)
  const candidate = namedPostingCandidateSchema.parse(appHeldCandidateInput), attempt = retrievedAttemptSchema.parse(appHeldAttemptInput), review = namedPostingReviewSchema.parse(appHeldReviewInput)
  assertBoundAndFresh(candidate, attempt, now)
  const candidateHash = createHash('sha256').update(JSON.stringify(candidate)).digest('hex')
  if (review.attemptId !== attempt.id || review.candidateHash !== candidateHash || Date.parse(review.reviewedAt) > now) throw new Error('App-held review is not valid for this candidate and attempt.')
  const acceptedAt = Date.parse(acceptance.acceptedAt)
  if (acceptedAt < Date.parse(candidate.capturedAt) || acceptedAt < Date.parse(attempt.startedAt) || acceptedAt >= Date.parse(attempt.expiresAt) || acceptedAt > now || acceptance.acceptedAt !== review.reviewedAt) throw new Error('Acceptance temporal order is invalid.')
  const expected = acceptanceFor(candidate, attempt, review.reviewedAt)
  if (JSON.stringify(acceptance) !== JSON.stringify(expected)) throw new Error('Acceptance does not match the app-held reviewed posting and source attempt.')
  return expected
}
