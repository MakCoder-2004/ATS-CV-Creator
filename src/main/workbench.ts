import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { appearanceSchema, settingsSchema, type WorkbenchAPI } from '../shared/appearance'

/** One workspace per userData directory. Opening a workspace applies forward-only migrations. */
export function createWorkbench(userData: string): { api: WorkbenchAPI; close(): void } {
  mkdirSync(userData, { recursive: true })
  const db = new Database(join(userData, 'workbench.sqlite'))
  db.pragma('journal_mode = WAL')
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`)
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)').run()

  const api: WorkbenchAPI = {
    async getSettings() {
      const stored = db.prepare('SELECT value FROM settings WHERE key = ?').get('appearance') as { value: string } | undefined
      return settingsSchema.parse({ appearance: stored?.value ?? 'light' })
    },
    async setAppearance(value) {
      const appearance = appearanceSchema.parse(value)
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('appearance', appearance)
      return this.getSettings()
    }
  }
  return { api, close: () => db.close() }
}
