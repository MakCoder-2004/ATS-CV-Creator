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
  })
  expect(bridge.api).toBeDefined()
  await expect(bridge.api!.setPiModel(input)).resolves.toMatchObject({ pi: selection })
  expect(bridge.invoke).toHaveBeenCalledWith('settings:pi-model', input)
  expect('setFaithfulnessCheck' in bridge.api!).toBe(false)
})

test('preload exposes only status and confirmed local-removal methods for legacy keys', async () => {
  const status = { configured: true, storageAvailable: true, message: 'Legacy encrypted search key found on this device.' }
  bridge.invoke.mockResolvedValue(status)
  await expect(bridge.api!.getResearchSearchKeyStatus()).resolves.toEqual(status)
  await expect(bridge.api!.removeResearchSearchKey()).resolves.toEqual(status)
  expect(bridge.invoke.mock.calls).toEqual([['research-search:key:status'], ['research-search:key:remove']])
  expect('revealResearchSearchKey' in bridge.api!).toBe(false)
  expect('copyResearchSearchKey' in bridge.api!).toBe(false)
  expect('saveResearchSearchKey' in bridge.api!).toBe(false)
  bridge.invoke.mockResolvedValue({ ...status, key: 'plaintext' })
  await expect(bridge.api!.getResearchSearchKeyStatus()).rejects.toThrow()
})

test('preload distinguishes an encrypted legacy key from failed storage inspection', async () => {
  const status = {
    configured: true,
    storageAvailable: false,
    message: 'A legacy encrypted key is stored but device encryption is unavailable. You can still remove it locally.'
  }
  bridge.invoke.mockResolvedValue(status)
  await expect(bridge.api!.getResearchSearchKeyStatus()).resolves.toEqual(status)
  expect(bridge.invoke).toHaveBeenCalledWith('research-search:key:status')
})

test('preload rejects malformed Pi selections before invoking IPC', async () => {
  await expect(bridge.api!.setPiModel({ reference: 'provider/model', thinkingLevel: 'invalid' } as never)).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
})
