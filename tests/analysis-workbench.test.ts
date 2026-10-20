import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'

const dirs: string[] = []; const opened: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const value of opened.splice(0)) value.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
test('public workbench analysis requires accepted preview, sends its frozen minimized bundle and reuses compatible cache', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-contract-')); dirs.push(dir)
  const requests: string[] = []
  const transport: AnalysisTransport = { async generate(input) { requests.push(input.prompt); return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: ['TypeScript'], responsibilities: ['Build systems'], keywords: ['TypeScript'] }) } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
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
  const cached = await wb.api.startAnalysis(preview.token)
  expect(cached).toMatchObject({ status: 'complete', cacheHit: true, attempts: 0 })
  expect(requests).toHaveLength(1)
  expect(await wb.api.getAnalysisUsage()).toMatchObject({ runLimit: 12, minimumSpacingMs: 5000 })
})
