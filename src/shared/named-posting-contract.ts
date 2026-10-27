import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  namedPostingAcceptanceSchema, namedPostingCandidateSchema, namedPostingReviewSchema,
  namedPostingRetrievedAttemptSchema, type NamedPostingAcceptance, type NamedPostingCandidate,
  type NamedPostingReview,
} from './named-posting-schema'

export * from './named-posting-schema'
const ttlMs = 10 * 60_000

function acceptanceFor(candidate: NamedPostingCandidate, attempt: z.infer<typeof namedPostingRetrievedAttemptSchema>, acceptedAt: string): NamedPostingAcceptance {
  const record = { version: 1 as const, attemptId: attempt.id, acceptedAt, source: candidate.reference.source, board: candidate.reference.board, postingId: candidate.reference.postingId, title: candidate.title, employer: candidate.employer, text: candidate.text, provenanceUrl: candidate.reference.canonicalUrl, retrievalMethod: candidate.retrievalMethod, retrievalUrl: candidate.retrievalUrl, capturedAt: candidate.capturedAt, sourceUpdatedAt: candidate.sourceUpdatedAt, userReviewedExactRole: true as const, userReviewedCompleteness: true as const }
  return namedPostingAcceptanceSchema.parse({ ...record, evidenceHash: createHash('sha256').update(JSON.stringify(record)).digest('hex') })
}

/** Builder only; the result is not trusted until verified against app-held attempt and candidate. */
export function createNamedPostingAcceptance(candidateInput: unknown, attemptInput: unknown, reviewInput: unknown, now = Date.now()): NamedPostingAcceptance {
  const candidate = namedPostingCandidateSchema.parse(candidateInput), attempt = namedPostingRetrievedAttemptSchema.parse(attemptInput), review = namedPostingReviewSchema.parse(reviewInput)
  assertBoundAndFresh(candidate, attempt, now)
  const candidateHash = createHash('sha256').update(JSON.stringify(candidate)).digest('hex')
  if (review.attemptId !== attempt.id || review.candidateHash !== candidateHash || Date.parse(review.reviewedAt) < Date.parse(candidate.capturedAt) || Date.parse(review.reviewedAt) > now) throw new Error('Review record is not bound to this candidate or has invalid timing.')
  return acceptanceFor(candidate, attempt, new Date(now).toISOString())
}

function assertBoundAndFresh(candidate: NamedPostingCandidate, attempt: z.infer<typeof namedPostingRetrievedAttemptSchema>, now: number) {
  if (attempt.id !== candidate.attemptId || JSON.stringify(attempt.reference) !== JSON.stringify(candidate.reference)) throw new Error('Candidate is not bound to the app-held retrieved attempt.')
  const start = Date.parse(attempt.startedAt), capture = Date.parse(candidate.capturedAt), expiry = Date.parse(attempt.expiresAt)
  if (start > capture || capture > now || now >= expiry || (candidate.sourceUpdatedAt && Date.parse(candidate.sourceUpdatedAt) > now)) throw new Error('Posting temporal order is invalid or temporary data expired.')
  if (!(start < expiry) || expiry - start > ttlMs) throw new Error('Attempt expiry is outside the bounded TTL.')
}

/** Verify stored acceptance by recomputation against independently app-held immutable objects. */
export function verifyNamedPostingAcceptance(acceptanceInput: unknown, appHeldCandidateInput: unknown, appHeldAttemptInput: unknown, appHeldReviewInput: unknown, now = Date.now()): NamedPostingAcceptance {
  const acceptance = namedPostingAcceptanceSchema.parse(acceptanceInput)
  const candidate = namedPostingCandidateSchema.parse(appHeldCandidateInput), attempt = namedPostingRetrievedAttemptSchema.parse(appHeldAttemptInput), review = namedPostingReviewSchema.parse(appHeldReviewInput)
  assertBoundAndFresh(candidate, attempt, now)
  const candidateHash = createHash('sha256').update(JSON.stringify(candidate)).digest('hex')
  if (review.attemptId !== attempt.id || review.candidateHash !== candidateHash || Date.parse(review.reviewedAt) > now) throw new Error('App-held review is not valid for this candidate and attempt.')
  const acceptedAt = Date.parse(acceptance.acceptedAt)
  if (acceptedAt < Date.parse(candidate.capturedAt) || acceptedAt < Date.parse(review.reviewedAt) || acceptedAt < Date.parse(attempt.startedAt) || acceptedAt >= Date.parse(attempt.expiresAt) || acceptedAt > now) throw new Error('Acceptance temporal order is invalid.')
  const expected = acceptanceFor(candidate, attempt, acceptance.acceptedAt)
  if (JSON.stringify(acceptance) !== JSON.stringify(expected)) throw new Error('Acceptance does not match the app-held reviewed posting and source attempt.')
  return expected
}
