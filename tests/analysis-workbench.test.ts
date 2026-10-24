import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { analysisBudgetValues } from '../src/shared/posting-analysis'

const dirs: string[] = []; const opened: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const value of opened.splice(0)) value.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
test('public workbench analysis requires accepted preview, sends its frozen minimized bundle and reuses compatible cache', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-contract-')); dirs.push(dir)
  const requests: string[] = []
  const transport: AnalysisTransport = { async generate(input) { requests.push(input.prompt); return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: ['TypeScript'], responsibilities: ['Build systems'], keywords: ['TypeScript'] }) } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  const defaults = await wb.api.getAnalysisUsage()
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(defaults), minimumSpacingMs: 0 })
  const job = await wb.api.saveJob({ title: 'Developer', company: 'Local Corp', description: 'Must know TypeScript.' })
  if (!job.ok) throw Error('job fixture')
  const preview = await wb.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw Error('preview fixture')
  await expect(wb.api.startAnalysis(preview.token)).rejects.toThrow(/authorize/i)
  expect(requests).toHaveLength(0)
  expect(await wb.api.acceptOutboundConsent(preview.token, true, true)).toMatchObject({ ok: true })
  const first = await wb.api.startAnalysis(preview.token)
  expect(first).toMatchObject({ jobId: job.value.id, status: 'complete', attempts: 1, cacheHit: false, analysis: { required: ['TypeScript'] } })
  expect(requests).toHaveLength(1)
  expect(await wb.api.getAnalysis(job.value.id)).toMatchObject({ status: 'complete' })
  expect(await wb.api.cancelAnalysis(job.value.id)).toMatchObject({ status: 'complete' })
  const cached = await wb.api.startAnalysis(preview.token)
  expect(cached).toMatchObject({ status: 'complete', cacheHit: true, attempts: 0 })
  expect(requests).toHaveLength(1)
  expect(await wb.api.getAnalysisUsage()).toMatchObject({ runLimit: 12, minimumSpacingMs: 0 })
  wb.close(); opened.pop()
  const offlineTransport: AnalysisTransport = { async generate() { throw { code: 'ENOTFOUND' } } }
  const reopened = createWorkbench(dir, undefined, offlineTransport); opened.push(reopened)
  const restoredConsent = await reopened.api.prepareOutboundConsent(job.value.id)
  if (!restoredConsent.ok) throw Error('reopen preview fixture')
  await reopened.api.acceptOutboundConsent(restoredConsent.token, true, true)
  expect(await reopened.api.startAnalysis(restoredConsent.token)).toMatchObject({ jobId: job.value.id, status: 'complete', cacheHit: true, attempts: 0 })
  const changedJob = await reopened.api.saveJob({ id: job.value.id, title: 'Developer', company: 'Local Corp', description: 'Must know Rust.' })
  if (!changedJob.ok) throw Error('updated job fixture')
  const changedConsent = await reopened.api.prepareOutboundConsent(job.value.id)
  if (!changedConsent.ok) throw Error('changed preview fixture')
  await reopened.api.acceptOutboundConsent(changedConsent.token, true, true)
  expect(await reopened.api.startAnalysis(changedConsent.token)).toMatchObject({ jobId: job.value.id, status: 'failed', attempts: 1, error: expect.stringMatching(/network/i) })
})

test('a saved analysis cannot be used to generate under a newly authorized run until that run starts analysis', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-run-scope-')); dirs.push(dir)
  const transport: AnalysisTransport = { async generate() { return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: [], responsibilities: [], keywords: ['TypeScript'] }) } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  const job = await wb.api.saveJob({ title: 'Developer', company: 'Local Corp', description: 'TypeScript required.' })
  if (!job.ok) throw Error('job fixture')
  const first = await wb.api.prepareOutboundConsent(job.value.id)
  if (!first.ok) throw Error('preview fixture')
  await wb.api.acceptOutboundConsent(first.token, true, true)
  const original = await wb.api.startAnalysis(first.token)
  expect(original.status).toBe('complete')
  const next = await wb.api.prepareOutboundConsent(job.value.id)
  if (!next.ok) throw Error('next preview fixture')
  await wb.api.acceptOutboundConsent(next.token, true, true)
  expect(await wb.api.generateDraft(next.token)).toMatchObject({ ok: false, message: expect.stringMatching(/analysis.*this run/i) })
  expect(await wb.api.getGenerationRecovery(job.value.id)).toBeNull()
  const cached = await wb.api.startAnalysis(next.token)
  expect(cached).toMatchObject({ status: 'complete', cacheHit: true, runId: expect.any(String) })
  expect(cached.runId).not.toBe(original.runId)
})

