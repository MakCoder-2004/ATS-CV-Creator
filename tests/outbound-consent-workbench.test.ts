import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { PiModelRuntime } from '../src/main/pi-model'
import type { Api, Model } from '@earendil-works/pi-ai'

const directories: string[] = []
const workbenches: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const workbench of workbenches.splice(0)) { try { workbench.close() } catch {} }; for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) })
const model = { id: 'author/chat', provider: 'sample', name: 'Synthetic', api: 'openai-completions' as Api, baseUrl: 'https://example.invalid', input: ['text'], reasoning: true, contextWindow: 16384, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as Model<Api>
const runtime = { getProviders: () => [{ id: model.provider, getModels: () => [model] }], getPhysicalModel: () => model, getAvailable: async () => [model], getAuth: async () => ({ source: 'synthetic' }) } as unknown as PiModelRuntime
async function open() { const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-consent-')); directories.push(directory); const workbench = createWorkbench(directory, undefined, undefined, undefined, runtime); workbenches.push(workbench); await workbench.api.setPiModel({ reference: 'sample/author/chat', thinkingLevel: 'low' }); return { directory, workbench } }

test('outgoing consent preview is minimized, explicit, frozen to job/profile/model revisions, and cancellable', async () => {
  const { directory, workbench } = await open()
  const contact = await workbench.api.saveContact({ fullName: 'Canary Person', email: 'canary@example.test', phone: '555-014-0198', location: 'Canary City' })
  const evidence = await workbench.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Canary Employer', startDate: '2020-01', endDate: '2024-06', description: 'Canary Person delivered systems at Canary Employer.' })
  const job = await workbench.api.saveJob({ title: 'Engineer', company: 'Canary Employer', description: 'Canary Employer seeks an engineer. jobs@canary.example requires systems.' })
  if (!contact.ok || !evidence.ok || !job.ok) throw new Error('Fixture records failed to save.')
  const preview = await workbench.api.prepareOutboundConsent(job.value.id)
  expect(preview.ok).toBe(true)
  if (!preview.ok) throw new Error(preview.message)
  const serialized = JSON.stringify(preview.outgoing)
  for (const secret of ['Canary Person', 'canary@example.test', '555-014-0198', 'Canary City', 'Canary Employer', '2020-01', '2024-06', 'jobs@canary.example']) expect(serialized).not.toContain(secret)
  expect(preview.warning).toMatch(/sensitivity|anonymity/i)
  expect(preview.termsNotice).toMatch(/Pi sends|provider/i)
  expect(await workbench.api.acceptOutboundConsent(preview.token, false, true)).toMatchObject({ ok: false })
  expect(await workbench.api.acceptOutboundConsent(preview.token, true, true)).toMatchObject({ ok: true, runId: expect.any(String) })
  await workbench.api.cancelOutboundConsent(preview.token)
  expect(await workbench.api.cancelOutboundConsent(preview.token)).toMatchObject({ ok: false })
  workbench.close()
  const reopened = createWorkbench(directory, undefined, undefined, undefined, runtime)
  workbenches.push(reopened)
  expect(await reopened.api.acceptOutboundConsent(preview.token, true, true)).toMatchObject({ ok: false })
})

test('purpose is frozen in the consent preview and persisted grant metadata without changing the input scope hash', async () => {
  const { directory, workbench } = await open()
  const job = await workbench.api.saveJob({ title: 'Engineer', company: 'Canary Co', description: 'Build systems.' })
  if (!job.ok) throw new Error('Fixture job failed.')
  const legacy = await workbench.api.prepareOutboundConsent(job.value.id)
  if (!legacy.ok) throw new Error(legacy.message)
  const optedIn = await workbench.api.prepareOutboundConsent(job.value.id, 'cv+cover-letter')
  if (!optedIn.ok) throw new Error(optedIn.message)
  expect(legacy.purpose).toBe('cv')
  expect(optedIn.purpose).toBe('cv+cover-letter')
  expect(legacy.outgoing).toEqual(optedIn.outgoing)
  const accepted = await workbench.api.acceptOutboundConsent(optedIn.token, true, true)
  expect(accepted.ok).toBe(true)
  const Database = (await import('better-sqlite3')).default
  const db = new Database(join(directory, 'workbench.sqlite'), { readonly: true })
  try {
    expect(db.prepare('SELECT purpose_version,purpose,purpose_hash FROM outbound_consents').get()).toMatchObject({ purpose_version: 1, purpose: 'cv+cover-letter', purpose_hash: expect.stringMatching(/^[a-f0-9]{64}$/) })
  } finally { db.close() }
  const letterOnly = await workbench.api.prepareOutboundConsent(job.value.id, 'cover-letter-only')
  if (!letterOnly.ok) throw new Error(letterOnly.message)
  await workbench.api.acceptOutboundConsent(letterOnly.token, true, true)
  await expect(workbench.api.startAnalysis(letterOnly.token)).rejects.toThrow(/cover letter only/i)
  expect(await workbench.api.generateDraft(letterOnly.token)).toMatchObject({ ok: false, message: expect.stringMatching(/cover letter only/i) })
})

test('stale source, model change or changed posting requires a fresh review', async () => {
  const { workbench } = await open()
  const job = await workbench.api.saveJob({ title: 'Engineer', company: 'Canary Co', description: 'Build systems.' })
  if (!job.ok) throw new Error('Fixture job failed.')
  const preview = await workbench.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw new Error(preview.message)
  await workbench.api.setPiModel({ reference: 'sample/author/chat', thinkingLevel: 'high' })
  expect(await workbench.api.acceptOutboundConsent(preview.token, true, true)).toMatchObject({ ok: false, message: expect.stringMatching(/expired|changed|review/i) })
  const fresh = await workbench.api.prepareOutboundConsent(job.value.id)
  if (!fresh.ok) throw new Error(fresh.message)
  const saved = await workbench.api.saveJob({ id: job.value.id, title: 'Engineer', company: 'Canary Co', description: 'Build more systems.' })
  expect(saved.ok).toBe(true)
  expect(await workbench.api.acceptOutboundConsent(fresh.token, true, true)).toMatchObject({ ok: false })
  workbench.close()
})
