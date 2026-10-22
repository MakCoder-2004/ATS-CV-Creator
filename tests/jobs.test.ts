import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createWorkbench } from '../src/main/workbench'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) })
function open() {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-jobs-'))
  directories.push(directory)
  return { directory, workbench: createWorkbench(directory) }
}

test('saved jobs preserve original posting text, have stable IDs, and reopen after SQLite restart', async () => {
  const { directory, workbench } = open()
  const original = '\n  Responsibilities:\n- Build reliable systems.\n  Requirements: TypeScript.  \n'
  const saved = await workbench.api.saveJob({ title: 'Engineer', company: 'Fictional Co', description: original })
  expect(saved.ok).toBe(true)
  if (!saved.ok) throw Error(saved.error.message)
  expect(saved.value).toMatchObject({ title: 'Engineer', company: 'Fictional Co', description: original, provenance: 'manual', sourceSnapshot: null, revisions: [{ title: 'Engineer', company: 'Fictional Co', description: original, revision: 1, provenance: 'manual' }] })
  const id = saved.value.id
  expect(await workbench.api.listJobs()).toEqual([saved.value])
  workbench.close()

  const reopened = createWorkbench(directory)
  expect(await reopened.api.openJob(id)).toEqual(saved.value)
  expect(await reopened.api.listJobs()).toEqual([saved.value])
  reopened.close()
})

test('reviewed link imports save atomically with immutable source provenance and reopen offline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-reviewed-import-'))
  directories.push(directory)
  const calls: string[] = []
  const description = `Responsibilities\n${'The fictional engineering team builds reliable software and maintains dependable systems with careful collaboration. '.repeat(4)}\nRequirements\n• Build reliable services with the fictional team.`
  const responseBody = JSON.stringify({ id: 'review-save-1', text: 'Source Engineer', company: 'Example Source Co', descriptionPlain: description, lists: [{ text: 'Responsibilities', content: '<li>Build reliable services with the fictional team.</li>' }] })
  const imported = createWorkbench(directory, undefined, undefined, undefined, { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async url => { calls.push(url.href); return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(responseBody) } } })
  let importedClosed = false
  try {
    const { token } = await imported.api.startPostingFetch('https://jobs.lever.co/example-board/review-save-1')
    let state = await imported.api.readPostingPreview(token)
    for (let attempt = 0; attempt < 50 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 2)); state = await imported.api.readPostingPreview(token) }
    expect(state.status).toBe('ready')
    if (state.status !== 'ready') throw Error('Synthetic source was not ready')
    const reviewedDescription = `${state.preview.description}\nReviewed clarification: include the fictional on-call rotation.`
    const result = await imported.api.acceptPostingImport(token, { title: 'Reviewed Engineer', company: 'Corrected Example Co', description: reviewedDescription })
    expect(result).toMatchObject({ ok: true, value: { title: 'Reviewed Engineer', company: 'Corrected Example Co', provenance: 'imported', sourceSnapshot: { title: 'Source Engineer', company: 'Example Source Co', submittedUrl: 'https://jobs.lever.co/example-board/review-save-1', finalUrl: 'https://api.lever.co/v0/postings/example-board/review-save-1', extractionMethod: 'lever-json-v1', fieldOrigins: { title: 'user-correction', company: 'user-correction', description: 'user-correction' } }, revisions: [{ title: 'Reviewed Engineer', company: 'Corrected Example Co', revision: 1, provenance: 'imported' }] } })
    if (!result.ok) throw Error(result.error.message)
    expect(result.value.sourceSnapshot?.description).not.toBe(result.value.description)
    const repeated = await imported.api.acceptPostingImport(token, { title: 'Reviewed Engineer', company: 'Corrected Example Co', description: reviewedDescription })
    expect(repeated).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await imported.api.listJobs()).toHaveLength(1)
    expect((await imported.api.getAnalysisUsage()).attempts).toBe(0)
    const id = result.value.id
    imported.close(); importedClosed = true
    const reopened = createWorkbench(directory)
    try {
      expect(await reopened.api.openJob(id)).toEqual(result.value)
      expect(calls).toHaveLength(1)
    } finally { reopened.close() }
  } finally { if (!importedClosed) imported.close() }
})

