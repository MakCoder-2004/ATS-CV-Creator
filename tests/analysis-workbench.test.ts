import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { analysisBudgetValues } from '../src/shared/posting-analysis'

const dirs: string[] = []; const opened: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const value of opened.splice(0)) value.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
test('analysis budgets are validated, persisted, and reflected in local usage observations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-budget-contract-')); dirs.push(dir)
  const wb = createWorkbench(dir); opened.push(wb)
  const defaults = await wb.api.getAnalysisUsage()
  expect(defaults).toMatchObject({ minimumSpacingMs: 5000, rateLimitAttempts: 12, rateLimitWindowMs: 300000, configuredDailyLimit: 50, runLimit: 12, runTimeLimitMs: 300000 })
  const configured = await wb.api.setAnalysisBudgets({ minimumSpacingMs: 7000, rateLimitAttempts: 8, rateLimitWindowMs: 60000, configuredDailyLimit: 25, runLimit: 6, runTimeLimitMs: 120000 })
  expect(configured).toMatchObject({ minimumSpacingMs: 7000, rateLimitAttempts: 8, rateLimitWindowMs: 60000, configuredDailyLimit: 25, runLimit: 6, runTimeLimitMs: 120000 })
  await expect(wb.api.setAnalysisBudgets({ ...configured, configuredDailyLimit: 0 })).rejects.toThrow()
  await expect(wb.api.setAnalysisBudgets({ ...configured, runLimit: 13 })).rejects.toThrow()
  await expect(wb.api.setAnalysisBudgets({ ...configured, runTimeLimitMs: 300001 })).rejects.toThrow()
  wb.close(); opened.pop()
  const reopened = createWorkbench(dir); opened.push(reopened)
  expect(await reopened.api.getAnalysisUsage()).toMatchObject({ minimumSpacingMs: 7000, rateLimitAttempts: 8, rateLimitWindowMs: 60000, configuredDailyLimit: 25, runLimit: 6, runTimeLimitMs: 120000 })
})

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
  expect(await wb.api.startAnalysis(preview.token)).toMatchObject({ status: 'failed', attempts: 2, error: expect.stringMatching(/malformed/i) })
  expect(requests).toHaveLength(2)
})

test('failed accepted analysis cannot silently restart and reuse its consent or exhausted run budget', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-restart-contract-')); dirs.push(dir)
  let calls = 0
  const transport: AnalysisTransport = { async generate() { calls++; return '{malformed' } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  const defaults = await wb.api.getAnalysisUsage()
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(defaults), minimumSpacingMs: 0, runLimit: 1 })
  const job = await wb.api.saveJob({ title: 'Developer', company: 'Local Corp', description: 'TypeScript required.' })
  if (!job.ok) throw Error('job fixture')
  const preview = await wb.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw Error('preview fixture')
  await wb.api.acceptOutboundConsent(preview.token, true, true)
  expect(await wb.api.startAnalysis(preview.token)).toMatchObject({ status: 'failed', attempts: 1 })
  await expect(wb.api.startAnalysis(preview.token)).rejects.toThrow(/already started/i)
  expect(calls).toBe(1)
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
  expect(await reopened.api.getAnalysis(job.value.id)).toMatchObject({ jobId: job.value.id, runId: expect.any(String), status: 'complete', cacheHit: true, analysis: { required: ['TypeScript'] } })
})

test('warns before a run when remaining configured daily attempts may be insufficient', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-pre-run-warning-contract-')); dirs.push(dir)
  const wb = createWorkbench(dir); opened.push(wb)
  const defaults = await wb.api.getAnalysisUsage()
  const usage = await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(defaults), runLimit: 12, configuredDailyLimit: 1, rateLimitAttempts: 1 })
  expect(usage.warning).toMatch(/before.*run.*configured local daily/i)
  expect(usage.warning).toMatch(/before.*run.*rate window/i)
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
  expect(result).toMatchObject({ status: 'failed', attempts: 1, error: expect.stringMatching(/API key.*Settings/i) })
  expect(JSON.stringify(result)).not.toContain('private-provider-detail')
  expect(requests).toHaveLength(1)
})
