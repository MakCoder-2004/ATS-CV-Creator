import { describe, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { createNamedPostingAcceptance, namedPostingAcceptanceSchema, namedPostingAttemptSchema, namedPostingCandidateSchema, namedPostingReferenceSchema, parseNamedPostingUrl, verifyNamedPostingAcceptance } from '../src/shared/named-posting-contract'

const now = Date.parse('2026-10-26T18:00:00.000Z'), capturedAt = new Date(now).toISOString(), optedInAt = new Date(now - 1_000).toISOString()
const longText = 'Responsibilities: build and maintain reliable systems. Requirements: experience with testing, thoughtful communication, and collaboration across teams. '.repeat(2)
function fixture(url = 'https://jobs.lever.co/acme/platform-1') {
  const parsed = parseNamedPostingUrl(url), id = randomUUID()
  const reference = { ...parsed, submittedUrl: url }
  const attempt = { id, reference, startedAt: capturedAt, status: 'retrieved' as const, expiresAt: new Date(now + 60_000).toISOString(), eligibility: { personalLocalOptIn: true as const, source: parsed.source, scope: 'personal-local' as const, optedInAt } }
  const route = parsed.source === 'lever' ? { retrievalMethod: 'lever-postings-api-v0' as const, retrievalUrl: `https://api.lever.co/v0/postings/${parsed.board}/${parsed.postingId}` } : { retrievalMethod: 'greenhouse-job-board-api-v1' as const, retrievalUrl: `https://boards-api.greenhouse.io/v1/boards/${parsed.board}/jobs/${parsed.postingId}` }
  const candidate = { version: 1 as const, attemptId: id, reference, returnedBoard: parsed.board, returnedPostingId: parsed.postingId, title: 'Platform Engineer', employer: 'Acme', text: longText, completeness: 'full' as const, capturedAt, sourceUpdatedAt: capturedAt, ...route }
  return { attempt, candidate }
}

describe('named posting URL references (contract only; no network)', () => {
  it.each([
    ['https://jobs.lever.co/acme/platform-1', 'lever', 'acme', 'platform-1'],
    ['https://boards.greenhouse.io/acme/jobs/12345/platform-engineer', 'greenhouse', 'acme', '12345'],
    ['https://job-boards.greenhouse.io/acme/jobs/12345', 'greenhouse', 'acme', '12345'],
  ] as const)('normalizes supported exact posting %s', (url, source, board, postingId) => {
    expect(parseNamedPostingUrl(url)).toMatchObject({ source, board, postingId })
    expect(namedPostingReferenceSchema.safeParse({ ...parseNamedPostingUrl(url), submittedUrl: url }).success).toBe(true)
  })
  it.each(['https://jobs.lever.co/acme/platform-1/apply', 'https://jobs.lever.co/acme/platform-1?source=x', 'https://jobs.lever.co/acme/platform-1#apply', 'https://jobs.lever.co/acme/platform-1?', 'https://jobs.lever.co/acme/platform-1#', 'https://evil.example/acme/platform-1', 'https://boards.greenhouse.io/acme/jobs/not-an-id', 'https://boards.greenhouse.io/acme/jobs/123?gh_src=x', 'http://jobs.lever.co/acme/platform-1', 'https://user@jobs.lever.co/acme/platform-1', 'https://jobs.lever.co/acme', 'https://jobs.lever.co/acme/platform-1/extra'])('fails closed on unsupported URL %s', url => expect(() => parseNamedPostingUrl(url)).toThrow())
  it('requires returned site and posting ID to match exactly (namesakes do not match)', () => {
    const { candidate } = fixture()
    expect(namedPostingCandidateSchema.safeParse({ ...candidate, returnedBoard: 'other' }).success).toBe(false)
    expect(namedPostingCandidateSchema.safeParse({ ...candidate, returnedPostingId: 'platform-2' }).success).toBe(false)
    expect(namedPostingCandidateSchema.safeParse({ ...candidate, title: 'Platform Engineer — 東京' }).success).toBe(true)
    expect(namedPostingCandidateSchema.safeParse({ ...candidate, provenanceUrl: 'https://jobs.lever.co/acme/other' }).success).toBe(false)
  })
  it('requires source-specific local opt-in, bounded chronology and named API provenance', () => {
    const { attempt, candidate } = fixture()
    expect(namedPostingAttemptSchema.safeParse({ ...attempt, eligibility: { ...attempt.eligibility, source: 'greenhouse' } }).success).toBe(false)
    expect(namedPostingAttemptSchema.safeParse({ ...attempt, startedAt: new Date(now + 1).toISOString() }).success).toBe(true)
    expect(namedPostingAttemptSchema.safeParse({ ...attempt, expiresAt: new Date(now + 10 * 60_000 + 1).toISOString() }).success).toBe(false)
    expect(namedPostingCandidateSchema.safeParse({ ...candidate, retrievalUrl: 'https://jobs.lever.co/acme/platform-1' }).success).toBe(false)
    expect(namedPostingCandidateSchema.safeParse({ ...candidate, retrievalMethod: 'greenhouse-job-board-api-v1' }).success).toBe(false)
    expect(() => createNamedPostingAcceptance(candidate, { ...attempt, startedAt: new Date(now + 1).toISOString(), eligibility: { ...attempt.eligibility, optedInAt: new Date(now).toISOString() } }, { exactRole: true, completeness: true }, now)).toThrow()
  })
  it('requires app-held retrieved attempt, unexpired complete candidate and explicit review before acceptance', () => {
    const { attempt, candidate } = fixture()
    const review = { attemptId: attempt.id, candidateHash: createHash('sha256').update(JSON.stringify(namedPostingCandidateSchema.parse(candidate))).digest('hex'), reviewedAt: capturedAt, exactRole: true as const, completeness: true as const }
    expect(() => createNamedPostingAcceptance(candidate, attempt, { ...review, exactRole: false }, now)).toThrow()
    expect(() => createNamedPostingAcceptance({ ...candidate, completeness: 'partial' }, attempt, review, now)).toThrow()
    expect(() => createNamedPostingAcceptance(candidate, { ...attempt, expiresAt: capturedAt }, review, now)).toThrow()
    expect(() => createNamedPostingAcceptance(candidate, { ...attempt, id: randomUUID() }, review, now)).toThrow(/bound/)
    const accepted = createNamedPostingAcceptance(candidate, attempt, review, now)
    expect(namedPostingAcceptanceSchema.safeParse(accepted).success).toBe(true)
    expect(verifyNamedPostingAcceptance(accepted, candidate, attempt, review, now)).toEqual(accepted)
    expect(accepted).toMatchObject({ source: 'lever', board: 'acme', postingId: 'platform-1', userReviewedExactRole: true, userReviewedCompleteness: true })
    expect(accepted.evidenceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(() => verifyNamedPostingAcceptance(accepted, { ...candidate, text: candidate.text + ' forged' }, attempt, review, now)).toThrow(/app-held|review/)
    expect(() => verifyNamedPostingAcceptance({ ...accepted, text: accepted.text + ' forged' }, candidate, attempt, review, now)).toThrow(/match/)
    expect(() => verifyNamedPostingAcceptance({ ...accepted, evidenceHash: 'a'.repeat(64) }, candidate, attempt, review, now)).toThrow(/match/)
    expect(() => verifyNamedPostingAcceptance(accepted, candidate, attempt, { ...review, candidateHash: 'b'.repeat(64) }, now)).toThrow(/review/)
  })
  it.each(['not-found', 'expired', 'login-required', 'incomplete', 'unsafe-redirect', 'unsafe-address', 'cancelled', 'deadline', 'ambiguous', 'opt-in-required', 'source-error'] as const)('models %s as failure with no candidate promotion', reason => {
    const { attempt, candidate } = fixture()
    const { expiresAt: _expiresAt, eligibility: _eligibility, ...temporaryAttempt } = attempt
    const failed = { ...temporaryAttempt, status: 'failed' as const, reason }
    expect(namedPostingAttemptSchema.safeParse(failed).success).toBe(true)
    expect(() => createNamedPostingAcceptance(candidate, failed, { exactRole: true, completeness: true }, now)).toThrow()
  })
  it('rejects a changed submitted URL despite the same canonical job and bounds review timing', () => {
    const { attempt, candidate } = fixture('https://boards.greenhouse.io/acme/jobs/123/platform-engineer')
    const other = { ...candidate, reference: { ...candidate.reference, submittedUrl: 'https://boards.greenhouse.io/acme/jobs/123/other-role' } }
    expect(namedPostingCandidateSchema.safeParse(other).success).toBe(true)
    const candidateHash = createHash('sha256').update(JSON.stringify(namedPostingCandidateSchema.parse(other))).digest('hex')
    const review = { attemptId: attempt.id, candidateHash, reviewedAt: capturedAt, exactRole: true as const, completeness: true as const }
    expect(() => createNamedPostingAcceptance(other, attempt, review, now)).toThrow(/bound/)
    const originalHash = createHash('sha256').update(JSON.stringify(namedPostingCandidateSchema.parse(candidate))).digest('hex')
    for (const reviewedAt of [new Date(now - 1).toISOString(), new Date(now + 1).toISOString()]) {
      expect(() => createNamedPostingAcceptance(candidate, attempt, { ...review, candidateHash: originalHash, reviewedAt }, now)).toThrow(/timing/)
    }
  })
  it('accepts only global Lever host and rejects unsafe URL decorations', () => {
    expect(() => parseNamedPostingUrl('https://boards.greenhouse.io/acme/jobs/123/other-role?gh_jid=456')).toThrow()
    expect(() => parseNamedPostingUrl('https://jobs.lever.co/acme/role%2Fother')).toThrow()
    expect(() => parseNamedPostingUrl('https://jobs.lever.co/acme/role\nother')).toThrow()
    expect(() => parseNamedPostingUrl('https://jobs.eu.lever.co/acme/role')).toThrow()
    expect(() => parseNamedPostingUrl('https://boards.greenhouse.io/acme/jobs/123/role%2Fother')).toThrow()
  })
})
