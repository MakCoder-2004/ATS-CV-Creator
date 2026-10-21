import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { createWorkspaceBackupEngine } from '../src/main/workspace-backup'

function workspace() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE encrypted_credentials (key TEXT PRIMARY KEY, ciphertext TEXT NOT NULL);
    CREATE TABLE outbound_consents (id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, scope_hash TEXT NOT NULL, created_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE profile_contact (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, data TEXT NOT NULL);
    INSERT INTO settings VALUES ('appearance','light');
    INSERT INTO encrypted_credentials VALUES ('api','secret-bytes');
    INSERT INTO profile_contact VALUES (1,'00000000-0000-4000-8000-000000000001',2,'{"id":"00000000-0000-4000-8000-000000000001","revision":2,"fullName":"A"}');
    INSERT INTO outbound_consents VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-01-01T00:00:00.000Z',0);`)
  return db
}

describe('workspace backup engine', () => {
  it('round trips non-secret tables, invalidates consent and clears device credentials', () => {
    const db = workspace(); const engine = createWorkspaceBackupEngine(db)
    const backup = engine.createBackup()
    expect(backup).not.toContain('secret-bytes')
    const preview = engine.previewRestore(backup)
    expect(preview.rowCounts.settings).toEqual({ current: 1, restored: 1 })
    db.prepare("UPDATE settings SET value='dark'").run()
    engine.applyRestore(preview.token, content => content)
    expect(db.prepare('SELECT value FROM settings').get()).toEqual({ value: 'light' })
    expect(db.prepare('SELECT * FROM encrypted_credentials').all()).toEqual([])
    expect(db.prepare('SELECT revoked FROM outbound_consents').get()).toEqual({ revoked: 1 })
  })

  it('refuses unverified safety backup and leaves workspace untouched', () => {
    const db = workspace(); const engine = createWorkspaceBackupEngine(db)
    const preview = engine.previewRestore(engine.createBackup())
    db.prepare("UPDATE settings SET value='dark'").run()
    expect(() => engine.applyRestore(preview.token, () => 'tampered')).toThrow(/safety backup/i)
    expect(db.prepare('SELECT value FROM settings').get()).toEqual({ value: 'dark' })
  })

  it('rejects arbitrary settings keys before export and restore', () => {
    const db = workspace(); const engine = createWorkspaceBackupEngine(db)
    db.prepare('INSERT INTO settings VALUES (?, ?)').run('api-key', 'private')
    expect(() => engine.createBackup()).toThrow(/settings/i)
    db.prepare("DELETE FROM settings WHERE key='api-key'").run()
    const backup = JSON.parse(engine.createBackup())
    backup.tables.settings.rows.push({ key: 'api-key', value: 'private' })
    expect(() => engine.previewRestore(JSON.stringify(backup))).toThrow(/settings/i)
  })

  it('rejects well-formed JSON that violates the profile domain contract', () => {
    const db = workspace(); const engine = createWorkspaceBackupEngine(db)
    const backup = JSON.parse(engine.createBackup())
    backup.tables.profile_contact.rows[0].data = JSON.stringify({ id: 'contact-1', revision: -3, fullName: '' })
    expect(() => engine.previewRestore(JSON.stringify(backup))).toThrow(/profile_contact/i)
    expect(db.prepare('SELECT revision FROM profile_contact').get()).toEqual({ revision: 2 })
  })

  it('aborts if workspace data changes while the verified safety backup is written', () => {
    const db = workspace(); const engine = createWorkspaceBackupEngine(db)
    const preview = engine.previewRestore(engine.createBackup())
    expect(() => engine.applyRestore(preview.token, safety => {
      db.prepare("UPDATE settings SET value='changed during write'").run()
      return safety
    })).toThrow(/changed/i)
    expect(db.prepare('SELECT value FROM settings').get()).toEqual({ value: 'changed during write' })
  })

  it('rejects corrupt or incompatible input before preview and supports cancellation', () => {
    const db = workspace(); const engine = createWorkspaceBackupEngine(db)
    expect(() => engine.previewRestore('{')).toThrow(/invalid/i)
    const preview = engine.previewRestore(engine.createBackup())
    expect(engine.cancelRestore(preview.token)).toBe(true)
    expect(() => engine.applyRestore(preview.token, value => value)).toThrow(/preview/i)
  })
})
