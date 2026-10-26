import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { acceptNamedPosting, namedPostingAcceptanceSchema, namedPostingAttemptSchema, namedPostingCandidateSchema, namedPostingReferenceSchema, parseNamedPostingUrl } from '../src/shared/named-posting-contract'

const now = Date.parse('2026-10-26T18:00:00.000Z'), capturedAt = new Date(now).toISOString()
const longText = 'Responsibilities: build and maintain reliable systems. Requirements: experience with testing, thoughtful communication, and collaboration across teams. '.repeat(2)
function fixture(url = 'https://jobs.lever.co/acme/platform-1') {
  const parsed = parseNamedPostingUrl(url), id = randomUUID()
  const reference = { ...parsed, submittedUrl: url }
  const attempt = { id, reference, startedAt: capturedAt, status: 'retrieved' as const, expiresAt: new Date(now + 60_000).toISOString() }
  const candidate = { version: 1 as const, attemptId: id, reference, returnedBoard: parsed.board, returnedPostingId: parsed.postingId, title: 'Platform Engineer', employer: 'Acme', text: longText, completeness: 'full' as const, capturedAt, sourceUpdatedAt: capturedAt, provenanceUrl: parsed.canonicalUrl }
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
  it.each(['https://jobs.lever.co/acme/platform-1/apply', 'https://jobs.lever.co/acme/platform-1?source=x', 'https://jobs.lever.co/acme/platform-1#apply', 'https://evil.example/acme/platform-1', 'https://boards.greenhouse.io/acme/jobs/not-an-id', 'https://boards.greenhouse.io/acme/jobs/123?gh_src=x', 'http://jobs.lever.co/acme/platform-1', 'https://user@jobs.lever.co/acme/platform-1', 'https://jobs.lever.co/acme', 'https://jobs.lever.co/acme/platform-1/extra'])('fails closed on unsupported URL %s', url => expect(() => parseNamedPostingUrl(url)).toThrow())
  it('requires returned site and posting ID to match exactly (namesakes do not match)', () => {
    const { candidate } = fixture()
    expect(namedPostingCandidateSchema.safeParse({ ...candidate, returnedBoard: 'other' }).success).toBe(false)
    expect(namedPostingCandidateSchema.safeParse({ ...candidate, returnedPostingId: 'platform-2' }).success).toBe(false)
    expect(namedPostingCandidateSchema.safeParse({ ...candidate, title: 'Platform Engineer — 東京' }).success).toBe(true)
    expect(namedPostingCandidateSchema.safeParse({ ...candidate, provenanceUrl: 'https://jobs.lever.co/acme/other' }).success).toBe(false)
  })
  it('requires app-held retrieved attempt, unexpired complete candidate and explicit review before acceptance', () => {
    const { attempt, candidate } = fixture()
    expect(() => acceptNamedPosting(candidate, attempt, { exactRole: false, completeness: true }, now)).toThrow(/review/)
    expect(() => acceptNamedPosting({ ...candidate, completeness: 'partial' }, attempt, { exactRole: true, completeness: true }, now)).toThrow()
    expect(() => acceptNamedPosting(candidate, { ...attempt, expiresAt: capturedAt }, { exactRole: true, completeness: true }, now)).toThrow(/expired/)
    expect(() => acceptNamedPosting(candidate, { ...attempt, id: randomUUID() }, { exactRole: true, completeness: true }, now)).toThrow(/bound/)
    const accepted = acceptNamedPosting(candidate, attempt, { exactRole: true, completeness: true }, now)
    expect(namedPostingAcceptanceSchema.safeParse(accepted).success).toBe(true)
    expect(accepted).toMatchObject({ source: 'lever', board: 'acme', postingId: 'platform-1', userReviewedExactRole: true, userReviewedCompleteness: true })
    expect(accepted.evidenceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(() => acceptNamedPosting(accepted, attempt, { exactRole: true, completeness: true }, now)).toThrow()
  })
  it.each(['not-found', 'expired', 'login-required', 'incomplete', 'unsafe-redirect', 'unsafe-address', 'cancelled', 'deadline', 'ambiguous', 'opt-in-required', 'source-error'] as const)('models %s as failure with no candidate promotion', reason => {
    const { attempt, candidate } = fixture()
    const { expiresAt: _expiresAt, ...temporaryAttempt } = attempt
    const failed = { ...temporaryAttempt, status: 'failed' as const, reason }
    expect(namedPostingAttemptSchema.safeParse(failed).success).toBe(true)
    expect(() => acceptNamedPosting(candidate, failed, { exactRole: true, completeness: true }, now)).toThrow(/retrieved/)
  })
  it('does not mistake decorated or conflicting selection identity for canonical identity', () => {
    expect(() => parseNamedPostingUrl('https://boards.greenhouse.io/acme/jobs/123/other-role?gh_jid=456')).toThrow()
    expect(() => parseNamedPostingUrl('https://jobs.lever.co/acme/role%2Fother')).toThrow()
  })
})
