import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import Database from 'better-sqlite3'
import { createWorkbench } from '../src/main/workbench'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }, 30_000)
function open(transport?: Parameters<typeof createWorkbench>[2]) {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-jobs-'))
  directories.push(directory)
  return { directory, workbench: createWorkbench(directory, undefined, transport) }
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
  const description = `Responsibilities\n${'The fictional engineering team builds reliable software and maintains dependable systems with careful collaboration. '.repeat(400)}\nRequirements\n• Build reliable services with the fictional team.`
  const responseBody = JSON.stringify({ id: 'review-save-1', text: 'Source Engineer', company: 'Example Source Co', descriptionPlain: description, lists: [{ text: 'Responsibilities', content: '<li>Build reliable services with the fictional team.</li>' }] })
  const imported = createWorkbench(directory, undefined, undefined, undefined, { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async url => { calls.push(url.href); return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(responseBody) } } })
  let importedClosed = false
  try {
    const { token } = await imported.api.startPostingFetch('https://jobs.lever.co/example-board/review-save-1')
    let state = await imported.api.readPostingPreview(token)
    for (let attempt = 0; attempt < 300 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); state = await imported.api.readPostingPreview(token) }
    expect(state.status).toBe('ready')
    if (state.status !== 'ready') throw Error('Synthetic source was not ready')
    expect(Array.from(state.preview.description).length).toBeGreaterThan(30000)
    const reviewedDescription = `${state.preview.description}\nReviewed clarification: include the fictional on-call rotation.`
    const database = new Database(join(directory, 'workbench.sqlite'))
    database.exec("CREATE TRIGGER refuse_import BEFORE INSERT ON jobs BEGIN SELECT RAISE(ABORT, 'simulated import transaction failure'); END")
    const failedAcceptance = await imported.api.acceptPostingImport(token, { title: 'Reviewed Engineer', company: 'Corrected Example Co', description: reviewedDescription })
    expect(failedAcceptance).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await imported.api.listJobs()).toEqual([])
    database.exec('DROP TRIGGER refuse_import')
    database.close()
    const result = await imported.api.acceptPostingImport(token, { title: 'Reviewed Engineer', company: 'Corrected Example Co', description: reviewedDescription })
    expect(result).toMatchObject({ ok: true, value: { title: 'Reviewed Engineer', company: 'Corrected Example Co', provenance: 'imported', sourceSnapshot: { title: 'Source Engineer', company: 'Example Source Co', submittedUrl: 'https://jobs.lever.co/example-board/review-save-1', finalUrl: 'https://api.lever.co/v0/postings/example-board/review-save-1', extractionMethod: 'lever-json-v1', fieldOrigins: { title: 'user-correction', company: 'user-correction', description: 'user-correction' } }, revisions: [{ title: 'Reviewed Engineer', company: 'Corrected Example Co', revision: 1, provenance: 'imported' }] } })
    if (!result.ok) throw Error(result.error.message)
    expect(result.value.sourceSnapshot?.description).not.toBe(result.value.description)
    const backup = imported.backup.createBackup()
    expect(backup).toContain('Source Engineer')
    expect(backup).toContain(result.value.sourceSnapshot!.hashes.description)
    const unrelated = await imported.api.saveJob({ title: 'Another role', company: 'Fictional Co', description: 'Separate manual posting.' })
    expect(unrelated.ok).toBe(true)
    const restore = imported.backup.previewRestore(backup)
    imported.backup.applyRestore(restore.token, safety => safety)
    const repeatedFetch = await imported.api.startPostingFetch('https://jobs.lever.co/example-board/review-save-1')
    let repeatedState = await imported.api.readPostingPreview(repeatedFetch.token)
    for (let attempt = 0; attempt < 300 && repeatedState.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); repeatedState = await imported.api.readPostingPreview(repeatedFetch.token) }
    if (repeatedState.status !== 'ready') throw Error('Repeated synthetic source was not ready')
    const repeated = await imported.api.acceptPostingImport(repeatedFetch.token, { title: 'Reviewed Engineer', company: 'Corrected Example Co', description: reviewedDescription })
    expect(repeated).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: expect.stringMatching(/already saved|Open the existing/i) } })
    expect(await imported.api.listJobs()).toHaveLength(1)
    expect((await imported.api.getAnalysisUsage()).attempts).toBe(0)
    const id = result.value.id
    imported.close(); importedClosed = true
    const reopened = createWorkbench(directory)
    try {
      const restored = await reopened.api.openJob(id)
      expect(restored).toEqual(result.value)
      expect(restored?.sourceSnapshot?.hashes).toEqual(result.value.sourceSnapshot?.hashes)
      expect(restored?.sourceSnapshot?.description).toBe(state.preview.description)
      expect(restored?.description).toBe(reviewedDescription)
      expect(calls).toHaveLength(2)
    } finally { reopened.close() }
  } finally { if (!importedClosed) imported.close() }
})

