import type Database from 'better-sqlite3'

export const PI_SETTINGS_MIGRATION_VERSION = 9

export function migrateLegacyOpenRouterWorkspace(db: Database.Database, now = new Date().toISOString()): void {
  db.transaction(() => {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(PI_SETTINGS_MIGRATION_VERSION)) return
    db.prepare("DELETE FROM encrypted_credentials WHERE key = 'openrouter-api-key'").run()
    db.prepare("DELETE FROM settings WHERE key IN ('openrouter-model', 'analysis-budgets')").run()
    db.prepare('UPDATE outbound_consents SET revoked = 1 WHERE revoked = 0').run()
    db.prepare("UPDATE generation_recovery SET status = 'cancelled', updated_at = ? WHERE status IN ('running', 'paused')").run(now)
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(PI_SETTINGS_MIGRATION_VERSION)
  })()
}
