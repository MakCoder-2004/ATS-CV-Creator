import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createJobResearchSessions } from '../src/main/job-research-session'
import { normalizeJobResearchUrl, verifyReviewedJobResearch, type JobResearchRun } from '../src/shared/job-research'

const URL = 'https://jobs.example.org/role/4464025097'
function synthetic(status: JobResearchRun['status'] = 'provisional', url = URL): JobResearchRun {
  const selected = normalizeJobResearchUrl(url), id = randomUUID(), sourceId = randomUUID()
  const role = status === 'full' || status === 'provisional'
  return { version: 1, id, selected, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), status,
    ...(role ? {} : { accessFailure: 'unreadable' as const }), sources: role ? [{ version: 1, id: sourceId, url: selected.canonicalUrl, capturedAt: new Date().toISOString(), method: 'direct-html', identity: 'exact-role', title: 'Synthetic Engineer', employer: 'Invented Corp', employerIdentityUrl: null }] : [],
    findings: role ? [{ version: 1, id: randomUUID(), sourceId, kind: 'direct-role-text', text: status === 'full' ? 'Build and maintain reliable TypeScript services, document operational decisions, collaborate with the synthetic engineering team, and review software reliability outcomes.' : 'TypeScript experience preferred.', completeness: status === 'full' ? 'full' : 'partial' }] : [], unknowns: role && status !== 'full' ? ['Full description unknown.'] : status === 'none' ? ['No public content found.'] : [] }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('volatile public research session', () => {
  it('aborts and eagerly evicts reviewed source findings at the deadline', async () => {
    vi.useFakeTimers()
    try {
      const run = synthetic('full'), sessions = createJobResearchSessions({ direct: async () => run })
      const token = sessions.acceptInitialDirectRun(run).token
      sessions.reviewJobResearch(token, [run.findings[0].id], false)
      await vi.advanceTimersByTimeAsync(15 * 60_000)
      expect(() => sessions.getReviewedRun(token)).toThrow(/expired/)
      sessions.close()
    } finally { vi.useRealTimers() }
  })

  it('never dispatches indexed search or reads credentials, including for generic hosts', async () => {
    const status = vi.fn(async () => ({ configured: true, storageAvailable: true, message: '' }))
    const withKey = vi.fn(async <T>(use: (key: string) => Promise<T>) => use('must-not-be-read'))
    const providerDispatch = vi.fn()
    let directReads = 0
    const sessions = createJobResearchSessions({ credentials: { status, withKey }, createSearch: providerDispatch, direct: async () => { directReads++; return synthetic('provisional', 'https://careers.example.net/openings/77') } } as never)
    const token = sessions.startJobResearch('https://careers.example.net/openings/77').token
    await tick()
    const outcome = await sessions.searchJobResearch(token)
    expect(outcome).toMatchObject({ status: 'unavailable', settingsAction: false, searchOutcome: 'not-sent', message: expect.stringMatching(/manual paste.*no search request/i) })
    expect(directReads).toBe(1)
    expect(status).not.toHaveBeenCalled()
    expect(withKey).not.toHaveBeenCalled()
    expect(providerDispatch).not.toHaveBeenCalled()
    expect(sessions.getJobResearch(token)).toMatchObject({ status: 'ready', run: { status: 'provisional' } })
    sessions.close()
  })

  it('preserves direct research and app-held review independently of search', async () => {
    const run = synthetic('full')
    const sessions = createJobResearchSessions({ direct: async () => run })
    const { token } = sessions.startJobResearch(URL)
    await tick()
    const state = sessions.getJobResearch(token)
    expect(state).toMatchObject({ status: 'ready', run: { status: 'full' } })
    if (state.status !== 'ready') return
    const accepted = sessions.reviewJobResearch(token, [state.run.findings[0].id], false)
    expect(accepted.analysisScope).toBe('full')
    expect(sessions.verifyAppHeldReview(token, accepted)).toEqual(accepted)
    expect(() => sessions.verifyAppHeldReview(token, { ...accepted, evidenceHash: '0'.repeat(64) })).toThrow()
    expect(() => verifyReviewedJobResearch({ ...state.run, id: randomUUID() }, accepted)).toThrow()
    sessions.close()
  })

  it.each(['https://www.linkedin.com/jobs/view/4464025097/', 'https://www.indeed.com/viewjob?jk=abcdefgh'])('pauses automatic research for blocked source %s', sourceUrl => {
    let directReads = 0
    const sessions = createJobResearchSessions({ direct: async () => { directReads++; return synthetic('full') } })
    expect(() => sessions.startJobResearch(sourceUrl)).toThrow(/paused/)
    expect(directReads).toBe(0)
    sessions.close()
  })

  it('rejects a direct result for a different selected role', async () => {
    const wrongRole = synthetic('none', 'https://jobs.example.org/role/4464025098')
    const sessions = createJobResearchSessions({ direct: async () => wrongRole })
    const token = sessions.startJobResearch(URL).token
    await tick()
    expect(sessions.getJobResearch(token)).toMatchObject({ status: 'unavailable', message: expect.stringContaining('selected role identity') })
    sessions.close()
  })

  it('clears expiry timers when cancelled or closed', async () => {
    vi.useFakeTimers()
    try {
      const sessions = createJobResearchSessions({ direct: async () => synthetic('full') })
      const token = sessions.startJobResearch(URL).token
      await vi.advanceTimersByTimeAsync(0)
      expect(sessions.cancelJobResearch(token).ok).toBe(true)
      sessions.close()
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
