import { afterEach, expect, test, vi } from 'vitest'
import type { WorkbenchAPI } from '../src/shared/appearance'

const bridge = vi.hoisted(() => ({ api: undefined as WorkbenchAPI | undefined, invoke: vi.fn() }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_name: string, api: WorkbenchAPI) => { bridge.api = api } },
  ipcRenderer: { invoke: bridge.invoke },
}))

import '../src/preload/index'

afterEach(() => bridge.invoke.mockReset())

test('preload sends a typed Pi selection only through the Settings IPC channel', async () => {
  const selection = { providerId: 'provider/with/slash', modelId: 'author/chat/model', thinkingLevel: 'low' as const }
  bridge.invoke.mockResolvedValue({
    appearance: 'light',
    openRouter: { model: 'legacy/model', faithfulnessCheck: false, credential: { configured: false, secureStorageAvailable: false } },
    pi: selection,
  })
  expect(bridge.api).toBeDefined()
  await expect(bridge.api!.setPiModel(selection)).resolves.toMatchObject({ pi: selection })
  expect(bridge.invoke).toHaveBeenCalledWith('settings:pi-model', selection)
})

test('preload rejects malformed Pi selections before invoking IPC', async () => {
  await expect(bridge.api!.setPiModel({ providerId: 'provider', modelId: 'model', thinkingLevel: 'invalid' } as never)).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
})
