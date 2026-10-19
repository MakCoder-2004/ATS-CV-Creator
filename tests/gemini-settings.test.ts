import Database from 'better-sqlite3'
import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench, type SecureStorage } from '../src/main/workbench'
import { createGeminiModelConfig } from '../src/shared/gemini-settings'

const directories: string[] = []
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function workspace() {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-gemini-'))
  directories.push(directory)
  return directory
}
const fakeSecureStorage: SecureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`cipher:${value}`, 'utf8')
}

test('credentials are encrypted before persistence and never returned through settings', async () => {
  const dir = workspace()
  const app = createWorkbench(dir, fakeSecureStorage)
  const canary = 'secret-canary-gemini-key'
  expect(await app.api.getSettings()).toEqual({ appearance: 'light', gemini: { model: 'gemini-3.6-flash', credential: { configured: false, secureStorageAvailable: true } } })
  const saved = await app.api.saveGeminiApiKey(canary)
  expect(saved.gemini.credential).toEqual({ configured: true, secureStorageAvailable: true })
  expect(JSON.stringify(saved)).not.toContain(canary)
  expect(JSON.stringify(await app.api.getSettings())).not.toContain(canary)
  expect(createGeminiModelConfig(saved.gemini.model)).toEqual({ provider: 'google', model: 'gemini-3.6-flash' })
  app.close()

  const databaseText = readFileSync(join(dir, 'workbench.sqlite'), 'utf8')
  expect(databaseText).not.toContain(canary)
  const db = new Database(join(dir, 'workbench.sqlite'))
  expect(db.prepare('SELECT ciphertext FROM encrypted_credentials WHERE key = ?').get('gemini-api-key')).toEqual({ ciphertext: Buffer.from(`cipher:${canary}`).toString('base64') })
  db.close()

  const reopened = createWorkbench(dir, fakeSecureStorage)
  expect((await reopened.api.getSettings()).gemini.credential.configured).toBe(true)
  const changed = await reopened.api.saveGeminiApiKey('replacement-key-canary')
  expect(JSON.stringify(changed)).not.toContain('replacement-key-canary')
  const modelSettings = await reopened.api.setGeminiModel('gemini-2.5-flash')
  expect(modelSettings.gemini.model).toBe('gemini-2.5-flash')
  await reopened.api.removeGeminiApiKey()
  expect((await reopened.api.getSettings()).gemini.credential.configured).toBe(false)
  reopened.close()
})

test('secure storage failure refuses the key without creating plaintext or credential state', async () => {
  const dir = workspace()
  const app = createWorkbench(dir)
  await expect(app.api.saveGeminiApiKey('never-store-this-canary')).rejects.toThrow(/Secure storage is unavailable/)
  expect((await app.api.getSettings()).gemini.credential).toEqual({ configured: false, secureStorageAvailable: false })
  app.close()
  const db = new Database(join(dir, 'workbench.sqlite'))
  expect(db.prepare('SELECT count(*) AS n FROM encrypted_credentials').get()).toEqual({ n: 0 })
  expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('gemini-model')).toEqual(undefined)
  db.close()
  expect(readFileSync(join(dir, 'workbench.sqlite'), 'utf8')).not.toContain('never-store-this-canary')
})

test('Electron basic_text storage is rejected as unavailable', async () => {
  const app = createWorkbench(workspace(), { ...fakeSecureStorage, getSelectedStorageBackend: () => 'basic_text' })
  expect((await app.api.getSettings()).gemini.credential.secureStorageAvailable).toBe(false)
  await expect(app.api.saveGeminiApiKey('must-not-persist')).rejects.toThrow(/Secure storage is unavailable/)
  app.close()
})

test('invalid models are rejected without changing the saved model', async () => {
  const app = createWorkbench(workspace(), fakeSecureStorage)
  await expect(app.api.setGeminiModel('arbitrary-model' as never)).rejects.toThrow()
  expect((await app.api.getSettings()).gemini.model).toBe('gemini-3.6-flash')
  app.close()
})
