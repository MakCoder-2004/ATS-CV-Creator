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

test('requested-document preload refuses malformed results and extra authority', async () => {
  bridge.invoke.mockResolvedValue({ cv: { ok: true, message: 'CV retained.' }, letter: { status: 'saved', letter: { approved: true } } })
  await expect(bridge.api!.generateRequestedDocuments(randomUUID())).rejects.toThrow()
  bridge.invoke.mockResolvedValue({ cv: { ok: false, message: 'No CV.' }, letter: { status: 'not-requested', approved: true } })
  await expect(bridge.api!.generateRequestedDocuments(randomUUID())).rejects.toThrow()
})
