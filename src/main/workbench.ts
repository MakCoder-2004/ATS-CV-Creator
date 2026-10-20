import Database from 'better-sqlite3'
import type { ZodError } from 'zod'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { appearanceSchema, settingsSchema, type WorkbenchStorageAPI } from '../shared/appearance'
import { geminiKeyInputSchema, geminiModelSchema, type GeminiModel } from '../shared/gemini-settings'
import { contactInputSchema, contactRecordSchema, evidenceRevisionSchema, profileEntryInputSchema, profileEntrySchema, profileMutationResultSchema, profileSnapshotSchema, skillInputSchema, skillRecordSchema, uuidSchema, type ContactRecord, type EvidenceRevision, type ProfileEntry, type ProfileSnapshot, type SkillRecord } from '../shared/profile'
import { experienceInputSchema, experienceRecordSchema, experienceSnapshotSchema, experienceMutationResultSchema, projectInputSchema, projectRecordSchema, type ExperienceRecord, type ProjectRecord, type FactualItemRecord, type ExperienceSnapshot } from '../shared/experience'
import { jobInputSchema, jobRecordSchema, jobSaveResultSchema } from '../shared/jobs'
import type { JobRecord } from '../shared/jobs'
import { profileExchangeSchema, type ProfileExchange } from '../shared/profile-exchange'
import { prepareOutboundBundle, type ConsentSource, type EvidenceScopeRevision, type OutboundBundle, type OutboundPayload } from '../shared/outbound-consent'
import { createOutboundConsentEngine } from './outbound-consent'
import type { OutboundConsentAction, OutboundConsentPreview } from '../shared/outbound-consent-contract'
import { outboundConsentActionSchema, outboundConsentPreviewSchema } from '../shared/outbound-consent-contract'
import { AnalysisError, createAnalysisDispatcher, type AnalysisTransport } from './posting-analysis'
import { createGeminiAnalysisTransport } from './gemini-analysis-transport'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { analysisBudgetsSchema, analysisResultSchema, analysisUsageSchema, defaultAnalysisBudgets, postingAnalysisSchema, type AnalysisBudgets } from '../shared/posting-analysis'
import { pacificDay } from '../shared/pacific-day'
import { addDraftItemInputSchema, draftCorrectionInputSchema, draftRevisionSchema, type DraftRevision } from '../shared/draft'
import { CitationValidationError, runSourceLinkedGraph } from './source-linked-generation'
import { prepareDraftInputs } from './draft-inputs'
import { checkDraftFacts } from './factual-verification'
import { factualCheckReportSchema } from '../shared/factual-report'
import { createCanonicalDocument, documentFitReportSchema, type DocumentFitReport } from '../shared/document'

export interface SecureStorage {
  isEncryptionAvailable(): boolean
  getSelectedStorageBackend?(): string
  encryptString(value: string): Buffer
  decryptString?(value: Buffer): string
}

const unavailableSecureStorage: SecureStorage = {
  isEncryptionAvailable: () => false,
  encryptString: () => { throw new Error('Secure storage unavailable') }
}

type NestedInput = { id?: string; text: string }
type NestedRecord = { id: string; revision: number; text: string }
function reconcileNestedItems(items: NestedInput[], previous: NestedRecord[], owner: string): NestedRecord[] {
  const byId = new Map(previous.map(item => [item.id, item]))
  const used = new Set<string>()
  return items.map(item => {
    const prior = item.id ? byId.get(item.id) : undefined
    if (item.id && (!prior || used.has(item.id))) throw new Error(`Nested factual item does not belong to this ${owner}.`)
    if (item.id) used.add(item.id)
    return { id: prior?.id ?? randomUUID(), revision: prior ? prior.text === item.text ? prior.revision : prior.revision + 1 : 1, text: item.text }
  })
}

