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

test('preload exposes only named status, remove, reveal and copy methods; stale save IPC is absent', async () => {
  const key = 'tvly-secret-example-key-12345'
  const status = { configured: true, storageAvailable: true, message: 'Search is available only after a key is stored on this device.' }
  bridge.invoke.mockResolvedValue(status)
  await expect(bridge.api!.getResearchSearchKeyStatus()).resolves.toEqual(status)
  expect('saveResearchSearchKey' in bridge.api!).toBe(false)
  await expect(bridge.api!.removeResearchSearchKey()).resolves.toEqual(status)
  bridge.invoke.mockResolvedValue({ key })
  await expect(bridge.api!.revealResearchSearchKey()).resolves.toEqual({ key })
  bridge.invoke.mockResolvedValue({ ok: true, message: 'Search key copied. Clipboard contents remain outside CV Tailor until replaced.' })
  await expect(bridge.api!.copyResearchSearchKey()).resolves.toMatchObject({ ok: true })
  expect(bridge.invoke.mock.calls).toEqual([
    ['research-search:key:status'], ['research-search:key:remove'],
    ['research-search:key:reveal'], ['research-search:key:copy']
  ])
  bridge.invoke.mockResolvedValue({ key: 'short' })
  await expect(bridge.api!.revealResearchSearchKey()).rejects.toThrow()
  bridge.invoke.mockResolvedValue({ ok: true, message: 'unexpected', key })
  await expect(bridge.api!.copyResearchSearchKey()).rejects.toThrow()
  bridge.invoke.mockClear()
  expect(bridge.invoke).not.toHaveBeenCalled()
  bridge.invoke.mockResolvedValue({ ...status, key })
  await expect(bridge.api!.getResearchSearchKeyStatus()).rejects.toThrow()
})

test('preload accepts a configured key status while device encryption is unavailable', async () => {
  const status = {
    configured: true,
    storageAvailable: false,
    message: 'A search key is stored but device encryption is unavailable; it cannot be used until encryption returns. You can remove it locally.'
  }
  bridge.invoke.mockResolvedValue(status)
  await expect(bridge.api!.getResearchSearchKeyStatus()).resolves.toEqual(status)
  expect(bridge.invoke).toHaveBeenCalledWith('research-search:key:status')
})

test('preload rejects malformed Pi selections before invoking IPC', async () => {
  await expect(bridge.api!.setPiModel({ reference: 'provider/model', thinkingLevel: 'invalid' } as never)).rejects.toThrow()
  expect(bridge.invoke).not.toHaveBeenCalled()
})
