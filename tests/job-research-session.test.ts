import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createJobResearchSessions } from '../src/main/job-research-session'
import { createTavilyResearchSession, TavilySearchError, type TavilyTransport } from '../src/main/tavily-search'
import { normalizeJobResearchUrl, verifyReviewedJobResearch, type JobResearchRun } from '../src/shared/job-research'

const URL = 'https://www.linkedin.com/jobs/view/4464025097/'
function synthetic(status: JobResearchRun['status'] = 'provisional'): JobResearchRun {
  const selected = normalizeJobResearchUrl(URL), id = randomUUID(), sourceId = randomUUID()
  const role = status === 'full' || status === 'provisional'
  return { version: 1, id, selected, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), status,
    sources: role ? [{ version: 1, id: sourceId, url: URL, capturedAt: new Date().toISOString(), method: 'direct-html', identity: 'exact-role', title: 'Synthetic Engineer', employer: 'Invented Corp', employerIdentityUrl: null }] : [],
    findings: role ? [{ version: 1, id: randomUUID(), sourceId, kind: 'direct-role-text', text: status === 'full' ? 'Build reliable software systems with TypeScript and carefully document operational changes for this entirely synthetic engineering team.' : 'TypeScript experience preferred.', completeness: status === 'full' ? 'full' : 'partial' }] : [], unknowns: role && status !== 'full' ? ['Full description unknown.'] : status === 'none' ? ['No public content found.'] : [] }
}
function fixture(url = URL, title = 'Synthetic Engineer — Invented Corp') {
  let requests = 0, searches = 0
  const transport: TavilyTransport = {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async (_url, _address, method, headers, body) => {
      requests++
      expect(headers.Authorization).toBe('Bearer fake-test-key')
      if (method === 'POST') {
        searches++
        const parsed = JSON.parse(body!.toString()) as Record<string, unknown>
        expect(parsed.search_depth).toBe('basic')
        expect(parsed.max_results).toBe(5)
        expect(parsed.include_answer).toBe(false)
        expect(parsed.include_raw_content).toBe(false)
        expect(parsed.query).toBe('job 4464025097 site:www.linkedin.com')
        expect(JSON.stringify(parsed)).not.toMatch(/profile|contact|resume|curriculum|@|utm_/i)
      }
      return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(method === 'GET'
        ? { account: { current_plan: 'Researcher', plan_limit: 1000, paygo_limit: 0, paygo_usage: 0, plan_usage: 0 }, key: { usage: 0, limit: 1000 } }
        : { usage: { credits: 1 }, request_id: 'synthetic-request', results: [{ url, title, content: 'Synthetic requirement: maintain TypeScript services.' }] })) }
    }
  }
  const credentials = { status: async () => ({ configured: true, storageAvailable: true, message: '' }), withKey: async <T>(use: (key: string) => Promise<T>) => use('fake-test-key') }
  return { credentials, createSearch: ((c: Pick<typeof credentials, 'withKey'>, options: { signal?: AbortSignal } = {}) => createTavilyResearchSession(c, { ...options, transport })), get requests() { return requests }, get searches() { return searches } }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('volatile public research session', () => {
  it('never searches on paste/start/read/review; issues only an app-held review and no stored job', async () => {
    const t = fixture(), direct = async () => synthetic('full')
    const sessions = createJobResearchSessions({ credentials: t.credentials, createSearch: t.createSearch, direct })
    const { token } = sessions.startJobResearch(URL)
    await tick()
    const state = sessions.getJobResearch(token)
    expect(state.status).toBe('ready')
    if (state.status !== 'ready') return
    const original = state.run
    const accepted = sessions.reviewJobResearch(token, [original.findings[0].id], false)
    expect(accepted.analysisScope).toBe('full')
    expect(sessions.verifyAppHeldReview(token, accepted)).toEqual(accepted)
    expect(() => sessions.verifyAppHeldReview(token, { ...accepted, evidenceHash: '0'.repeat(64) })).toThrow()
    expect(() => verifyReviewedJobResearch({ ...original, id: randomUUID() }, accepted)).toThrow()
    const trustedText = original.findings[0].text
    state.run.findings[0].text = 'Client-tampered evidence'
    expect(sessions.getJobResearch(token)).toMatchObject({ status: 'ready', run: { findings: [{ text: trustedText }] } })
    await expect(sessions.searchJobResearch(token)).rejects.toThrow(/complete/)
    expect(t.requests).toBe(0)
    sessions.close()
  })

  it('missing account gives a Settings action and sends no HTTP request', async () => {
    const t = fixture(), sessions = createJobResearchSessions({ credentials: { ...t.credentials, status: async () => ({ configured: false, storageAvailable: true, message: '' }) }, createSearch: t.createSearch, direct: async () => synthetic() })
    const { token } = sessions.startJobResearch(URL); await tick()
    expect(await sessions.searchJobResearch(token)).toMatchObject({ status: 'unavailable', settingsAction: true, message: expect.stringContaining('Settings') })
    expect(t.requests).toBe(0)
    expect(sessions.getJobResearch(token).status).toBe('ready')
    await expect(sessions.searchJobResearch(token)).rejects.toThrow(/one explicit/)
    sessions.close()
  })

  it('uses one basic Tavily search only on explicit action; exact-role partial evidence is reviewable, but never saved', async () => {
    const t = fixture(); let reads = 0
    const sessions = createJobResearchSessions({ credentials: t.credentials, createSearch: t.createSearch, direct: async () => { reads++; return synthetic() } })
    const { token } = sessions.startJobResearch(URL); await tick()
    expect(t.requests).toBe(0)
    expect(reads).toBe(1)
    const searched = await sessions.searchJobResearch(token)
    expect(t.searches).toBe(1)
    expect(t.requests).toBe(2) // free-plan /usage preflight and one /search
    expect(reads).toBe(2) // pinned exact selected URL re-read, never arbitrary result URL
    expect(searched.status).toBe('ready')
    if (searched.status !== 'ready') return
    expect(searched.run.status).toBe('provisional')
    const indexed = searched.run.findings.find(finding => finding.kind === 'indexed-role-claim')!
    expect(indexed.text).toContain('Synthetic requirement')
    expect(() => sessions.reviewJobResearch(token, [indexed.id], false)).toThrow(/Acknowledge/)
    expect(sessions.reviewJobResearch(token, [indexed.id], true).analysisScope).toBe('provisional')
    expect(() => sessions.reviewJobResearch(token, [randomUUID()], true)).toThrow(/app-issued/)
    expect(searched.run.sources.find(source => source.id === indexed.sourceId)?.url).toBe(URL)
    await expect(sessions.searchJobResearch(token)).rejects.toThrow(/one explicit/)
    sessions.close()
  })

  it('discards namesake search links and snippets without a direct verified role', async () => {
    const t = fixture('https://finaira.io/work-at-finaira/', 'Synthetic Engineer — Invented Corp')
    const sessions = createJobResearchSessions({ credentials: t.credentials, createSearch: t.createSearch, direct: async () => synthetic('none') })
    const { token } = sessions.startJobResearch(URL); await tick()
    const state = await sessions.searchJobResearch(token)
    expect(state.status).toBe('ready')
    if (state.status === 'ready') { expect(state.run.findings).toHaveLength(0); expect(state.run.status).toBe('none') }
    expect(t.searches).toBe(1)
    sessions.close()
  })

  it('does not turn a matched search snippet into evidence when the fresh direct read fails', async () => {
    const t = fixture(); let reads = 0
    const sessions = createJobResearchSessions({ credentials: t.credentials, createSearch: t.createSearch, direct: async () => ++reads === 1 ? synthetic('none') : synthetic('blocked') })
    const token = sessions.startJobResearch(URL).token; await tick()
    const state = await sessions.searchJobResearch(token)
    expect(state.status).toBe('ready')
    if (state.status === 'ready') { expect(state.run.findings).toHaveLength(0); expect(state.run.status).toBe('none') }
    expect(reads).toBe(2)
    sessions.close()
  })

  it('sanitizes billing and authentication errors without repeating a charged search', async () => {
    for (const code of ['authentication', 'billing', 'plan_unverified'] as const) {
      const t = fixture()
      const sessions = createJobResearchSessions({ credentials: t.credentials, direct: async () => synthetic(), createSearch: () => ({ searchesDispatched: 1, search: async () => { throw new TavilySearchError(code) } }) })
      const token = sessions.startJobResearch(URL).token; await tick()
      const state = await sessions.searchJobResearch(token)
      expect(state).toMatchObject({ status: 'unavailable', settingsAction: true })
      if (state.status === 'unavailable') expect(state.message).not.toMatch(/fake-test-key|synthetic-request/)
      expect(t.requests).toBe(0)
      await expect(sessions.searchJobResearch(token)).rejects.toThrow(/one explicit/)
      sessions.close()
    }
  })

  it('bounds temporary run count and removes older reviewed tokens when full', async () => {
    const t = fixture(), sessions = createJobResearchSessions({ credentials: t.credentials, direct: async () => synthetic() })
    const tokens: string[] = []
    for (let i = 0; i < 5; i++) { tokens.push(sessions.startJobResearch(URL).token); await tick() }
    const sixth = sessions.startJobResearch(URL).token
    expect(() => sessions.getJobResearch(tokens[0])).toThrow(/expired/)
    expect(sessions.getJobResearch(tokens[1]).status).toBe('ready')
    await tick(); expect(sessions.getJobResearch(sixth).status).toBe('ready')
    sessions.close()
  })

  it('rejects late direct/search results after cancellation or expiry', async () => {
    let finish!: (value: JobResearchRun) => void
    const sessions = createJobResearchSessions({ credentials: fixture().credentials, direct: () => new Promise(resolve => { finish = resolve }) })
    const token = sessions.startJobResearch(URL).token
    expect(sessions.cancelJobResearch(token)).toEqual({ ok: true })
    finish(synthetic())
    await tick()
    expect(() => sessions.getJobResearch(token)).toThrow(/expired/)
    sessions.close()
    const t = fixture(); let finishSearch!: (result: ReturnType<typeof synthetic>) => void
    const pending = createJobResearchSessions({ credentials: t.credentials, direct: async () => synthetic(), createSearch: () => ({ searchesDispatched: 1, search: () => new Promise(resolve => { finishSearch = resolve as never }) }) })
    const pendingToken = pending.startJobResearch(URL).token; await tick()
    const action = pending.searchJobResearch(pendingToken)
    await tick()
    pending.cancelJobResearch(pendingToken)
    finishSearch({ links: [{ url: URL, title: 'Synthetic Engineer — Invented Corp', snippet: 'untrusted late text' }], credits: 1, requestId: 'late' } as never)
    await expect(action).rejects.toThrow(/expired/)
    expect(() => pending.getJobResearch(pendingToken)).toThrow(/expired/)
    pending.close()
    let clock = 0
    const expiry = createJobResearchSessions({ credentials: fixture().credentials, now: () => clock, direct: async () => synthetic() })
    const expiredToken = expiry.startJobResearch(URL).token; await tick()
    clock += 15 * 60_000 + 1
    expect(() => expiry.getJobResearch(expiredToken)).toThrow(/expired/)
  })
})
