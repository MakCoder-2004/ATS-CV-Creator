import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { IpcMainInvokeEvent } from 'electron'
import { registerResearchSearchSettingsIpc } from '../src/main/research-search-settings-ipc'
import { createResearchSearchCredentials, defaultResearchCredentialDirectory } from '../src/main/research-search-credentials'
import { researchSearchKeyCopySchema, researchSearchKeyRevealSchema, researchSearchKeyStatusSchema } from '../src/shared/research-search-settings'

const directories: string[] = []
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks() })
const key = 'tvly-secret-example-key-12345'
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-search-settings-')); directories.push(root)
  const workspace = join(root, 'appData', 'CV Tailor')
  const directory = defaultResearchCredentialDirectory(join(root, 'appData'), workspace)
  const encryption = { isEncryptionAvailable: vi.fn(() => true), encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)), decryptString: vi.fn((bytes: Buffer) => bytes.toString().replace(/^encrypted:/, '')) }
  const credentials = createResearchSearchCredentials({ credentialsDirectory: directory, workspaceDirectory: workspace, encryption })
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>()
  const allowed = { senderFrame: {} } as IpcMainInvokeEvent
  const trusted = vi.fn((event: IpcMainInvokeEvent) => { if (event !== allowed) throw new Error('Untrusted IPC sender') })
  const clipboard = { writeText: vi.fn((_value: string) => {}) }
  registerResearchSearchSettingsIpc({ handle: (name, handler) => { handlers.set(name, handler); return undefined } } as Parameters<typeof registerResearchSearchSettingsIpc>[0], credentials, trusted, clipboard)
  const invoke = (name: string, event: IpcMainInvokeEvent, ...args: unknown[]) => handlers.get(name)?.(event, ...args) ?? Promise.reject(new Error('No handler registered'))
  return { credentials, handlers, allowed, clipboard, encryption, invoke }
}

test('stale save IPC is absent; trusted status and removal remain without automatic deletion', async () => {
  const x = fixture()
  expect(x.handlers.has('research-search:key:save')).toBe(false)
  const initial = researchSearchKeyStatusSchema.parse(await x.invoke('research-search:key:status', x.allowed))
  expect(initial).toMatchObject({ configured: false, storageAvailable: true })
  await expect(x.invoke('research-search:key:save', x.allowed, key)).rejects.toThrow('No handler registered')
  expect(await x.credentials.status()).toMatchObject({ configured: false })
  await x.credentials.save(key)
  expect(researchSearchKeyStatusSchema.parse(await x.invoke('research-search:key:status', x.allowed))).toMatchObject({ configured: true })
  await expect(x.invoke('research-search:key:remove', {} as IpcMainInvokeEvent)).rejects.toThrow('Untrusted IPC sender')
  expect(researchSearchKeyStatusSchema.parse(await x.invoke('research-search:key:remove', x.allowed))).toMatchObject({ configured: false })
})

test('reveal and copy require trusted explicit no-argument actions', async () => {
  const x = fixture()
  await x.credentials.save(key)
  for (const action of ['research-search:key:reveal', 'research-search:key:copy']) {
    await expect(x.invoke(action, {} as IpcMainInvokeEvent)).rejects.toThrow('Untrusted IPC sender')
    await expect(x.invoke(action, x.allowed, key)).rejects.toThrow('Unexpected arguments')
  }
  const status = await x.invoke('research-search:key:status', x.allowed)
  expect(researchSearchKeyStatusSchema.parse(status).configured).toBe(true)
  expect(x.encryption.decryptString).not.toHaveBeenCalled()
  expect(researchSearchKeyRevealSchema.parse(await x.invoke('research-search:key:reveal', x.allowed))).toEqual({ key })
  expect(researchSearchKeyCopySchema.parse(await x.invoke('research-search:key:copy', x.allowed))).toMatchObject({ ok: true })
  expect(x.clipboard.writeText).toHaveBeenCalledWith(key)
})
