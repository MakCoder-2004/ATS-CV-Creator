import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createJobResearchSessions } from '../src/main/job-research-session'
import { fetchDirectJobResearch } from '../src/main/job-research-fetch'
import { createTavilyResearchSession, TavilySearchError, type TavilyTransport } from '../src/main/tavily-search'
import { normalizeJobResearchUrl, verifyReviewedJobResearch, type JobResearchRun } from '../src/shared/job-research'

const URL = 'https://www.linkedin.com/jobs/view/4464025097/'
function synthetic(status: JobResearchRun['status'] = 'provisional'): JobResearchRun {
  const selected = normalizeJobResearchUrl(URL), id = randomUUID(), sourceId = randomUUID()
  const role = status === 'full' || status === 'provisional'
  return { version: 1, id, selected, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), status,
    ...(role ? {} : { accessFailure: 'unreadable' as const }), sources: role ? [{ version: 1, id: sourceId, url: URL, capturedAt: new Date().toISOString(), method: 'direct-html', identity: 'exact-role', title: 'Synthetic Engineer', employer: 'Invented Corp', employerIdentityUrl: null }] : [],
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

  it.each(['blocked', 'none'] as const)('keeps an exact-ID indexed lead as provisional when fresh direct is %s', async outcome => {
    const t = fixture(); let reads = 0
    const sessions = createJobResearchSessions({ credentials: t.credentials, createSearch: t.createSearch, direct: async () => ++reads === 1 ? synthetic('none') : synthetic(outcome) })
    const token = sessions.startJobResearch(URL).token; await tick()
    const state = await sessions.searchJobResearch(token)
    expect(state.status).toBe('ready')
    if (state.status === 'ready') {
      expect(state.run.status).toBe('provisional')
      expect(state.run.unknowns.join(' ')).toMatch(/Identity matched by selected URL only.*not independently confirmed on source/)
      const finding = state.run.findings[0]
      expect(finding).toMatchObject({ kind: 'indexed-role-claim', completeness: 'partial' })
      expect(state.run.sources.find(source => source.id === finding.sourceId)).toMatchObject({ url: URL, title: 'Synthetic Engineer — Invented Corp', employer: null, employerIdentityUrl: null, method: 'indexed-snippet' })
      expect(() => sessions.reviewJobResearch(token, [finding.id], false)).toThrow(/Acknowledge/)
      expect(sessions.reviewJobResearch(token, [finding.id], true).analysisScope).toBe('provisional')
    }
    expect(reads).toBe(2)
    sessions.close()
  })

  it('keeps original partial evidence but rejects an unclassified thrown re-read without leaking the error', async () => {
    const t = fixture(); let reads = 0
    const sessions = createJobResearchSessions({ credentials: t.credentials, createSearch: t.createSearch, direct: async () => {
      if (++reads === 1) return synthetic()
      throw new Error('sensitive source transport details')
    } })
    const token = sessions.startJobResearch(URL).token; await tick()
    const initial = sessions.getJobResearch(token)
    const state = await sessions.searchJobResearch(token)
    expect(state.status).toBe('ready')
    if (state.status === 'ready' && initial.status === 'ready') {
      expect(state.run.id).toBe(initial.run.id)
      expect(state.run.findings).toEqual(expect.arrayContaining(initial.run.findings))
      expect(state.run.findings.some(finding => finding.kind === 'indexed-role-claim')).toBe(false)
      expect(state.run.unknowns.join(' ')).toMatch(/could not be safely reached/)
      expect(JSON.stringify(state)).not.toContain('sensitive source transport details')
    }
    expect(reads).toBe(2)
    sessions.close()
  })

  it('never adds a snippet over a fresh complete direct posting', async () => {
    const t = fixture(); let reads = 0
    const sessions = createJobResearchSessions({ credentials: t.credentials, createSearch: t.createSearch, direct: async () => synthetic(++reads === 1 ? 'none' : 'full') })
    const token = sessions.startJobResearch(URL).token; await tick()
    const state = await sessions.searchJobResearch(token)
    expect(state.status).toBe('ready')
    if (state.status === 'ready') {
      expect(state.run.status).toBe('full')
      expect(state.run.findings).toHaveLength(1)
      expect(state.run.findings[0]).toMatchObject({ kind: 'direct-role-text', completeness: 'full' })
    }
    expect(reads).toBe(2)
    sessions.close()
  })

  it('rejects a different LinkedIn role ID even with the same title and employer', async () => {
    const t = fixture('https://www.linkedin.com/jobs/view/4464025098/')
    let reads = 0
    const sessions = createJobResearchSessions({ credentials: t.credentials, createSearch: t.createSearch, direct: async () => synthetic(++reads === 1 ? 'none' : 'blocked') })
    const token = sessions.startJobResearch(URL).token; await tick()
    const state = await sessions.searchJobResearch(token)
    expect(state.status).toBe('ready')
    if (state.status === 'ready') { expect(state.run.status).toBe('none'); expect(state.run.findings).toHaveLength(0) }
    expect(reads).toBe(1)
    sessions.close()
  })

  it('requires exact generic canonical URL, meaningful title and nonempty excerpt, not a namesake', async () => {
    const selected = 'https://careers.example.org/positions/engineer-42'
    for (const [lead, title, snippet, accepted] of [
      ['https://careers.example.org/positions/engineer-43', 'Engineer — Invented Corp', 'Maintain services.', false],
      [selected, 'Job', 'Maintain services.', false],
      [selected, 'Engineer — Invented Corp', ' ', false],
      [selected, 'Engineer — Invented Corp', 'Maintain services.', true],
    ] as const) {
      let reads = 0
      const credentials = fixture().credentials
      const sessions = createJobResearchSessions({ credentials, direct: async () => {
        reads++
        const original = synthetic('none')
        return { ...original, selected: normalizeJobResearchUrl(selected) }
      }, createSearch: () => ({ searchesDispatched: 1, search: async () => ({ links: [{ url: lead, title, snippet }], credits: 1 as const, requestId: 'synthetic' }) }) })
      const token = sessions.startJobResearch(selected).token; await tick()
      const state = await sessions.searchJobResearch(token)
      expect(state.status).toBe('ready')
      if (state.status === 'ready') {
        expect(state.run.status).toBe(accepted ? 'provisional' : 'none')
        expect(state.run.findings).toHaveLength(accepted ? 1 : 0)
        if (accepted) {
          const id = state.run.findings[0].id
          expect(() => sessions.reviewJobResearch(token, [id], false)).toThrow(/Acknowledge/)
          expect(sessions.reviewJobResearch(token, [id], true).analysisScope).toBe('provisional')
        }
      }
      expect(reads).toBe(accepted ? 2 : 1)
      sessions.close()
    }
  })

  it('retains both partial direct reads but rejects a conflicting indexed title', async () => {
    const t = fixture(URL, 'Unrelated Engineer — Another Employer'); let reads = 0
    const sessions = createJobResearchSessions({ credentials: t.credentials, createSearch: t.createSearch, direct: async () => synthetic(++reads === 1 ? 'provisional' : 'provisional') })
    const token = sessions.startJobResearch(URL).token; await tick()
    const original = sessions.getJobResearch(token)
    const state = await sessions.searchJobResearch(token)
    expect(state.status).toBe('ready')
    if (state.status === 'ready' && original.status === 'ready') {
      expect(state.run.status).toBe('provisional')
      expect(state.run.findings).toHaveLength(2)
      expect(state.run.findings).toEqual(expect.arrayContaining(original.run.findings))
      expect(state.run.findings.every(finding => finding.kind === 'direct-role-text')).toBe(true)
    }
    expect(reads).toBe(2)
    sessions.close()
  })

  it.each(['private DNS', 'unsafe redirect'] as const)('does not accept an indexed lead after %s', async failure => {
    const t = fixture(); let reads = 0
    const sessions = createJobResearchSessions({ credentials: t.credentials, createSearch: t.createSearch, direct: async () => {
      if (++reads === 1) return synthetic('none')
      if (failure === 'private DNS') throw new Error('The source resolved to a private or non-public address.')
      return { ...synthetic('blocked'), accessFailure: 'unsafe' as const, unknowns: ['The source redirected away from the selected role.'] }
    } })
    const token = sessions.startJobResearch(URL).token; await tick()
    const state = await sessions.searchJobResearch(token)
    expect(state.status).toBe('ready')
    if (state.status === 'ready') {
      expect(state.run.status).toBe('none')
      expect(state.run.findings).toHaveLength(0)
      expect(state.run.unknowns.join(' ')).toMatch(/could not be safely reached/)
    }
    sessions.close()
  })

  it.each(['cross-origin', 'role redirect', 'loop', 'private DNS', 'TLS', 'login', 'HTTP 403'] as const)('uses typed direct access outcome for %s fallback', async scenario => {
    const t = fixture(); let reads = 0
    const safeResponse = (status: number, location?: string) => ({ status, headers: location ? { location } : {}, body: Buffer.alloc(0) })
    const direct = async () => {
      if (++reads === 1) return synthetic('none')
      return fetchDirectJobResearch(URL, {
        lookup: async () => scenario === 'private DNS' ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '8.8.8.8', family: 4 }],
        request: async () => {
          if (scenario === 'TLS') throw new Error('synthetic TLS certificate failure')
          if (scenario === 'HTTP 403') return safeResponse(403)
          const location = scenario === 'cross-origin' ? 'https://other.example.org/jobs/view/4464025097/'
            : scenario === 'role redirect' ? 'https://www.linkedin.com/jobs/view/4464025098/'
            : scenario === 'loop' ? URL : 'https://www.linkedin.com/login'
          return safeResponse(302, location)
        },
      })
    }
    const sessions = createJobResearchSessions({ credentials: t.credentials, createSearch: t.createSearch, direct })
    const token = sessions.startJobResearch(URL).token; await tick()
    const state = await sessions.searchJobResearch(token)
    expect(state.status).toBe('ready')
    if (state.status === 'ready') {
      const allowed = scenario === 'login' || scenario === 'HTTP 403'
      expect(state.run.findings.some(finding => finding.kind === 'indexed-role-claim')).toBe(allowed)
      expect(state.run.status).toBe(allowed ? 'provisional' : 'none')
      if (!allowed) expect(state.run.unknowns.join(' ')).toMatch(/could not be safely reached/)
    }
    expect(reads).toBe(2)
    sessions.close()
  })

  it.each([
    ['Senior Synthetic Engineer — Invented Corp', false],
    ['Synthetic Engineer — Different Corp', false],
    ['Synthetic Engineer', false],
    ['SYNTHETIC ENGINEER at INVENTED CORP', true],
    ['Synthetic Engineer | Invented Corp', true],
  ] as const)('checks directly verified title against %s without substrings', async (indexedTitle, accepted) => {
    const t = fixture(URL, indexedTitle)
    const sessions = createJobResearchSessions({ credentials: t.credentials, createSearch: t.createSearch, direct: async () => synthetic() })
    const token = sessions.startJobResearch(URL).token; await tick()
    const state = await sessions.searchJobResearch(token)
    expect(state.status).toBe('ready')
    if (state.status === 'ready') {
      expect(state.run.findings.some(finding => finding.kind === 'indexed-role-claim')).toBe(accepted)
      expect(state.run.status).toBe('provisional')
    }
    sessions.close()
  })

  it('does not infer a safe fallback from legacy untagged blocked runs', async () => {
    const t = fixture(); let reads = 0
    const sessions = createJobResearchSessions({ credentials: t.credentials, createSearch: t.createSearch, direct: async () => {
      if (++reads === 1) return synthetic('none')
      const { accessFailure: _legacy, ...legacy } = synthetic('blocked')
      return { ...legacy, unknowns: ['Sign in to view this job.'] }
    } })
    const token = sessions.startJobResearch(URL).token; await tick()
    const state = await sessions.searchJobResearch(token)
    expect(state.status).toBe('ready')
    if (state.status === 'ready') expect(state.run.findings).toHaveLength(0)
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