test('a source-missing company can be supplied deliberately while incomplete posting text remains blocked', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-import-corrections-'))
  directories.push(directory)
  const body = JSON.stringify({ id: 'company-omitted', text: 'Source Engineer', descriptionPlain: `Responsibilities\n${'Build and maintain fictional software with a cross-functional example team. '.repeat(5)}\nRequirements\nCareful testing and documentation.`, lists: [{ text: 'Requirements', content: '<li>Careful testing and documentation.</li>' }] })
  const wb = createWorkbench(directory, undefined, undefined, undefined, { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(body) }) })
  try {
    const started = await wb.api.startPostingFetch('https://jobs.lever.co/example-board/company-omitted')
    let state = await wb.api.readPostingPreview(started.token)
    for (let attempt = 0; attempt < 300 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); state = await wb.api.readPostingPreview(started.token) }
    expect(state).toMatchObject({ status: 'incomplete', preview: { company: null } })
    if (state.status !== 'incomplete') throw Error('Expected the source to omit its employer name')
    expect(await wb.api.acceptPostingImport(started.token, { title: state.preview.title, company: 'User-reviewed Example Employer', description: 'A replacement description cannot bypass incomplete source notices.' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    const accepted = await wb.api.acceptPostingImport(started.token, { title: state.preview.title, company: 'User-reviewed Example Employer', description: state.preview.description })
    if (!accepted.ok) throw new Error(`Company correction rejected: ${accepted.error.message}`)
    expect(accepted).toMatchObject({ ok: true, value: { company: 'User-reviewed Example Employer', sourceSnapshot: { company: null, hashes: { company: null }, fieldOrigins: { company: 'user-correction' } } } })
    expect(await wb.api.acceptPostingImport(started.token, { title: state.preview.title, company: 'Another Guess', description: state.preview.description })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  } finally { wb.close() }
})

test('an incomplete teaser cannot be accepted by supplying missing fields alone', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-import-teaser-'))
  directories.push(directory)
  const body = JSON.stringify({ id: 'teaser', text: 'Source Engineer', descriptionPlain: 'A short teaser.' })
  const wb = createWorkbench(directory, undefined, undefined, undefined, { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(body) }) })
  try {
    const started = await wb.api.startPostingFetch('https://jobs.lever.co/example-board/teaser')
    let state = await wb.api.readPostingPreview(started.token)
    for (let attempt = 0; attempt < 300 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); state = await wb.api.readPostingPreview(started.token) }
    expect(state).toMatchObject({ status: 'incomplete', preview: { company: null } })
    expect(await wb.api.acceptPostingImport(started.token, { title: 'Engineer', company: 'User-reviewed Example', description: 'A complete posting description supplied by the caller cannot override source teaser warnings by itself.' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await wb.api.acceptPostingImport(started.token, { title: 'Engineer', company: 'Example', description: 'I supplied a replacement but no full posting.' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await wb.api.listJobs()).toEqual([])
  } finally { wb.close() }
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
    expect(await apiWorkbench.api.acceptPostingImport(active.token, { title: 'Ignored Engineer', company: 'Example', description: 'This cancelled preview cannot be accepted.' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
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

test('posting revision write ceiling matches backup limits and refuses without pruning or partial mutation', async () => {
  const { directory, workbench } = open()
  let saved = await workbench.api.saveJob({ title: 'History-bound role', company: 'Example', description: 'Revision 1.' })
  if (!saved.ok) throw Error(saved.error.message)
  for (let revision = 2; revision <= 256; revision++) {
    saved = await workbench.api.saveJob({ id: saved.value.id, title: 'History-bound role', company: 'Example', description: `Revision ${revision}.` })
    if (!saved.ok) throw Error(`Revision ${revision} was refused before the advertised history limit.`)
  }
  expect(saved.value.revisions).toHaveLength(256)
  const atLimit = saved.value
  const rejected = await workbench.api.saveJob({ id: saved.value.id, title: 'History-bound role', company: 'Example', description: 'Revision 257.' })
  expect(rejected).toMatchObject({ ok: false, error: { code: 'REVISION_LIMIT', message: expect.stringMatching(/256-revision history limit/) } })
  expect(await workbench.api.openJob(saved.value.id)).toEqual(atLimit)
  const backup = workbench.backup.createBackup()
  const preview = workbench.backup.previewRestore(backup)
  workbench.backup.applyRestore(preview.token, safety => safety)
  expect(await workbench.api.openJob(saved.value.id)).toEqual(atLimit)
  workbench.close()
  const reopened = createWorkbench(directory)
  expect(await reopened.api.openJob(saved.value.id)).toEqual(atLimit)
  reopened.close()
})

test('job history byte ceiling refuses atomically and the last accepted full history remains backupable', async () => {
  const { directory, workbench } = open()
  const description = (revision: number) => `${revision.toString().padStart(2, '0')}${'x'.repeat(199998)}`
  let saved = await workbench.api.saveJob({ title: 'Large history role', company: 'Example', description: description(0) })
  if (!saved.ok) throw Error(saved.error.message)
  let refused: unknown
  for (let revision = 1; revision <= 30; revision++) {
    const result = await workbench.api.saveJob({ id: saved.value.id, title: 'Large history role', company: 'Example', description: description(revision) })
    if (!result.ok) { refused = result; break }
    saved = result
  }
  expect(refused).toMatchObject({ ok: false, error: { code: 'HISTORY_SIZE_LIMIT', message: expect.stringMatching(/4 MiB/) } })
  if (!saved.ok) throw new Error('The last accepted job revision was lost.')
  const lastAccepted = saved.value
  expect(await workbench.api.openJob(lastAccepted.id)).toEqual(lastAccepted)
  const backup = workbench.backup.createBackup()
  const restore = workbench.backup.previewRestore(backup)
  workbench.backup.applyRestore(restore.token, safety => safety)
  expect(await workbench.api.openJob(lastAccepted.id)).toEqual(lastAccepted)
  workbench.close()
  const reopened = createWorkbench(directory)
  expect(await reopened.api.openJob(lastAccepted.id)).toEqual(lastAccepted)
  reopened.close()
}, 20_000)

test('aggregate backup ceiling rejects a multi-job save before mutation and preserves a restorable workspace', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-backup-capacity-'))
  directories.push(directory)
  const baseline = createWorkbench(directory)
  const first = await baseline.api.saveJob({ title: 'First role', company: 'Example', description: 'A'.repeat(2000) })
  const second = await baseline.api.saveJob({ title: 'Second role', company: 'Example', description: 'B'.repeat(2000) })
  if (!first.ok || !second.ok) throw Error('Job fixtures failed')
  const twoJobBackup = baseline.backup.createBackup()
  const backupBoundary = Buffer.byteLength(twoJobBackup, 'utf8') + 256
  baseline.close()

  const workbench = createWorkbench(directory, undefined, undefined, { workspaceBackupMaxBytes: backupBoundary })
  try {
    expect(Buffer.byteLength(workbench.backup.createBackup(), 'utf8')).toBeLessThanOrEqual(backupBoundary)
    const rejected = await workbench.api.saveJob({ title: 'Third role', company: 'Example', description: 'C'.repeat(1000) })
    expect(rejected).toMatchObject({ ok: false, error: { code: 'BACKUP_LIMIT', message: expect.stringMatching(/exceed.*backup safety limit/i) } })
    expect(await workbench.api.listJobs()).toHaveLength(2)
    expect(await workbench.api.openJob(first.value.id)).toEqual(first.value)
    expect(await workbench.api.openJob(second.value.id)).toEqual(second.value)
    const directWriter = new Database(join(directory, 'workbench.sqlite'))
    const directId = 'fd570a2e-53b5-4e2d-9e3d-8019ed4cc367', createdAt = new Date().toISOString()
    const directRecord = { id: directId, title: 'Direct SQL role', company: 'Example', description: 'D'.repeat(1000), createdAt, updatedAt: createdAt, provenance: 'manual', sourceSnapshot: null, revisions: [{ title: 'Direct SQL role', company: 'Example', description: 'D'.repeat(1000), revision: 1, acceptedAt: createdAt, provenance: 'manual' }] }
    expect(() => directWriter.prepare('INSERT INTO jobs (id, created_at, updated_at, data) VALUES (?, ?, ?, ?) RETURNING id').get(directId, createdAt, createdAt, JSON.stringify(directRecord))).toThrow(/WORKSPACE_BACKUP_CAPACITY/)
    expect((directWriter.prepare('SELECT COUNT(*) AS count FROM jobs').get() as { count: number }).count).toBe(2)
    directWriter.close()
    const currentBackup = workbench.backup.createBackup()
    expect(Buffer.byteLength(currentBackup, 'utf8')).toBeLessThanOrEqual(backupBoundary)
    const preview = workbench.backup.previewRestore(currentBackup)
    workbench.backup.applyRestore(preview.token, safety => safety)
    expect(await workbench.api.listJobs()).toHaveLength(2)
  } finally { workbench.close() }
})

test('backup capacity also guards non-job SQLite writes and keeps them atomic', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-nonjob-backup-capacity-'))
  directories.push(directory)
  const probe = createWorkbench(directory)
  const currentBytes = Buffer.byteLength(probe.backup.createBackup(), 'utf8')
  probe.close()
  const maxBytes = currentBytes + 512
  const workbench = createWorkbench(directory, undefined, undefined, { workspaceBackupMaxBytes: maxBytes })
  try {
    const result = await workbench.api.saveExperience({ kind: 'employment', title: 'Large record', organization: 'Example', description: 'profile evidence '.repeat(1000), factualItems: [] })
    expect(result).toMatchObject({ ok: false, error: { code: 'BACKUP_LIMIT', message: expect.stringMatching(/backup safety limit/i) } })
    expect(await workbench.api.getExperience()).toEqual({ experience: [], projects: [] })
    const backup = workbench.backup.createBackup()
    expect(Buffer.byteLength(backup, 'utf8')).toBeLessThanOrEqual(maxBytes)
  } finally { workbench.close() }
  const reopened = createWorkbench(directory)
  expect(await reopened.api.getExperience()).toEqual({ experience: [], projects: [] })
  reopened.close()
})

test('aggregate backup guard blocks model dispatch before accounting can overrun its capacity', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-backup-dispatch-capacity-'))
  directories.push(directory)
  const probe = createWorkbench(directory)
  const job = await probe.api.saveJob({ title: 'Capacity role', company: 'Example', description: 'Bounded posting.' })
  if (!job.ok) throw Error('Job fixture failed')
  const consentA = await probe.api.prepareOutboundConsent(job.value.id)
  if (!consentA.ok) throw Error(consentA.message)
  await probe.api.acceptOutboundConsent(consentA.token, true, true)
  const backupA = probe.backup.createBackup()
  const consentB = await probe.api.prepareOutboundConsent(job.value.id)
  if (!consentB.ok) throw Error(consentB.message)
  await probe.api.acceptOutboundConsent(consentB.token, true, true)
  const backupB = probe.backup.createBackup()
  const consentRowBytes = Buffer.byteLength(backupB, 'utf8') - Buffer.byteLength(backupA, 'utf8')
  probe.close()

  let modelDispatches = 0
  const scripted = { async generate() { modelDispatches++; return JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] }) } }
  const maxBytes = Buffer.byteLength(backupB, 'utf8') + consentRowBytes + 80
  const workbench = createWorkbench(directory, undefined, scripted, { workspaceBackupMaxBytes: maxBytes })
  try {
    const consent = await workbench.api.prepareOutboundConsent(job.value.id)
    if (!consent.ok) throw Error(consent.message)
    expect((await workbench.api.acceptOutboundConsent(consent.token, true, true)).ok).toBe(true)
    const result = await workbench.api.startAnalysis(consent.token)
    expect(result).toMatchObject({ status: 'failed', attempts: 0 })
    expect(result.progress).toMatch(/backup safety limit/i)
    expect(modelDispatches).toBe(0)
    expect((await workbench.api.getAnalysisUsage()).attempts).toBe(0)
    expect(await workbench.api.openJob(job.value.id)).toEqual(job.value)
    expect(Buffer.byteLength(workbench.backup.createBackup(), 'utf8')).toBeLessThanOrEqual(maxBytes)
  } finally { workbench.close() }
})

