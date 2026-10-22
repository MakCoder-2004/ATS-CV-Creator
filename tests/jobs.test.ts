import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createWorkbench } from '../src/main/workbench'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
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
  expect(saved.value).toMatchObject({ title: 'Engineer', company: 'Fictional Co', description: original })
  const id = saved.value.id
  expect(await workbench.api.listJobs()).toEqual([saved.value])
  workbench.close()

  const reopened = createWorkbench(directory)
  expect(await reopened.api.openJob(id)).toEqual(saved.value)
  expect(await reopened.api.listJobs()).toEqual([saved.value])
  reopened.close()
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
    for (let attempt = 0; attempt < 20 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 1)); state = await workbench.api.readPostingPreview(started.token) }
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ url: 'https://api.lever.co/v0/postings/example-board/synthetic-123', address: '8.8.8.8', headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'CV-Tailor/1.0' } })
    expect(state).toMatchObject({ status: 'incomplete', preview: { title: 'Synthetic Platform Engineer', company: null, description: expect.stringContaining('• Experience with testing.') } })
    expect(await workbench.api.listJobs()).toEqual([])
    workbench.close()
    reopened = createWorkbench(directory)
    expect(await reopened.api.listJobs()).toEqual([])
    expect(await reopened.api.readPostingPreview(started.token)).toEqual({ status: 'failed', message: 'This temporary preview is no longer available.' })
  } finally { workbench.close(); reopened?.close() }
})

test('posting fetch rejects unsupported links before contacting a source and cancels active reads', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-cancel-'))
  directories.push(directory)
  let requestStarted!: () => void
  let dnsLookups = 0
  const startedRequest = new Promise<void>(resolve => { requestStarted = resolve })
  let apiWorkbench: ReturnType<typeof createWorkbench> | undefined
  try {
    apiWorkbench = createWorkbench(directory, undefined, undefined, undefined, {
      lookup: async () => { dnsLookups++; return [{ address: '8.8.4.4', family: 4 }] },
      request: async (_url, _address, signal) => new Promise((_resolve, reject) => { requestStarted(); signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' })), { once: true }) })
    })
    await expect(apiWorkbench.api.startPostingFetch('https://unknown.example/job')).rejects.toThrow(/Lever job-detail/)
    expect(dnsLookups).toBe(0)
    const active = await apiWorkbench.api.startPostingFetch('https://jobs.lever.co/example-board/cancel-me')
    await startedRequest
    expect(await apiWorkbench.api.cancelPostingFetch(active.token)).toEqual({ ok: true })
    expect(await apiWorkbench.api.readPostingPreview(active.token)).toEqual({ status: 'cancelled' })
    expect(await apiWorkbench.api.listJobs()).toEqual([])
  } finally { apiWorkbench?.close() }
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
      now: () => Date.now() + 60_000
    })
    const { token } = await workbench.api.startPostingFetch('https://jobs.lever.co/example-board/retry-me')
    let state = await workbench.api.readPostingPreview(token)
    for (let attempt = 0; attempt < 100 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 5)); state = await workbench.api.readPostingPreview(token) }
    expect(attempts).toHaveLength(2)
    expect(waits).toContain(2_000)
    expect(state).toMatchObject({ status: 'ready', preview: { company: 'Synthetic Employer', description: expect.stringContaining('• Maintain example services.') } })
    expect(await workbench.api.listJobs()).toEqual([])
  } finally { workbench?.close() }
})

test('posting import does not retry permanent access denials', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-denied-'))
  directories.push(directory)
  let requests = 0
  const workbench = createWorkbench(directory, undefined, undefined, undefined, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async () => { requests++; return { status: 403, headers: {}, body: Buffer.alloc(0) } },
    wait: async () => {}, now: () => Date.now() + 600_000
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
      wait: async (_milliseconds, signal) => new Promise(resolve => { enterBackoff(); signal.addEventListener('abort', () => resolve(), { once: true }) }),
      now: () => Date.now() + 2_000_000
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
    wait: async () => {}, now: () => Date.now() + 120_000
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
  const { workbench } = open()
  const first = await workbench.api.saveJob({ title: 'Engineer', company: 'Northwind', description: 'Design compiler tools.' })
  const second = await workbench.api.saveJob({ title: 'Analyst', company: 'Contoso', description: 'Review fictional datasets.' })
  if (!first.ok || !second.ok) throw Error('Fixture save failed')
  expect(await workbench.api.openJob(first.value.id)).toMatchObject({ title: 'Engineer', company: 'Northwind', description: 'Design compiler tools.' })
  expect(await workbench.api.openJob(second.value.id)).toMatchObject({ title: 'Analyst', company: 'Contoso', description: 'Review fictional datasets.' })
  const updated = await workbench.api.saveJob({ id: first.value.id, title: 'Senior Engineer', company: 'Northwind', description: 'Design compiler tools with a fictional team.' })
  expect(updated).toMatchObject({ ok: true, value: { id: first.value.id, createdAt: first.value.createdAt, title: 'Senior Engineer' } })
  expect(await workbench.api.listJobs()).toHaveLength(2)
  expect(await workbench.api.openJob(second.value.id)).toEqual(second.value)
  workbench.close()
})
