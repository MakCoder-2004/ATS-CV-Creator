import { afterEach, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import type { IpcMainInvokeEvent } from 'electron'
import { registerResearchSearchSettingsIpc } from '../src/main/research-search-settings-ipc'
import { createResearchSearchCredentials, defaultResearchCredentialDirectory } from '../src/main/research-search-credentials'
import { researchSearchKeyStatusSchema } from '../src/shared/research-search-settings'

const directories: string[] = []
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks() })
const key = 'tvly-secret-example-key-12345'
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-search-settings-')); directories.push(root)
  const workspace = join(root, 'appData', 'CV Tailor')
  mkdirSync(workspace, { recursive: true })
  const directory = defaultResearchCredentialDirectory(join(root, 'appData'), workspace)
  const encryption = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
    decryptString: vi.fn((bytes: Buffer) => bytes.toString().replace(/^encrypted:/, ''))
  }
  const store = () => createResearchSearchCredentials({ credentialsDirectory: directory, workspaceDirectory: workspace, encryption })
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>()
  const trusted = vi.fn((event: IpcMainInvokeEvent) => { if (event !== allowed) throw new Error('Untrusted IPC sender') })
  const allowed = { senderFrame: {} } as IpcMainInvokeEvent
  registerResearchSearchSettingsIpc({ handle: (name, handler) => { handlers.set(name, handler); return undefined } } as Parameters<typeof registerResearchSearchSettingsIpc>[0], store(), trusted)
  const invoke = (name: string, event: IpcMainInvokeEvent, ...args: unknown[]) => handlers.get(name)!(event, ...args)
  return { root, workspace, directory, encryption, store, allowed, trusted, invoke }
}

test('only trusted exact-arity requests can save, read status and remove; responses never return the key', async () => {
  const x = fixture()
  const status = 'research-search:key:status', save = 'research-search:key:save', remove = 'research-search:key:remove'
  await expect(x.invoke(save, {} as IpcMainInvokeEvent, key)).rejects.toThrow('Untrusted IPC sender')
  await expect(x.invoke(status, x.allowed, 'extra')).rejects.toThrow('Unexpected arguments')
  await expect(x.invoke(remove, x.allowed, 'extra')).rejects.toThrow('Unexpected arguments')
  for (const candidate of [undefined, 42, { key }, 'short', 'tvly-secret\nkey-here', `${key}\n`, `${key} `, key.repeat(25)]) {
    await expect(x.invoke(save, x.allowed, candidate)).rejects.toThrow('Enter a valid search key.')
  }
  await expect(x.invoke(save, x.allowed, key, 'extra')).rejects.toThrow('Expected search key')
  const before = await x.invoke(status, x.allowed)
  expect(researchSearchKeyStatusSchema.parse(before)).toMatchObject({ configured: false, storageAvailable: true })
  const stored = await x.invoke(save, x.allowed, key)
  expect(researchSearchKeyStatusSchema.parse(stored).configured).toBe(true)
  expect(JSON.stringify(stored)).not.toContain(key)
  const reopened = x.store()
  expect(await reopened.status()).toMatchObject({ configured: true, storageAvailable: true })
  const removed = await x.invoke(remove, x.allowed)
  expect(researchSearchKeyStatusSchema.parse(removed).configured).toBe(false)
  expect(await reopened.status()).toMatchObject({ configured: false })
})

test('encrypted private sibling is outside workspace and backups; unavailable encryption saves nothing', async () => {
  const x = fixture()
  const unavailable = x.store()
  x.encryption.isEncryptionAvailable.mockReturnValue(false)
  await expect(unavailable.save(key)).rejects.toThrow('Device encryption is unavailable')
  expect(await unavailable.status()).toMatchObject({ configured: false, storageAvailable: false })
  x.encryption.isEncryptionAvailable.mockReturnValue(true)
  await x.invoke('research-search:key:save', x.allowed, key)
  x.encryption.isEncryptionAvailable.mockReturnValue(false)
  const storedButUnavailable = await x.invoke('research-search:key:status', x.allowed)
  expect(researchSearchKeyStatusSchema.parse(storedButUnavailable)).toEqual({
    configured: true,
    storageAvailable: false,
    message: 'A search key is stored but device encryption is unavailable; it cannot be used until encryption returns. You can remove it locally.'
  })
  expect(JSON.stringify(storedButUnavailable)).not.toContain(key)
  const removedUnavailable = await x.invoke('research-search:key:remove', x.allowed)
  expect(researchSearchKeyStatusSchema.parse(removedUnavailable)).toMatchObject({ configured: false, storageAvailable: false })
  expect(readdirSync(x.directory)).not.toContain('tavily-key.dpapi')
  x.encryption.isEncryptionAvailable.mockReturnValue(true)
  await x.invoke('research-search:key:save', x.allowed, key)
  const files = readdirSync(x.directory)
  expect(files).toEqual(['tavily-key.dpapi'])
  expect(readFileSync(join(x.directory, files[0]), 'utf8')).toBe(`encrypted:${key}`)
  expect(relative(x.workspace, x.directory).split(/[\\/]/)[0]).toBe('..')
  expect(readdirSync(join(x.root, 'appData'))).toContain('CV Tailor Search Credentials')
  expect(readdirSync(x.root)).not.toContain('tavily-key.dpapi')
  expect(readdirSync(x.workspace, { recursive: true })).not.toContain('tavily-key.dpapi')
  expect(JSON.stringify(await x.store().status())).not.toContain(key)
  expect(() => createResearchSearchCredentials({ credentialsDirectory: x.workspace, workspaceDirectory: x.workspace, encryption: x.encryption })).toThrow(/outside/)
})

test('stale key and encryption failures never echo secrets, log them or overwrite a saved key', async () => {
  const x = fixture()
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  await x.invoke('research-search:key:save', x.allowed, key)
  const file = join(x.directory, 'tavily-key.dpapi')
  x.encryption.encryptString.mockImplementationOnce(() => { throw new Error(`private:${key}`) })
  await expect(x.invoke('research-search:key:save', x.allowed, `${key}-replacement`)).rejects.toThrow('Search key could not be saved')
  expect(readFileSync(file, 'utf8')).toBe(`encrypted:${key}`)
  writeFileSync(file, Buffer.from('stale-ciphertext'))
  x.encryption.decryptString.mockImplementationOnce(() => { throw new Error(`private:${key}`) })
  await expect(x.store().withKey(async () => 'never')).rejects.toThrow('could not be used')
  expect(JSON.stringify(await x.invoke('research-search:key:status', x.allowed))).not.toContain(key)
  expect(consoleSpy).not.toHaveBeenCalled()
})