test('posting fetch previews run through the public application contract and stay ephemeral', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-safe-fetch-'))
  directories.push(directory)
  const calls: Array<{ url: string; address: string; headers: Readonly<Record<string, string>> }> = []
  const responseBody = JSON.stringify({ id: 'synthetic-123', text: 'Synthetic Platform Engineer', descriptionPlain: 'Build reliable example systems for the fictional organization. The person in this role will collaborate with a diverse team to deliver practical software improvements and maintain dependable systems over time.\nResponsibilities\nDesign safe interfaces.', descriptionBodyPlain: 'Responsibilities\nDesign safe interfaces.', lists: [{ text: 'Requirements', content: '<li>Experience with testing.</li>' }] })
  const options = { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async (url: URL, address: { address: string }, _signal: AbortSignal, headers: Readonly<Record<string, string>>) => { calls.push({ url: url.href, address: address.address, headers }); return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(responseBody) } } }
  const workbench = createWorkbench(directory, undefined, undefined, undefined, options)
  let reopened: ReturnType<typeof createWorkbench> | undefined
  try {
    expect(await workbench.api.listJobs()).toEqual([])
    const started = await workbench.api.startPostingFetch('https://jobs.lever.co/example-board/synthetic-123')
    let state = await workbench.api.readPostingPreview(started.token)
    for (let attempt = 0; attempt < 200 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); state = await workbench.api.readPostingPreview(started.token) }
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ url: 'https://api.lever.co/v0/postings/example-board/synthetic-123', address: '8.8.8.8', headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'CV-Tailor/1.0' } })
    expect(state).toMatchObject({ status: 'incomplete', preview: { title: 'Synthetic Platform Engineer', company: null, description: expect.stringContaining('• Experience with testing.') } })
    expect(await workbench.api.listJobs()).toEqual([])
    expect((await workbench.api.getAnalysisUsage()).attempts).toBe(0)
    workbench.close()
    reopened = createWorkbench(directory)
    expect(await reopened.api.listJobs()).toEqual([])
    expect(await reopened.api.readPostingPreview(started.token)).toEqual({ status: 'failed', message: 'This temporary preview is no longer available.' })
  } finally { workbench.close(); reopened?.close() }
})

test('posting fetch preserves the Lever opening and reconciles adversarial list sections in a bounded extraction', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-extraction-'))
  directories.push(directory)
  const items = Array.from({ length: 10 }, (_, item) => `Repeated synthetic requirement ${item} with supporting detail.`)
  const description = `${'Fictional contextual posting text. '.repeat(4_000)}\n${items.join('\n')}`
  const lists = Array.from({ length: 1_000 }, (_, group) => ({ text: `Section ${group}`, content: items.map(item => `<li>${item}</li>`).join('') }))
  const body = JSON.stringify({ id: 'extract-me', text: 'Synthetic Systems Engineer', company: 'Example Employer', descriptionPlain: description, opening: '<p>Opening detail preserved from the source.</p>', lists })
  const workbench = createWorkbench(directory, undefined, undefined, undefined, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(body) }),
    wait: async () => {}, now: () => Date.now()
  })
  try {
    const { token } = await workbench.api.startPostingFetch('https://jobs.lever.co/example-board/extract-me')
    let state = await workbench.api.readPostingPreview(token)
    for (let attempt = 0; attempt < 100 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 5)); state = await workbench.api.readPostingPreview(token) }
    expect(state, JSON.stringify(state).slice(0, 500)).toMatchObject({ status: 'ready' })
    if (state.status === 'ready') {
      expect(state.preview.description).toContain('Opening detail preserved from the source.')
      expect(state.preview.description).toContain('• Repeated synthetic requirement 9 with supporting detail.')
      expect(state.preview.description.match(/• Repeated synthetic requirement /g)).toHaveLength(10)
    }
  } finally { workbench.close() }
})

test('posting fetch rejects unsupported links before contacting a source and cancels active reads', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-cancel-'))
  directories.push(directory)
  let requestStarted!: () => void
  let resolveLate!: (response: { status: number; headers: Record<string, string>; body: Buffer }) => void
  let dnsLookups = 0
  const startedRequest = new Promise<void>(resolve => { requestStarted = resolve })
  let apiWorkbench: ReturnType<typeof createWorkbench> | undefined
  try {
    apiWorkbench = createWorkbench(directory, undefined, undefined, undefined, {
      lookup: async () => { dnsLookups++; return [{ address: '8.8.4.4', family: 4 }] },
      request: async () => new Promise(resolve => { requestStarted(); resolveLate = resolve })
    })
    await expect(apiWorkbench.api.startPostingFetch('https://unknown.example/job')).rejects.toThrow(/Lever job-detail/)
    expect(dnsLookups).toBe(0)
    const active = await apiWorkbench.api.startPostingFetch('https://jobs.lever.co/example-board/cancel-me')
    await startedRequest
    expect(await apiWorkbench.api.cancelPostingFetch(active.token)).toEqual({ ok: true })
    expect(await apiWorkbench.api.readPostingPreview(active.token)).toEqual({ status: 'cancelled' })
    resolveLate({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ id: 'cancel-me', text: 'Late response', company: 'Example', descriptionPlain: 'This response arrived only after cancellation.' })) })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await apiWorkbench.api.readPostingPreview(active.token)).toEqual({ status: 'cancelled' })
    expect(await apiWorkbench.api.listJobs()).toEqual([])
  } finally { apiWorkbench?.close() }
})