test('measures a saved-job write with a sizable bounded SQLite workspace', async () => {
  const { directory, workbench } = open()
  try {
    const backup = JSON.parse(workbench.backup.createBackup())
    const createdAt = new Date().toISOString()
    backup.tables.jobs.rows = Array.from({ length: 300 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
      const description = `${'Bounded synthetic posting context. '.repeat(30)} requirement ${index}.`
      const value = { id, title: `Synthetic role ${index}`, company: 'Benchmark Systems', description, createdAt, updatedAt: createdAt, provenance: 'manual', sourceSnapshot: null, revisions: [{ title: `Synthetic role ${index}`, company: 'Benchmark Systems', description, revision: 1, acceptedAt: createdAt, provenance: 'manual' }] }
      return { id, created_at: createdAt, updated_at: createdAt, data: JSON.stringify(value) }
    })
    const restore = workbench.backup.previewRestore(JSON.stringify(backup))
    workbench.backup.applyRestore(restore.token, safety => safety)
    const started = performance.now()
    const final = await workbench.api.saveJob({ title: 'Synthetic role 300', company: 'Benchmark Systems', description: 'A measurable final bounded posting.' })
    const elapsedMs = performance.now() - started
    expect(final.ok).toBe(true)
    expect(elapsedMs).toBeLessThan(5_000)
    console.info(`backupability preflight save over 300 SQLite jobs: ${elapsedMs.toFixed(1)}ms`)
    expect(Buffer.byteLength(workbench.backup.createBackup(), 'utf8')).toBeLessThan(64 * 1024 * 1024)
  } finally { workbench.close() }
}, 30_000)

