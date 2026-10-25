import { expect, test, vi } from 'vitest'
import { createTavilyResearchSession, TavilySearchError, type TavilyTransport } from '../src/main/tavily-search'

const usage = { key: { usage: 3, limit: 1000 }, account: { current_plan: 'Researcher', plan_usage: 3, plan_limit: 1000, paygo_usage: 0, paygo_limit: 0 } }
const results = { results: [{ url: 'https://jobs.example.org/posting/123#top', title: 'Engineer', content: 'Short public snippet.', raw_content: 'Must never leave adapter.' }], answer: 'Do not forward', usage: { credits: 1 }, request_id: 'request-123' }
const response = (value: unknown) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(value)) })
function fixture(plan: unknown = usage, search: unknown = results) {
  const sent: { path: string; headers: Readonly<Record<string, string>>; body?: Buffer; address: string; method: string }[] = []
  const transport: TavilyTransport = {
    lookup: vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]),
    request: vi.fn(async (url, address, method, headers, body) => {
      sent.push({ path: url.href, address: address.address, method, headers, body })
      return response(method === 'GET' ? plan : search)
    })
  }
  const key = 'tvly-SECRET-KEEP-PRIVATE'
  const credentials = { withKey: async <T>(use: (value: string) => Promise<T>) => use(key) }
  return { transport, credentials, sent, key }
}
const input = { kind: 'role' as const, title: 'Engineer', postingHost: 'jobs.example.org', roleId: '123' }

test('preflights free plan for every basic search and forwards only bounded attributed links', async () => {
  const f = fixture()
  const session = createTavilyResearchSession(f.credentials, { transport: f.transport })
  const result = await session.search(input)
  expect(result).toEqual({ links: [{ url: 'https://jobs.example.org/posting/123', title: 'Engineer', snippet: 'Short public snippet.' }], credits: 1, requestId: 'request-123' })
  expect(f.sent.map(call => call.path)).toEqual(['https://api.tavily.com/usage', 'https://api.tavily.com/search'])
  expect(f.sent.map(call => call.method)).toEqual(['GET', 'POST'])
  expect(f.sent.every(call => call.headers.Authorization === `Bearer ${f.key}` && call.address === '8.8.8.8')).toBe(true)
  expect(JSON.parse(f.sent[1].body!.toString())).toEqual({ query: 'Engineer 123 site:jobs.example.org', search_depth: 'basic', auto_parameters: false, include_answer: false, include_raw_content: false, max_results: 5, chunks_per_source: 1, topic: 'general', include_usage: true })
  expect(JSON.stringify(result)).not.toContain(f.key)
  expect(JSON.stringify(result)).not.toContain('Do not forward')
})

test('three dispatches per action are reserved synchronously even with concurrent calls', async () => {
  const f = fixture()
  const session = createTavilyResearchSession(f.credentials, { transport: f.transport })
  const work = [session.search(input), session.search(input), session.search(input)]
  await expect(session.search(input)).rejects.toThrow(/three-search limit/)
  await Promise.all(work)
  expect(session.searchesDispatched).toBe(3)
  expect(f.sent.filter(call => call.method === 'POST')).toHaveLength(3)
  expect(f.sent.map(call => call.method)).toEqual(['GET', 'POST', 'GET', 'POST', 'GET', 'POST'])
})

test.each([
  [{ ...usage, account: { ...usage.account, current_plan: 'Project' } }, 'paid plan'],
  [{ ...usage, account: { ...usage.account, current_plan: 'Researcher', paygo_limit: 100 } }, 'paid overage'],
  [{ ...usage, account: { ...usage.account, plan_usage: 1000 } }, 'exhausted credits'],
  [{ ...usage, account: { ...usage.account, paygo_limit: undefined } }, 'unknown paygo'],
  [{ ...usage, account: { ...usage.account, current_plan: 'researcher' } }, 'unknown plan name']
])('refuses %s before search dispatch (%s)', async (plan, _label) => {
  const f = fixture(plan)
  await expect(createTavilyResearchSession(f.credentials, { transport: f.transport }).search(input)).rejects.toThrow(/free Researcher plan/)
  expect(f.sent).toHaveLength(1)
})

test('rejects private or mixed DNS before passing key to a network request', async () => {
  const f = fixture()
  f.transport.lookup = async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]
  await expect(createTavilyResearchSession(f.credentials, { transport: f.transport }).search(input)).rejects.toThrow(/was accepted/)
  expect(f.sent).toHaveLength(0)
})

test.each([
  { ...results, results: Array(6).fill(results.results[0]) },
  { ...results, results: [{ ...results.results[0], url: 'http://localhost/' }] },
  { ...results, results: [{ ...results.results[0], content: 42 }] },
  { ...results, usage: { credits: 2 } },
  { ...results, request_id: 'invalid request id' }
])('rejects malformed provider search responses as evidence', async search => {
  const f = fixture(usage, search)
  await expect(createTavilyResearchSession(f.credentials, { transport: f.transport }).search(input)).rejects.toThrow(/was accepted/)
})

