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
  const input = { reference: `${selection.providerId}/${selection.modelId}`, thinkingLevel: selection.thinkingLevel }
  bridge.invoke.mockResolvedValue({
    appearance: 'light',
    pi: selection,
    faithfulnessCheck: false,
  })
  expect(bridge.api).toBeDefined()
  await expect(bridge.api!.setPiModel(input)).resolves.toMatchObject({ pi: selection })
  expect(bridge.invoke).toHaveBeenCalledWith('settings:pi-model', input)
})

test('preload exposes only named search key status, save and remove methods', async () => {
  const key = 'tvly-secret-example-key-12345'
  const status = { configured: true, storageAvailable: true, message: 'Search is available only after a key is stored on this device.' }
  bridge.invoke.mockResolvedValue(status)
  await expect(bridge.api!.getResearchSearchKeyStatus()).resolves.toEqual(status)
  await expect(bridge.api!.saveResearchSearchKey(key)).resolves.toEqual(status)
  await expect(bridge.api!.removeResearchSearchKey()).resolves.toEqual(status)
  expect(bridge.invoke.mock.calls).toEqual([
    ['research-search:key:status'], ['research-search:key:save', key], ['research-search:key:remove']
  ])
  bridge.invoke.mockClear()
  await expect(bridge.api!.saveResearchSearchKey('short')).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
  bridge.invoke.mockResolvedValue({ ...status, key })
  await expect(bridge.api!.getResearchSearchKeyStatus()).rejects.toThrow()
})

test('preload rejects malformed Pi selections before invoking IPC', async () => {
  await expect(bridge.api!.setPiModel({ reference: 'provider/model', thinkingLevel: 'invalid' } as never)).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
})
