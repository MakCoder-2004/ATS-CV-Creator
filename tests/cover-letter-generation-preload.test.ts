import { afterEach, expect, test, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { WorkbenchAPI } from '../src/shared/appearance'

const bridge = vi.hoisted(() => ({ api: undefined as WorkbenchAPI | undefined, invoke: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: (_name: string, api: WorkbenchAPI) => { bridge.api = api } }, ipcRenderer: { invoke: bridge.invoke } }))
import '../src/preload/index'
afterEach(() => bridge.invoke.mockReset())

test('requested-document preload exposes the typed independent result without changing legacy CV IPC', async () => {
  const token = randomUUID(), cv = { ok: false, message: 'Complete posting analysis first.' }
  const result = { cv, letter: { status: 'not-started', reason: cv.message } }
  bridge.invoke.mockResolvedValue(result)
  await expect(bridge.api!.generateRequestedDocuments(token, 2)).resolves.toEqual(result)
  expect(bridge.invoke).toHaveBeenCalledWith('documents:generate', token, 2)
  bridge.invoke.mockResolvedValue(cv)
  await expect(bridge.api!.generateDraft(token, 1)).resolves.toEqual(cv)
  expect(bridge.invoke).toHaveBeenLastCalledWith('draft:generate', token, 1)
})

test('requested-document preload rejects invalid tokens and page targets before IPC', async () => {
  await expect(bridge.api!.generateRequestedDocuments('invalid', 1)).rejects.toThrow()
  await expect(bridge.api!.generateRequestedDocuments(randomUUID(), 3 as never)).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
})

test('letter-only preload validates fresh preview, token and durable status contracts', async () => {
  const jobId = randomUUID(), cvId = randomUUID(), token = randomUUID()
  bridge.invoke.mockResolvedValue({ ok: false, message: 'Fresh full flow required.' })
  await expect(bridge.api!.prepareCoverLetterRetry(jobId, cvId)).resolves.toMatchObject({ ok: false })
  expect(bridge.invoke).toHaveBeenLastCalledWith('cover-letter:retry:preview', jobId, cvId)
  bridge.invoke.mockResolvedValue({ status: 'not-started', reason: 'Accept a fresh grant.' })
  await expect(bridge.api!.generateCoverLetter(token)).resolves.toMatchObject({ status: 'not-started' })
  expect(bridge.invoke).toHaveBeenLastCalledWith('cover-letter:generate', token)
  const status = { jobId, status: 'uncertain', originCvRevisionId: cvId, parentRunId: randomUUID(), operationId: randomUUID(), letterId: null, retryAvailable: true, reason: 'Fresh consent required.', warning: 'May have completed.', experienceKinds: {} }
  bridge.invoke.mockResolvedValue(status)
  await expect(bridge.api!.getCoverLetterGenerationStatus(jobId)).resolves.toEqual(status)
  expect(bridge.invoke).toHaveBeenLastCalledWith('cover-letter:generation:status', jobId)
  bridge.invoke.mockClear()
  await expect(bridge.api!.prepareCoverLetterRetry(jobId, 'bad')).rejects.toThrow()
  await expect(bridge.api!.generateCoverLetter('bad')).rejects.toThrow()
  await expect(bridge.api!.getCoverLetterGenerationStatus('bad')).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
  bridge.invoke.mockResolvedValue({ ...status, approved: true })
  await expect(bridge.api!.getCoverLetterGenerationStatus(jobId)).rejects.toThrow()
  bridge.invoke.mockResolvedValue({ status: 'not-started', reason: 'Bad extra authority.', grant: true })
  await expect(bridge.api!.generateCoverLetter(token)).rejects.toThrow()
})

test('requested-document preload refuses malformed results and extra authority', async () => {
  bridge.invoke.mockResolvedValue({ cv: { ok: true, message: 'CV retained.' }, letter: { status: 'saved', letter: { approved: true } } })
  await expect(bridge.api!.generateRequestedDocuments(randomUUID())).rejects.toThrow()
  bridge.invoke.mockResolvedValue({ cv: { ok: false, message: 'No CV.' }, letter: { status: 'not-requested', approved: true } })
  await expect(bridge.api!.generateRequestedDocuments(randomUUID())).rejects.toThrow()
})