test('a profile change after consent cannot mark cached analysis ready for a stale run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-stale-cache-scope-')); dirs.push(dir)
  let calls = 0
  const wb = createWorkbench(dir, undefined, { async generate() { calls++; return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: [], responsibilities: [], keywords: [] }) } }); opened.push(wb)
  const job = await wb.api.saveJob({ title: 'Developer', company: 'Example Co', description: 'TypeScript required.' })
  if (!job.ok) throw Error('job fixture')
  const authorize = async () => {
    const preview = await wb.api.prepareOutboundConsent(job.value.id)
    if (!preview.ok) throw Error(preview.message)
    expect(await wb.api.acceptOutboundConsent(preview.token, true, true)).toMatchObject({ ok: true })
    return preview.token
  }
  const original = await wb.api.startAnalysis(await authorize())
  expect(original.status).toBe('complete')
  const staleToken = await authorize()
  expect((await wb.api.saveSkill({ name: 'TypeScript', category: 'Programming' })).ok).toBe(true)
  await expect(wb.api.startAnalysis(staleToken)).rejects.toThrow(/changed|review/i)
  expect(await wb.api.getAnalysis(job.value.id)).toMatchObject({ runId: original.runId })
  const fresh = await wb.api.startAnalysis(await authorize())
  expect(fresh).toMatchObject({ status: 'complete', cacheHit: true })
  expect(fresh.runId).not.toBe(original.runId)
  expect(calls).toBe(1)
})

test('cancelling an in-flight public run suppresses a late response and does not cache it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-cancel-contract-')); dirs.push(dir)
  let started!: () => void; let startedSecond!: () => void; let finish!: (value: string) => void
  const startedPromise = new Promise<void>(resolve => { started = resolve })
  const startedSecondPromise = new Promise<void>(resolve => { startedSecond = resolve })
  let calls = 0
  const transport: AnalysisTransport = { generate() { calls++; (calls === 1 ? started : startedSecond)(); return new Promise(resolve => { finish = resolve }) } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  const defaults = await wb.api.getAnalysisUsage()
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(defaults), minimumSpacingMs: 0 })
  const job = await wb.api.saveJob({ title: 'Developer', company: 'Local Corp', description: 'TypeScript required.' })
  if (!job.ok) throw Error('job fixture')
  const preview = await wb.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw Error('preview fixture')
  await wb.api.acceptOutboundConsent(preview.token, true, true)
  const pending = wb.api.startAnalysis(preview.token)
  await startedPromise
  await expect(wb.api.startAnalysis(preview.token)).rejects.toThrow(/already active/i)
  await wb.api.cancelAnalysis(job.value.id)
  finish(JSON.stringify({ required: ['TypeScript'], preferred: [], tools: [], responsibilities: [], keywords: ['TypeScript'] }))
  expect(await pending).toMatchObject({ status: 'cancelled', analysis: null })
  const secondPreview = await wb.api.prepareOutboundConsent(job.value.id)
  if (!secondPreview.ok) throw Error('second preview fixture')
  await wb.api.acceptOutboundConsent(secondPreview.token, true, true)
  const secondPending = wb.api.startAnalysis(secondPreview.token)
  await startedSecondPromise
  expect(calls).toBe(2)
  await wb.api.cancelAnalysis(job.value.id)
  finish(JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] }))
  await secondPending
})