test.each(['https://127.0.0.1/x', 'https://[::1]/x', 'https://10.2.3.4/x', 'https://127.1/x', 'https://0x7f000001/x', 'https://service.local/x', 'https://service.internal/x', 'https://service.test/x', 'https://localhost/x', 'https://user:pass@jobs.example.org/x', 'http://jobs.example.org/x', 'https://jobs.example.org:8443/x', 'https://jobs.example.org:443/x', 'https://jobs.example.org\\@localhost/x', 'https://jobs.example.org./x', 'https://jobs.example.org/%0aevil'])('refuses untrusted unsafe result URL %s', async url => {
  const f = fixture(usage, { ...results, results: [{ ...results.results[0], url }] })
  await expect(createTavilyResearchSession(f.credentials, { transport: f.transport }).search(input)).rejects.toThrow(/was accepted/)
  expect(f.sent.filter(call => call.method === 'POST')).toHaveLength(1)
})

test.each([
  [401, 'authentication'], [402, 'billing'], [432, 'quota']
] as const)('classifies sanitized provider HTTP %s without posting a search', async (status, code) => {
  const f = fixture()
  f.transport.request = async () => ({ status, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"error":"tvly-SECRET-KEEP-PRIVATE"}') })
  const error = await createTavilyResearchSession(f.credentials, { transport: f.transport }).search(input).catch(e => e)
  expect(error).toBeInstanceOf(TavilySearchError)
  expect(error.code).toBe(code)
  expect(error.message).not.toContain(f.key)
})

test('billing refusal on search dispatch remains classified without leaking provider content', async () => {
  const f = fixture()
  const original = f.transport.request
  f.transport.request = async (...args) => args[2] === 'POST'
    ? { status: 402, headers: {}, body: Buffer.from(f.key) }
    : original(...args)
  const error = await createTavilyResearchSession(f.credentials, { transport: f.transport }).search(input).catch(e => e)
  expect(error).toBeInstanceOf(TavilySearchError)
  expect(error.code).toBe('billing')
  expect(error.message).not.toContain(f.key)
  expect(f.sent).toHaveLength(1)
})

test.each([
  { account: { current_plan: 'Researcher', plan_limit: 1000 }, key: { usage: 0, limit: 1000 } },
  { ...usage, account: { ...usage.account, current_plan: 'UndocumentedTier' } }
])('missing or undocumented plan fields have a distinct fail-closed code', async plan => {
  const f = fixture(plan)
  const error = await createTavilyResearchSession(f.credentials, { transport: f.transport }).search(input).catch(e => e)
  expect(error).toBeInstanceOf(TavilySearchError)
  expect(error.code).toBe('plan_unverified')
  expect(f.sent).toHaveLength(1)
})

test('unavailable provider response is generic, not mistaken for plan or billing', async () => {
  const f = fixture()
  f.transport.request = async () => ({ status: 503, headers: {}, body: Buffer.from(f.key) })
  const error = await createTavilyResearchSession(f.credentials, { transport: f.transport }).search(input).catch(e => e)
  expect(error).toBeInstanceOf(Error)
  expect(error).not.toBeInstanceOf(TavilySearchError)
  expect(error.message).not.toContain(f.key)
})

test('cancellation prevents search after preflight and masks provider exceptions containing secrets', async () => {
  const f = fixture()
  const controller = new AbortController()
  const original = f.transport.request
  f.transport.request = async (...args) => { const result = await original(...args); controller.abort(); return result }
  await expect(createTavilyResearchSession(f.credentials, { transport: f.transport, signal: controller.signal }).search(input)).rejects.toThrow(/cancelled/)
  expect(f.sent).toHaveLength(1)
  const broken = fixture()
  broken.transport.request = async () => { throw new Error(broken.key) }
  await expect(createTavilyResearchSession(broken.credentials, { transport: broken.transport }).search(input)).rejects.toThrow(/was accepted/)
})

test('refuses redirects and oversized JSON without following or returning evidence', async () => {
  const f = fixture()
  f.transport.request = async () => ({ status: 302, headers: { location: 'https://attacker.example/key', 'content-type': 'application/json' }, body: Buffer.from('{}') })
  await expect(createTavilyResearchSession(f.credentials, { transport: f.transport }).search(input)).rejects.toThrow(/was accepted/)
  const large = fixture()
  large.transport.request = async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.alloc(256 * 1024 + 1) })
  await expect(createTavilyResearchSession(large.credentials, { transport: large.transport }).search(input)).rejects.toThrow(/was accepted/)
})

test('a hung lookup times out without dispatching a paid request', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture()
    f.transport.lookup = async () => new Promise(() => {})
    const result = createTavilyResearchSession(f.credentials, { transport: f.transport }).search(input)
    const assertion = expect(result).rejects.toThrow(/was accepted/)
    await vi.advanceTimersByTimeAsync(12_001)
    await assertion
    expect(f.sent).toHaveLength(0)
  } finally { vi.useRealTimers() }
})

test('rejects non-public query data and does not contact provider', async () => {
  const f = fixture()
  const session = createTavilyResearchSession(f.credentials, { transport: f.transport })
  expect(() => session.search({ kind: 'company', verifiedEmployerDomain: 'private@example.org' })).toThrow(/domain|public/)
  expect(() => session.search({ ...input, title: 'Engineer\nprivate profile' })).toThrow(/public job metadata/)
  expect(f.sent).toHaveLength(0)
})
