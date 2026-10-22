import Database from 'better-sqlite3'
import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench, type SecureStorage } from '../src/main/workbench'
import { defaultOpenRouterModel } from '../src/shared/openrouter-settings'

const directories: string[] = []
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function workspace() {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-gemini-'))
  directories.push(directory)
  return directory
}
const fakeSecureStorage: SecureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`cipher:${value}`, 'utf8'),
  decryptString: value => value.toString('utf8').replace(/^cipher:/, '')
}

test('credentials are encrypted before persistence and never returned through settings', async () => {
  const dir = workspace()
  const app = createWorkbench(dir, fakeSecureStorage)
  const canary = 'secret-canary-gemini-key'
  expect(await app.api.getSettings()).toEqual({ appearance: 'light', openRouter: { model: defaultOpenRouterModel, faithfulnessCheck: false, credential: { configured: false, secureStorageAvailable: true } } })
  const saved = await app.api.saveOpenRouterApiKey(canary)
  expect(saved.openRouter.credential).toEqual({ configured: true, secureStorageAvailable: true })
  expect(JSON.stringify(saved)).not.toContain(canary)
  expect(JSON.stringify(await app.api.getSettings())).not.toContain(canary)
  expect(await app.api.revealOpenRouterApiKey()).toBe(canary)
  expect(saved.openRouter.model).toBe(defaultOpenRouterModel)
  app.close()

  const databaseText = readFileSync(join(dir, 'workbench.sqlite'), 'utf8')
  expect(databaseText).not.toContain(canary)
  const db = new Database(join(dir, 'workbench.sqlite'))
  expect(db.prepare('SELECT ciphertext FROM encrypted_credentials WHERE key = ?').get('openrouter-api-key')).toEqual({ ciphertext: Buffer.from(`cipher:${canary}`).toString('base64') })
  expect(db.prepare('SELECT ciphertext FROM encrypted_credentials WHERE key = ?').get('gemini-api-key')).toBeUndefined()
  db.close()

  const reopened = createWorkbench(dir, fakeSecureStorage)
  expect((await reopened.api.getSettings()).openRouter.credential.configured).toBe(true)
  const enabled = await reopened.api.setFaithfulnessCheck(true)
  expect(enabled.openRouter.faithfulnessCheck).toBe(true)
  reopened.close()
  const reopenedWithFaithfulness = createWorkbench(dir, fakeSecureStorage)
  expect((await reopenedWithFaithfulness.api.getSettings()).openRouter.faithfulnessCheck).toBe(true)
  const changed = await reopenedWithFaithfulness.api.saveOpenRouterApiKey('replacement-key-canary')
  expect(JSON.stringify(changed)).not.toContain('replacement-key-canary')
  expect(await reopenedWithFaithfulness.api.revealOpenRouterApiKey()).toBe('replacement-key-canary')
  const modelSettings = await reopenedWithFaithfulness.api.setOpenRouterModel('openai/gpt-4o-mini')
  expect(modelSettings.openRouter.model).toBe('openai/gpt-4o-mini')
  expect((await reopenedWithFaithfulness.api.getSettings()).openRouter.model).toBe('openai/gpt-4o-mini')
  await reopenedWithFaithfulness.api.removeOpenRouterApiKey()
  expect((await reopenedWithFaithfulness.api.getSettings()).openRouter.credential.configured).toBe(false)
  await expect(reopenedWithFaithfulness.api.revealOpenRouterApiKey()).rejects.toThrow(/No OpenRouter API key/)
  reopenedWithFaithfulness.close()
})

test('secure storage failure refuses the key without creating plaintext or credential state', async () => {
  const dir = workspace()
  const app = createWorkbench(dir)
  await expect(app.api.saveOpenRouterApiKey('never-store-this-canary')).rejects.toThrow(/Secure storage is unavailable/)
  expect((await app.api.getSettings()).openRouter.credential).toEqual({ configured: false, secureStorageAvailable: false })
  app.close()
  const db = new Database(join(dir, 'workbench.sqlite'))
  expect(db.prepare('SELECT count(*) AS n FROM encrypted_credentials').get()).toEqual({ n: 0 })
  expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('openrouter-model')).toEqual(undefined)
  db.close()
  expect(readFileSync(join(dir, 'workbench.sqlite'), 'utf8')).not.toContain('never-store-this-canary')
})

test('Electron basic_text storage is rejected as unavailable', async () => {
  const app = createWorkbench(workspace(), { ...fakeSecureStorage, getSelectedStorageBackend: () => 'basic_text' })
  expect((await app.api.getSettings()).openRouter.credential.secureStorageAvailable).toBe(false)
  await expect(app.api.saveOpenRouterApiKey('must-not-persist')).rejects.toThrow(/Secure storage is unavailable/)
  await expect(app.api.revealOpenRouterApiKey()).rejects.toThrow(/No OpenRouter API key/)
  app.close()
})

test('an existing Gemini key is not reused as an OpenRouter credential', async () => {
  const dir = workspace()
  const app = createWorkbench(dir, fakeSecureStorage)
  app.close()
  const db = new Database(join(dir, 'workbench.sqlite'))
  db.prepare('INSERT INTO encrypted_credentials (key, ciphertext) VALUES (?, ?)').run('gemini-api-key', Buffer.from('cipher:old-gemini-key').toString('base64'))
  db.close()
  const reopened = createWorkbench(dir, fakeSecureStorage)
  expect((await reopened.api.getSettings()).openRouter.credential.configured).toBe(false)
  reopened.close()
})

test('invalid models are rejected without changing the saved model', async () => {
  const app = createWorkbench(workspace(), fakeSecureStorage)
  await expect(app.api.setOpenRouterModel('arbitrary-model' as never)).rejects.toThrow()
  expect((await app.api.getSettings()).openRouter.model).toBe(defaultOpenRouterModel)
  app.close()
})