test('public analysis reports malformed structured output after one counted schema repair', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-malformed-contract-')); dirs.push(dir)
  const requests: string[] = []
  const transport: AnalysisTransport = { async generate(input) { requests.push(input.prompt); return '{malformed' } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  const defaults = await wb.api.getAnalysisUsage()
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(defaults), minimumSpacingMs: 0 })
  const job = await wb.api.saveJob({ title: 'Developer', company: 'Local Corp', description: 'TypeScript required.' })
  if (!job.ok) throw Error('job fixture')
  const preview = await wb.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw Error('preview fixture')
  await wb.api.acceptOutboundConsent(preview.token, true, true)
  expect(await wb.api.startAnalysis(preview.token)).toMatchObject({ status: 'failed', attempts: 2, error: expect.stringMatching(/invalid structured data/i) })
  expect(requests).toHaveLength(2)
})

test('failed accepted analysis cannot silently restart under the same consent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-restart-contract-')); dirs.push(dir)
  let calls = 0
  const transport: AnalysisTransport = { async generate() { calls++; return '{malformed' } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  const job = await wb.api.saveJob({ title: 'Developer', company: 'Local Corp', description: 'TypeScript required.' })
  if (!job.ok) throw Error('job fixture')
  const preview = await wb.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw Error('preview fixture')
  await wb.api.acceptOutboundConsent(preview.token, true, true)
  expect(await wb.api.startAnalysis(preview.token)).toMatchObject({ status: 'failed', attempts: 2 })
  await expect(wb.api.startAnalysis(preview.token)).rejects.toThrow(/already started/i)
  expect(calls).toBe(2)
})

test('compatible persisted posting analysis is readable offline after restart without fresh consent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-restart-cache-contract-')); dirs.push(dir)
  const transport: AnalysisTransport = { async generate() { return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: [], responsibilities: [], keywords: ['TypeScript'] }) } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  const defaults = await wb.api.getAnalysisUsage()
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(defaults), minimumSpacingMs: 0 })
  const job = await wb.api.saveJob({ title: 'Developer', company: 'Local Corp', description: 'TypeScript required.' })
  if (!job.ok) throw Error('job fixture')
  const preview = await wb.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw Error('preview fixture')
  await wb.api.acceptOutboundConsent(preview.token, true, true)
  const generated = await wb.api.startAnalysis(preview.token)
  expect(generated.status).toBe('complete')
  wb.close(); opened.pop()
  const reopened = createWorkbench(dir, undefined, { async generate() { throw Error('offline') } }); opened.push(reopened)
  expect(await reopened.api.getAnalysis(job.value.id)).toMatchObject({ jobId: job.value.id, runId: expect.any(String), status: 'complete', cacheHit: false, progress: 'Posting analysis complete.', analysis: { required: ['TypeScript'] } })
})

test('accepted posting edits invalidate consent and block stale-token analysis and generation before dispatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-stale-token-')); dirs.push(dir)
  const requests: string[] = []
  const transport: AnalysisTransport = { async generate(input) { requests.push(input.prompt); return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: [], responsibilities: [], keywords: [] }) } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  const job = await wb.api.saveJob({ title: 'Developer', company: 'Local Corp', description: 'TypeScript required.' })
  if (!job.ok) throw Error('job fixture')
  const preview = await wb.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw Error('preview fixture')
  await wb.api.acceptOutboundConsent(preview.token, true, true)
  const saved = await wb.api.openJob(job.value.id)
  if (!saved) throw Error('saved job missing')
  expect((await wb.api.saveJob({ id: saved.id, title: saved.title, company: saved.company, description: 'Rust required.' })).ok).toBe(true)
  await expect(wb.api.startAnalysis(preview.token)).rejects.toThrow(/stale|authorize/i)
  expect(await wb.api.generateDraft(preview.token)).toMatchObject({ ok: false, message: expect.stringMatching(/authorize/i) })
  expect(requests).toHaveLength(0)
})

