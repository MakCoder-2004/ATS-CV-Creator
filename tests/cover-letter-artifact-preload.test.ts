import { afterEach, expect, test, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { WorkbenchAPI } from '../src/shared/appearance'
const bridge = vi.hoisted(() => ({ api: undefined as WorkbenchAPI | undefined, invoke: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: (_name: string, api: WorkbenchAPI) => { bridge.api = api } }, ipcRenderer: { invoke: bridge.invoke } }))
import '../src/preload/index'
afterEach(() => bridge.invoke.mockReset())
const jobId = randomUUID(), letterId = randomUUID(), action = { jobId, letterId }

for (const [method, channel] of [['measureCoverLetter', 'cover-letter:measure'], ['getCoverLetterPdf', 'cover-letter:pdf'], ['exportCoverLetter', 'cover-letter:export']] as const) test(`${method} sends only IDs/format and strictly parses responses`, async () => {
  const args = method === 'exportCoverLetter' ? { ...action, format: 'pdf' as const } : action
  const call = bridge.api![method] as (input: unknown) => Promise<unknown>
  await expect(call({ ...args, path: 'C:/forged', documentHash: 'a'.repeat(64), report: { actualPages: 1 } })).rejects.toThrow()
  await expect(call({ ...args, letterId: 'invalid' })).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
  const refused = { ok: false, message: 'Current review required.', ...(method === 'exportCoverLetter' ? { cancelled: false } : {}) }
  bridge.invoke.mockResolvedValue(refused)
  await expect(call(args)).resolves.toEqual(refused)
  expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith(channel, args)
  bridge.invoke.mockResolvedValue({ ...refused, path: 'C:/private' })
  await expect(call(args)).rejects.toThrow()
})

test('preview success requires actual bytes/hash and export success cannot also be cancelled', async () => {
  bridge.invoke.mockResolvedValue({ ok: true, message: 'No actual bytes.' })
  await expect(bridge.api!.getCoverLetterPdf(action)).rejects.toThrow()
  bridge.invoke.mockResolvedValue({ ok: false, message: 'Refused.', documentHash: 'a'.repeat(64), pdfBase64: 'ZmFrZQ==' })
  await expect(bridge.api!.getCoverLetterPdf(action)).rejects.toThrow()
  bridge.invoke.mockResolvedValue({ ok: true, cancelled: true, message: 'Contradictory success.' })
  await expect(bridge.api!.exportCoverLetter({ ...action, format: 'pdf' })).rejects.toThrow()
})

test('approval requires explicit current letter ID at preload and read model is strict', async () => {
  await expect(bridge.api!.approveCoverLetter(jobId)).rejects.toThrow()
  await expect(bridge.api!.getCoverLetterReadModel('bad')).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
  bridge.invoke.mockResolvedValue({ ok: false, message: 'Needs current main measurement.' })
  await expect(bridge.api!.approveCoverLetter(jobId, letterId)).resolves.toMatchObject({ ok: false })
  expect(bridge.invoke).toHaveBeenLastCalledWith('cover-letter:approve', jobId, letterId)
  bridge.invoke.mockResolvedValue({ jobId, letter: null, approved: true })
  await expect(bridge.api!.getCoverLetterReadModel(jobId)).rejects.toThrow()
  expect(bridge.invoke).toHaveBeenLastCalledWith('cover-letter:read-model', jobId)
})
