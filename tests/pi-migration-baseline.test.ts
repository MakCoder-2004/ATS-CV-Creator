import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'

const directories: string[] = []
const workbenches: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => {
  for (const workbench of workbenches.splice(0)) workbench.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})

test('a fresh workspace without a selected Pi model cannot authorize posting analysis', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-baseline-no-login-'))
  directories.push(directory)
  const workbench = createWorkbench(directory)
  workbenches.push(workbench)
  const request = vi.spyOn(globalThis, 'fetch')
  const job = await workbench.api.saveJob({ title: 'Engineer', company: 'Synthetic Company', description: 'TypeScript required.' })
  if (!job.ok) throw Error(job.error.message)
  expect(await workbench.api.prepareOutboundConsent(job.value.id)).toMatchObject({ ok: false, message: expect.stringMatching(/Choose an available Pi model/i) })
  expect(request).not.toHaveBeenCalled()
  expect(await workbench.api.getAnalysis(job.value.id)).not.toMatchObject({ status: 'complete' })
})