test('an active analysis blocks material posting edits and a cancelled late response cannot be current for the next target', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-edit-in-flight-')); dirs.push(dir)
  let started!: () => void, finish!: (value: string) => void
  const startedPromise = new Promise<void>(resolve => { started = resolve })
  const transport: AnalysisTransport = { generate() { started(); return new Promise(resolve => { finish = resolve }) } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(await wb.api.getAnalysisUsage()), minimumSpacingMs: 0 })
  const job = await wb.api.saveJob({ title: 'Developer', company: 'Local Corp', description: 'TypeScript required.' })
  if (!job.ok) throw Error('job fixture')
  const preview = await wb.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw Error('preview fixture')
  await wb.api.acceptOutboundConsent(preview.token, true, true)
  const pending = wb.api.startAnalysis(preview.token)
  await startedPromise
  expect(await wb.api.saveJob({ id: job.value.id, title: job.value.title, company: job.value.company, description: 'Rust required.' })).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: expect.stringMatching(/provider operation is active/i) } })
  expect(await wb.api.openJob(job.value.id)).toMatchObject({ description: 'TypeScript required.' })
  await wb.api.cancelAnalysis(job.value.id)
  expect(await wb.api.saveJob({ id: job.value.id, title: job.value.title, company: job.value.company, description: 'Rust required.' })).toMatchObject({ ok: true })
  finish(JSON.stringify({ required: ['TypeScript'], preferred: [], tools: [], responsibilities: [], keywords: [] }))
  expect(await pending).toMatchObject({ status: 'cancelled', analysis: null })
  expect(await wb.api.openJob(job.value.id)).toMatchObject({ description: 'Rust required.' })
  expect(await wb.api.getAnalysis(job.value.id)).not.toMatchObject({ status: 'complete', analysis: { required: ['TypeScript'] } })
})

test('accepted target edits expose prior posting analysis as stale until explicit reassessment', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-target-stale-')); dirs.push(dir)
  const requests: string[] = []
  const transport: AnalysisTransport = { async generate(input) { requests.push(input.prompt); return JSON.stringify({ required: [input.prompt.includes('Rust required') ? 'Rust' : 'TypeScript'], preferred: [], tools: [], responsibilities: [], keywords: [] }) } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(await wb.api.getAnalysisUsage()), minimumSpacingMs: 0 })
  const job = await wb.api.saveJob({ title: 'Developer', company: 'Local Corp', description: 'TypeScript required.' })
  if (!job.ok) throw Error('job fixture')
  const preview = await wb.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw Error('preview fixture')
  await wb.api.acceptOutboundConsent(preview.token, true, true)
  expect(await wb.api.startAnalysis(preview.token)).toMatchObject({ status: 'complete', analysis: { required: ['TypeScript'] } })
  const saved = await wb.api.openJob(job.value.id)
  if (!saved) throw Error('saved job missing')
  expect((await wb.api.saveJob({ id: saved.id, title: saved.title, company: saved.company, description: 'Rust required.' })).ok).toBe(true)
  expect(await wb.api.getAnalysis(job.value.id)).toMatchObject({ status: 'stale', analysis: { required: ['TypeScript'] }, progress: expect.stringMatching(/earlier accepted posting/i) })
  expect(requests).toHaveLength(1)
  wb.close(); opened.splice(opened.indexOf(wb), 1)
  const reopened = createWorkbench(dir, undefined, transport); opened.push(reopened)
  expect(await reopened.api.getAnalysis(job.value.id)).toMatchObject({ status: 'stale', analysis: { required: ['TypeScript'] } })
  const fresh = await reopened.api.prepareOutboundConsent(job.value.id)
  if (!fresh.ok) throw Error('fresh target preview')
  await reopened.api.acceptOutboundConsent(fresh.token, true, true)
  expect(await reopened.api.startAnalysis(fresh.token)).toMatchObject({ status: 'complete', analysis: { required: ['Rust'] } })
  expect(requests).toHaveLength(2)
})

test('invalid provider credentials fail once with a sanitized actionable public result', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-key-contract-')); dirs.push(dir)
  const requests: string[] = []
  const transport: AnalysisTransport = { async generate(input) { requests.push(input.prompt); throw { status: 401, code: 'API_KEY_INVALID', message: 'private-provider-detail' } } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  const job = await wb.api.saveJob({ title: 'Developer', company: 'Local Corp', description: 'TypeScript required.' })
  if (!job.ok) throw Error('job fixture')
  const preview = await wb.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw Error('preview fixture')
  await wb.api.acceptOutboundConsent(preview.token, true, true)
  const result = await wb.api.startAnalysis(preview.token)
  expect(result).toMatchObject({ status: 'failed', attempts: 1, error: expect.stringMatching(/provider rejected authentication/i) })
  expect(JSON.stringify(result)).not.toContain('private-provider-detail')
  expect(requests).toHaveLength(1)
})
