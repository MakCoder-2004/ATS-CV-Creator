import { afterEach, expect, test } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { registerWorkspaceBackupRowSizer } from '../src/main/workspace-backup'
import { migrateLegacyOpenRouterWorkspace } from '../src/main/pi-settings-migration'
import { generationRecoverySnapshotSchema } from '../src/shared/generation-recovery'

const databases: Database.Database[] = []
const workbenches: Array<ReturnType<typeof createWorkbench>> = []
const directories: string[] = []
afterEach(() => { for (const wb of workbenches.splice(0)) wb.close(); for (const db of databases.splice(0)) db.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) })

test('legacy migration deletes only CV Tailor credentials and blocks old consent and recovery', () => {
  const db = new Database(':memory:')
  databases.push(db)
  db.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE encrypted_credentials (key TEXT PRIMARY KEY, ciphertext TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE outbound_consents (id TEXT PRIMARY KEY, revoked INTEGER NOT NULL);
    CREATE TABLE generation_recovery (run_id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO encrypted_credentials VALUES ('openrouter-api-key', 'synthetic-ciphertext'), ('pi-auth-fixture', 'untouched');
    INSERT INTO settings VALUES ('openrouter-model', 'legacy/model'), ('analysis-budgets', '{}'), ('appearance', 'dark');
    INSERT INTO outbound_consents VALUES ('old', 0);
    INSERT INTO generation_recovery VALUES ('running', 'running', 'old'), ('paused', 'paused', 'old'), ('complete', 'complete', 'old');`)

  migrateLegacyOpenRouterWorkspace(db, 'migration-time')
  migrateLegacyOpenRouterWorkspace(db, 'second-run')

  expect(db.prepare('SELECT key FROM encrypted_credentials ORDER BY key').all()).toEqual([{ key: 'pi-auth-fixture' }])
  expect(db.prepare('SELECT key FROM settings ORDER BY key').all()).toEqual([{ key: 'appearance' }])
  expect(db.prepare('SELECT revoked FROM outbound_consents WHERE id = ?').get('old')).toEqual({ revoked: 1 })
  expect(db.prepare('SELECT status, updated_at FROM generation_recovery ORDER BY run_id').all()).toEqual([
    { status: 'complete', updated_at: 'old' },
    { status: 'cancelled', updated_at: 'migration-time' },
    { status: 'cancelled', updated_at: 'migration-time' }
  ])
})

test('an interrupted transaction keeps the synthetic old key and consent until a full retry succeeds', () => {
  const db = new Database(':memory:')
  databases.push(db)
  db.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE encrypted_credentials (key TEXT PRIMARY KEY, ciphertext TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE outbound_consents (id TEXT PRIMARY KEY, revoked INTEGER NOT NULL);
    CREATE TABLE generation_recovery (run_id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO encrypted_credentials VALUES ('openrouter-api-key', 'synthetic-ciphertext');
    INSERT INTO settings VALUES ('openrouter-model', 'author/model');
    INSERT INTO outbound_consents VALUES ('old', 0);
    INSERT INTO generation_recovery VALUES ('old', 'paused', 'old');
    CREATE TRIGGER reject_pi_upgrade BEFORE INSERT ON schema_migrations WHEN NEW.version=9 BEGIN SELECT RAISE(ABORT, 'synthetic interruption'); END;`)
  expect(() => migrateLegacyOpenRouterWorkspace(db)).toThrow(/synthetic interruption/)
  expect(db.prepare('SELECT ciphertext FROM encrypted_credentials WHERE key=?').get('openrouter-api-key')).toEqual({ ciphertext: 'synthetic-ciphertext' })
  expect(db.prepare('SELECT revoked FROM outbound_consents').get()).toEqual({ revoked: 0 })
  expect(db.prepare('SELECT status FROM generation_recovery').get()).toEqual({ status: 'paused' })
  db.exec('DROP TRIGGER reject_pi_upgrade')
  migrateLegacyOpenRouterWorkspace(db)
  expect(db.prepare('SELECT key FROM encrypted_credentials').all()).toEqual([])
  expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 9 }])
})

