import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { appearanceSchema, settingsSchema, type WorkbenchAPI } from '../shared/appearance'
import { contactInputSchema, contactRecordSchema, evidenceRevisionSchema, profileMutationResultSchema, profileSnapshotSchema, skillInputSchema, skillRecordSchema, uuidSchema, type ContactRecord, type EvidenceRevision, type ProfileSnapshot, type SkillRecord } from '../shared/profile'
import { experienceInputSchema, experienceRecordSchema, experienceSnapshotSchema, experienceHistorySchema, experienceMutationResultSchema, projectInputSchema, projectRecordSchema, type ExperienceRecord, type ProjectRecord, type FactualItemRecord } from '../shared/experience'

/** One workspace per userData directory. Opening a workspace applies forward-only migrations. */
export function createWorkbench(userData: string): { api: WorkbenchAPI; close(): void } {
  mkdirSync(userData, { recursive: true })
  const db = new Database(join(userData, 'workbench.sqlite'))
  db.pragma('journal_mode = WAL')
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_contact (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_skills (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS profile_skill_unique ON profile_skills(lower(json_extract(data, '$.name')), lower(json_extract(data, '$.category')));
    CREATE TABLE IF NOT EXISTS evidence_revisions (id TEXT NOT NULL, revision INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN ('created','updated','deleted')), snapshot TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(id, revision));
    CREATE TABLE IF NOT EXISTS profile_experience (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_projects (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);`)
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (1), (2), (4)').run()

  const readProfile = (): ProfileSnapshot => {
    const contactRow = db.prepare('SELECT data FROM profile_contact WHERE singleton = 1').get() as { data: string } | undefined
    const skills = db.prepare('SELECT data FROM profile_skills ORDER BY rowid').all() as { data: string }[]
    return profileSnapshotSchema.parse({ contact: contactRow ? JSON.parse(contactRow.data) : null, skills: skills.map((row) => JSON.parse(row.data)) })
  }
  const history = (id: string): EvidenceRevision[] => (db.prepare('SELECT id, revision, action, snapshot, created_at FROM evidence_revisions WHERE id = ? ORDER BY revision').all(id) as { id: string; revision: number; action: EvidenceRevision['action']; snapshot: string; created_at: string }[]).map((row) => evidenceRevisionSchema.parse({ id: row.id, revision: row.revision, action: row.action, snapshot: JSON.parse(row.snapshot), createdAt: row.created_at }))
  const failure = (code: string, message: string, fieldErrors?: Record<string, string>) => profileMutationResultSchema.parse({ ok: false, error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } })
  const experienceFailure = (code: string, message: string, fieldErrors?: Record<string, string>) => experienceMutationResultSchema.parse({ ok: false, error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } })
  const readExperience = () => experienceSnapshotSchema.parse({
    experience: (db.prepare('SELECT data FROM profile_experience ORDER BY rowid').all() as { data: string }[]).map(row => JSON.parse(row.data)),
    projects: (db.prepare('SELECT data FROM profile_projects ORDER BY rowid').all() as { data: string }[]).map(row => JSON.parse(row.data))
  })
  const validated = <T>(parsed: ReturnType<typeof contactInputSchema.safeParse> | ReturnType<typeof skillInputSchema.safeParse>): { value?: T; errors?: Record<string, string> } => {
    if (parsed.success) return { value: parsed.data as T }
    const errors: Record<string, string> = {}
    for (const issue of parsed.error.issues) errors[issue.path.length ? issue.path.join('.') : '_'] = issue.message
    return { errors }
  }
  const recordRevision = (record: ContactRecord | SkillRecord | ExperienceRecord | ProjectRecord | FactualItemRecord, action: EvidenceRevision['action']) => {
    db.prepare('INSERT INTO evidence_revisions (id, revision, action, snapshot, created_at) VALUES (?, ?, ?, ?, ?)').run(record.id, record.revision, action, JSON.stringify(record), new Date().toISOString())
  }
  const recordItemChanges = (prior: FactualItemRecord[], current: FactualItemRecord[]) => {
    const previous = new Map(prior.map(item => [item.id, item]))
    const next = new Map(current.map(item => [item.id, item]))
    for (const item of current) {
      const old = previous.get(item.id)
      if (!old) recordRevision(item, 'created')
      else if (old.text !== item.text) recordRevision(item, 'updated')
    }
    for (const item of prior) if (!next.has(item.id)) recordRevision({ ...item, revision: item.revision + 1 }, 'deleted')
  }
  const migrateNamedLinks = db.transaction(() => {
    const migrated = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 3').get()
    if (migrated) return
    const row = db.prepare('SELECT id, revision, data FROM profile_contact WHERE singleton = 1').get() as { id: string; revision: number; data: string } | undefined
    if (row) {
      const legacy = JSON.parse(row.data) as Record<string, unknown>
      if (Array.isArray(legacy.links) && legacy.links.every((link) => typeof link === 'string')) {
        const links = legacy.links.map((url) => ({ label: url, url }))
        const changed = links.length > 0
        const record = contactRecordSchema.parse({ ...legacy, links, revision: row.revision + (changed ? 1 : 0) })
        db.prepare('UPDATE profile_contact SET revision = ?, data = ? WHERE singleton = 1').run(record.revision, JSON.stringify(record))
        if (changed) recordRevision(record, 'updated')
      }
    }
    db.prepare('INSERT INTO schema_migrations (version) VALUES (3)').run()
  })
  migrateNamedLinks()
  const api: WorkbenchAPI = {
    async getSettings() {
      const stored = db.prepare('SELECT value FROM settings WHERE key = ?').get('appearance') as { value: string } | undefined
      return settingsSchema.parse({ appearance: stored?.value ?? 'light' })
    },
    async setAppearance(value) {
      const appearance = appearanceSchema.parse(value)
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('appearance', appearance)
      return this.getSettings()
    },
    async getProfile() { return readProfile() },
    async saveContact(input) {
      const { id: _id, ...contactInput } = input
      const parsed = validated<ContactRecord>(contactInputSchema.safeParse(contactInput))
      if (parsed.errors) return failure('VALIDATION_ERROR', 'Check the highlighted contact fields.', parsed.errors)
      const idResult = input.id === undefined ? undefined : uuidSchema.safeParse(input.id)
      if (idResult && !idResult.success) return failure('VALIDATION_ERROR', 'Contact ID must be a UUID.', { id: 'Invalid ID' })
      const tx = db.transaction(() => {
        const row = db.prepare('SELECT id, revision, data FROM profile_contact WHERE singleton = 1').get() as { id: string; revision: number; data: string } | undefined
        if (row && input.id !== row.id) return failure('CONFLICT', 'A contact already exists or the supplied ID is stale.')
        if (!row && input.id) return failure('CONFLICT', 'The contact no longer exists.')
        const id = row?.id ?? randomUUID(), revision = (row?.revision ?? 0) + 1
        const record = contactRecordSchema.parse({ ...parsed.value, id, revision })
        db.prepare('INSERT INTO profile_contact (singleton, id, revision, data) VALUES (1, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET id=excluded.id, revision=excluded.revision, data=excluded.data').run(id, revision, JSON.stringify(record))
        recordRevision(record, row ? 'updated' : 'created')
        return profileMutationResultSchema.parse({ ok: true, value: readProfile() })
      })
      try { return tx() } catch { return failure('CONFLICT', 'The contact could not be saved because of a data conflict.') }
    },
    async deleteContact(id) {
      if (!uuidSchema.safeParse(id).success) return failure('VALIDATION_ERROR', 'Contact ID must be a UUID.', { id: 'Invalid ID' })
      const tx = db.transaction(() => {
        const row = db.prepare('SELECT id, revision, data FROM profile_contact WHERE singleton = 1 AND id = ?').get(id) as { id: string; revision: number; data: string } | undefined
        if (!row) return failure('CONFLICT', 'The contact no longer exists.')
        const old = contactRecordSchema.parse(JSON.parse(row.data))
        recordRevision({ ...old, revision: row.revision + 1 }, 'deleted')
        db.prepare('DELETE FROM profile_contact WHERE singleton = 1').run()
        return profileMutationResultSchema.parse({ ok: true, value: readProfile() })
      })
      return tx()
    },
    async saveSkill(input) {
      const { id: _id, ...skillInput } = input
      const parsed = validated<Omit<SkillRecord, 'id' | 'revision'>>(skillInputSchema.safeParse(skillInput))
      if (parsed.errors) return failure('VALIDATION_ERROR', 'Check the highlighted skill fields.', parsed.errors)
      if (input.id !== undefined && !uuidSchema.safeParse(input.id).success) return failure('VALIDATION_ERROR', 'Skill ID must be a UUID.', { id: 'Invalid ID' })
      const tx = db.transaction(() => {
        const row = input.id ? db.prepare('SELECT id, revision FROM profile_skills WHERE id = ?').get(input.id) as { id: string; revision: number } | undefined : undefined
        if (input.id && !row) return failure('CONFLICT', 'The skill no longer exists.')
        const duplicate = db.prepare(`SELECT id FROM profile_skills WHERE lower(trim(json_extract(data, '$.name'))) = lower(trim(?))
          AND lower(trim(json_extract(data, '$.category'))) = lower(trim(?)) AND id <> ?`)
          .get(parsed.value!.name, parsed.value!.category, input.id ?? '')
        if (duplicate) return failure('CONFLICT', 'A matching skill already exists in this category.', { name: 'This skill already exists in this category.' })
        const id = row?.id ?? randomUUID(), revision = (row?.revision ?? 0) + 1
        const record = skillRecordSchema.parse({ ...parsed.value, id, revision })
        db.prepare('INSERT INTO profile_skills (id, revision, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, data=excluded.data').run(id, revision, JSON.stringify(record))
        recordRevision(record, row ? 'updated' : 'created')
        return profileMutationResultSchema.parse({ ok: true, value: readProfile() })
      })
      try { return tx() } catch { return failure('CONFLICT', 'The skill could not be saved; a matching skill may already exist.') }
    },
    async deleteSkill(id) {
      if (!uuidSchema.safeParse(id).success) return failure('VALIDATION_ERROR', 'Skill ID must be a UUID.', { id: 'Invalid ID' })
      const tx = db.transaction(() => {
        const row = db.prepare('SELECT data FROM profile_skills WHERE id = ?').get(id) as { data: string } | undefined
        if (!row) return failure('CONFLICT', 'The skill no longer exists.')
        const old = skillRecordSchema.parse(JSON.parse(row.data))
        recordRevision({ ...old, revision: old.revision + 1 }, 'deleted')
        db.prepare('DELETE FROM profile_skills WHERE id = ?').run(id)
        return profileMutationResultSchema.parse({ ok: true, value: readProfile() })
      })
      return tx()
    },
    async getEvidenceHistory(id) {
      if (!uuidSchema.safeParse(id).success) return []
      return history(id)
    },
    async getExperience() { return readExperience() },
    async saveExperience(input) {
      const { id: _id, factualItems = [], ...fields } = input
      const parsed = experienceInputSchema.safeParse({ ...fields, factualItems })
      if (!parsed.success) {
        const errors: Record<string, string> = {}
        for (const issue of parsed.error.issues) errors[issue.path.join('.') || '_'] = issue.message
        return experienceFailure('VALIDATION_ERROR', 'Check the highlighted experience fields.', errors)
      }
      if (input.id !== undefined && !uuidSchema.safeParse(input.id).success) return experienceFailure('VALIDATION_ERROR', 'Experience ID must be a UUID.', { id: 'Invalid ID' })
      const tx = db.transaction(() => {
        const row = input.id ? db.prepare('SELECT revision, data FROM profile_experience WHERE id = ?').get(input.id) as { revision: number; data: string } | undefined : undefined
        if (input.id && !row) return experienceFailure('CONFLICT', 'The experience record no longer exists.')
        const old = row ? experienceRecordSchema.parse(JSON.parse(row.data)) : undefined
        const oldItems = new Map((old?.factualItems ?? []).map(item => [item.id, item]))
        const used = new Set<string>()
        const nested = parsed.data.factualItems.map(item => {
          const prior = item.id ? oldItems.get(item.id) : undefined
          if (item.id && (!prior || used.has(item.id))) throw new Error('Nested factual item does not belong to this experience.')
          if (item.id) used.add(item.id)
          return { id: prior?.id ?? randomUUID(), revision: prior ? prior.text === item.text ? prior.revision : prior.revision + 1 : 1, text: item.text }
        })
        const record = experienceRecordSchema.parse({ ...parsed.data, id: old?.id ?? randomUUID(), revision: (old?.revision ?? 0) + 1, factualItems: nested })
        recordItemChanges(old?.factualItems ?? [], record.factualItems)
        db.prepare('INSERT INTO profile_experience (id, revision, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, data=excluded.data').run(record.id, record.revision, JSON.stringify(record))
        recordRevision(record, old ? 'updated' : 'created')
        return experienceMutationResultSchema.parse({ ok: true, value: readExperience() })
      })
      try { return tx() } catch (error) { return experienceFailure('CONFLICT', error instanceof Error && error.message.includes('Nested') ? error.message : 'The experience record could not be saved.') }
    },
    async deleteExperience(id) {
      if (!uuidSchema.safeParse(id).success) return experienceFailure('VALIDATION_ERROR', 'Experience ID must be a UUID.', { id: 'Invalid ID' })
      const tx = db.transaction(() => {
        const row = db.prepare('SELECT data FROM profile_experience WHERE id = ?').get(id) as { data: string } | undefined
        if (!row) return experienceFailure('CONFLICT', 'The experience record no longer exists.')
        const old = experienceRecordSchema.parse(JSON.parse(row.data))
        recordRevision({ ...old, revision: old.revision + 1 }, 'deleted')
        recordItemChanges(old.factualItems, [])
        db.prepare('DELETE FROM profile_experience WHERE id = ?').run(id)
        return experienceMutationResultSchema.parse({ ok: true, value: readExperience() })
      })
      return tx()
    },
    async saveProject(input) {
      const { id: _id, factualItems = [], technologies = [], links = [], ...fields } = input
      const parsed = projectInputSchema.safeParse({ ...fields, factualItems, technologies, links })
      if (!parsed.success) {
        const errors: Record<string, string> = {}
        for (const issue of parsed.error.issues) errors[issue.path.join('.') || '_'] = issue.message
        return experienceFailure('VALIDATION_ERROR', 'Check the highlighted project fields.', errors)
      }
      if (input.id !== undefined && !uuidSchema.safeParse(input.id).success) return experienceFailure('VALIDATION_ERROR', 'Project ID must be a UUID.', { id: 'Invalid ID' })
      const tx = db.transaction(() => {
        const row = input.id ? db.prepare('SELECT revision, data FROM profile_projects WHERE id = ?').get(input.id) as { revision: number; data: string } | undefined : undefined
        if (input.id && !row) return experienceFailure('CONFLICT', 'The project no longer exists.')
        const old = row ? projectRecordSchema.parse(JSON.parse(row.data)) : undefined
        const retainItems = (items: typeof parsed.data.factualItems, previous: ProjectRecord['factualItems']) => {
          const byId = new Map(previous.map(item => [item.id, item])), used = new Set<string>()
          return items.map(item => {
            const prior = item.id ? byId.get(item.id) : undefined
            if (item.id && (!prior || used.has(item.id))) throw new Error('Nested factual item does not belong to this project.')
            if (item.id) used.add(item.id)
            return { id: prior?.id ?? randomUUID(), revision: prior ? prior.text === item.text ? prior.revision : prior.revision + 1 : 1, text: item.text }
          })
        }
        const factualItems = retainItems(parsed.data.factualItems, old?.factualItems ?? [])
        const technologies = retainItems(parsed.data.technologies, old?.technologies ?? [])
        if (new Set([...factualItems, ...technologies].map(item => item.id)).size !== factualItems.length + technologies.length) throw new Error('Nested factual item IDs must be unique within this project.')
        const record = projectRecordSchema.parse({ ...parsed.data, id: old?.id ?? randomUUID(), revision: (old?.revision ?? 0) + 1, factualItems, technologies })
        recordItemChanges(old?.factualItems ?? [], record.factualItems)
        recordItemChanges(old?.technologies ?? [], record.technologies)
        db.prepare('INSERT INTO profile_projects (id, revision, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, data=excluded.data').run(record.id, record.revision, JSON.stringify(record))
        recordRevision(record, old ? 'updated' : 'created')
        return experienceMutationResultSchema.parse({ ok: true, value: readExperience() })
      })
      try { return tx() } catch (error) { return experienceFailure('CONFLICT', error instanceof Error && error.message.includes('Nested') ? error.message : 'The project could not be saved.') }
    },
    async deleteProject(id) {
      if (!uuidSchema.safeParse(id).success) return experienceFailure('VALIDATION_ERROR', 'Project ID must be a UUID.', { id: 'Invalid ID' })
      const tx = db.transaction(() => {
        const row = db.prepare('SELECT data FROM profile_projects WHERE id = ?').get(id) as { data: string } | undefined
        if (!row) return experienceFailure('CONFLICT', 'The project no longer exists.')
        const old = projectRecordSchema.parse(JSON.parse(row.data))
        recordRevision({ ...old, revision: old.revision + 1 }, 'deleted')
        recordItemChanges([...old.factualItems, ...old.technologies], [])
        db.prepare('DELETE FROM profile_projects WHERE id = ?').run(id)
        return experienceMutationResultSchema.parse({ ok: true, value: readExperience() })
      })
      return tx()
    }
  }
  return { api, close: () => db.close() }
}
