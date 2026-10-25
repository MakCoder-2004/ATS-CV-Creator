import { afterEach, expect, test, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { createWorkbench } from '../src/main/workbench'
import { normalizeJobResearchUrl } from '../src/shared/job-research'
import { samePostingSource } from '../src/shared/posting-identity'
import { createJobResearchSessions } from '../src/main/job-research-session'

const folders: string[] = []
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }) })
const selected = 'https://www.linkedin.com/jobs/search/?currentJobId=4464025097&utm_source=mail'
const canonical = 'https://www.linkedin.com/jobs/view/4464025097/'
const body = 'Responsibilities\n• Design synthetic systems with a team and document decisions.\n\nRequirements\n• TypeScript and testing for reliable synthetic systems. '.repeat(3)
function open(request: (url: URL) => { status: number; headers: Record<string, string>; body: Buffer }, transport?: { generate: (input: { prompt: string }) => Promise<string> }) {
  const folder = mkdtempSync(join(tmpdir(), 'cv-universal-direct-')); folders.push(folder)
  const requested: string[] = []
  const wb = createWorkbench(folder, undefined, transport, undefined, { research: {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async url => { requested.push(url.href); return request(url) },
    extract: async () => ({ outcome: 'full', title: 'Synthetic Engineer', employer: 'Fictional Employer', description: body }),
  } })
  return { wb, requested, folder }
}
async function settled(wb: ReturnType<typeof createWorkbench>, token: string) {
  let state = await wb.api.readPostingPreview(token)
  for (let i = 0; i < 300 && state.status === 'fetching'; i++) { await new Promise(resolve => setTimeout(resolve, 10)); state = await wb.api.readPostingPreview(token) }
  return state
}
test('selected full LinkedIn text is inspectable and transfers exactly once to full temporary research, never a saved job', async () => {
  let modelCalls = 0, searchCalls = 0
  const { wb, requested, folder } = open(() => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html><body>synthetic posting</body></html>') }), { async generate() { modelCalls++; throw Error('No model request before consent') } })
  const sessions = createJobResearchSessions({
    credentials: { status: async () => ({ configured: true, storageAvailable: true, message: '' }), withKey: async <T>(fn: (key: string) => Promise<T>) => fn('synthetic') },
    direct: async () => { throw Error('Handoff must not reread the source') },
    createSearch: () => ({ searchesDispatched: 0, search: async () => { searchCalls++; throw Error('Full text must not search') } }),
  })
  try {
    const { token } = await wb.api.startPostingFetch(selected)
    const state = await settled(wb, token)
    expect(requested).toEqual([canonical])
    expect(state).toMatchObject({ status: 'ready', preview: { submittedUrl: canonical, finalUrl: canonical, title: 'Synthetic Engineer', company: 'Fictional Employer', description: body.trim(), extractionMethod: 'linkedin-public-html-v1', notices: [expect.stringContaining('Nothing was saved to jobs or backups.')] } })
    expect(state.status === 'ready' && state.preview.notices[0]).toContain('Review temporary role source before analysis.')
    if (state.status !== 'ready') throw Error('Full direct source was not reviewable')
    expect(await wb.api.acceptPostingImport(token, 0)).toMatchObject({ ok: false, error: { message: expect.stringMatching(/Review temporarily or paste text manually/) } })
    expect(await wb.api.comparePostingRefresh(token, randomUUID(), '', 0)).toMatchObject({ ok: false, message: expect.stringMatching(/Review temporarily or paste text manually/) })
    const corrected = await wb.api.updatePostingPreview(token, 0, { title: state.preview.title, company: state.preview.company!, description: `${body.trim()}\nReviewed clarification.`, optionalDetails: state.preview.optionalDetails })
    expect(corrected).toMatchObject({ ok: true, revision: 1 })
    expect(await wb.api.reviewPostingPreview(token, 1, { completenessConfirmed: true, conflictResolutions: {} })).toMatchObject({ ok: true })
    expect(await wb.api.acceptPostingImport(token, 1)).toMatchObject({ ok: false, error: { message: expect.stringMatching(/Review temporarily or paste text manually/) } })
    expect(await wb.api.listJobs()).toEqual([])
    const backup = wb.backup.createBackup()
    expect(backup).not.toContain(body.trim())
    expect(backup).not.toContain('linkedin-public-html-v1')
    const captured = wb.api.takePostingResearchRun(token)
    expect(captured).toMatchObject({ status: 'full', selected: { canonicalUrl: canonical }, findings: [{ kind: 'direct-role-text', text: body.trim(), completeness: 'full' }] })
    expect(() => wb.api.takePostingResearchRun(token)).toThrow(/unavailable/)
    expect(await wb.api.readPostingPreview(token)).toMatchObject({ status: 'failed' })
    expect(await wb.api.cancelPostingFetch(token)).toEqual({ ok: false })
    expect(await wb.api.updatePostingPreview(token, 1, { title: state.preview.title, company: state.preview.company!, description: body, optionalDetails: state.preview.optionalDetails })).toMatchObject({ ok: false })
    expect(await wb.api.reviewPostingPreview(token, 1, { completenessConfirmed: true, conflictResolutions: {} })).toMatchObject({ ok: false })
    expect(await wb.api.acceptPostingImport(token, 1)).toMatchObject({ ok: false })
    expect(await wb.api.comparePostingRefresh(token, randomUUID(), '', 0)).toMatchObject({ ok: false })
    expect(await wb.api.acceptPostingRefresh(token, 1, randomUUID(), '', 0, { title: 'source', company: 'source', description: 'source', optionalDetails: {} })).toMatchObject({ ok: false })
    expect(JSON.parse(wb.backup.createBackup()).tables).toEqual(JSON.parse(backup).tables)
    const transferred = sessions.acceptInitialDirectRun(captured).token
    const research = sessions.getJobResearch(transferred)
    expect(research).toMatchObject({ status: 'ready', run: { id: captured.id, findings: [{ id: captured.findings[0].id, text: body.trim() }] } })
    expect(sessions.reviewJobResearch(transferred, [captured.findings[0].id], false)).toMatchObject({ analysisScope: 'full', selected: { canonicalUrl: canonical } })
    expect(requested).toEqual([canonical])
    expect(searchCalls).toBe(0)
    expect(modelCalls).toBe(0)
    expect(await wb.api.listJobs()).toEqual([])
    expect(wb.backup.createBackup()).not.toContain(body.trim())
    const db = new Database(join(folder, 'workbench.sqlite'), { readonly: true })
    try {
      for (const table of ['jobs', 'posting_analysis_cache', 'analysis_run_state', 'outbound_consents', 'draft_revisions', 'generation_recovery']) {
        expect((db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count, table).toBe(0)
      }
    } finally { db.close() }
  } finally { sessions.close(); wb.close() }
})
test('incomplete and blocked public sources cannot become a saved source, with no provider dispatch', async () => {
  for (const request of [
    () => ({ status: 307, headers: { location: 'https://www.linkedin.com/login' }, body: Buffer.alloc(0) }),
    () => ({ status: 403, headers: {}, body: Buffer.alloc(0) }),
  ]) {
    const { wb, requested } = open(request)
    try {
      const { token } = await wb.api.startPostingFetch(selected)
      expect(await settled(wb, token)).toMatchObject({ status: 'research-notice', message: expect.stringMatching(/nothing was saved/i) })
      expect(wb.api.takePostingResearchRun(token)).toMatchObject({ selected: { canonicalUrl: canonical }, status: 'blocked', findings: [] })
      expect(requested).toEqual([canonical])
      expect(await wb.api.listJobs()).toEqual([])
      expect(await wb.api.acceptPostingImport(token, 0)).toMatchObject({ ok: false })
    } finally { wb.close() }
  }
  expect(() => normalizeJobResearchUrl('https://www.linkedin.com/jobs/view/4464025097/?currentJobId=4464025098')).toThrow(/conflicting/i)
})
test('full text without a source employer remains an unsaveable research notice', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'cv-direct-employer-')); folders.push(folder)
  const wb = createWorkbench(folder, undefined, undefined, undefined, { research: {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>synthetic</html>') }),
    extract: async () => ({ outcome: 'full', title: 'Synthetic Engineer', employer: null, description: body }),
  } })
  try {
    const { token } = await wb.api.startPostingFetch(selected)
    expect(await settled(wb, token)).toMatchObject({ status: 'research-notice', message: expect.stringMatching(/reviewable temporary capture/i) })
    expect(wb.api.takePostingResearchRun(token)).toMatchObject({ status: 'full', findings: [{ completeness: 'full' }] })
    expect(await wb.api.reviewPostingPreview(token, 0, { completenessConfirmed: true, conflictResolutions: {} })).toMatchObject({ ok: false })
    expect(await wb.api.listJobs()).toEqual([])
  } finally { wb.close() }
})