test('opening an old workspace deletes only the app-owned key and leaves saved jobs readable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-upgrade-workspace-'))
  directories.push(directory)
  const legacy = createWorkbench(directory, undefined, { async generate() { throw new Error('No network in upgrade fixture.') } }); workbenches.push(legacy)
  const job = await legacy.api.saveJob({ title: 'Synthetic role', company: 'Example', description: 'A retained posting.' })
  if (!job.ok) throw new Error('Synthetic job could not be saved.')
  legacy.close(); workbenches.splice(workbenches.indexOf(legacy), 1)
  const db = new Database(join(directory, 'workbench.sqlite'))
  databases.push(db)
  registerWorkspaceBackupRowSizer(db)
  db.prepare('INSERT INTO encrypted_credentials (key,ciphertext) VALUES (?,?),(?,?)').run('openrouter-api-key', 'synthetic-ciphertext', 'pi-owned-test-row', 'untouched')
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('openrouter-model', 'author/model')
  db.close()
  databases.pop()
  const upgraded = createWorkbench(directory); workbenches.push(upgraded)
  expect((await upgraded.api.openJob(job.value.id))?.description).toBe('A retained posting.')
  expect((await upgraded.api.getSettings()).pi).toBeNull()
  upgraded.close(); workbenches.splice(workbenches.indexOf(upgraded), 1)
  const inspected = new Database(join(directory, 'workbench.sqlite'))
  databases.push(inspected)
  expect(inspected.prepare('SELECT key FROM encrypted_credentials ORDER BY key').all()).toEqual([{ key: 'pi-owned-test-row' }])
  expect(inspected.prepare('SELECT key FROM settings WHERE key=?').all('openrouter-model')).toEqual([])
})

test('a real paused legacy run stays visible but cannot resume after Pi upgrade', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-legacy-recovery-'))
  directories.push(directory)
  let calls = 0
  const transport: AnalysisTransport = { async generate({ prompt }) {
    calls++
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) {
      const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Synthetic evidence.' })) })
    }
    throw Object.assign(new Error('Synthetic interrupted provider response.'), { code: 'ECONNRESET' })
  } }
  const old = createWorkbench(directory, undefined, transport); workbenches.push(old)
  const role = await old.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Example', description: 'Built systems.' })
  const job = await old.api.saveJob({ title: 'Engineer', company: 'Example', description: 'Build systems.' })
  if (!role.ok || !job.ok) throw new Error('Could not save synthetic recovery sources.')
  const preview = await old.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw new Error(preview.message)
  expect(await old.api.acceptOutboundConsent(preview.token, true, true)).toMatchObject({ ok: true })
  expect(await old.api.startAnalysis(preview.token)).toMatchObject({ status: 'complete' })
  expect(await old.api.generateDraft(preview.token)).toMatchObject({ ok: false })
  const prior = await old.api.getGenerationRecovery(job.value.id)
  expect(prior).toMatchObject({ canResume: true, runId: expect.any(String) })
  old.close(); workbenches.splice(workbenches.indexOf(old), 1)

  const db = new Database(join(directory, 'workbench.sqlite')); databases.push(db)
  registerWorkspaceBackupRowSizer(db)
  const row = db.prepare('SELECT snapshot FROM generation_recovery WHERE run_id=?').get(prior!.runId) as { snapshot: string }
  const current = JSON.parse(row.snapshot)
  const legacy = generationRecoverySnapshotSchema.parse({
    version: 1,
    runId: current.runId, jobId: current.jobId, consentId: current.consentId, scopeHash: current.scopeHash,
    analysis: current.analysis, job: current.job, profile: current.profile, experience: current.experience,
    draftInputs: current.draftInputs, safeItems: current.safeItems, identity: current.identity,
    pageTarget: current.pageTarget, source: { job: current.source.job, profile: current.source.profile, model: { name: current.source.model.name } },
    faithfulnessCheck: current.faithfulnessCheck,
    budgets: { minimumSpacingMs: 0, rateLimitAttempts: 100, rateLimitWindowMs: 86400000, configuredDailyLimit: 10000, runLimit: 12, runTimeLimitMs: 300000 }
  })
  expect(legacy).toMatchObject({ version: 1, budgets: { runLimit: 12 }, source: { model: { name: expect.any(String) } } })
  db.prepare('UPDATE generation_recovery SET snapshot=? WHERE run_id=?').run(JSON.stringify(legacy), prior!.runId)
  db.prepare('DELETE FROM schema_migrations WHERE version=9').run()
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('openrouter-model', legacy.source.model.name)
  db.close(); databases.pop()

  const upgraded = createWorkbench(directory); workbenches.push(upgraded)
  const recovery = await upgraded.api.getGenerationRecovery(job.value.id)
  expect(prior?.uncertainAttempts).toBe(1)
  expect(recovery).toMatchObject({ canResume: false, status: 'uncertain', attempts: prior?.attempts, uncertainAttempts: prior?.uncertainAttempts, progress: expect.stringMatching(/cannot resume with Pi.*may have incurred a charge.*Review outgoing data/i) })
  expect(await upgraded.api.resumeGeneration(prior!.runId, 'retry-uncertain')).toMatchObject({ ok: false })
  expect(await upgraded.api.openJob(job.value.id)).toMatchObject({ description: 'Build systems.' })
  expect(calls).toBe(3)
})