test('backupability guard rolls back non-job profile writes at the aggregate boundary', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-nonjob-backup-capacity-'))
  directories.push(directory)
  const baseline = createWorkbench(directory)
  const currentBytes = Buffer.byteLength(baseline.backup.createBackup(), 'utf8')
  baseline.close()
  const maxBytes = currentBytes + 512
  const workbench = createWorkbench(directory, undefined, undefined, { workspaceBackupMaxBytes: maxBytes })
  try {
    const result = await workbench.api.saveExperience({ kind: 'employment', title: 'Large record', organization: 'Example', description: 'profile evidence '.repeat(500), factualItems: [] })
    expect(result).toMatchObject({ ok: false, error: { code: 'BACKUP_LIMIT', message: expect.stringMatching(/backup safety limit/i) } })
    expect(await workbench.api.getExperience()).toEqual({ experience: [], projects: [] })
    expect(Buffer.byteLength(workbench.backup.createBackup(), 'utf8')).toBeLessThanOrEqual(maxBytes)
  } finally { workbench.close() }
  const reopened = createWorkbench(directory)
  expect(await reopened.api.getExperience()).toEqual({ experience: [], projects: [] })
  reopened.close()
})

test('model capacity refusal preserves long saved text and sends no scripted model request', async () => {
  let modelDispatches = 0
  const transport = {
    async validateCapacity() { return false },
    async generate() { modelDispatches++; return '{}' }
  }
  const { workbench } = open(transport)
  const text = 'Complete requirements.\n'.repeat(1500)
  const job = await workbench.api.saveJob({ title: 'Engineer', company: 'Example', description: text })
  if (!job.ok) throw Error(job.error.message)
  const consent = await workbench.api.prepareOutboundConsent(job.value.id)
  if (!consent.ok) throw Error(consent.message)
  await workbench.api.acceptOutboundConsent(consent.token, true, true)
  const analysis = await workbench.api.startAnalysis(consent.token)
  expect(analysis).toMatchObject({ status: 'failed', attempts: 0 })
  expect(analysis.progress).toMatch(/model capacity|shorten/i)
  expect(modelDispatches).toBe(0)
  expect((await workbench.api.openJob(job.value.id))?.description).toBe(text)
  workbench.close()
})

test('complete long postings reopen exactly and text above the shared safety ceiling is refused', async () => {
  const { directory, workbench } = open()
  const complete = `Requirements:\n${'Unicode ☕ responsibilities and qualifications.\n'.repeat(1100)}`
  expect(Array.from(complete).length).toBeGreaterThan(30000)
  const saved = await workbench.api.saveJob({ title: 'Engineer', company: 'Example', description: complete })
  expect(saved.ok).toBe(true)
  if (!saved.ok) throw Error(saved.error.message)
  workbench.close()

  const reopened = createWorkbench(directory)
  expect((await reopened.api.openJob(saved.value.id))?.description).toBe(complete)
  const oversized = await reopened.api.saveJob({ title: 'Engineer', company: 'Example', description: 'x'.repeat(200001) })
  expect(oversized).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { description: expect.stringMatching(/200,000/) } } })
  expect((await reopened.api.openJob(saved.value.id))?.description).toBe(complete)
  reopened.close()
})