test('full public preview expires and discards captured text without another API call', async () => {
  vi.useFakeTimers()
  const { wb } = open(() => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>synthetic</html>') }))
  try {
    const token = (await wb.api.startPostingFetch(selected)).token
    let state = await wb.api.readPostingPreview(token)
    for (let i = 0; i < 20 && state.status === 'fetching'; i++) { await Promise.resolve(); state = await wb.api.readPostingPreview(token) }
    expect(state).toMatchObject({ status: 'ready' })
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(() => wb.api.takePostingResearchRun(token)).toThrow(/unavailable/)
    expect(await wb.api.readPostingPreview(token)).toMatchObject({ status: 'failed' })
  } finally { wb.close(); vi.useRealTimers() }
})

test('handoff clears the posting expiry timer and removes the public preview immediately', async () => {
  vi.useFakeTimers()
  const { wb } = open(() => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>synthetic</html>') }))
  try {
    const token = (await wb.api.startPostingFetch(selected)).token
    let state = await wb.api.readPostingPreview(token)
    for (let i = 0; i < 20 && state.status === 'fetching'; i++) { await Promise.resolve(); state = await wb.api.readPostingPreview(token) }
    expect(state).toMatchObject({ status: 'ready' })
    expect(vi.getTimerCount()).toBe(1)
    expect(wb.api.takePostingResearchRun(token)).toMatchObject({ status: 'full', findings: [{ text: body.trim() }] })
    expect(vi.getTimerCount()).toBe(0)
    expect(await wb.api.readPostingPreview(token)).toMatchObject({ status: 'failed' })
    expect(await wb.api.cancelPostingFetch(token)).toEqual({ ok: false })
  } finally { wb.close(); vi.useRealTimers() }
})

test('synthetic exact-role JSON-LD is extracted by the real bounded worker', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'cv-direct-worker-')); folders.push(folder)
  const url = 'https://careers.fictional.org/jobs/role-4'
  const structuredDescription = `<h2>Responsibilities</h2><p>${body}</p><h2>Requirements</h2><p>${body}</p>`
  const html = `<html><head><link rel="canonical" href="${url}"><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', url, title: 'Synthetic Engineer', hiringOrganization: { name: 'Fictional Employer' }, description: structuredDescription })}</script></head><body>Exact synthetic role</body></html>`
  const wb = createWorkbench(folder, undefined, undefined, undefined, { research: { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(html) }) } })
  try {
    const { token } = await wb.api.startPostingFetch(url)
    expect(await settled(wb, token)).toMatchObject({ status: 'ready', preview: { title: 'Synthetic Engineer', company: 'Fictional Employer', extractionMethod: 'public-jsonld-v1' } })
  } finally { wb.close() }
})

