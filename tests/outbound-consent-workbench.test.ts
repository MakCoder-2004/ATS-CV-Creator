import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'

const directories: string[] = []
const workbenches: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const workbench of workbenches.splice(0)) { try { workbench.close() } catch {} }; for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) })
function open() { const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-consent-')); directories.push(directory); const workbench = createWorkbench(directory); workbenches.push(workbench); return { directory, workbench } }

test('outgoing consent preview is minimized, explicit, frozen to job/profile/model revisions, and cancellable', async () => {
  const { directory, workbench } = open()
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
  expect(preview.termsNotice).toMatch(/OpenRouter|third-party/i)
  expect(await workbench.api.acceptOutboundConsent(preview.token, false, true)).toMatchObject({ ok: false })
  expect(await workbench.api.acceptOutboundConsent(preview.token, true, true)).toMatchObject({ ok: true, runId: expect.any(String) })
  await workbench.api.cancelOutboundConsent(preview.token)
  expect(await workbench.api.cancelOutboundConsent(preview.token)).toMatchObject({ ok: false })
  workbench.close()
  const reopened = createWorkbench(directory)
  workbenches.push(reopened)
  expect(await reopened.api.acceptOutboundConsent(preview.token, true, true)).toMatchObject({ ok: false })
})

test('stale source, model change or changed posting requires a fresh review', async () => {
  const { workbench } = open()
  const job = await workbench.api.saveJob({ title: 'Engineer', company: 'Canary Co', description: 'Build systems.' })
  if (!job.ok) throw new Error('Fixture job failed.')
  const preview = await workbench.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw new Error(preview.message)
  await workbench.api.setOpenRouterModel('openai/gpt-4o-mini')
  expect(await workbench.api.acceptOutboundConsent(preview.token, true, true)).toMatchObject({ ok: false, message: expect.stringMatching(/changed|review/i) })
  const fresh = await workbench.api.prepareOutboundConsent(job.value.id)
  if (!fresh.ok) throw new Error(fresh.message)
  const saved = await workbench.api.saveJob({ id: job.value.id, title: 'Engineer', company: 'Canary Co', description: 'Build more systems.' })
  expect(saved.ok).toBe(true)
  expect(await workbench.api.acceptOutboundConsent(fresh.token, true, true)).toMatchObject({ ok: false })
  workbench.close()
})
