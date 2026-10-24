import { afterEach, expect, test } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import { registerWorkspaceBackupRowSizer } from '../src/main/workspace-backup'
import { migrateLegacyOpenRouterWorkspace } from '../src/main/pi-settings-migration'

const databases: Database.Database[] = []
const directories: string[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })

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
  const legacy = createWorkbench(directory, undefined, { async generate() { throw new Error('No network in upgrade fixture.') } })
  const job = await legacy.api.saveJob({ title: 'Synthetic role', company: 'Example', description: 'A retained posting.' })
  if (!job.ok) throw new Error('Synthetic job could not be saved.')
  legacy.close()
  const db = new Database(join(directory, 'workbench.sqlite'))
  databases.push(db)
  registerWorkspaceBackupRowSizer(db)
  db.prepare('INSERT INTO encrypted_credentials (key,ciphertext) VALUES (?,?),(?,?)').run('openrouter-api-key', 'synthetic-ciphertext', 'pi-owned-test-row', 'untouched')
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('openrouter-model', 'author/model')
  db.close()
  databases.pop()
  const upgraded = createWorkbench(directory)
  expect((await upgraded.api.openJob(job.value.id))?.description).toBe('A retained posting.')
  expect((await upgraded.api.getSettings()).pi).toBeNull()
  upgraded.close()
  const inspected = new Database(join(directory, 'workbench.sqlite'))
  databases.push(inspected)
  expect(inspected.prepare('SELECT key FROM encrypted_credentials ORDER BY key').all()).toEqual([{ key: 'pi-owned-test-row' }])
  expect(inspected.prepare('SELECT key FROM settings WHERE key=?').all('openrouter-model')).toEqual([])
})