test('generic JSON-LD direct URL stays temporary and binds the same exact source and employer', async () => {
  const url = 'https://careers.fictional.org/jobs/role-4'
  const { wb, requested } = open(() => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>synthetic</html>') }))
  try {
    const { token } = await wb.api.startPostingFetch(url + '?utm_source=email')
    expect(await settled(wb, token)).toMatchObject({ status: 'ready', preview: { submittedUrl: url, extractionMethod: 'public-jsonld-v1' } })
    expect(await wb.api.reviewPostingPreview(token, 0, { completenessConfirmed: true, conflictResolutions: {} })).toMatchObject({ ok: true })
    expect(await wb.api.acceptPostingImport(token, 0)).toMatchObject({ ok: false, error: { message: expect.stringMatching(/Review temporarily or paste text manually/) } })
    expect(await wb.api.acceptPostingRefresh(token, 0, randomUUID(), '', 0, { title: 'source', company: 'source', description: 'source', optionalDetails: {} })).toMatchObject({ ok: false, error: { message: expect.stringMatching(/Review temporarily or paste text manually/) } })
    expect(wb.api.takePostingResearchRun(token)).toMatchObject({ status: 'full', selected: { canonicalUrl: url } })
    expect(await wb.api.readPostingPreview(token)).toMatchObject({ status: 'failed' })
    expect(await wb.api.acceptPostingImport(token, 0)).toMatchObject({ ok: false })
    expect(await wb.api.acceptPostingRefresh(token, 0, randomUUID(), '', 0, { title: 'source', company: 'source', description: 'source', optionalDetails: {} })).toMatchObject({ ok: false })
    expect(await wb.api.listJobs()).toEqual([])
    expect(requested).toEqual([url])
    expect(samePostingSource({ submittedUrl: url, finalUrl: url }, { submittedUrl: url + '/other', finalUrl: url + '/other' })).toBe(false)
  } finally { wb.close() }
})
