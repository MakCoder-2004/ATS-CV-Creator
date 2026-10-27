import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { IpcMainInvokeEvent } from 'electron'
import { registerResearchSearchSettingsIpc } from '../src/main/research-search-settings-ipc'
import { createResearchSearchCredentials, defaultResearchCredentialDirectory } from '../src/main/research-search-credentials'
import { researchSearchKeyStatusSchema } from '../src/shared/research-search-settings'

const directories: string[] = []
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks() })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-search-settings-')); directories.push(root)
  const workspace = join(root, 'appData', 'CV Tailor')
  mkdirSync(workspace, { recursive: true })
  const directory = defaultResearchCredentialDirectory(join(root, 'appData'), workspace)
  const encryption = { isEncryptionAvailable: vi.fn(() => true) }
  const credentials = createResearchSearchCredentials({ credentialsDirectory: directory, workspaceDirectory: workspace, encryption })
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>()
  const allowed = { senderFrame: {} } as IpcMainInvokeEvent
  const trusted = vi.fn((event: IpcMainInvokeEvent) => { if (event !== allowed) throw new Error('Untrusted IPC sender') })
  registerResearchSearchSettingsIpc({ handle: (name, handler) => { handlers.set(name, handler); return undefined } } as Parameters<typeof registerResearchSearchSettingsIpc>[0], credentials, trusted)
  const invoke = (name: string, event: IpcMainInvokeEvent, ...args: unknown[]) => handlers.get(name)?.(event, ...args) ?? Promise.reject(new Error('No handler registered'))
  return { root, directory, workspace, credentials, handlers, allowed, trusted, encryption, invoke }
}

test('only trusted status and removal handlers remain; no reveal, copy, save or decryption surfaces', async () => {
  const x = fixture()
  expect([...x.handlers.keys()].sort()).toEqual(['research-search:key:remove', 'research-search:key:status'])
  const initial = researchSearchKeyStatusSchema.parse(await x.invoke('research-search:key:status', x.allowed))
  expect(initial).toMatchObject({ configured: false, storageAvailable: true, message: 'No legacy encrypted search key is saved on this device.' })
  const file = join(x.directory, 'tavily-key.dpapi')
  mkdirSync(x.directory, { recursive: true })
  const cipher = Buffer.from('synthetic-encrypted-fixture-only')
  writeFileSync(file, cipher)
  expect(researchSearchKeyStatusSchema.parse(await x.invoke('research-search:key:status', x.allowed)).configured).toBe(true)
  expect(x.encryption).not.toHaveProperty('decryptString')
  await expect(x.invoke('research-search:key:remove', {} as IpcMainInvokeEvent)).rejects.toThrow('Untrusted IPC sender')
  await expect(x.invoke('research-search:key:remove', x.allowed, 'unexpected')).rejects.toThrow('Unexpected arguments')
  expect(await x.invoke('research-search:key:remove', x.allowed)).toMatchObject({ configured: false })
})

test('removal failure returns a safe error and leaves unknown storage status distinct', async () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>()
  const allowed = {} as IpcMainInvokeEvent
  const credentials = {
    status: async () => ({ configured: false, storageAvailable: false, message: 'Legacy search-key storage could not be checked. Any existing key was left unchanged.' }),
    remove: async () => { throw new Error('synthetic storage failure') }
  }
  registerResearchSearchSettingsIpc({ handle: (name, handler) => { handlers.set(name, handler); return undefined } } as Parameters<typeof registerResearchSearchSettingsIpc>[0], credentials as never, event => { if (event !== allowed) throw new Error('Untrusted IPC sender') })
  const status = await handlers.get('research-search:key:status')!(allowed)
  expect(researchSearchKeyStatusSchema.parse(status)).toMatchObject({ configured: false, storageAvailable: false })
  await expect(handlers.get('research-search:key:remove')!(allowed)).rejects.toThrow('left unchanged')
})