test('posting fetch cancellation interrupts pending DNS before opening a connection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-dns-cancel-'))
  directories.push(directory)
  let dnsStarted!: () => void, requests = 0
  const startedDns = new Promise<void>(resolve => { dnsStarted = resolve })
  const workbench = createWorkbench(directory, undefined, undefined, undefined, {
    lookup: async () => new Promise(() => { dnsStarted() }),
    request: async () => { requests++; return { status: 200, headers: {}, body: Buffer.alloc(0) } }
  })
  try {
    const { token } = await workbench.api.startPostingFetch('https://jobs.lever.co/example-board/dns-cancel')
    await startedDns
    expect(await workbench.api.cancelPostingFetch(token)).toEqual({ ok: true })
    expect(await workbench.api.readPostingPreview(token)).toEqual({ status: 'cancelled' })
    expect(requests).toBe(0)
    expect(workbench.hasActiveWork()).toBe(false)
  } finally { workbench.close() }
})

test('posting fetch fails closed on mixed public/private DNS and redirect pivots', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-destinations-'))
  directories.push(directory)
  let blockedRequests = 0, dnsCalls = 0, redirectRequests = 0
  const workbench = createWorkbench(directory, undefined, undefined, undefined, {
    lookup: async () => { dnsCalls++; return [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] },
    request: async () => { blockedRequests++; return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.alloc(0) } },
    wait: async () => {}, now: () => Date.now()
  })
  try {
    const privateTarget = await workbench.api.startPostingFetch('https://jobs.lever.co/example-board/private')
    let state = await workbench.api.readPostingPreview(privateTarget.token)
    for (let attempt = 0; attempt < 100 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 5)); state = await workbench.api.readPostingPreview(privateTarget.token) }
    expect(state).toMatchObject({ status: 'failed', message: expect.stringContaining('non-public') })
    expect(blockedRequests).toBe(0)

    const redirectDirectory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-redirect-'))
    directories.push(redirectDirectory)
    const redirectWork = createWorkbench(redirectDirectory, undefined, undefined, undefined, {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async () => { redirectRequests++; return { status: 302, headers: {}, location: 'https://evil.example/private', body: Buffer.alloc(0) } },
      wait: async () => {}, now: () => Date.now()
    })
    try {
      const pivot = await redirectWork.api.startPostingFetch('https://jobs.lever.co/example-board/pivot')
      let pivotState = await redirectWork.api.readPostingPreview(pivot.token)
      for (let attempt = 0; attempt < 100 && pivotState.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 5)); pivotState = await redirectWork.api.readPostingPreview(pivot.token) }
      expect(pivotState).toMatchObject({ status: 'failed', message: expect.stringContaining('outside the approved') })
      expect(redirectRequests).toBe(1)
    } finally { redirectWork.close() }
    expect(dnsCalls).toBe(1)
    expect(await workbench.api.listJobs()).toEqual([])
  } finally { workbench.close() }
})

