import { afterEach, expect, test } from 'vitest'
import Database from 'better-sqlite3'
import { migrateLegacyOpenRouterWorkspace } from '../src/main/pi-settings-migration'

const databases: Database.Database[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

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
