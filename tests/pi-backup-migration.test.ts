import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { createWorkbench } from '../src/main/workbench'
import { registerWorkspaceBackupRowSizer } from '../src/main/workspace-backup'
import type { PiModelRuntime } from '../src/main/pi-model'
import type { Api, Model } from '@earendil-works/pi-ai'

const directories: string[] = []
const opened: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const workbench of opened.splice(0)) workbench.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const directory = () => { const dir = mkdtempSync(join(tmpdir(), 'cv-pi-backup-')); directories.push(dir); return dir }
const safetyCopy = (dir: string) => (content: string) => { const path = join(dir, 'safety-copy.json'); writeFileSync(path, content, { flag: 'wx' }); return readFileSync(path, 'utf8') }

test('legacy backup restores history without OpenRouter settings, credentials, or consent', async () => {
  const oldDir = directory(), old = createWorkbench(oldDir, undefined, { async generate() { throw new Error('No model request in backup fixture.') } })
  opened.push(old)
  const saved = await old.api.saveJob({ title: 'Synthetic role', company: 'Example', description: 'Retain this posting.' })
  if (!saved.ok) throw new Error('Could not save synthetic job.')
  await old.api.setOpenRouterModel('author/legacy-model')
  const legacyBackup = old.backup.createBackup()
  expect(JSON.parse(legacyBackup).tables.settings.rows.some((row: { key: string }) => row.key === 'openrouter-model')).toBe(true)
  old.close(); opened.pop()

  const newDir = directory(), fresh = createWorkbench(newDir)
  fresh.close()
  const db = new Database(join(newDir, 'workbench.sqlite'))
  registerWorkspaceBackupRowSizer(db)
  db.prepare('INSERT INTO encrypted_credentials (key,ciphertext) VALUES (?,?)').run('openrouter-api-key', 'synthetic-ciphertext')
  db.close()
  const migrated = createWorkbench(newDir)
  opened.push(migrated)
  const preview = migrated.backup.previewRestore(legacyBackup)
  expect(preview.consentInvalidated).toBe(true)
  migrated.backup.applyRestore(preview.token, safetyCopy(newDir))
  expect(await migrated.api.openJob(saved.value.id)).toMatchObject({ description: 'Retain this posting.' })
  expect((await migrated.api.getSettings()).pi).toBeNull()
  const newBackup = JSON.parse(migrated.backup.createBackup())
  expect(newBackup.tables.settings.rows.some((row: { key: string }) => row.key === 'openrouter-model' || row.key === 'analysis-budgets')).toBe(false)
  expect(newBackup.tables.schema_migrations.rows.some((row: { version: number }) => row.version === 9)).toBe(true)
  expect(JSON.stringify(newBackup)).not.toContain('synthetic-ciphertext')
})

test('new-format backup retains the exact Pi selection while resetting workspace authorization', async () => {
  const dir = directory()
  const model = { provider: 'sample', id: 'author/chat', name: 'Synthetic', api: 'openai-completions' as Api,
    baseUrl: 'https://example.invalid', input: ['text'], reasoning: true, contextWindow: 16384, maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as Model<Api>
  const runtime = {
    getProviders: () => [{ id: model.provider, getModels: () => [model] }],
    getPhysicalModel: () => model, getAvailable: async () => [model], getAuth: async () => ({ source: 'synthetic' })
  } as unknown as PiModelRuntime
  const workbench = createWorkbench(dir, undefined, undefined, undefined, undefined, runtime)
  opened.push(workbench)
  await workbench.api.setPiModel({ reference: 'sample/author/chat', thinkingLevel: 'low' })
  const job = await workbench.api.saveJob({ title: 'Engineer', company: 'Example', description: 'Build TypeScript systems.' })
  if (!job.ok) throw new Error('Could not save the synthetic job.')
  const preview = await workbench.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw new Error(preview.message)
  expect(await workbench.api.acceptOutboundConsent(preview.token, true, true)).toMatchObject({ ok: true })
  const backup = workbench.backup.createBackup()
  await workbench.api.setAppearance('dark')
  const restore = workbench.backup.previewRestore(backup)
  workbench.backup.applyRestore(restore.token, safetyCopy(dir))
  workbench.close(); opened.pop()
  const reopened = createWorkbench(dir, undefined, undefined, undefined, undefined, runtime)
  opened.push(reopened)
  expect((await reopened.api.getSettings()).pi).toEqual({ providerId: 'sample', modelId: 'author/chat', thinkingLevel: 'low' })
  expect((await reopened.api.getSettings()).appearance).toBe('light')
  await expect(reopened.api.startAnalysis(preview.token)).rejects.toThrow()
})