test('posting import retries one transient response and never saves on fetch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-retry-'))
  directories.push(directory)
  const attempts: number[] = [], waits: number[] = []
  const text = 'This synthetic role supports an example team by improving a fictional product, documenting operational decisions, and collaborating with colleagues across the organization. Responsibilities include maintaining services and writing clear technical documentation for internal users.'
  const body = JSON.stringify({ id: 'retry-me', text: 'Example Reliability Engineer', company: 'Synthetic Employer', descriptionPlain: `Responsibilities\n${text}`, lists: [{ text: 'Responsibilities', content: '<li>Maintain example services.</li>' }] })
  let workbench: ReturnType<typeof createWorkbench> | undefined
  try {
    workbench = createWorkbench(directory, undefined, undefined, undefined, {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async () => { attempts.push(attempts.length + 1); return attempts.length === 1 ? { status: 503, headers: {}, body: Buffer.alloc(0) } : { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(body) } },
      wait: async ms => { waits.push(ms) },
      now: () => Date.now()
    })
    const { token } = await workbench.api.startPostingFetch('https://jobs.lever.co/example-board/retry-me')
    let state = await workbench.api.readPostingPreview(token)
    for (let attempt = 0; attempt < 100 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 5)); state = await workbench.api.readPostingPreview(token) }
    expect(attempts).toHaveLength(2)
    expect(waits).toContain(2_000)
    expect(state).toMatchObject({ status: 'ready', preview: { company: 'Synthetic Employer', description: expect.stringContaining('• Maintain example services.') } })
    const repeated = await workbench.api.startPostingFetch('https://jobs.lever.co/example-board/retry-me')
    state = await workbench.api.readPostingPreview(repeated.token)
    for (let attempt = 0; attempt < 100 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 5)); state = await workbench.api.readPostingPreview(repeated.token) }
    expect(attempts).toHaveLength(3)
    expect(waits.some(ms => ms > 1_000 && ms < 2_000)).toBe(true)
    expect(await workbench.api.listJobs()).toEqual([])
    expect((await workbench.api.getAnalysisUsage()).attempts).toBe(0)
  } finally { workbench?.close() }
})

test('posting fetch enforces its response deadline through the public application contract', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-deadline-'))
  directories.push(directory)
  let requestStarted!: () => void
  const startedRequest = new Promise<void>(resolve => { requestStarted = resolve })
  vi.useFakeTimers()
  const workbench = createWorkbench(directory, undefined, undefined, undefined, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async () => new Promise(() => { requestStarted() }),
    wait: async () => {}, now: () => Date.now()
  })
  try {
    const { token } = await workbench.api.startPostingFetch('https://jobs.lever.co/example-board/timeout')
    await startedRequest
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await workbench.api.readPostingPreview(token)).toMatchObject({ status: 'failed', message: expect.stringContaining('15 seconds') })
    expect(await workbench.api.listJobs()).toEqual([])
  } finally { workbench.close(); vi.useRealTimers() }
})

test('posting import does not retry permanent access denials', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-denied-'))
  directories.push(directory)
  let requests = 0
  const workbench = createWorkbench(directory, undefined, undefined, undefined, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async () => { requests++; return { status: 403, headers: {}, body: Buffer.alloc(0) } },
    wait: async () => {}, now: () => Date.now()
  })
  try {
    const { token } = await workbench.api.startPostingFetch('https://jobs.lever.co/example-board/denied')
    let state = await workbench.api.readPostingPreview(token)
    for (let attempt = 0; attempt < 100 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 5)); state = await workbench.api.readPostingPreview(token) }
    expect(state).toMatchObject({ status: 'failed', message: expect.stringMatching(/denied or rate-limited/) })
    expect(requests).toBe(1)
  } finally { workbench.close() }
})

test('posting fetch cancellation interrupts a bounded Retry-After wait', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-backoff-'))
  directories.push(directory)
  let enterBackoff!: () => void
  const backoff = new Promise<void>(resolve => { enterBackoff = resolve })
  let requests = 0
  let workbench: ReturnType<typeof createWorkbench> | undefined
  try {
    workbench = createWorkbench(directory, undefined, undefined, undefined, {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async () => { requests++; return { status: 429, headers: { 'retry-after': '30' }, body: Buffer.alloc(0) } },
      wait: async (milliseconds, signal) => milliseconds === 30_000 ? new Promise(resolve => { enterBackoff(); signal.addEventListener('abort', () => resolve(), { once: true }) }) : undefined,
      now: () => Date.now()
    })
    const { token } = await workbench.api.startPostingFetch('https://jobs.lever.co/example-board/backoff')
    await backoff
    await workbench.api.cancelPostingFetch(token)
    expect(await workbench.api.readPostingPreview(token)).toEqual({ status: 'cancelled' })
    expect(requests).toBe(1)
  } finally { workbench?.close() }
})