/** One workspace per userData directory. Opening a workspace applies forward-only migrations. */
export function createWorkbench(userData: string, secureStorage: SecureStorage = unavailableSecureStorage, scriptedTransport?: AnalysisTransport): { api: WorkbenchStorageAPI; authorizeOutboundPayload<T>(runId: string, payload: T): T; close(): void } {
  mkdirSync(userData, { recursive: true })
  const db = new Database(join(userData, 'workbench.sqlite'))
  db.pragma('journal_mode = WAL')
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS encrypted_credentials (key TEXT PRIMARY KEY, ciphertext TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_contact (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_skills (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_entries (id TEXT PRIMARY KEY, section TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS profile_skill_unique ON profile_skills(lower(json_extract(data, '$.name')), lower(json_extract(data, '$.category')));
    CREATE TABLE IF NOT EXISTS evidence_revisions (id TEXT NOT NULL, revision INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN ('created','updated','deleted')), snapshot TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(id, revision));
    CREATE TABLE IF NOT EXISTS profile_experience (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_projects (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outbound_consents (id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, scope_hash TEXT NOT NULL, created_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS posting_analysis_cache (cache_key TEXT PRIMARY KEY, job_id TEXT NOT NULL, run_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS analysis_run_state (job_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS analysis_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, attempted_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS draft_revisions (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(job_id, revision));
    CREATE TABLE IF NOT EXISTS document_fit_reports (job_id TEXT PRIMARY KEY, data TEXT NOT NULL);`)
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (1), (2), (4), (5)').run()

  const readProfile = (): ProfileSnapshot => {
    const contactRow = db.prepare('SELECT data FROM profile_contact WHERE singleton = 1').get() as { data: string } | undefined
    const skills = db.prepare('SELECT data FROM profile_skills ORDER BY rowid').all() as { data: string }[]
    const records = (db.prepare('SELECT data FROM profile_entries ORDER BY rowid').all() as { data: string }[]).map(row => profileEntrySchema.parse(JSON.parse(row.data)))
    return profileSnapshotSchema.parse({ contact: contactRow ? JSON.parse(contactRow.data) : null, skills: skills.map((row) => JSON.parse(row.data)), education: records.filter(x => x.section === 'education'), certificates: records.filter(x => x.section === 'certificates'), summary: records.filter(x => x.section === 'summary'), languages: records.filter(x => x.section === 'languages'), extras: records.filter(x => x.section === 'extras') })
  }
  const history = (id: string): EvidenceRevision[] => (db.prepare('SELECT id, revision, action, snapshot, created_at FROM evidence_revisions WHERE id = ? ORDER BY revision').all(id) as { id: string; revision: number; action: EvidenceRevision['action']; snapshot: string; created_at: string }[]).map((row) => evidenceRevisionSchema.parse({ id: row.id, revision: row.revision, action: row.action, snapshot: JSON.parse(row.snapshot), createdAt: row.created_at }))
  const failure = (code: string, message: string, fieldErrors?: Record<string, string>) => profileMutationResultSchema.parse({ ok: false, error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } })
  const experienceFailure = (code: string, message: string, fieldErrors?: Record<string, string>) => experienceMutationResultSchema.parse({ ok: false, error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } })
  const readExperience = () => experienceSnapshotSchema.parse({
    experience: (db.prepare('SELECT data FROM profile_experience ORDER BY rowid').all() as { data: string }[]).map(row => JSON.parse(row.data)),
    projects: (db.prepare('SELECT data FROM profile_projects ORDER BY rowid').all() as { data: string }[]).map(row => JSON.parse(row.data))
  })
  const validated = <T>(parsed: { success: true; data: unknown } | { success: false; error: ZodError }): { value?: T; errors?: Record<string, string> } => {
    if (parsed.success) return { value: parsed.data as T }
    const errors: Record<string, string> = {}
    for (const issue of parsed.error.issues) errors[issue.path.length ? issue.path.join('.') : '_'] = issue.message
    return { errors }
  }
  const recordRevision = (record: ContactRecord | SkillRecord | ProfileEntry | ExperienceRecord | ProjectRecord | FactualItemRecord, action: EvidenceRevision['action']) => {
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
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (4)').run()
  const secureStorageAvailable = () => {
    try {
      if (!secureStorage.isEncryptionAvailable()) return false
      // Electron's Linux basic_text backend is reversible obfuscation, not secure encryption.
      return secureStorage.getSelectedStorageBackend?.() !== 'basic_text'
    } catch { return false }
  }
  const saveSetting = (key: string, value: string) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  const profileRecords = (profile: ProfileSnapshot, experience: ExperienceSnapshot) => [
    profile.contact, ...profile.skills, ...profile.education, ...profile.certificates, ...profile.summary, ...profile.languages, ...profile.extras,
    ...experience.experience, ...experience.experience.flatMap(item => item.factualItems),
    ...experience.projects, ...experience.projects.flatMap(item => [...item.factualItems, ...item.technologies])
  ].filter((record): record is NonNullable<typeof record> => record !== null)
  const validateProfileImport = (input: string): { ok: true; data: ProfileExchange } | { ok: false; message: string } => {
    let decoded: unknown
    try { decoded = JSON.parse(input) } catch { return { ok: false, message: 'This profile file is invalid or incompatible.' } }
    const parsed = profileExchangeSchema.safeParse(decoded)
    if (!parsed.success) return { ok: false, message: 'This profile file is invalid or incompatible.' }
    const data = parsed.data
    const records = profileRecords(data.profile, data.experience)
    const currentRecords = profileRecords(readProfile(), readExperience())
    const currentById = new Map(currentRecords.map(record => [record.id, record]))
    for (const record of records) {
      const active = currentById.get(record.id)
      if (active && record.revision <= active.revision && !isDeepStrictEqual(active, record)) return { ok: false, message: 'This import reuses an active evidence ID/revision for different or outdated facts.' }
      const historyRows = db.prepare('SELECT revision, snapshot FROM evidence_revisions WHERE id = ? ORDER BY revision DESC').all(record.id) as { revision: number; snapshot: string }[]
      const matchingRevision = historyRows.find(row => row.revision === record.revision)
      if (historyRows.length && (historyRows[0].revision > record.revision || (matchingRevision && !isDeepStrictEqual(JSON.parse(matchingRevision.snapshot), record)))) return { ok: false, message: 'This import reuses an evidence ID/revision for different or outdated facts. Export a fresh profile or use newly identified records.' }
    }
    return { ok: true, data }
  }
  const outboundEngine = createOutboundConsentEngine()
  const pendingOutbound = new Map<string, { jobId: string; source: ConsentSource; bundle: OutboundBundle; runId: string; consentId?: string }>()
  const currentAnalysis = new Map<string, ReturnType<typeof analysisResultSchema.parse>>()
  const saveAnalysisState = (input: unknown) => {
    const value = analysisResultSchema.parse(input)
    currentAnalysis.set(value.jobId, value)
    if (value.runId) db.prepare('INSERT INTO analysis_run_state (job_id, run_id, data) VALUES (?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET run_id=excluded.run_id, data=excluded.data').run(value.jobId, value.runId, JSON.stringify(value))
    return value
  }
  const startedAnalysisTokens = new Set<string>()
  const analysisCacheKey = (source: ConsentSource) => createHash('sha256').update(JSON.stringify({ job: { title: source.job.title, company: source.job.company, description: source.job.description }, model: source.model.name, prompt: 'posting-analysis-v1', schema: JSON.stringify(z.toJSONSchema(postingAnalysisSchema)) })).digest('hex')
  const activeAnalysisByJob = new Map<string, string>()
  const readAnalysisBudgets = (): AnalysisBudgets => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('analysis-budgets') as { value: string } | undefined
    try { return analysisBudgetsSchema.parse(row ? JSON.parse(row.value) : defaultAnalysisBudgets) } catch { return defaultAnalysisBudgets }
  }
  const previousAttempts = (db.prepare('SELECT attempted_at FROM analysis_attempts').all() as { attempted_at: string }[]).map(row => Date.parse(row.attempted_at)).filter(Number.isFinite)
  const dispatcher = createAnalysisDispatcher({ ...readAnalysisBudgets(), maxAttempts: readAnalysisBudgets().runLimit, maxElapsedMs: readAnalysisBudgets().runTimeLimitMs, maxDailyAttempts: readAnalysisBudgets().configuredDailyLimit, observedAttempts: previousAttempts, transport: scriptedTransport ?? { generate: async input => {
    const row = db.prepare('SELECT ciphertext FROM encrypted_credentials WHERE key = ?').get('gemini-api-key') as { ciphertext: string } | undefined
    if (!row || !secureStorage.decryptString || !secureStorageAvailable()) throw Object.assign(new Error('Gemini API key is unavailable.'), { status: 401 })
    const key = secureStorage.decryptString(Buffer.from(row.ciphertext, 'base64'))
    return createGeminiAnalysisTransport(key).generate(input)
  } }, onAttempt: (timestamp, runId) => { previousAttempts.push(timestamp); db.prepare('INSERT INTO analysis_attempts (run_id, attempted_at) VALUES (?, ?)').run(runId, new Date(timestamp).toISOString()) }, onProgress: (runId, jobId, progress, attempts) => { const observed = (db.prepare('SELECT COUNT(*) AS count FROM analysis_attempts WHERE run_id = ?').get(runId) as { count: number }).count; saveAnalysisState({ jobId, runId, status: 'running', analysis: null, progress, attempts: observed || attempts, cacheHit: false }) } })
  const currentConsentSource = (jobId: string): ConsentSource | null => {
    const job = db.prepare('SELECT data FROM jobs WHERE id = ?').get(jobId) as { data: string } | undefined
    if (!job) return null
    const savedJob = jobRecordSchema.parse(JSON.parse(job.data))
    const profile = readProfile(), experience = readExperience()
    const eligible = [profile.contact, ...profile.skills, ...profile.education, ...profile.certificates,
      ...experience.experience, ...experience.experience.flatMap(item => item.factualItems),
      ...experience.projects, ...experience.projects.flatMap(item => [...item.factualItems, ...item.technologies])]
      .filter((item): item is NonNullable<typeof item> => item !== null)
    const revisions: EvidenceScopeRevision[] = eligible.map(item => [item.id, item.revision])
    const settings = db.prepare('SELECT value FROM settings WHERE key = ?').get('gemini-model') as { value: string } | undefined
    return { job: { id: savedJob.id, revision: savedJob.updatedAt, title: savedJob.title, company: savedJob.company, description: savedJob.description },
      profile: { ...profile, revision: revisions, experience: experience.experience, projects: experience.projects },
      model: { name: geminiModelSchema.parse(settings?.value ?? 'gemini-3.6-flash') } }
  }
  const api: WorkbenchStorageAPI = {
    async getSettings() {
      const rows = db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?)').all('appearance', 'gemini-model') as { key: string; value: string }[]
      const stored = Object.fromEntries(rows.map(row => [row.key, row.value]))
      const configured = Boolean(db.prepare('SELECT 1 FROM encrypted_credentials WHERE key = ?').get('gemini-api-key'))
      return settingsSchema.parse({ appearance: stored.appearance ?? 'light', gemini: { model: stored['gemini-model'] ?? 'gemini-3.6-flash', credential: { configured, secureStorageAvailable: secureStorageAvailable() } } })
    },
    async setAppearance(value) {
      saveSetting('appearance', appearanceSchema.parse(value))
      return this.getSettings()
    },
    async setGeminiModel(value: GeminiModel) {
      saveSetting('gemini-model', geminiModelSchema.parse(value))
      return this.getSettings()
    },
    async saveGeminiApiKey(value: string) {
      const key = geminiKeyInputSchema.parse(value)
      if (!secureStorageAvailable()) throw new Error('Secure storage is unavailable. Your API key was not saved.')
      let encrypted: Buffer
      try { encrypted = secureStorage.encryptString(key) }
      catch { throw new Error('Secure storage could not encrypt the API key. The key was not saved.') }
      if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) throw new Error('Secure storage could not encrypt the API key. The key was not saved.')
      db.prepare('INSERT INTO encrypted_credentials (key, ciphertext) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET ciphertext = excluded.ciphertext').run('gemini-api-key', encrypted.toString('base64'))
      return this.getSettings()
    },
    async removeGeminiApiKey() {
      db.prepare('DELETE FROM encrypted_credentials WHERE key = ?').run('gemini-api-key')
      return this.getSettings()
    },
    async getProfile() { return readProfile() },
    async validateProfileImport(input: string) {
      const result = validateProfileImport(input)
      return result.ok ? { ok: true, message: 'Profile import is valid.' } : { ok: false, message: result.message }
    },
    async replaceProfile(input: string) {
      const validation = validateProfileImport(input)
      if (!validation.ok) return { ok: false, message: validation.message }
      const data = validation.data
      const currentRecords = profileRecords(readProfile(), readExperience())
      const incomingRecords = profileRecords(data.profile, data.experience)
      const incomingIds = new Set(incomingRecords.map(record => record.id))
      const tx = db.transaction(() => {
        for (const record of currentRecords) {
          const row = db.prepare('SELECT revision FROM evidence_revisions WHERE id = ? AND revision = ?').get(record.id, record.revision)
          if (!row) {
            const latest = db.prepare('SELECT MAX(revision) AS revision FROM evidence_revisions WHERE id = ?').get(record.id) as { revision: number | null }
            recordRevision(record, latest.revision === null ? 'created' : 'updated')
          }
          if (!incomingIds.has(record.id)) recordRevision({ ...record, revision: record.revision + 1 }, 'deleted')
        }
        for (const record of incomingRecords) {
          const row = db.prepare('SELECT revision FROM evidence_revisions WHERE id = ? AND revision = ?').get(record.id, record.revision)
          if (!row) {
            const latest = db.prepare('SELECT MAX(revision) AS revision FROM evidence_revisions WHERE id = ?').get(record.id) as { revision: number | null }
            recordRevision(record, latest.revision === null ? 'created' : 'updated')
          }
        }
        db.exec('DELETE FROM profile_contact; DELETE FROM profile_skills; DELETE FROM profile_entries; DELETE FROM profile_experience; DELETE FROM profile_projects;')
        if (data.profile.contact) db.prepare('INSERT INTO profile_contact (singleton,id,revision,data) VALUES (1,?,?,?)').run(data.profile.contact.id, data.profile.contact.revision, JSON.stringify(data.profile.contact))
        for (const item of data.profile.skills) db.prepare('INSERT INTO profile_skills (id,revision,data) VALUES (?,?,?)').run(item.id,item.revision,JSON.stringify(item))
        for (const section of ['education','certificates','summary','languages','extras'] as const) for (const item of data.profile[section]) db.prepare('INSERT INTO profile_entries (id,section,revision,data) VALUES (?,?,?,?)').run(item.id,section,item.revision,JSON.stringify(item))
        for (const item of data.experience.experience) db.prepare('INSERT INTO profile_experience (id,revision,data) VALUES (?,?,?)').run(item.id,item.revision,JSON.stringify(item))
        for (const item of data.experience.projects) db.prepare('INSERT INTO profile_projects (id,revision,data) VALUES (?,?,?)').run(item.id,item.revision,JSON.stringify(item))
      })
      try { tx(); return { ok: true, message: 'Profile replaced.', profile: readProfile() } } catch { return { ok: false, message: 'Profile replacement failed; no changes were applied.' } }
    },
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
    async saveProfileEntry(input) {
      const { id: _id, ...entryInput } = input
      const parsed = validated<ProfileEntry>(profileEntryInputSchema.safeParse(entryInput))
      if (parsed.errors) return failure('VALIDATION_ERROR', 'Check the highlighted profile fields.', parsed.errors)
      if (input.id !== undefined && !uuidSchema.safeParse(input.id).success) return failure('VALIDATION_ERROR', 'Record ID must be a UUID.', { id: 'Invalid ID' })
      const tx = db.transaction(() => {
        const row = input.id ? db.prepare('SELECT id, revision FROM profile_entries WHERE id = ?').get(input.id) as { id: string; revision: number } | undefined : undefined
        if (input.id && !row) return failure('CONFLICT', 'The profile record no longer exists.')
        if (row) {
          const current = db.prepare('SELECT section FROM profile_entries WHERE id = ?').get(input.id) as { section: string }
          if (current.section !== parsed.value!.section) return failure('CONFLICT', 'A profile record cannot be moved to another section.')
        }
        if (parsed.value!.section === 'summary' && db.prepare('SELECT id FROM profile_entries WHERE section = ? AND id <> ?').get('summary', input.id ?? '')) return failure('CONFLICT', 'A summary already exists; edit the existing summary.')
        const id = row?.id ?? randomUUID(), revision = (row?.revision ?? 0) + 1
        const record = profileEntrySchema.parse({ ...parsed.value, id, revision })
        db.prepare('INSERT INTO profile_entries (id, section, revision, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET section=excluded.section, revision=excluded.revision, data=excluded.data').run(id, record.section, revision, JSON.stringify(record))
        recordRevision(record, row ? 'updated' : 'created')
        return profileMutationResultSchema.parse({ ok: true, value: readProfile() })
      })
      try { return tx() } catch { return failure('CONFLICT', 'The profile record could not be saved.') }
    },
    async deleteProfileEntry(id) {
      if (!uuidSchema.safeParse(id).success) return failure('VALIDATION_ERROR', 'Record ID must be a UUID.', { id: 'Invalid ID' })
      const tx = db.transaction(() => {
        const row = db.prepare('SELECT data FROM profile_entries WHERE id = ?').get(id) as { data: string } | undefined
        if (!row) return failure('CONFLICT', 'The profile record no longer exists.')
        const old = profileEntrySchema.parse(JSON.parse(row.data))
        recordRevision({ ...old, revision: old.revision + 1 }, 'deleted')
        db.prepare('DELETE FROM profile_entries WHERE id = ?').run(id)
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
        const nested = reconcileNestedItems(parsed.data.factualItems, old?.factualItems ?? [], 'experience')
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
        const factualItems = reconcileNestedItems(parsed.data.factualItems, old?.factualItems ?? [], 'project')
        const technologies = reconcileNestedItems(parsed.data.technologies, old?.technologies ?? [], 'project')
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
    },
    async saveJob(input) {
      const { id: _id, ...jobInput } = input
      const parsed = jobInputSchema.safeParse(jobInput)
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {}
        for (const issue of parsed.error.issues) fieldErrors[issue.path.length ? issue.path.join('.') : '_'] = issue.message
        return jobSaveResultSchema.parse({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Enter a title, company, and job description.', fieldErrors } })
      }
      if (input.id !== undefined && !uuidSchema.safeParse(input.id).success) return jobSaveResultSchema.parse({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Job ID must be a UUID.', fieldErrors: { id: 'Invalid ID' } } })
      const tx = db.transaction(() => {
        const existing = input.id ? db.prepare('SELECT created_at FROM jobs WHERE id = ?').get(input.id) as { created_at: string } | undefined : undefined
        if (input.id && !existing) return jobSaveResultSchema.parse({ ok: false, error: { code: 'CONFLICT', message: 'This saved job no longer exists.' } })
        const now = new Date().toISOString()
        const record = jobRecordSchema.parse({ ...parsed.data, id: input.id ?? randomUUID(), createdAt: existing?.created_at ?? now, updatedAt: now })
        db.prepare('INSERT INTO jobs (id, created_at, updated_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, data=excluded.data').run(record.id, record.createdAt, record.updatedAt, JSON.stringify(record))
        return jobSaveResultSchema.parse({ ok: true, value: record })
      })
      try { return tx() } catch { return jobSaveResultSchema.parse({ ok: false, error: { code: 'CONFLICT', message: 'The job could not be saved.' } }) }
    },
    async listJobs() {
      return (db.prepare('SELECT data FROM jobs ORDER BY updated_at DESC, id').all() as { data: string }[]).map(row => jobRecordSchema.parse(JSON.parse(row.data)))
    },
    async openJob(id) {
      if (!uuidSchema.safeParse(id).success) return null
      const row = db.prepare('SELECT data FROM jobs WHERE id = ?').get(id) as { data: string } | undefined
      return row ? jobRecordSchema.parse(JSON.parse(row.data)) : null
    },
    async prepareOutboundConsent(jobId: string): Promise<OutboundConsentPreview> {
      if (!uuidSchema.safeParse(jobId).success) return outboundConsentPreviewSchema.parse({ ok: false, message: 'Choose a valid saved job to review outgoing data.' })
      const source = currentConsentSource(jobId)
      if (!source) return outboundConsentPreviewSchema.parse({ ok: false, message: 'That saved job is unavailable. Choose another job.' })
      try {
        const bundle = prepareOutboundBundle(source)
        const token = randomUUID(), runId = randomUUID()
        pendingOutbound.set(token, { jobId, source, bundle, runId })
        return outboundConsentPreviewSchema.parse({ ok: true, token, jobTitle: source.job.title, jobCompany: source.job.company, outgoing: bundle.outgoing, warning: bundle.preview.residualSensitivityNotice, termsNotice: 'Google Gemini free-tier requests may be used to improve Google products. Do not submit personal, sensitive, or confidential information. This app minimizes data but cannot guarantee anonymity.' })
      } catch { return outboundConsentPreviewSchema.parse({ ok: false, message: 'Outgoing data could not be prepared safely. Review your profile and model settings, then try again.' }) }
    },
    async acceptOutboundConsent(token: string, accepted: boolean, freeTierTermsAcknowledged: boolean): Promise<OutboundConsentAction> {
      const pending = pendingOutbound.get(token)
      if (!pending) return outboundConsentActionSchema.parse({ ok: false, message: 'This preview expired. Prepare and review the outgoing data again.' })
      if (pending.consentId) return outboundConsentActionSchema.parse({ ok: false, message: 'This preview has already been accepted. Start a new run to request fresh consent.' })
      if (!accepted) return outboundConsentActionSchema.parse({ ok: false, message: 'Consent was not accepted. No request was sent.' })
      const latest = currentConsentSource(pending.jobId)
      if (!latest || prepareOutboundBundle(latest).scopeHash !== pending.bundle.scopeHash) {
        pendingOutbound.delete(token)
        return outboundConsentActionSchema.parse({ ok: false, message: 'Your job, profile, or model settings changed after preview. Review the outgoing data again.' })
      }
      try {
        const record = outboundEngine.grantConsent(pending.runId, pending.bundle, { accepted, freeTierTermsAcknowledged })
        try {
          db.prepare('INSERT INTO outbound_consents (id, run_id, scope_hash, created_at, revoked) VALUES (?, ?, ?, ?, 0)').run(record.id, pending.runId, pending.bundle.scopeHash, record.createdAt)
        } catch {
          outboundEngine.revoke(record.id)
          return outboundConsentActionSchema.parse({ ok: false, message: 'Consent could not be saved. No request was sent.' })
        }
        pending.consentId = record.id
        return outboundConsentActionSchema.parse({ ok: true, runId: pending.runId, message: 'Consent saved for this run only. No provider request was sent.' })
      } catch (error) { return outboundConsentActionSchema.parse({ ok: false, message: error instanceof Error ? error.message : 'Consent could not be saved.' }) }
    },
    async startAnalysis(token: string) {
      const pending = pendingOutbound.get(token)
      if (!pending?.consentId) throw new Error('Review and authorize this exact outgoing bundle before analysis.')
      const cacheKey = analysisCacheKey(pending.source)
      const cached = db.prepare('SELECT data, run_id FROM posting_analysis_cache WHERE cache_key = ?').get(cacheKey) as { data: string; run_id: string } | undefined
      if (cached) {
        dispatcher.authorize(pending.runId, pending.consentId)
        const value = analysisResultSchema.parse({ jobId: pending.jobId, runId: cached.run_id, status: 'complete', analysis: postingAnalysisSchema.parse(JSON.parse(cached.data)), progress: 'Loaded compatible saved analysis.', attempts: 0, cacheHit: true })
        saveAnalysisState(value)
        return value
      }
      const credentials = db.prepare('SELECT ciphertext FROM encrypted_credentials WHERE key = ?').get('gemini-api-key')
      if (!scriptedTransport && !credentials) throw new Error('Save a Gemini API key in Settings before starting analysis.')
      if (startedAnalysisTokens.has(token)) throw new Error('This accepted analysis run is already active or has already started. Review outgoing data and accept a new run to continue.')
      const approvedPayload = authorizeOutboundPayload(pending.runId, pending.bundle.outgoing)
      if (activeAnalysisByJob.has(pending.jobId)) throw new Error('An analysis for this job is already active. Cancel it before starting another run.')
      startedAnalysisTokens.add(token)
      dispatcher.authorize(pending.runId, pending.consentId)
      activeAnalysisByJob.set(pending.jobId, pending.runId)
      let result: Awaited<ReturnType<typeof dispatcher.analyze>>
      try {
        result = await dispatcher.analyze({ runId: pending.runId, jobId: pending.jobId, model: geminiModelSchema.parse(pending.source.model.name), prompt: `Extract only explicit qualifications from this authorized minimized posting. Do not infer missing requirements. Return JSON with required, preferred, tools, responsibilities, keywords.\n${JSON.stringify(approvedPayload)}`, consentId: pending.consentId })
      } catch (error) {
        if (activeAnalysisByJob.get(pending.jobId) === pending.runId) activeAnalysisByJob.delete(pending.jobId)
        const failure = error instanceof AnalysisError ? error : new AnalysisError('PROVIDER', 'Analysis could not complete. Check Settings and try again.')
        const status = failure.code === 'CANCELLED' ? 'cancelled' : 'failed'
        const value = analysisResultSchema.parse({ jobId: pending.jobId, runId: pending.runId, status, analysis: null, progress: failure.message, attempts: failure.usage?.attempts ?? 0, error: failure.message, cacheHit: false })
        saveAnalysisState(value)
        return value
      }
      if (activeAnalysisByJob.get(pending.jobId) === pending.runId) activeAnalysisByJob.delete(pending.jobId)
      db.prepare('INSERT OR REPLACE INTO posting_analysis_cache (cache_key, job_id, run_id, data) VALUES (?, ?, ?, ?)').run(cacheKey, pending.jobId, pending.runId, JSON.stringify(result.analysis))
      const value = analysisResultSchema.parse({ jobId: pending.jobId, runId: pending.runId, status: 'complete', analysis: result.analysis, progress: 'Posting analysis complete.', attempts: result.usage.attempts, cacheHit: false })
      saveAnalysisState(value)
      return value
    },
    async generateDraft(token: string, pageTarget: 1 | 2 = 1) {
      if (pageTarget !== 1 && pageTarget !== 2) return { ok: false, message: 'Choose a one- or two-page target.' }
      const pending = pendingOutbound.get(token)
      if (!pending?.consentId) return { ok: false, message: 'Review and authorize this exact outgoing bundle before generation.' }
      const latestScope = currentConsentSource(pending.jobId)
      if (!latestScope || prepareOutboundBundle(latestScope).scopeHash !== pending.bundle.scopeHash) return { ok: false, message: 'Your job, profile, or model settings changed after consent. Review the outgoing data again.' }
      const analysis = await this.getAnalysis(pending.jobId)
      if (!analysis || analysis.status !== 'complete' || !analysis.analysis) return { ok: false, message: 'Complete posting analysis before generating a draft.' }
      if (activeAnalysisByJob.has(pending.jobId)) return { ok: false, message: 'Generation is already active for this saved job.' }
      const job = await this.openJob(pending.jobId)
      if (!job) return { ok: false, message: 'The saved job is unavailable.' }
      const latestScopeAfterAsync = currentConsentSource(pending.jobId)
      if (!latestScopeAfterAsync || prepareOutboundBundle(latestScopeAfterAsync).scopeHash !== pending.bundle.scopeHash) return { ok: false, message: 'Your job, profile, or model settings changed after consent. Review the outgoing data again.' }
      const profile = readProfile(), experience = readExperience()
      const draftInputs = prepareDraftInputs(profile, experience)
      const items = draftInputs.items
      const approvedPayload = authorizeOutboundPayload<OutboundPayload>(pending.runId, pending.bundle.outgoing)
      const scrubbed = new Map<string, string>()
      profile.education.forEach((item, i) => { const safe = approvedPayload.profile.education[i]; if (safe) scrubbed.set(item.id, JSON.stringify(safe)) })
      experience.experience.forEach((item, i) => { const safe = approvedPayload.profile.experience[i]; if (safe) { scrubbed.set(item.id, JSON.stringify(safe)); item.factualItems.forEach((fact, n) => scrubbed.set(fact.id, safe.evidence[n] ?? '')) } })
      experience.projects.forEach((item, i) => { const safe = approvedPayload.profile.projects[i]; if (safe) { scrubbed.set(item.id, JSON.stringify(safe)); item.factualItems.forEach((fact, n) => scrubbed.set(fact.id, safe.evidence[n] ?? '')); item.technologies.forEach((fact, n) => scrubbed.set(fact.id, safe.technologies[n] ?? '')) } })
      profile.skills.forEach((item, i) => { const safe = approvedPayload.profile.skills[i]; if (safe) scrubbed.set(item.id, JSON.stringify(safe)) })
      profile.certificates.forEach((item, i) => { const safe = approvedPayload.profile.certificates[i]; if (safe) scrubbed.set(item.id, JSON.stringify(safe)) })
      const safeItems = items.map(item => ({ ...item, text: scrubbed.get(item.id) ?? '' })).filter(item => item.text)
      activeAnalysisByJob.set(pending.jobId, pending.runId)
      const failedDraftIdentity = { id: randomUUID(), jobId: pending.jobId, revision: ((db.prepare('SELECT MAX(revision) AS revision FROM draft_revisions WHERE job_id = ?').get(pending.jobId) as { revision: number | null }).revision ?? 0) + 1, createdAt: new Date().toISOString(), lockedFields: draftInputs.lockedFields }
      try {
        const result = await runSourceLinkedGraph({ job: approvedPayload.job, analysis: analysis.analysis, items: safeItems, pageTarget, restoreText: pending.bundle.restoreIdentifiers, onProgress: progress => { const observed = (db.prepare('SELECT COUNT(*) AS count FROM analysis_attempts WHERE run_id = ?').get(pending.runId) as { count: number }).count; saveAnalysisState({ jobId: pending.jobId, runId: pending.runId, status: 'running', analysis: analysis.analysis, progress, attempts: observed, cacheHit: analysis.cacheHit }) }, identity: failedDraftIdentity, call: async (prompt, responseSchema) => {
          authorizeOutboundPayload(pending.runId, pending.bundle.outgoing)
          const generated = await dispatcher.generate({ runId: pending.runId, jobId: pending.jobId, model: geminiModelSchema.parse(pending.source.model.name), prompt, consentId: pending.consentId!, responseSchema })
          authorizeOutboundPayload(pending.runId, pending.bundle.outgoing)
          return { value: responseSchema.parse(JSON.parse(generated.text)), attempts: generated.attempts }
        } })
        authorizeOutboundPayload(pending.runId, pending.bundle.outgoing)
        const repairSchema = z.object({ corrections: z.array(z.object({ section: z.enum(['education', 'experience', 'projects', 'skills', 'certificates']), index: z.number().int().nonnegative(), text: z.string().trim().min(1).max(3000), citations: z.array(z.object({ evidenceId: uuidSchema, revision: z.number().int().positive() }).strict()).min(1) }).strict()).max(200) }).strict()
        let report = checkDraftFacts(result.draft)
        let repairAttempts = 0
        for (let cycle = 0; cycle < 2 && !report.passed; cycle++) {
          const failedItems = report.findings.map(finding => {
            const found = /^(education|experience|projects|skills|certificates)\[(\d+)\]/.exec(finding.itemPath)
            if (!found) return { finding }
            const section = found[1] as keyof DraftRevision['content'], index = Number(found[2]), item = result.draft.content[section][index]
            return { finding, section, index, text: item && ('text' in item ? item.text : item.name), citedEvidence: item?.citations.map(citation => ({ ...citation, text: safeItems.find(source => source.id === citation.evidenceId)?.text ?? '' })) }
          })
          authorizeOutboundPayload(pending.runId, pending.bundle.outgoing)
          const repair = await dispatcher.generate({ runId: pending.runId, jobId: pending.jobId, model: geminiModelSchema.parse(pending.source.model.name), consentId: pending.consentId!, responseSchema: repairSchema, prompt: `Factual repair cycle ${cycle + 1} of 2. Correct only the listed failing draft items using only their cited evidence. Preserve every unaffected item. Never infer facts or use uncited evidence. Return corrections for failed item paths only; keep citation IDs/revisions from the supplied evidence. If no safe correction is possible, remove that item by returning no correction for it.\n${JSON.stringify({ findings: failedItems })}` })
          authorizeOutboundPayload(pending.runId, pending.bundle.outgoing)
          repairAttempts += repair.attempts
          const response = repairSchema.parse(JSON.parse(repair.text))
          for (const correction of response.corrections) {
            const section = [...result.draft.content[correction.section]], prior = section[correction.index]
            if (!prior || !correction.citations.every(citation => result.draft.evidence.some(source => source.evidenceId === citation.evidenceId && source.revision === citation.revision) && safeItems.some(source => source.id === citation.evidenceId && source.category === correction.section))) continue
            section[correction.index] = 'text' in prior ? { ...prior, text: pending.bundle.restoreIdentifiers(correction.text), citations: correction.citations } : { ...prior, name: pending.bundle.restoreIdentifiers(correction.text), citations: correction.citations }
            result.draft.content = { ...result.draft.content, [correction.section]: section }
          }
          result.draft.attempts += repair.attempts
          report = checkDraftFacts(result.draft)
        }
        const totalAttempts = result.attempts + repairAttempts
        const checkedDraft = draftRevisionSchema.parse({ ...result.draft, status: report.passed ? 'unverified' : 'blocked', checkReport: report, progress: report.passed ? `${result.draft.progress} Deterministic factual checks passed; citations do not establish semantic truth. Human review remains required.` : `Draft saved for its ${result.draft.pageTarget}-page target; blocked by ${report.findings.length} deterministic factual finding(s). Edit the draft or correct its cited evidence, then check again.` })
        result.draft = checkedDraft
        const tx = db.transaction(() => { db.prepare('INSERT INTO draft_revisions (id,job_id,revision,data) VALUES (?,?,?,?)').run(result.draft.id, result.draft.jobId, result.draft.revision, JSON.stringify(result.draft)) })
        tx()
        if (activeAnalysisByJob.get(pending.jobId) === pending.runId) activeAnalysisByJob.delete(pending.jobId)
        saveAnalysisState({ jobId: pending.jobId, runId: pending.runId, status: 'complete', analysis: analysis.analysis, progress: result.draft.progress, attempts: analysis.attempts + totalAttempts, cacheHit: analysis.cacheHit })
        return { ok: true, message: result.draft.status === 'blocked' ? 'Draft saved locally, editable, and blocked by factual findings.' : 'Draft saved locally. It is unverified and unapproved.', draft: result.draft }
      } catch (error) {
        if (activeAnalysisByJob.get(pending.jobId) === pending.runId) activeAnalysisByJob.delete(pending.jobId)
        const cancelled = error instanceof AnalysisError && error.code === 'CANCELLED'
        const observedAttempts = (db.prepare('SELECT COUNT(*) AS count FROM analysis_attempts WHERE run_id = ?').get(pending.runId) as { count: number }).count
        const message = cancelled ? 'Draft generation was cancelled. No generated wording was retained.' : 'The generated response could not be safely validated. No model wording was retained; author a correction in the blocked draft or retry.'
        const validationFailure = error instanceof SyntaxError || error instanceof z.ZodError || error instanceof CitationValidationError
        if (validationFailure) {
          const failed = draftRevisionSchema.parse({ ...failedDraftIdentity, pageTarget, status: 'blocked', approved: false, content: { education: [], experience: [], projects: [], skills: [], certificates: [] }, evidence: safeItems.map(item => ({ evidenceId: item.id, revision: item.revision, snapshot: item.snapshot })), progress: 'Generation failed validation; model output was discarded. This empty draft is editable only by adding locally authored content and remains blocked pending factual checks.', attempts: observedAttempts })
          const code = error instanceof CitationValidationError ? error.finding : 'schema'
          const report = factualCheckReportSchema.parse({ ...checkDraftFacts(failed), passed: false, findings: [{ code, itemPath: 'generation', message: code === 'foreign-citation' ? 'The response referenced evidence outside the selected authorized sources. Model output was discarded.' : 'The tailored response did not match the required structured schema. Model output was discarded.', correction: 'Author or correct draft wording using the saved evidence revisions, then run factual checks.' }] })
          const blocked = draftRevisionSchema.parse({ ...failed, checkReport: report })
          db.prepare('INSERT INTO draft_revisions (id,job_id,revision,data) VALUES (?,?,?,?)').run(blocked.id, blocked.jobId, blocked.revision, JSON.stringify(blocked))
          saveAnalysisState({ jobId: pending.jobId, runId: pending.runId, status: 'complete', analysis: analysis.analysis, progress: blocked.progress, attempts: observedAttempts, cacheHit: analysis.cacheHit })
          return { ok: true, message: 'A blocked draft was saved; no invalid model output was retained.', draft: blocked }
        }
        const safeMessage = cancelled ? message : error instanceof Error && /scope|authorization|stale|changed/i.test(error.message) ? 'Your authorized scope changed during generation. Review the outgoing data and try again.' : 'Draft generation failed safely. No draft was created; check authorization, connection, and model settings before retrying.'
        saveAnalysisState({ jobId: pending.jobId, runId: pending.runId, status: cancelled ? 'cancelled' : 'failed', analysis: analysis.analysis, progress: safeMessage, attempts: observedAttempts, error: safeMessage, cacheHit: analysis.cacheHit })
        return { ok: false, message: safeMessage }
      }
    },
    async correctDraft(input: { jobId: string; section: 'education' | 'experience' | 'projects' | 'skills' | 'certificates'; index: number; text: string }) {
      const parsed = draftCorrectionInputSchema.safeParse(input)
      if (!parsed.success) return null
      const row = db.prepare('SELECT data FROM draft_revisions WHERE job_id = ? ORDER BY revision DESC LIMIT 1').get(parsed.data.jobId) as { data: string } | undefined
      if (!row) return null
      const prior = draftRevisionSchema.parse(JSON.parse(row.data))
      const section = [...prior.content[parsed.data.section]]
      const target = section[parsed.data.index]
      if (!target) return null
      const updatedContent = { ...prior.content, [parsed.data.section]: section.map((item, index) => index !== parsed.data.index ? item : 'text' in item ? { ...item, text: parsed.data.text } : { ...item, name: parsed.data.text }) }
      const next = draftRevisionSchema.parse({ ...prior, id: randomUUID(), revision: prior.revision + 1, status: 'unverified', checkReport: undefined, content: updatedContent, progress: 'Draft wording corrected locally. Recheck before human review.' })
      const checkedReport = checkDraftFacts(next)
      const known = prior.checkReport?.findings.filter(finding => finding.itemPath === 'generation') ?? []
      const report = factualCheckReportSchema.parse({ ...checkedReport, passed: checkedReport.passed && known.length === 0, findings: [...known, ...checkedReport.findings] })
      const checked = draftRevisionSchema.parse({ ...next, status: report.passed ? 'unverified' : 'blocked', checkReport: report, progress: report.passed ? 'Correction passes deterministic checks; semantic truth still requires human review.' : `Blocked by ${report.findings.length} factual finding(s). Use the correction guidance below.` })
      db.prepare('INSERT INTO draft_revisions (id,job_id,revision,data) VALUES (?,?,?,?)').run(checked.id, checked.jobId, checked.revision, JSON.stringify(checked))
      return checked
    },
    async addDraftItem(input: { jobId: string; section: 'education' | 'experience' | 'projects' | 'skills' | 'certificates'; text: string; citation: { evidenceId: string; revision: number } }) {
      const parsed = addDraftItemInputSchema.safeParse(input)
      if (!parsed.success) return null
      const prior = await this.getDraft(parsed.data.jobId)
      if (!prior) return null
      const selected = prior.evidence.find(item => item.evidenceId === parsed.data.citation.evidenceId && item.revision === parsed.data.citation.revision)
      if (!selected) return null
      const current = prepareDraftInputs(readProfile(), readExperience()).items.find(item => item.id === selected.evidenceId)
      if (!current || current.revision !== selected.revision || current.category !== parsed.data.section) return null
      const parent = parsed.data.section === 'experience' ? prior.lockedFields.experience.find(item => item.sourceIds?.includes(current.id)) : parsed.data.section === 'projects' ? prior.lockedFields.projects.find(item => item.sourceIds?.includes(current.id)) : undefined
      if ((parsed.data.section === 'experience' || parsed.data.section === 'projects') && !parent) return null
      const items = [...prior.content[parsed.data.section]]
      const draftItem = parsed.data.section === 'skills' ? { name: parsed.data.text, citations: [parsed.data.citation], rationale: 'Locally authored correction from selected saved evidence.' } : { text: parsed.data.text, citations: [parsed.data.citation], rationale: 'Locally authored correction from selected saved evidence.' }
      items.push(draftItem as never)
      const next = draftRevisionSchema.parse({ ...prior, id: randomUUID(), revision: prior.revision + 1, status: 'blocked', checkReport: undefined, content: { ...prior.content, [parsed.data.section]: items }, progress: 'The invalid provider response was discarded and replaced by locally authored, cited content. Automated checks do not replace human review.' })
      const report = checkDraftFacts(next)
      const saved = draftRevisionSchema.parse({ ...next, status: report.passed ? 'unverified' : 'blocked', checkReport: report })
      db.prepare('INSERT INTO draft_revisions (id,job_id,revision,data) VALUES (?,?,?,?)').run(saved.id, saved.jobId, saved.revision, JSON.stringify(saved))
      return saved
    },
    async checkDraft(jobId: string) {
      if (!uuidSchema.safeParse(jobId).success) return null
      const row = db.prepare('SELECT data FROM draft_revisions WHERE job_id = ? ORDER BY revision DESC LIMIT 1').get(jobId) as { data: string } | undefined
      if (!row) return null
      const draft = draftRevisionSchema.parse(JSON.parse(row.data))
      const checked = checkDraftFacts(draft)
      const known = draft.checkReport?.findings.filter(finding => finding.itemPath === 'generation') ?? []
      const report = factualCheckReportSchema.parse({ ...checked, passed: checked.passed && known.length === 0, findings: [...known, ...checked.findings] })
      const updated = draftRevisionSchema.parse({ ...draft, status: report.passed ? 'unverified' : 'blocked', checkReport: report, progress: report.passed ? 'Deterministic factual checks passed; citations do not establish semantic truth. Human review remains required.' : `Blocked by ${report.findings.length} deterministic factual finding(s). Correct the draft and check again.` })
      db.prepare('UPDATE draft_revisions SET data = ? WHERE id = ?').run(JSON.stringify(updated), draft.id)
      return report
    },
    async getDraft(jobId: string) {
      if (!uuidSchema.safeParse(jobId).success) return null
      const row = db.prepare('SELECT data FROM draft_revisions WHERE job_id = ? ORDER BY revision DESC LIMIT 1').get(jobId) as { data: string } | undefined
      if (!row) return null
      const stored = JSON.parse(row.data) as Record<string, unknown>
      return draftRevisionSchema.parse({ ...stored, pageTarget: stored.pageTarget ?? 1 })
    },
    async getCanonicalDocument(jobId: string) {
      const draft = await this.getDraft(jobId)
      if (!draft) return null
      return createCanonicalDocument(draft, readProfile(), readExperience())
    },
    async saveDocumentFitReport(jobId: string, report: DocumentFitReport) {
      const parsed = documentFitReportSchema.parse(report), canonical = await this.getCanonicalDocument(jobId)
      if (!canonical || canonical.targetPages !== parsed.targetPages || createHash('sha256').update(JSON.stringify(canonical)).digest('hex') !== parsed.documentHash) throw new Error('Document changed during page measurement; measure the current preview again.')
      db.prepare('INSERT INTO document_fit_reports (job_id,data) VALUES (?,?) ON CONFLICT(job_id) DO UPDATE SET data=excluded.data').run(jobId, JSON.stringify(parsed))
      return parsed
    },
    async getDocumentFitReport(jobId: string) {
      const row = db.prepare('SELECT data FROM document_fit_reports WHERE job_id = ?').get(jobId) as { data: string } | undefined
      if (!row) return null
      const report = documentFitReportSchema.parse(JSON.parse(row.data)), canonical = await this.getCanonicalDocument(jobId)
      if (!canonical || canonical.targetPages !== report.targetPages || createHash('sha256').update(JSON.stringify(canonical)).digest('hex') !== report.documentHash) return null
      return report
    },
    async acceptDocumentCuts(jobId: string, documentHash: string, entryIds: string[]) {
      const report = await this.getDocumentFitReport(jobId), current = await this.getDraft(jobId)
      if (!report || !report.overflow || report.documentHash !== documentHash || !current) return { ok: false, message: 'Page-fit proposal is stale. Measure the current preview again.' }
      const selected = new Set(entryIds)
      if (!selected.size || [...selected].some(id => !report.proposedCuts.some(cut => cut.entryId === id))) return { ok: false, message: 'Choose one or more proposed cuts from the current overflow report.' }
      const content = { ...current.content }
      for (const section of ['education', 'experience', 'projects', 'skills', 'certificates'] as const) content[section] = content[section].filter((_, index) => !selected.has(`${section}-${index}`)) as never
      const revised = draftRevisionSchema.parse({ ...current, id: randomUUID(), revision: current.revision + 1, content, approved: false, status: 'unverified', progress: 'Accepted page-fit cuts. The document is a new unverified revision and must be rechecked and reviewed.', createdAt: new Date().toISOString() })
      db.prepare('INSERT INTO draft_revisions (id,job_id,revision,data) VALUES (?,?,?,?)').run(revised.id, revised.jobId, revised.revision, JSON.stringify(revised))
      db.prepare('DELETE FROM document_fit_reports WHERE job_id = ?').run(jobId)
      return { ok: true, message: 'Accepted cuts saved as a new draft revision; remeasure and review it.', draft: revised }
    },
    async getAnalysis(jobId: string) {
      if (!uuidSchema.safeParse(jobId).success) return null
      const value = currentAnalysis.get(jobId)
      if (value) return analysisResultSchema.parse(value)
      const savedState = db.prepare('SELECT data FROM analysis_run_state WHERE job_id = ?').get(jobId) as { data: string } | undefined
      if (savedState) { const restored = analysisResultSchema.parse(JSON.parse(savedState.data)); currentAnalysis.set(jobId, restored); return restored }
      const source = currentConsentSource(jobId)
      if (!source) return null
      const cached = db.prepare('SELECT data, run_id FROM posting_analysis_cache WHERE cache_key = ? AND job_id = ?').get(analysisCacheKey(source), jobId) as { data: string; run_id: string } | undefined
      if (!cached) return null
      const restored = analysisResultSchema.parse({ jobId, runId: cached.run_id, status: 'complete', analysis: postingAnalysisSchema.parse(JSON.parse(cached.data)), progress: 'Loaded compatible saved analysis from this workspace.', attempts: 0, cacheHit: true })
      currentAnalysis.set(jobId, restored)
      return restored
    },
    async cancelAnalysis(jobId: string) {
      const activeRunId = activeAnalysisByJob.get(jobId)
      const previous = currentAnalysis.get(jobId)
      if (!activeRunId && previous) return analysisResultSchema.parse(previous)
      if (activeRunId) dispatcher.cancel(activeRunId)
      const value = analysisResultSchema.parse({ jobId, ...(activeRunId ? { runId: activeRunId } : {}), status: 'cancelled', analysis: null, progress: 'Analysis cancelled. No further requests will be sent.', attempts: previous?.attempts ?? 0, cacheHit: false })
      saveAnalysisState(value)
      return value
    },
    async getAnalysisUsage() {
      const day = pacificDay(Date.now())
      const attempts = previousAttempts.filter(timestamp => pacificDay(timestamp) === day).length
      const budgets = readAnalysisBudgets()
      const localNotice = 'Local observations and configured app limits only; other clients or keys sharing the provider project are not visible. These are not provider quota guarantees.'
      const now = Date.now()
      const recentAttempts = previousAttempts.filter(timestamp => now - timestamp < budgets.rateLimitWindowMs).length
      const dailyWarning = budgets.configuredDailyLimit - attempts < budgets.runLimit ? `Warning before run: the remaining configured local daily attempts may be insufficient for this run (up to ${budgets.runLimit} attempts). ` : ''
      const rateWarning = recentAttempts + budgets.runLimit > budgets.rateLimitAttempts ? `Warning before run: this run may reach the configured ${budgets.rateLimitAttempts}-attempt rate window and require pacing. ` : ''
      return analysisUsageSchema.parse({ ...budgets, pacificDay: day, attempts, warning: `${dailyWarning}${rateWarning}${localNotice}` })
    },
    async setAnalysisBudgets(value) {
      const budgets = analysisBudgetsSchema.parse(value)
      saveSetting('analysis-budgets', JSON.stringify(budgets))
      dispatcher.setBudgets(budgets)
      return this.getAnalysisUsage()
    },
    async cancelOutboundConsent(token: string): Promise<OutboundConsentAction> {
      const pending = pendingOutbound.get(token)
      if (!pending) return outboundConsentActionSchema.parse({ ok: false, message: 'This preview is no longer active.' })
      if (pending.consentId) {
        outboundEngine.revoke(pending.consentId)
        db.prepare('UPDATE outbound_consents SET revoked = 1 WHERE id = ?').run(pending.consentId)
      }
      const active = activeAnalysisByJob.get(pending.jobId) === pending.runId
      if (active) dispatcher.cancel(pending.runId)
      const prior = currentAnalysis.get(pending.jobId)
      if (active || !prior) saveAnalysisState({ jobId: pending.jobId, runId: pending.runId, status: 'cancelled', analysis: null, progress: 'Run cancelled. Further dispatches are stopped.', attempts: prior?.attempts ?? 0, cacheHit: false })
      pendingOutbound.delete(token)
      return outboundConsentActionSchema.parse({ ok: true, runId: pending.runId, message: 'Consent cancelled for this run. No further provider request will be dispatched.' })
    }
  }
  const authorizeOutboundPayload = <T>(runId: string, payload: T): T => {
    const consent = [...pendingOutbound.values()].find(item => item.runId === runId && item.consentId)
    if (!consent) throw new Error('No active outbound consent exists for this run.')
    const latest = currentConsentSource(consent.jobId)
    if (!latest || prepareOutboundBundle(latest).scopeHash !== consent.bundle.scopeHash) {
      outboundEngine.revoke(consent.consentId!)
      db.prepare('UPDATE outbound_consents SET revoked = 1 WHERE id = ?').run(consent.consentId)
      throw new Error('Outbound authorization is stale; review the updated data before sending.')
    }
    return outboundEngine.authorizePayload(runId, consent.bundle, payload)
  }
  return { api, authorizeOutboundPayload, close: () => db.close() }
}