test('posting import stops oversized compressed and decompressed bodies without a partial preview', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-bounds-'))
  directories.push(directory)
  const oversizedCompressed = Buffer.alloc(2 * 1024 * 1024 + 1)
  const oversizedExpanded = gzipSync(Buffer.alloc(8 * 1024 * 1024 + 1, 65))
  let requestCount = 0
  const workbench = createWorkbench(directory, undefined, undefined, undefined, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async url => { requestCount++; return { status: 200, headers: { 'content-type': 'application/json', 'content-encoding': url.pathname.endsWith('compressed') ? 'identity' : 'gzip' }, body: url.pathname.endsWith('compressed') ? oversizedCompressed : oversizedExpanded } },
    wait: async () => {}, now: () => Date.now()
  })
  try {
    for (const id of ['compressed', 'expanded']) {
      const { token } = await workbench.api.startPostingFetch(`https://jobs.lever.co/example-board/${id}`)
      let state = await workbench.api.readPostingPreview(token)
      for (let attempt = 0; attempt < 100 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 5)); state = await workbench.api.readPostingPreview(token) }
      expect(state.status).toBe('failed')
      if (state.status === 'failed') expect(state.message).toMatch(/2 MiB|8 MiB/)
    }
    expect(requestCount).toBe(2)
    expect(await workbench.api.listJobs()).toEqual([])
  } finally { workbench.close() }
})

test('job validation is actionable and invalid records do not mutate storage', async () => {
  const { workbench } = open()
  const invalid = await workbench.api.saveJob({ title: '  ', company: '', description: '\n ' })
  expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { title: expect.any(String), company: expect.any(String), description: expect.any(String) } } })
  expect(await workbench.api.listJobs()).toEqual([])
  expect(await workbench.api.openJob('not-a-uuid')).toBeNull()
  const missing = await workbench.api.saveJob({ id: 'b28b5307-07dd-4e39-bc16-849c56b4c331', title: 'Engineer', company: 'Fictional Co', description: 'Build software.' })
  expect(missing).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  workbench.close()
})

test('opening another job returns only its posting and updating one keeps its identity', async () => {
  const { directory, workbench } = open()
  const first = await workbench.api.saveJob({ title: 'Engineer', company: 'Northwind', description: 'Design compiler tools.' })
  const second = await workbench.api.saveJob({ title: 'Analyst', company: 'Contoso', description: 'Review fictional datasets.' })
  if (!first.ok || !second.ok) throw Error('Fixture save failed')
  expect(await workbench.api.openJob(first.value.id)).toMatchObject({ title: 'Engineer', company: 'Northwind', description: 'Design compiler tools.' })
  expect(await workbench.api.openJob(second.value.id)).toMatchObject({ title: 'Analyst', company: 'Contoso', description: 'Review fictional datasets.' })
  const updated = await workbench.api.saveJob({ id: first.value.id, title: 'Senior Engineer', company: 'Northwind', description: 'Design compiler tools with a fictional team.' })
  expect(updated).toMatchObject({ ok: true, value: { id: first.value.id, createdAt: first.value.createdAt, title: 'Senior Engineer', revisions: [{ title: 'Engineer', revision: 1, provenance: 'manual' }, { title: 'Senior Engineer', revision: 2, provenance: 'manual' }] } })
  expect(await workbench.api.openJob(first.value.id)).toMatchObject({ revisions: [{ description: 'Design compiler tools.' }, { description: 'Design compiler tools with a fictional team.' }] })
  expect(await workbench.api.listJobs()).toHaveLength(2)
  expect(await workbench.api.openJob(second.value.id)).toEqual(second.value)
  workbench.close()
  const reopened = createWorkbench(directory)
  expect(await reopened.api.openJob(first.value.id)).toMatchObject({ id: first.value.id, createdAt: first.value.createdAt, description: 'Design compiler tools with a fictional team.', revisions: [{ description: 'Design compiler tools.' }, { description: 'Design compiler tools with a fictional team.' }] })
  reopened.close()
})

test('manual posting text remains within the established safe limit and rejects overflow without mutation', async () => {
  const { workbench } = open()
  const exact = await workbench.api.saveJob({ title: 'Engineer', company: 'Example', description: 'x'.repeat(30000) })
  expect(exact.ok).toBe(true)
  const oversized = await workbench.api.saveJob({ title: 'Engineer', company: 'Example', description: 'x'.repeat(30001) })
  expect(oversized).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { description: expect.any(String) } } })
  expect(await workbench.api.listJobs()).toHaveLength(1)
  if (!exact.ok) throw Error('exact-limit posting rejected')
  expect((await workbench.api.openJob(exact.value.id))?.description).toHaveLength(30000)
  workbench.close()
})
