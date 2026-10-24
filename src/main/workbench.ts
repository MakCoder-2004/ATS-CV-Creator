import Database from 'better-sqlite3'
import type { ZodError } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { appearanceSchema, settingsSchema, type WorkbenchStorageAPI } from '../shared/appearance'
import { defaultOpenRouterModel, openRouterKeyInputSchema, openRouterModelSchema, type OpenRouterModel } from '../shared/openrouter-settings'
import { contactInputSchema, contactRecordSchema, evidenceRevisionSchema, profileEntryInputSchema, profileEntrySchema, profileMutationResultSchema, profileSnapshotSchema, skillInputSchema, skillRecordSchema, uuidSchema, type ContactRecord, type EvidenceRevision, type ProfileEntry, type ProfileSnapshot, type SkillRecord } from '../shared/profile'
import { experienceInputSchema, experienceRecordSchema, experienceSnapshotSchema, experienceMutationResultSchema, projectInputSchema, projectRecordSchema, type ExperienceRecord, type ProjectRecord, type FactualItemRecord, type ExperienceSnapshot } from '../shared/experience'
import { jobInputSchema, jobRecordSchema, jobSaveResultSchema, MAX_JOB_RECORD_UTF8_BYTES, MAX_POSTING_REVISIONS, legacyDraftTargetBaseline, postingOptionalFieldNames, postingRefreshChoiceSchema, type PostingRefreshChoice } from '../shared/jobs'
import { normalizePostingUrl, samePostingSource } from '../shared/posting-identity'
import type { JobRecord } from '../shared/jobs'
import { profileExchangeSchema, type ProfileExchange } from '../shared/profile-exchange'
import { prepareOutboundBundle, type ConsentSource, type EvidenceScopeRevision, type OutboundBundle, type OutboundPayload } from '../shared/outbound-consent'
import { createOutboundConsentEngine } from './outbound-consent'
import type { OutboundConsentAction, OutboundConsentPreview } from '../shared/outbound-consent-contract'
import { regenerationProposalSchema, regenerationTargetSchema, type RegenerationTarget, type RegenerationProposal } from '../shared/regeneration'
import { outboundConsentActionSchema, outboundConsentPreviewSchema } from '../shared/outbound-consent-contract'
import { AnalysisError, createAnalysisDispatcher, type AnalysisTransport } from './posting-analysis'
import { createOpenRouterAnalysisTransport, MAX_PROFILE_AI_REQUEST_BODY_BYTES, serializeOpenRouterRequestBody } from './openrouter-analysis-transport'
import { z } from 'zod'
import { analysisBudgetsSchema, analysisResultSchema, analysisUsageSchema, defaultAnalysisBudgets, generationRecoverySchema, postingAnalysisSchema, displayPostingAnalysisSchema, type AnalysisBudgets, type AnalysisResult, type RecoveryChoice } from '../shared/posting-analysis'
import { pacificDay } from '../shared/pacific-day'
import { addDraftItemInputSchema, draftCorrectionInputSchema, draftRevisionSchema, suggestedSkillDecisionSchema, draftTailoringCorrectionSchema, type DraftRevision } from '../shared/draft'
import { mutateDraftRecordInputSchema, type MutateDraftRecordInput } from '../shared/draft-records'
import { CitationValidationError, IncompatibleGenerationCheckpointError, runSourceLinkedGraph } from './source-linked-generation'
import { prepareDraftInputs } from './draft-inputs'
import { checkDraftFacts } from './factual-verification'
import { factualCheckReportSchema } from '../shared/factual-report'
import { qualificationCoverage, supportedCoverageTerms } from './qualification-coverage'
import { createCanonicalDocument, documentFitReportSchema, type DocumentFitReport } from '../shared/document'
import { SqliteCheckpointSaver } from './sqlite-checkpoint'
import { createWorkspaceBackupEngine, registerWorkspaceBackupRowSizer, WorkspaceBackupCapacityError } from './workspace-backup'
import type { WorkspaceBackupEngine } from '../shared/workspace-backup'
import { generationRecoverySnapshotSchema } from '../shared/generation-recovery'
import { profilePdfProposalSchema, type ProfilePdfProposal } from '../shared/profile-pdf-import'
import { postingFetchStateSchema, postingPreviewEditSchema, postingReviewSchema, type PostingPreviewEdit } from '../shared/posting-import'
import { fetchLeverPosting, validateLeverPostingUrl, type SafePostingFetchOptions } from './safe-posting-fetch'

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
function hasCompleteReviewedPostingText(value: string): boolean {
  const text = value.trim()
  if ([...text].length < 200) return false
  const hasSectionHeading = /(?:^|\n)\s*(?:responsibilities|requirements|qualifications|what you(?:'|’)ll do|what we(?:'|’)re looking for)\s*:?(?:\n|$)/im.test(text)
  const hasBullets = (text.match(/(?:^|\n)\s*[•*-]\s+\S/gm) ?? []).length > 0
  const hasMultipleParagraphs = text.split(/\n\s*\n/).filter(paragraph => paragraph.trim()).length > 1
  return hasSectionHeading && (hasBullets || hasMultipleParagraphs)
}
function repairsIncompletePosting(source: import('../shared/posting-import').PostingPreview, working: ReturnType<typeof jobInputSchema.parse>): boolean {
  const titleIsConsciouslySupplied = !!source.title.trim() || (!!working.title.trim() && working.title !== source.title)
  const descriptionNeedsRepair = source.notices.some(notice => /source did not provide posting text|structured source sections could not be interpreted|lacks enough posting-detail structure/i.test(notice))
  const descriptionIsComplete = hasCompleteReviewedPostingText(working.description) && (!descriptionNeedsRepair || working.description !== source.description)
  return titleIsConsciouslySupplied && !!working.company.trim() && descriptionIsComplete
}
function leverSourceIdentity(value: string): string | null {
  try {
    const url = new URL(value), parts = url.pathname.split('/').filter(Boolean)
    if (url.protocol !== 'https:') return null
    if (url.hostname === 'jobs.lever.co' && parts.length === 2) return `lever:${parts[0]}/${parts[1]}`
    if (url.hostname === 'api.lever.co' && parts.length === 4 && parts[0] === 'v0' && parts[1] === 'postings') return `lever:${parts[2]}/${parts[3]}`
  } catch {}
  return null
}
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
const escapeCoverageTerm = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function preserveKnownFindings(checked: ReturnType<typeof checkDraftFacts>, prior: DraftRevision) {
  const isLegacyNarrativeFinding = (finding: { itemPath: string }) => finding.itemPath.startsWith('tailoring.') || finding.itemPath === 'summary[0]'
  const known = prior.checkReport?.findings.filter(finding => !isLegacyNarrativeFinding(finding) && (finding.itemPath === 'generation' || finding.code === 'semantic-unsupported')).map(finding => {
    if (finding.code !== 'semantic-unsupported') return finding
    const originDraftId = finding.originDraftId ?? prior.checkReport?.draftId ?? prior.id
    const originDraftRevision = finding.originDraftRevision ?? prior.checkReport?.draftRevision ?? prior.revision
    const originEvidenceRevisionHash = finding.originEvidenceRevisionHash ?? prior.checkReport?.evidenceRevisionHash
    return { ...finding, originDraftId, originDraftRevision, ...(originEvidenceRevisionHash ? { originEvidenceRevisionHash } : {}), historical: originDraftId !== checked.draftId || originDraftRevision !== checked.draftRevision }
  }) ?? []
  const findings = [...known, ...checked.findings.filter(finding => !known.some(item => item.code === finding.code && item.itemPath === finding.itemPath))]
  return factualCheckReportSchema.parse({ ...checked, passed: checked.passed && known.length === 0, findings })
}

export function createWorkbench(userData: string, secureStorage: SecureStorage = unavailableSecureStorage, scriptedTransport?: AnalysisTransport, recoveryHooks?: { beforeGraphCheckpoint?: (metadata: import('@langchain/langgraph').CheckpointMetadata) => void; modelCatalogFetcher?: typeof fetch; workspaceBackupMaxBytes?: number }, safePostingFetchOptions?: SafePostingFetchOptions): { api: WorkbenchStorageAPI; authorizeOutboundPayload<T>(runId: string, payload: T): T; backup: WorkspaceBackupEngine; hasActiveWork(): boolean; close(): void } {
  mkdirSync(userData, { recursive: true })
  const db = new Database(join(userData, 'workbench.sqlite'))
  registerWorkspaceBackupRowSizer(db)
  db.pragma('journal_mode = WAL')
  const graphCheckpointer = new SqliteCheckpointSaver(db, recoveryHooks?.beforeGraphCheckpoint)
  const postingFetches = new Map<string, { controller: AbortController; state: ReturnType<typeof postingFetchStateSchema.parse>; revision: number; working?: PostingPreviewEdit; reviewed?: { revision: number; input: ReturnType<typeof jobInputSchema.parse>; review: import('../shared/posting-import').PostingReview } }>()
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS encrypted_credentials (key TEXT PRIMARY KEY, ciphertext TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_contact (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_skills (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_entries (id TEXT PRIMARY KEY, section TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS profile_skill_unique ON profile_skills(lower(json_extract(data, '$.name')), lower(json_extract(data, '$.category')));
    CREATE TABLE IF NOT EXISTS evidence_revisions (id TEXT NOT NULL, revision INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN ('created','updated','deleted')), snapshot TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(id, revision));
    CREATE TABLE IF NOT EXISTS profile_import_provenance (owner_id TEXT NOT NULL, owner_revision INTEGER NOT NULL, field TEXT NOT NULL, source_hash TEXT NOT NULL, page INTEGER NOT NULL, passage TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_id, owner_revision, field, source_hash, page, passage));
    CREATE TABLE IF NOT EXISTS profile_experience (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_projects (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outbound_consents (id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, scope_hash TEXT NOT NULL, created_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS posting_analysis_cache (cache_key TEXT PRIMARY KEY, job_id TEXT NOT NULL, run_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS analysis_run_state (job_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS analysis_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, attempted_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS provider_attempt_outcomes (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, dispatched_at TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('dispatched','response','error')), settled_at TEXT, checkpointed_at TEXT);
    CREATE TABLE IF NOT EXISTS generation_recovery (run_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, consent_id TEXT NOT NULL, scope_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','paused','cancelled','complete')), snapshot TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS generation_recovery_extensions (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, prior_run_limit INTEGER NOT NULL, new_run_limit INTEGER NOT NULL, prior_time_limit_ms INTEGER NOT NULL, new_time_limit_ms INTEGER NOT NULL, recorded_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS draft_revisions (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(job_id, revision));
    CREATE TABLE IF NOT EXISTS regeneration_proposals (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS document_fit_reports (job_id TEXT PRIMARY KEY, data TEXT NOT NULL);`)
  const providerOutcomeColumns = db.pragma('table_info(provider_attempt_outcomes)') as Array<{ name: string }>
  if (!providerOutcomeColumns.some(column => column.name === 'checkpointed_at')) db.exec('ALTER TABLE provider_attempt_outcomes ADD COLUMN checkpointed_at TEXT')
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (1), (2), (4), (5), (6), (7)').run()
  const migrateDraftTargetBaselines = db.transaction(() => {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version = 8').get()) return
    const jobs = new Map((db.prepare('SELECT id, data FROM jobs').all() as Array<{ id: string; data: string }>).map(row => {
      const job = jobRecordSchema.parse(JSON.parse(row.data))
      return [row.id, legacyDraftTargetBaseline(job)] as const
    }))
    const drafts = db.prepare('SELECT id, job_id, data FROM draft_revisions').all() as Array<{ id: string; job_id: string; data: string }>
    for (const row of drafts) {
      const stored = JSON.parse(row.data) as Record<string, unknown>
      if (typeof stored.targetPostingUpdatedAt === 'string') continue
      if (!jobs.has(row.job_id)) throw new Error('A legacy CV draft has no saved-job target to bind.')
      const baseline = jobs.get(row.job_id)
      if (!baseline) continue
      const migrated = draftRevisionSchema.parse({ ...stored, pageTarget: stored.pageTarget ?? 1, targetPostingUpdatedAt: baseline })
      db.prepare('UPDATE draft_revisions SET data = ? WHERE id = ?').run(JSON.stringify(migrated), row.id)
    }
    db.prepare('INSERT INTO schema_migrations (version) VALUES (8)').run()
  })
  migrateDraftTargetBaselines()

  const readProfile = (): ProfileSnapshot => {
    const contactRow = db.prepare('SELECT data FROM profile_contact WHERE singleton = 1').get() as { data: string } | undefined
    const skills = db.prepare('SELECT data FROM profile_skills ORDER BY rowid').all() as { data: string }[]
    const records = (db.prepare('SELECT data FROM profile_entries ORDER BY rowid').all() as { data: string }[]).map(row => profileEntrySchema.parse(JSON.parse(row.data)))
    return profileSnapshotSchema.parse({ contact: contactRow ? JSON.parse(contactRow.data) : null, skills: skills.map((row) => JSON.parse(row.data)), education: records.filter(x => x.section === 'education'), certificates: records.filter(x => x.section === 'certificates'), summary: records.filter(x => x.section === 'summary'), languages: records.filter(x => x.section === 'languages'), extras: records.filter(x => x.section === 'extras') })
  }
  const history = (id: string): EvidenceRevision[] => (db.prepare('SELECT id, revision, action, snapshot, created_at FROM evidence_revisions WHERE id = ? ORDER BY revision').all(id) as { id: string; revision: number; action: EvidenceRevision['action']; snapshot: string; created_at: string }[]).map((row) => evidenceRevisionSchema.parse({ id: row.id, revision: row.revision, action: row.action, snapshot: JSON.parse(row.snapshot), createdAt: row.created_at }))
  const failure = (code: string, message: string, fieldErrors?: Record<string, string>) => profileMutationResultSchema.parse({ ok: false, error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } })
  const backupFailureMessage = (error: unknown, fallback: string) => error instanceof WorkspaceBackupCapacityError ? error.message : fallback
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
  const pendingOutbound = new Map<string, { jobId: string; source: ConsentSource; bundle: OutboundBundle; runId: string; faithfulnessCheck: boolean; consentId?: string }>()
  const currentAnalysis = new Map<string, ReturnType<typeof analysisResultSchema.parse>>()
  const saveAnalysisState = (input: unknown) => {
    const parsed = analysisResultSchema.parse(input)
    const prior = currentAnalysis.get(parsed.jobId)
    const job = db.prepare('SELECT updated_at FROM jobs WHERE id = ?').get(parsed.jobId) as { updated_at: string } | undefined
    const value = analysisResultSchema.parse({ ...parsed, targetPostingUpdatedAt: parsed.targetPostingUpdatedAt ?? (prior && prior.runId === parsed.runId ? prior.targetPostingUpdatedAt : job?.updated_at) })
    currentAnalysis.set(value.jobId, value)
    if (value.runId) db.prepare('INSERT INTO analysis_run_state (job_id, run_id, data) VALUES (?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET run_id=excluded.run_id, data=excluded.data').run(value.jobId, value.runId, JSON.stringify(value))
    return value
  }
  const startedAnalysisTokens = new Set<string>()
  const startedRegenerationTokens = new Set<string>()
  const analysisCacheKey = (source: ConsentSource) => createHash('sha256').update(JSON.stringify({ job: { title: source.job.title, company: source.job.company, description: source.job.description }, minimizedPosting: prepareOutboundBundle(source).outgoing.job, model: source.model.name, prompt: 'posting-analysis-v2', schema: JSON.stringify(z.toJSONSchema(postingAnalysisSchema)) })).digest('hex')
  const activeAnalysisByJob = new Map<string, string>()
  const recoveredRunIds = new Set<string>()
  const readAnalysisBudgets = (): AnalysisBudgets => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('analysis-budgets') as { value: string } | undefined
    try { return analysisBudgetsSchema.parse(row ? JSON.parse(row.value) : defaultAnalysisBudgets) } catch { return defaultAnalysisBudgets }
  }
  const previousAttempts = (db.prepare('SELECT attempted_at FROM analysis_attempts').all() as { attempted_at: string }[]).map(row => Date.parse(row.attempted_at)).filter(Number.isFinite)
  const persistedRunCounts = Object.fromEntries((db.prepare('SELECT run_id, COUNT(*) AS count FROM analysis_attempts GROUP BY run_id').all() as Array<{ run_id: string; count: number }>).map(row => [row.run_id, row.count]))
  const persistedRunStarts = Object.fromEntries((db.prepare('SELECT run_id, MIN(attempted_at) AS first FROM analysis_attempts GROUP BY run_id').all() as Array<{ run_id: string; first: string }>).map(row => [row.run_id, Date.parse(row.first)]).filter(([, timestamp]) => Number.isFinite(timestamp)))
  const readStoredOpenRouterKey = () => {
    const row = db.prepare('SELECT ciphertext FROM encrypted_credentials WHERE key = ?').get('openrouter-api-key') as { ciphertext: string } | undefined
    if (!row) throw new Error('No OpenRouter API key is saved on this device.')
    if (!secureStorage.decryptString || !secureStorageAvailable()) throw new Error('Secure storage is unavailable. The saved key cannot be read.')
    try { return secureStorage.decryptString(Buffer.from(row.ciphertext, 'base64')) }
    catch { throw new Error('The saved key could not be decrypted on this device.') }
  }
  const activeProfileAiRuns = new Set<string>()
  // The injected scripted transport is an offline test seam; absent metadata there means fixture-sized capacity, never production model metadata.
  const fixtureTransport: AnalysisTransport | undefined = scriptedTransport && {
    validateCapacity: scriptedTransport.validateCapacity ?? (recoveryHooks?.modelCatalogFetcher
      ? input => createOpenRouterAnalysisTransport('', recoveryHooks.modelCatalogFetcher).validateCapacity!(input)
      : async () => true),
    generate: input => scriptedTransport.generate(input)
  }
  const dispatcher = createAnalysisDispatcher({ ...readAnalysisBudgets(), maxAttempts: readAnalysisBudgets().runLimit, maxElapsedMs: readAnalysisBudgets().runTimeLimitMs, maxDailyAttempts: readAnalysisBudgets().configuredDailyLimit, observedAttempts: previousAttempts, observedRunAttempts: persistedRunCounts, observedRunStartedAt: persistedRunStarts, transport: fixtureTransport ?? {
    validateCapacity: async input => {
      try { return await createOpenRouterAnalysisTransport(readStoredOpenRouterKey()).validateCapacity!(input) }
      catch { return false }
    },
    generate: async input => {
      let key: string
      try { key = readStoredOpenRouterKey() }
      catch { throw Object.assign(new Error('OpenRouter API key is unavailable.'), { status: 401 }) }
      return createOpenRouterAnalysisTransport(key).generate(input)
    }
  }, onAttempt: (timestamp, runId) => { const dispatchedAt = new Date(timestamp).toISOString(); db.transaction(() => { db.prepare('INSERT INTO analysis_attempts (run_id, attempted_at) VALUES (?, ?)').run(runId, dispatchedAt); db.prepare('INSERT INTO provider_attempt_outcomes (run_id, dispatched_at, outcome) VALUES (?, ?, \'dispatched\')').run(runId, dispatchedAt) })(); previousAttempts.push(timestamp) }, onAttemptComplete: (runId, succeeded) => { if (succeeded) db.prepare(`UPDATE provider_attempt_outcomes SET outcome='response', settled_at=? WHERE id=(SELECT id FROM provider_attempt_outcomes WHERE run_id=? AND outcome='dispatched' AND checkpointed_at IS NULL ORDER BY id DESC LIMIT 1)`).run(new Date().toISOString(), runId) }, onProgress: (runId, jobId, progress, attempts) => { if (jobId.startsWith('profile-import:')) return; const observed = (db.prepare('SELECT COUNT(*) AS count FROM analysis_attempts WHERE run_id = ?').get(runId) as { count: number }).count; const prior = currentAnalysis.get(jobId), sameRun = prior?.runId === runId; saveAnalysisState({ jobId, runId, status: 'running', analysis: sameRun ? prior.analysis : null, progress, attempts: observed || attempts, cacheHit: sameRun ? prior.cacheHit : false, ...(sameRun && prior.generationStep ? { generationStep: prior.generationStep } : {}), ...(sameRun && prior.completedSteps ? { completedSteps: prior.completedSteps } : {}) }) } })
  const workingTextScopeNotice = (jobId: string) => {
    const row = db.prepare('SELECT data FROM jobs WHERE id = ?').get(jobId) as { data: string } | undefined
    if (!row) return ''
    const job = jobRecordSchema.parse(JSON.parse(row.data))
    return job.sourceSnapshot && job.sourceSnapshot.description !== job.description
      ? ' Scope note: this assessment uses only the accepted working posting. The separately retained source snapshot differs, so source requirements absent from the working text were not assessed.'
      : ''
  }
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
    const settings = db.prepare('SELECT value FROM settings WHERE key = ?').get('openrouter-model') as { value: string } | undefined
    return { job: { id: savedJob.id, revision: savedJob.updatedAt, title: savedJob.title, company: savedJob.company, description: savedJob.description },
      profile: { ...profile, revision: revisions, experience: experience.experience, projects: experience.projects },
      model: { name: openRouterModelSchema.parse(settings?.value ?? defaultOpenRouterModel) } }
  }
  const currentSourceStatus = (draft: DraftRevision) => {
    const currentById = new Map(profileRecords(readProfile(), readExperience()).map(record => [record.id, record]))
    const cited = Object.values(draft.content).flatMap(items => items.flatMap(item => item.citations))
    const legacyMetadataChanges: string[] = []
    for (const section of ['experience', 'projects'] as const) for (const parent of draft.lockedFields[section]) {
      if (!draft.content[section].some(item => item.citations.some(citation => (parent.sourceIds ?? [parent.evidenceId]).includes(citation.evidenceId)))) continue
      const frozen = draft.evidence.find(entry => entry.evidenceId === parent.evidenceId)
      if (frozen) cited.push({ evidenceId: frozen.evidenceId, revision: frozen.revision })
      else {
        // Older drafts may lack a frozen parent revision; at least verify the metadata they actually use.
        const current = currentById.get(parent.evidenceId) as Record<string, unknown> | undefined
        const fields = section === 'experience' ? ['title', 'organization', 'startDate', 'endDate'] : ['name']
        if (!current || fields.some(field => current[field] !== (parent as Record<string, unknown>)[field])) legacyMetadataChanges.push(parent.evidenceId)
      }
    }
    return [...new Set([...legacyMetadataChanges, ...cited.filter(citation => {
      const frozen = draft.evidence.find(entry => entry.evidenceId === citation.evidenceId && entry.revision === citation.revision)
      return frozen?.provenance !== 'manual' && (!frozen || currentById.get(citation.evidenceId)?.revision !== citation.revision)
    }).map(citation => citation.evidenceId)])]
  }
  type DraftProfileMutation = { section: 'education' | 'experience' | 'projects' | 'skills'; operation: 'add' | 'update' | 'remove'; record: ProfileEntry | SkillRecord | ExperienceRecord | ProjectRecord; prior?: ProfileEntry | SkillRecord | ExperienceRecord | ProjectRecord }
  const stageDraftProfileMutation = (section: DraftProfileMutation['section'], operation: DraftProfileMutation['operation'], id: string | undefined, expectedRevision: number | undefined, input: unknown): DraftProfileMutation | undefined => {
    const experience = readExperience(), profile = readProfile()
    const existing = id ? profileRecords(profile, experience).find(record => record.id === id) : undefined
    const typeMatches = existing && ((section === 'education' && 'section' in existing && existing.section === 'education') || (section === 'skills' && 'category' in existing && 'name' in existing) || (section === 'experience' && 'kind' in existing) || (section === 'projects' && 'technologies' in existing && 'name' in existing))
    if (operation !== 'add' && (!existing || existing.revision !== expectedRevision || !typeMatches)) return undefined
    if (operation === 'remove' && existing) return { section, operation, record: { ...existing, revision: existing.revision + 1 } as DraftProfileMutation['record'], prior: existing as DraftProfileMutation['record'] }
    const rid = operation === 'update' ? id! : randomUUID()
    if (section === 'education') {
      const parsed = profileEntryInputSchema.safeParse(input); if (!parsed.success || parsed.data.section !== 'education') return undefined
      const old = operation === 'update' ? existing as ProfileEntry : undefined
      const record = profileEntrySchema.parse({ ...parsed.data, id: rid, revision: (old?.revision ?? 0) + 1 })
      return { section, operation, record, ...(old ? { prior: old } : {}) }
    }
    if (section === 'skills') {
      const parsed = skillInputSchema.safeParse(input); if (!parsed.success) return undefined
      const old = operation === 'update' ? existing as SkillRecord : undefined
      const record = skillRecordSchema.parse({ ...parsed.data, id: rid, revision: (old?.revision ?? 0) + 1 })
      return { section, operation, record, ...(old ? { prior: old } : {}) }
    }
    if (section === 'experience') {
      const parsed = experienceInputSchema.safeParse(input); if (!parsed.success) return undefined
      const old = operation === 'update' ? existing as ExperienceRecord : undefined
      const facts = reconcileNestedItems(parsed.data.factualItems, old?.factualItems ?? [], 'experience')
      const record = experienceRecordSchema.parse({ ...parsed.data, id: rid, revision: (old?.revision ?? 0) + 1, factualItems: facts })
      return { section, operation, record, ...(old ? { prior: old } : {}) }
    }
    const parsed = projectInputSchema.safeParse(input); if (!parsed.success) return undefined
    const old = operation === 'update' ? existing as ProjectRecord : undefined
    const facts = reconcileNestedItems(parsed.data.factualItems, old?.factualItems ?? [], 'project'), tools = reconcileNestedItems(parsed.data.technologies, old?.technologies ?? [], 'project')
    const record = projectRecordSchema.parse({ ...parsed.data, id: rid, revision: (old?.revision ?? 0) + 1, factualItems: facts, technologies: tools })
    return { section, operation, record, ...(old ? { prior: old } : {}) }
  }
  const commitDraftProfileMutation = (plan: DraftProfileMutation) => {
    const deleting = plan.operation === 'remove', record = plan.record
    if (plan.section === 'education') { const value = record as ProfileEntry; if (deleting) db.prepare('DELETE FROM profile_entries WHERE id=?').run(value.id); else db.prepare('INSERT INTO profile_entries(id,section,revision,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data').run(value.id,'education',value.revision,JSON.stringify(value)) }
    else if (plan.section === 'skills') { const value=record as SkillRecord; if (deleting) db.prepare('DELETE FROM profile_skills WHERE id=?').run(value.id); else db.prepare('INSERT INTO profile_skills(id,revision,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data').run(value.id,value.revision,JSON.stringify(value)) }
    else if (plan.section === 'experience') { const value=record as ExperienceRecord; if (deleting) db.prepare('DELETE FROM profile_experience WHERE id=?').run(value.id); else db.prepare('INSERT INTO profile_experience(id,revision,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data').run(value.id,value.revision,JSON.stringify(value)); if (deleting) recordItemChanges((plan.prior as ExperienceRecord).factualItems,[])  }
    else { const value=record as ProjectRecord; if (deleting) db.prepare('DELETE FROM profile_projects WHERE id=?').run(value.id); else db.prepare('INSERT INTO profile_projects(id,revision,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data').run(value.id,value.revision,JSON.stringify(value)); const old=plan.prior as ProjectRecord|undefined; if (deleting) { recordItemChanges(old?.factualItems??[],[]); recordItemChanges(old?.technologies??[],[]) } }
    if (deleting) { const previous = plan.prior ?? record; recordRevision({ ...previous, revision: previous.revision + 1 } as never, 'deleted') }
    else { if (plan.prior && 'factualItems' in plan.prior && 'factualItems' in record) recordItemChanges(plan.prior.factualItems, record.factualItems); else if (!plan.prior && !deleting && 'factualItems' in record) recordItemChanges([], record.factualItems); if (plan.prior && 'technologies' in plan.prior && 'technologies' in record) recordItemChanges(plan.prior.technologies, record.technologies); else if (!plan.prior && !deleting && 'technologies' in record) recordItemChanges([], record.technologies); recordRevision(record as never, plan.prior ? 'updated' : 'created') }
  }
  const profileImportBaseline = () => createHash('sha256').update(JSON.stringify({ profile: readProfile(), experience: readExperience(), history: db.prepare('SELECT id,revision,action,snapshot,created_at FROM evidence_revisions ORDER BY id,revision').all() })).digest('hex')
  const api: WorkbenchStorageAPI = {
    async getWorkspaceBackupStatus() { return backupEngine.readBackupStatus() },
    async getSettings() {
      const rows = db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?, ?)').all('appearance', 'openrouter-model', 'faithfulness-check') as { key: string; value: string }[]
      const stored = Object.fromEntries(rows.map(row => [row.key, row.value]))
      const configured = Boolean(db.prepare('SELECT 1 FROM encrypted_credentials WHERE key = ?').get('openrouter-api-key'))
      return settingsSchema.parse({ appearance: stored.appearance ?? 'light', openRouter: { model: stored['openrouter-model'] ?? defaultOpenRouterModel, faithfulnessCheck: stored['faithfulness-check'] === 'true', credential: { configured, secureStorageAvailable: secureStorageAvailable() } } })
    },
    async setAppearance(value) {
      saveSetting('appearance', appearanceSchema.parse(value))
      return this.getSettings()
    },
    async setOpenRouterModel(value: OpenRouterModel) {
      saveSetting('openrouter-model', openRouterModelSchema.parse(value))
      return this.getSettings()
    },
    async setFaithfulnessCheck(value: boolean) {
      if (typeof value !== 'boolean') throw new Error('Faithfulness setting must be boolean.')
      saveSetting('faithfulness-check', String(value))
      return this.getSettings()
    },
    async saveOpenRouterApiKey(value: string) {
      const key = openRouterKeyInputSchema.parse(value)
      if (!secureStorageAvailable()) throw new Error('Secure storage is unavailable. Your API key was not saved.')
      let encrypted: Buffer
      try { encrypted = secureStorage.encryptString(key) }
      catch { throw new Error('Secure storage could not encrypt the API key. The key was not saved.') }
      if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) throw new Error('Secure storage could not encrypt the API key. The key was not saved.')
      db.prepare('INSERT INTO encrypted_credentials (key, ciphertext) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET ciphertext = excluded.ciphertext').run('openrouter-api-key', encrypted.toString('base64'))
      return this.getSettings()
    },
    async revealOpenRouterApiKey() {
      return readStoredOpenRouterKey()
    },
    async removeOpenRouterApiKey() {
      db.prepare('DELETE FROM encrypted_credentials WHERE key = ?').run('openrouter-api-key')
      return this.getSettings()
    },
    async getProfile() { return readProfile() },
    async authorizeProfileImportAi(runId: string) {
      if (!/^profile-import:[0-9a-f-]{36}$/.test(runId)) throw new Error('Profile import operation identity is invalid.')
      if (!scriptedTransport) readStoredOpenRouterKey()
      dispatcher.authorize(runId, runId)
    },
    async generateProfileImportAi(runId: string, model: string, prompt: string, responseSchema: import('zod').ZodTypeAny) {
      if (!/^profile-import:[0-9a-f-]{36}$/.test(runId) || prompt.length > 24_000) throw new Error('Profile import request is invalid or exceeds the local input limit.')
      if (activeProfileAiRuns.has(runId)) throw new Error('This profile import request is already running.')
      const settings = db.prepare('SELECT value FROM settings WHERE key = ?').get('openrouter-model') as { value: string } | undefined
      const selectedModel = openRouterModelSchema.parse(model)
      if (selectedModel !== openRouterModelSchema.parse(settings?.value ?? defaultOpenRouterModel)) throw new Error('The OpenRouter model changed after consent. Review the outgoing text and authorize a fresh request.')
      const requestBody = serializeOpenRouterRequestBody({ model: selectedModel, prompt, responseSchema, maxTokens: 2048 })
      if (Buffer.byteLength(requestBody, 'utf8') > MAX_PROFILE_AI_REQUEST_BODY_BYTES) throw new Error('The complete AI request, including its schema, exceeds the 64 KiB request limit. Nothing was sent; continue with local review.')
      activeProfileAiRuns.add(runId)
      try { return await dispatcher.generate({ runId, jobId: runId, model: selectedModel, prompt, consentId: runId, responseSchema, retryProviderFailures: false, maxTokens: 2048, maxResponseChars: 500_000 }) }
      finally { activeProfileAiRuns.delete(runId) }
    },
    cancelProfileImportAi(runId: string) { dispatcher.cancel(runId) },
    async getProfileImportBaseline() { return profileImportBaseline() },
    async importEmptyProfilePdf(sourceHash: string, baseline: string, input: ProfilePdfProposal) {
      const validHash = /^[a-f0-9]{64}$/.test(sourceHash)
      const checked = profilePdfProposalSchema.safeParse(input)
      if (!validHash || !checked.success) return { ok: false, message: 'The reviewed CV proposals are invalid. Reopen the PDF and review them again.' }
      const proposals = checked.data
      if (proposals.contact && !proposals.contact.fullName?.trim()) return { ok: false, message: 'Add a full name to the contact proposal or skip it before applying.' }
      if (proposals.experience.some(item => item.kind === 'unresolved' && proposals.decisions?.[item.proposalRef]?.action !== 'skip')) return { ok: false, message: 'Choose Employment or Training for each included experience record.' }
      const persistentId = (proposalRef: string) => proposals.proposalIds[proposalRef]
      const associate = (ownerId: string, ownerRevision: number, proposalRef: string) => {
        const proposalId = persistentId(proposalRef)
        if (!proposalId) throw new Error('PROFILE_IMPORT_SOURCE_INVALID')
        const sourceRows = proposals.sources.filter(source => source.proposalRef === proposalRef && source.proposalId === proposalId)
        const insert = db.prepare('INSERT OR IGNORE INTO profile_import_provenance (owner_id,owner_revision,field,source_hash,page,passage,created_at) VALUES (?,?,?,?,?,?,?)')
        for (const source of sourceRows) insert.run(ownerId, ownerRevision, source.field, sourceHash, source.page, source.passage, new Date().toISOString())
      }
      const mergingProfile = profileRecords(readProfile(), readExperience()).length > 0
      const tx = db.transaction(() => {
        if (profileImportBaseline() !== baseline) throw new Error('STALE_PROFILE_PREVIEW')
        const currentProfile = readProfile(), currentExperience = readExperience()
        if (profileRecords(currentProfile, currentExperience).length) {
          const decisions = proposals.decisions
          if (!decisions) throw new Error('PROFILE_MERGE_DECISIONS_REQUIRED')
          const decisionFor = (ref: string) => decisions[ref]
          const sameRecordValues = (left: { revision: number }, right: { revision: number }) => {
            const { revision: _leftRevision, ...leftValues } = left, { revision: _rightRevision, ...rightValues } = right
            const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value
            return isDeepStrictEqual(stable(leftValues), stable(rightValues))
          }
          const mergeNested = (prior: Array<{ id: string; revision: number; text: string }>, incoming: Array<{ id?: string; text: string }>) => {
            const merged: Array<{ id?: string; text: string }> = prior.map(({ id, text }) => ({ id, text }))
            for (const item of incoming) {
              if (item.id) {
                const index = merged.findIndex(value => value.id === item.id)
                if (index < 0) merged.push(item)
                else merged[index] = item
              } else if (!merged.some(value => value.text.trim().toLocaleLowerCase() === item.text.trim().toLocaleLowerCase())) merged.push(item)
            }
            return merged
          }
          const validateNestedUpdateTargets = (parentOperation: 'add' | 'update' | 'skip', ownerExists: boolean, proposed: Array<{ proposalRef: string }>, prior: Array<{ id: string }>) => {
            const used = new Set<string>()
            for (const item of proposed) {
              const decision = decisionFor(item.proposalRef)
              if (decision.action !== 'update') continue
              const targetId = decision.targetId
              if (parentOperation !== 'update' || !ownerExists || !targetId || !prior.some(value => value.id === targetId) || used.has(targetId)) throw new Error('PROFILE_MERGE_TARGET_INVALID')
              used.add(targetId)
            }
          }
          const updateEntry = (item: typeof proposals.entries[number]) => {
            const decision = decisionFor(item.proposalRef)
            if (decision.action === 'skip') return
            const target = decision.action === 'update' ? profileRecords(currentProfile, currentExperience).find(record => record.id === decision.targetId && 'section' in record && record.section === item.section) as ProfileEntry | undefined : undefined
            if (decision.action === 'update' && !target) throw new Error('PROFILE_MERGE_TARGET_INVALID')
            const { proposalRef: _ref, requiresDateResolution: _dateResolution, ...incoming } = item
            const prior = target
            const record = profileEntrySchema.parse({ ...(prior ?? {}), ...incoming, id: prior?.id ?? persistentId(item.proposalRef), revision: (prior?.revision ?? 0) + 1 })
            if (prior && sameRecordValues(prior, record)) { associate(prior.id, prior.revision, item.proposalRef); return }
            db.prepare('INSERT INTO profile_entries(id,section,revision,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET section=excluded.section,revision=excluded.revision,data=excluded.data').run(record.id, record.section, record.revision, JSON.stringify(record))
            recordRevision(record, prior ? 'updated' : 'created'); associate(record.id, record.revision, item.proposalRef)
          }
          const contactProposal = proposals.contact
          if (contactProposal) {
            const decision = decisionFor(contactProposal.proposalRef)
            if (decision.action !== 'skip') {
              if (decision.action === 'add' && currentProfile.contact) throw new Error('PROFILE_MERGE_TARGET_INVALID')
              const existing = decision.action === 'update' && currentProfile.contact?.id === decision.targetId ? currentProfile.contact : undefined
              if (decision.action === 'update' && !existing) throw new Error('PROFILE_MERGE_TARGET_INVALID')
              const { proposalRef: _ref, ...incoming } = contactProposal
              const record = contactRecordSchema.parse({ ...(existing ?? {}), ...incoming, id: existing?.id ?? persistentId(contactProposal.proposalRef), revision: (existing?.revision ?? 0) + 1 })
              if (existing && sameRecordValues(existing, record)) associate(existing.id, existing.revision, contactProposal.proposalRef)
              else {
                db.prepare('INSERT INTO profile_contact(singleton,id,revision,data) VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET id=excluded.id,revision=excluded.revision,data=excluded.data').run(record.id, record.revision, JSON.stringify(record))
                recordRevision(record, existing ? 'updated' : 'created'); associate(record.id, record.revision, contactProposal.proposalRef)
              }
            }
          }
          for (const item of proposals.skills) {
            const decision = decisionFor(item.proposalRef)
            if (decision.action === 'skip') continue
            const target = decision.action === 'update' ? currentProfile.skills.find(record => record.id === decision.targetId) : undefined
            if (decision.action === 'update' && !target) throw new Error('PROFILE_MERGE_TARGET_INVALID')
            const { proposalRef: _ref, ...incoming } = item
            const record = skillRecordSchema.parse({ ...(target ?? {}), ...incoming, id: target?.id ?? persistentId(item.proposalRef), revision: (target?.revision ?? 0) + 1 })
            if (target && sameRecordValues(target, record)) { associate(target.id, target.revision, item.proposalRef); continue }
            db.prepare('INSERT INTO profile_skills(id,revision,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data').run(record.id, record.revision, JSON.stringify(record))
            recordRevision(record, target ? 'updated' : 'created'); associate(record.id, record.revision, item.proposalRef)
          }
          for (const item of proposals.entries) updateEntry(item)
          for (const item of proposals.experience) {
            const decision = decisionFor(item.proposalRef)
            if (decision.action === 'skip') continue
            const target = decision.action === 'update' ? currentExperience.experience.find(record => record.id === decision.targetId) : undefined
            if (decision.action === 'update' && !target) throw new Error('PROFILE_MERGE_TARGET_INVALID')
            const { proposalRef: _ref, requiresDateResolution: _dateResolution, factualItems, ...fields } = item
            validateNestedUpdateTargets(decision.action, Boolean(target), factualItems, target?.factualItems ?? [])
            const facts = factualItems.flatMap(({ proposalRef, ...fact }) => {
              const choice = decisionFor(proposalRef)
              return choice.action === 'skip' ? [] : [{ ...fact, ...(choice.action === 'update' ? { id: choice.targetId } : {}) }]
            })
            const priorFacts = target?.factualItems ?? []
            const { id: _targetId, revision: _targetRevision, ...targetInput } = target ?? {}
            const input = { ...targetInput, ...fields, factualItems: mergeNested(priorFacts, facts) }
            const plan = stageDraftProfileMutation('experience', decision.action, target?.id, target?.revision, input)
            if (!plan) throw new Error('PROFILE_MERGE_INVALID')
            const record = plan.record as ExperienceRecord
            if (target && sameRecordValues(target, record)) {
              associate(target.id, target.revision, item.proposalRef)
              for (const fact of factualItems) { if (decisionFor(fact.proposalRef).action === 'skip') continue; const accepted = target.factualItems.find(value => value.text.trim().toLocaleLowerCase() === fact.text.trim().toLocaleLowerCase()); if (accepted) associate(accepted.id, accepted.revision, fact.proposalRef) }
              continue
            }
            commitDraftProfileMutation(plan)
            associate(record.id, record.revision, item.proposalRef)
            for (const fact of factualItems) {
              if (decisionFor(fact.proposalRef).action === 'skip') continue
              const accepted = record.factualItems.find(value => value.text.trim().toLocaleLowerCase() === fact.text.trim().toLocaleLowerCase())
              if (accepted) associate(accepted.id, accepted.revision, fact.proposalRef)
            }
          }
          for (const item of proposals.projects) {
            const decision = decisionFor(item.proposalRef)
            if (decision.action === 'skip') continue
            const target = decision.action === 'update' ? currentExperience.projects.find(record => record.id === decision.targetId) : undefined
            if (decision.action === 'update' && !target) throw new Error('PROFILE_MERGE_TARGET_INVALID')
            const { proposalRef: _ref, factualItems, technologies, ...fields } = item
            validateNestedUpdateTargets(decision.action, Boolean(target), factualItems, target?.factualItems ?? [])
            validateNestedUpdateTargets(decision.action, Boolean(target), technologies, target?.technologies ?? [])
            const facts = factualItems.flatMap(({ proposalRef, ...fact }) => { const choice = decisionFor(proposalRef); return choice.action === 'skip' ? [] : [{ ...fact, ...(choice.action === 'update' ? { id: choice.targetId } : {}) }] })
            const tools = technologies.flatMap(({ proposalRef, ...technology }) => { const choice = decisionFor(proposalRef); return choice.action === 'skip' ? [] : [{ ...technology, ...(choice.action === 'update' ? { id: choice.targetId } : {}) }] })
            const preserve = (incoming: typeof facts, old: Array<{ id: string; revision?: number; text: string }>) => mergeNested(old.map(({ id, text }) => ({ id, revision: 1, text })), incoming)
            const incomingLinks = fields.links ?? []
            const mergedLinks = [...incomingLinks, ...(target?.links ?? []).filter(link => !incomingLinks.some(value => value.url.toLocaleLowerCase() === link.url.toLocaleLowerCase()))]
            const { id: _targetId, revision: _targetRevision, ...targetInput } = target ?? {}
            const input = { ...targetInput, ...fields, links: mergedLinks, factualItems: preserve(facts, target?.factualItems.map(({ id, text }) => ({ id, text })) ?? []), technologies: preserve(tools, target?.technologies.map(({ id, text }) => ({ id, text })) ?? []) }
            const plan = stageDraftProfileMutation('projects', decision.action, target?.id, target?.revision, input)
            if (!plan) throw new Error('PROFILE_MERGE_INVALID')
            const record = plan.record as ProjectRecord
            if (target && sameRecordValues(target, record)) {
              associate(target.id, target.revision, item.proposalRef)
              for (const nested of factualItems) { if (decisionFor(nested.proposalRef).action === 'skip') continue; const accepted = target.factualItems.find(value => value.text.trim().toLocaleLowerCase() === nested.text.trim().toLocaleLowerCase()); if (accepted) associate(accepted.id, accepted.revision, nested.proposalRef) }
              for (const nested of technologies) { if (decisionFor(nested.proposalRef).action === 'skip') continue; const accepted = target.technologies.find(value => value.text.trim().toLocaleLowerCase() === nested.text.trim().toLocaleLowerCase()); if (accepted) associate(accepted.id, accepted.revision, nested.proposalRef) }
              continue
            }
            commitDraftProfileMutation(plan)
            associate(record.id, record.revision, item.proposalRef)
            for (const nested of factualItems) {
              if (decisionFor(nested.proposalRef).action === 'skip') continue
              const accepted = record.factualItems.find(value => value.text.trim().toLocaleLowerCase() === nested.text.trim().toLocaleLowerCase())
              if (accepted) associate(accepted.id, accepted.revision, nested.proposalRef)
            }
            for (const nested of technologies) {
              if (decisionFor(nested.proposalRef).action === 'skip') continue
              const accepted = record.technologies.find(value => value.text.trim().toLocaleLowerCase() === nested.text.trim().toLocaleLowerCase())
              if (accepted) associate(accepted.id, accepted.revision, nested.proposalRef)
            }
          }
          return { profile: readProfile(), experience: readExperience() }
        }
        const contact = proposals.contact?.fullName ? contactRecordSchema.parse({ ...((({ proposalRef: _proposalRef, ...value }) => value)(proposals.contact)), id: persistentId(proposals.contact.proposalRef), revision: 1 }) : null
        const skills = proposals.skills.map(item => { const { proposalRef: _proposalRef, ...value } = item; return skillRecordSchema.parse({ ...value, id: persistentId(item.proposalRef), revision: 1 }) })
        const roles = proposals.experience.map(item => { const { proposalRef: _proposalRef, requiresDateResolution: _requiresDateResolution, ...value } = item; return experienceRecordSchema.parse({ ...value, id: persistentId(item.proposalRef), revision: 1, factualItems: item.factualItems.map(fact => ({ text: fact.text, id: persistentId(fact.proposalRef), revision: 1 })) }) })
        const entries = proposals.entries.map(item => { const { proposalRef: _proposalRef, requiresDateResolution: _requiresDateResolution, ...value } = item; return profileEntrySchema.parse({ ...value, id: persistentId(item.proposalRef), revision: 1 }) })
        const projects = proposals.projects.map(item => { const { proposalRef: _proposalRef, ...value } = item; return projectRecordSchema.parse({ ...value, id: persistentId(item.proposalRef), revision: 1, factualItems: item.factualItems.map(fact => ({ text: fact.text, id: persistentId(fact.proposalRef), revision: 1 })), technologies: item.technologies.map(technology => ({ text: technology.text, id: persistentId(technology.proposalRef), revision: 1 })) }) })
        if (contact) {
          db.prepare('INSERT INTO profile_contact (singleton,id,revision,data) VALUES (1,?,?,?)').run(contact.id, contact.revision, JSON.stringify(contact))
          recordRevision(contact, 'created'); associate(contact.id, contact.revision, proposals.contact!.proposalRef)
        }
        for (const skill of skills) {
          db.prepare('INSERT INTO profile_skills (id,revision,data) VALUES (?,?,?)').run(skill.id, skill.revision, JSON.stringify(skill))
          recordRevision(skill, 'created'); associate(skill.id, skill.revision, proposals.skills.find(item => item.name === skill.name && item.category === skill.category)!.proposalRef)
        }
        roles.forEach((role, roleIndex) => {
          const sourceRole = proposals.experience[roleIndex]
          db.prepare('INSERT INTO profile_experience (id,revision,data) VALUES (?,?,?)').run(role.id, role.revision, JSON.stringify(role))
          recordRevision(role, 'created'); recordItemChanges([], role.factualItems)
          associate(role.id, role.revision, sourceRole.proposalRef)
          role.factualItems.forEach((fact, index) => associate(fact.id, fact.revision, sourceRole.factualItems[index].proposalRef))
        })
        entries.forEach((entry, entryIndex) => {
          db.prepare('INSERT INTO profile_entries (id,section,revision,data) VALUES (?,?,?,?)').run(entry.id, entry.section, entry.revision, JSON.stringify(entry))
          recordRevision(entry, 'created'); associate(entry.id, entry.revision, proposals.entries[entryIndex].proposalRef)
        })
        projects.forEach((project, projectIndex) => {
          const sourceProject = proposals.projects[projectIndex]
          db.prepare('INSERT INTO profile_projects (id,revision,data) VALUES (?,?,?)').run(project.id, project.revision, JSON.stringify(project))
          recordRevision(project, 'created'); recordItemChanges([], project.factualItems); recordItemChanges([], project.technologies)
          associate(project.id, project.revision, sourceProject.proposalRef)
          project.factualItems.forEach((fact, index) => associate(fact.id, fact.revision, sourceProject.factualItems[index].proposalRef))
          project.technologies.forEach((technology, index) => associate(technology.id, technology.revision, sourceProject.technologies[index].proposalRef))
        })
        return { profile: readProfile(), experience: readExperience() }
      })
      try { return { ok: true, message: mergingProfile ? 'Reviewed CV decisions were applied. Accepted additions and updates were saved; skipped records were preserved.' : 'Reviewed CV details were added to your profile.', ...tx() } }
      catch (error) { return { ok: false, message: error instanceof WorkspaceBackupCapacityError ? error.message : error instanceof Error && error.message === 'STALE_PROFILE_PREVIEW' ? 'Your profile changed after this CV was reviewed. Nothing was applied; review the PDF again.' : error instanceof Error && error.message === 'PROFILE_NOT_EMPTY' ? 'This profile is no longer empty. Nothing was applied; use the separate profile editor to preserve existing facts.' : error instanceof Error && error.message === 'PROFILE_MERGE_DECISIONS_REQUIRED' ? 'Choose add, update, or skip for every proposed record before applying.' : error instanceof Error && error.message === 'PROFILE_MERGE_TARGET_INVALID' ? 'A selected record or nested detail no longer belongs to the chosen section or parent. Nothing was applied; review the current profile and choose its current matching record.' : error instanceof Error && error.message === 'PROFILE_MERGE_INVALID' ? 'One or more selected proposals are invalid. Correct or skip them before applying.' : 'The reviewed CV could not be applied. No profile changes were made.' } }
    },
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
      try { tx(); return { ok: true, message: 'Profile replaced.', profile: readProfile() } } catch (error) { return { ok: false, message: backupFailureMessage(error, 'Profile replacement failed; no changes were applied.') } }
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
      try { return tx() } catch (error) { return error instanceof WorkspaceBackupCapacityError ? failure('BACKUP_LIMIT', error.message) : failure('CONFLICT', 'The contact could not be saved because of a data conflict.') }
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
      try { return tx() } catch (error) { return error instanceof WorkspaceBackupCapacityError ? failure('BACKUP_LIMIT', error.message) : failure('CONFLICT', 'The skill could not be saved; a matching skill may already exist.') }
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
      try { return tx() } catch (error) { return error instanceof WorkspaceBackupCapacityError ? failure('BACKUP_LIMIT', error.message) : failure('CONFLICT', 'The profile record could not be saved.') }
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
      try { return tx() } catch (error) { return error instanceof WorkspaceBackupCapacityError ? experienceFailure('BACKUP_LIMIT', error.message) : experienceFailure('CONFLICT', error instanceof Error && error.message.includes('Nested') ? error.message : 'The experience record could not be saved.') }
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
      try { return tx() } catch (error) { return error instanceof WorkspaceBackupCapacityError ? experienceFailure('BACKUP_LIMIT', error.message) : experienceFailure('CONFLICT', error instanceof Error && error.message.includes('Nested') ? error.message : 'The project could not be saved.') }
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
    async startPostingFetch(input: string) {
      if (!validateLeverPostingUrl(input)) throw new Error('Only a named HTTPS Lever job-detail link is supported. Paste posting text instead for other sources.')
      if ([...postingFetches.values()].some(fetch => fetch.state.status === 'fetching')) throw new Error('A posting fetch is already active. Cancel it or wait for it to finish.')
      for (const prior of postingFetches.values()) if (prior.state.status === 'ready' || prior.state.status === 'incomplete') { prior.state = { status: 'cancelled' }; prior.reviewed = undefined; prior.working = undefined }
      while (postingFetches.size >= 5) {
        const expired = [...postingFetches.entries()].find(([, fetch]) => fetch.state.status !== 'fetching')
        if (!expired) throw new Error('Temporary posting previews are full. Close an earlier preview and try again.')
        postingFetches.delete(expired[0])
      }
      const token = randomUUID(), controller = new AbortController()
      postingFetches.set(token, { controller, state: { status: 'fetching' }, revision: 0 })
      void fetchLeverPosting(input, { ...safePostingFetchOptions, signal: controller.signal }).then(preview => {
        const current = postingFetches.get(token)
        if (!current || current.controller.signal.aborted) return
        const incomplete = preview.conflicts.length > 0 || preview.notices.some(notice => notice.includes('preview is incomplete') || notice.startsWith('Unresolved source conflict:')) || !preview.title || !preview.company || !preview.description
        current.state = incomplete ? { status: 'incomplete', preview } : { status: 'ready', preview }
        current.working = { title: preview.title, company: preview.company ?? '', description: preview.description, optionalDetails: preview.optionalDetails }
      }).catch(error => {
        const current = postingFetches.get(token)
        if (!current) return
        current.state = controller.signal.aborted ? { status: 'cancelled' } : { status: 'failed', message: error instanceof Error ? error.message : 'The posting could not be fetched. Open it or paste posting text instead.' }
      })
      return { token }
    },
    async readPostingPreview(token: string) {
      const checked = uuidSchema.safeParse(token)
      if (!checked.success) return postingFetchStateSchema.parse({ status: 'failed', message: 'This temporary preview is no longer available.' })
      return postingFetchStateSchema.parse(postingFetches.get(checked.data)?.state ?? { status: 'failed', message: 'This temporary preview is no longer available.' })
    },
    async cancelPostingFetch(token: string) {
      const checked = uuidSchema.safeParse(token)
      if (!checked.success) return { ok: false }
      const fetch = postingFetches.get(checked.data)
      if (!fetch) return { ok: false }
      fetch.controller.abort()
      fetch.state = { status: 'cancelled' }; fetch.reviewed = undefined; fetch.working = undefined
      return { ok: true }
    },
    async updatePostingPreview(token: string, expectedRevision: number, input) {
      const checked = uuidSchema.safeParse(token), pending = checked.success ? postingFetches.get(checked.data) : undefined
      if (!pending || !Number.isSafeInteger(expectedRevision) || pending.revision !== expectedRevision || !['ready', 'incomplete'].includes(pending.state.status)) return { ok: false, message: 'This preview changed or is no longer available. Fetch it again before editing.' }
      const parsed = postingPreviewEditSchema.safeParse(input)
      if (!parsed.success) return { ok: false, message: 'The preview edit is invalid or exceeds a safe field limit.' }
      const source = pending.state.status === 'ready' || pending.state.status === 'incomplete' ? pending.state.preview : null
      if (!source) return { ok: false, message: 'This preview has no captured source to edit.' }
      const optionalDetails = Object.fromEntries(Object.entries(parsed.data.optionalDetails).map(([field, detail]) => {
        const captured = source.optionalDetails[field as keyof PostingPreviewEdit['optionalDetails']]
        const unchanged = detail.value === captured.value
        const sourceRemoved = detail.value === null && captured.value === null
        return [field, {
          value: detail.value,
          origin: unchanged ? captured.origin : sourceRemoved ? 'unknown' : 'user-correction',
          source: captured.source,
          uncertainty: unchanged ? captured.uncertainty : 'none'
        }]
      })) as PostingPreviewEdit['optionalDetails']
      pending.working = { ...parsed.data, optionalDetails }
      pending.revision++
      pending.reviewed = undefined
      return { ok: true, revision: pending.revision }
    },
    async reviewPostingPreview(token: string, revision: number, review) {
      const checked = uuidSchema.safeParse(token), pending = checked.success ? postingFetches.get(checked.data) : undefined
      const checkedReview = postingReviewSchema.safeParse(review)
      if (!pending || pending.revision !== revision || !checkedReview.success || !['ready', 'incomplete'].includes(pending.state.status)) return { ok: false, message: 'This preview changed or is no longer available; review the current version.' }
      if (!checkedReview.data.completenessConfirmed) { pending.reviewed = undefined; return { ok: true } }
      const source = pending.state.status === 'ready' || pending.state.status === 'incomplete' ? pending.state.preview : null
      const parsed = pending.working ? jobInputSchema.safeParse(pending.working) : { success: false as const }
      if (!source || !parsed.success) return { ok: false, message: 'Enter and review a non-empty title, company, and complete posting description before confirming.' }
      const companyOnlyIncomplete = pending.state.status === 'incomplete' && !!source.title.trim() && !!source.description.trim() && source.company === null && source.notices.every(notice => /employer name was not provided|extraction cannot guarantee posting completeness or that the role remains open|^extracted from (?:inert lever-hosted|the supported lever-hosted)/i.test(notice))
      const conflictOnlyIncomplete = pending.state.status === 'incomplete' && source.conflicts.length > 0 && !!source.title.trim() && !!parsed.data.company.trim() && !!source.description.trim() && source.notices.every(notice => /conflicting source values|unresolved source conflict:|extraction cannot guarantee posting completeness or that the role remains open|^extracted from (?:inert lever-hosted|the supported lever-hosted)/i.test(notice))
      const contentRepair = pending.state.status === 'incomplete' && (!source.title.trim() || source.notices.some(notice => /source did not provide posting text|structured source sections could not be interpreted|lacks enough posting-detail structure/i.test(notice))) && repairsIncompletePosting(source, parsed.data)
      if (pending.state.status !== 'ready' && !companyOnlyIncomplete && !conflictOnlyIncomplete && !contentRepair) return { ok: false, message: 'This source is incomplete; correct missing essential content. Teaser text cannot be confirmed as complete.' }
      for (const conflict of source.conflicts) {
        const resolution = checkedReview.data.conflictResolutions[conflict.id]
        if (!resolution || !conflict.values.some(candidate => candidate.value === resolution)) return { ok: false, message: `Choose one of the listed source values for ${conflict.field}.` }
        const selected = conflict.field === 'company' ? parsed.data.company : conflict.field === 'title' ? parsed.data.title : conflict.field === 'description' ? parsed.data.description : (parsed.data.optionalDetails ?? source.optionalDetails)[conflict.field].value
        if (selected !== resolution) return { ok: false, message: `The working ${conflict.field} must equal the selected source value.` }
      }
      if (Object.keys(checkedReview.data.conflictResolutions).some(id => !source.conflicts.some(conflict => conflict.id === id))) return { ok: false, message: 'A conflict resolution does not belong to this preview.' }
      if (companyOnlyIncomplete && (parsed.data.title !== source.title || parsed.data.description !== source.description)) return { ok: false, message: 'The source only permits a company correction; incomplete posting text cannot be replaced here.' }
      pending.reviewed = { revision, input: parsed.data, review: checkedReview.data }
      return { ok: true }
    },
    async acceptPostingImport(token: string, revision: number) {
      const checkedToken = uuidSchema.safeParse(token), pending = checkedToken.success ? postingFetches.get(checkedToken.data) : undefined
      if (!pending || pending.revision !== revision || pending.reviewed?.revision !== revision || !pending.reviewed.review.completenessConfirmed) return jobSaveResultSchema.parse({ ok: false, error: { code: 'CONFLICT', message: 'Review the current preview after your last edit before saving.' } })
      const pendingState = pending.state
      const source = pendingState.status === 'ready' || pendingState.status === 'incomplete' ? pendingState.preview : null
      if (!source) return jobSaveResultSchema.parse({ ok: false, error: { code: 'CONFLICT', message: 'This posting preview is unavailable, cancelled, or already used.' } })
      const parsed = pending.reviewed.input
      const review = pending.reviewed.review
      const companyOnlyIncomplete = pendingState.status === 'incomplete' && source.title.trim().length > 0 && source.description.trim().length > 0 && source.company === null && source.notices.every(notice => /employer name was not provided|extraction cannot guarantee posting completeness or that the role remains open|^extracted from (?:inert lever-hosted|the supported lever-hosted)/i.test(notice))
      const conflictOnlyIncomplete = pendingState.status === 'incomplete' && source.conflicts.length > 0 && !!parsed.company.trim() && !!source.title.trim() && !!source.description.trim() && source.notices.every(notice => /conflicting source values|unresolved source conflict:|extraction cannot guarantee posting completeness or that the role remains open|^extracted from (?:inert lever-hosted|the supported lever-hosted)/i.test(notice))
      const contentRepair = pendingState.status === 'incomplete' && (!source.title.trim() || source.notices.some(notice => /source did not provide posting text|structured source sections could not be interpreted|lacks enough posting-detail structure/i.test(notice))) && repairsIncompletePosting(source, parsed)
      if (pendingState.status !== 'ready' && !companyOnlyIncomplete && !conflictOnlyIncomplete && !contentRepair) return jobSaveResultSchema.parse({ ok: false, error: { code: 'CONFLICT', message: 'Resolve missing essential content before saving.' } })
      const workingOptionalDetails = parsed.optionalDetails ?? source.optionalDetails
      for (const conflict of source.conflicts) {
        const resolution = review.conflictResolutions[conflict.id]
        if (!resolution || !conflict.values.some(candidate => candidate.value === resolution)) return jobSaveResultSchema.parse({ ok: false, error: { code: 'CONFLICT', message: `Resolve the conflicting ${conflict.field} values using one of the source values before saving.` } })
        const selected = conflict.field === 'company' ? parsed.company : conflict.field === 'title' ? parsed.title : conflict.field === 'description' ? parsed.description : workingOptionalDetails[conflict.field].value
        if (selected !== resolution) return jobSaveResultSchema.parse({ ok: false, error: { code: 'CONFLICT', message: `The saved ${conflict.field} must match the explicitly selected source value.` } })
      }
      if (Object.keys(review.conflictResolutions).some(id => !source.conflicts.some(conflict => conflict.id === id))) return jobSaveResultSchema.parse({ ok: false, error: { code: 'CONFLICT', message: 'A conflict resolution does not belong to this posting preview.' } })
      if (companyOnlyIncomplete && (parsed.title !== source.title || parsed.description !== source.description)) return jobSaveResultSchema.parse({ ok: false, error: { code: 'CONFLICT', message: 'This source only allows a reviewed employer-name correction; its incomplete posting content cannot be replaced here.' } })
      const sourceIdentity = leverSourceIdentity(source.submittedUrl)
      if (!sourceIdentity) return jobSaveResultSchema.parse({ ok: false, error: { code: 'CONFLICT', message: 'The posting source identity could not be verified.' } })
      const known = (db.prepare('SELECT data FROM jobs').all() as { data: string }[]).map(row => jobRecordSchema.parse(JSON.parse(row.data)))
      if (known.some(job => job.sourceSnapshot && samePostingSource(job.sourceSnapshot, source))) return jobSaveResultSchema.parse({ ok: false, error: { code: 'CONFLICT', message: 'This exact source is already saved. Open the existing posting instead; no duplicate was created.' } })
      const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
      const sourceSnapshot = {
        title: source.title, company: source.company, description: source.description, optionalDetails: source.optionalDetails, conflicts: source.conflicts,
        submittedUrl: source.submittedUrl, finalUrl: source.finalUrl, sourceIdentity, capturedAt: new Date().toISOString(),
        extractionMethod: source.extractionMethod, extractionVersion: 1 as const,
        hashes: { title: hash(source.title), company: source.company === null ? null : hash(source.company), description: hash(source.description) },
        fieldOrigins: { title: parsed.title === source.title ? 'source' as const : 'user-correction' as const, company: source.company !== null && parsed.company === source.company ? 'source' as const : 'user-correction' as const, description: parsed.description === source.description ? 'source' as const : 'user-correction' as const, optionalDetails: Object.fromEntries(Object.entries(workingOptionalDetails).map(([field, detail]) => [field, detail.origin])) }
      }
      const now = new Date().toISOString(), id = randomUUID()
      const record = jobRecordSchema.parse({ ...parsed, optionalDetails: workingOptionalDetails, id, createdAt: now, updatedAt: now, provenance: 'imported', sourceSnapshot, revisions: [{ ...parsed, optionalDetails: workingOptionalDetails, revision: 1, acceptedAt: now, provenance: 'imported' }] })
      try {
        const tx = db.transaction(() => db.prepare('INSERT INTO jobs (id, created_at, updated_at, data) VALUES (?, ?, ?, ?)').run(record.id, now, now, JSON.stringify(record)))
        tx()
        pending.state = { status: 'cancelled' }; pending.reviewed = undefined
        return jobSaveResultSchema.parse({ ok: true, value: record })
      } catch { return jobSaveResultSchema.parse({ ok: false, error: { code: 'CONFLICT', message: 'The reviewed posting could not be saved. No partial job history was retained.' } }) }
    },
    async comparePostingRefresh(token: string, jobId: string, expectedUpdatedAt: string, expectedRevision: number) {
      const pending = postingFetches.get(token), row = db.prepare('SELECT data FROM jobs WHERE id = ?').get(jobId) as { data: string } | undefined
      const current = row ? jobRecordSchema.parse(JSON.parse(row.data)) : undefined
      if (!pending || !current || pending.state.status !== 'ready' && pending.state.status !== 'incomplete') return { ok: false, message: 'This refresh preview or saved posting is unavailable.' }
      if (current.updatedAt !== expectedUpdatedAt || (current.revisions.at(-1)?.revision ?? 0) !== expectedRevision) return { ok: false, message: 'The saved posting changed while this refresh was being reviewed. Reopen it and compare again.' }
      const source = pending.state.preview
      if (!current.sourceSnapshot || !samePostingSource(current.sourceSnapshot, source)) return { ok: false, message: 'This refresh does not match the saved posting’s exact source identity.' }
      const prior = current.sourceSnapshot
      const unchanged = prior.title === source.title && prior.company === source.company && prior.description === source.description && isDeepStrictEqual(prior.optionalDetails, source.optionalDetails) && isDeepStrictEqual(prior.conflicts, source.conflicts) && prior.extractionMethod === source.extractionMethod && normalizePostingUrl(prior.submittedUrl) === normalizePostingUrl(source.submittedUrl) && normalizePostingUrl(prior.finalUrl) === normalizePostingUrl(source.finalUrl)
      return { ok: true, unchanged, previousSource: prior, working: { title: current.title, company: current.company, description: current.description, optionalDetails: current.optionalDetails }, newSource: source }
    },
    async acceptPostingRefresh(token: string, revision: number, jobId: string, expectedUpdatedAt: string, expectedBaseRevision: number, choices: PostingRefreshChoice) {
      const invalid = (message: string) => jobSaveResultSchema.parse({ ok: false, error: { code: 'CONFLICT', message } })
      const checkedChoices = postingRefreshChoiceSchema.safeParse(choices), pending = postingFetches.get(token)
      if (!checkedChoices.success || !pending || pending.revision !== revision || pending.reviewed?.revision !== revision || !pending.reviewed.review.completenessConfirmed || pending.state.status !== 'ready' && pending.state.status !== 'incomplete') return invalid('Review the current refresh and choose which source fields to accept before applying it.')
      const row = db.prepare('SELECT created_at, data FROM jobs WHERE id = ?').get(jobId) as { created_at: string; data: string } | undefined
      if (!row) return invalid('The saved posting no longer exists.')
      const prior = jobRecordSchema.parse(JSON.parse(row.data)), source = pending.state.preview, reviewed = pending.reviewed.input
      if (prior.updatedAt !== expectedUpdatedAt || (prior.revisions.at(-1)?.revision ?? 0) !== expectedBaseRevision) return invalid('The saved posting changed while this refresh was being reviewed. Nothing was replaced; compare again.')
      if (!prior.sourceSnapshot || !samePostingSource(prior.sourceSnapshot, source)) return invalid('This refresh does not match the saved posting’s exact source identity.')
      const sourceIdentity = leverSourceIdentity(source.submittedUrl)
      if (!sourceIdentity) return invalid('The refreshed source identity could not be verified.')
      const choose = (field: 'title' | 'company' | 'description') => checkedChoices.data[field] === 'source' ? reviewed[field] : prior[field]
      const optionalDetails = Object.fromEntries(postingOptionalFieldNames.map(field => [field, checkedChoices.data.optionalDetails[field] === 'source' ? reviewed.optionalDetails?.[field] ?? source.optionalDetails[field] : prior.optionalDetails[field]])) as typeof prior.optionalDetails
      const working = jobInputSchema.safeParse({ title: choose('title'), company: choose('company'), description: choose('description'), optionalDetails })
      if (!working.success) return invalid('Choose complete title, company, and posting text before accepting this refresh.')
      const values = working.data
      const acceptedOptionalDetails = values.optionalDetails ?? source.optionalDetails
      const workingChanged = prior.title !== values.title || prior.company !== values.company || prior.description !== values.description || !isDeepStrictEqual(prior.optionalDetails, acceptedOptionalDetails)
      const targetChanged = prior.title !== values.title || prior.company !== values.company || prior.description !== values.description
      const sourceChanged = prior.sourceSnapshot.title !== source.title || prior.sourceSnapshot.company !== source.company || prior.sourceSnapshot.description !== source.description || !isDeepStrictEqual(prior.sourceSnapshot.optionalDetails, source.optionalDetails) || !isDeepStrictEqual(prior.sourceSnapshot.conflicts, source.conflicts) || prior.sourceSnapshot.extractionMethod !== source.extractionMethod || normalizePostingUrl(prior.sourceSnapshot.submittedUrl) !== normalizePostingUrl(source.submittedUrl) || normalizePostingUrl(prior.sourceSnapshot.finalUrl) !== normalizePostingUrl(source.finalUrl)
      if (!sourceChanged && !workingChanged) { pending.state = { status: 'cancelled' }; pending.reviewed = undefined; return jobSaveResultSchema.parse({ ok: true, value: prior }) }
      const lastAcceptedAt = Date.parse(prior.revisions.at(-1)?.acceptedAt ?? prior.updatedAt)
      const now = new Date(Math.max(Date.now(), lastAcceptedAt + 1, targetChanged ? Date.parse(prior.updatedAt) + 1 : 0)).toISOString()
      const targetUpdatedAt = targetChanged ? now : prior.updatedAt
      const snapshot = {
        title: source.title, company: source.company, description: source.description, optionalDetails: source.optionalDetails, conflicts: source.conflicts,
        submittedUrl: source.submittedUrl, finalUrl: source.finalUrl, sourceIdentity, capturedAt: new Date().toISOString(), extractionMethod: source.extractionMethod, extractionVersion: 1 as const,
        hashes: { title: createHash('sha256').update(source.title, 'utf8').digest('hex'), company: source.company === null ? null : createHash('sha256').update(source.company, 'utf8').digest('hex'), description: createHash('sha256').update(source.description, 'utf8').digest('hex') },
        fieldOrigins: { title: values.title === source.title ? 'source' as const : 'user-correction' as const, company: source.company !== null && values.company === source.company ? 'source' as const : 'user-correction' as const, description: values.description === source.description ? 'source' as const : 'user-correction' as const, optionalDetails: Object.fromEntries(postingOptionalFieldNames.map(field => [field, acceptedOptionalDetails[field].value === source.optionalDetails[field].value ? source.optionalDetails[field].origin : 'user-correction'])) }
      }
      const history = sourceChanged && prior.sourceSnapshot ? [...prior.sourceHistory, prior.sourceSnapshot] : prior.sourceHistory
      const newRevision = { ...values, optionalDetails: acceptedOptionalDetails, revision: (prior.revisions.at(-1)?.revision ?? 0) + 1, acceptedAt: now, provenance: 'imported' as const }
      const record = jobRecordSchema.parse({ ...values, optionalDetails: acceptedOptionalDetails, id: prior.id, createdAt: prior.createdAt, updatedAt: targetUpdatedAt, provenance: 'imported', sourceSnapshot: snapshot, sourceHistory: history, revisions: [...prior.revisions, newRevision] })
      if (targetChanged && activeAnalysisByJob.has(jobId)) return invalid('An analysis operation is active for this saved posting. Cancel it before accepting refresh changes.')
      try {
        const tx = db.transaction(() => {
          const latest = db.prepare('SELECT data FROM jobs WHERE id = ?').get(jobId) as { data: string } | undefined
          if (!latest) throw new Error('STALE_REFRESH')
          const latestJob = jobRecordSchema.parse(JSON.parse(latest.data))
          if (latestJob.updatedAt !== expectedUpdatedAt || (latestJob.revisions.at(-1)?.revision ?? 0) !== expectedBaseRevision) throw new Error('STALE_REFRESH')
          db.prepare('UPDATE jobs SET updated_at = ?, data = ? WHERE id = ?').run(record.updatedAt, JSON.stringify(record), jobId)
          if (targetChanged) {
            const unresolved = (db.prepare('SELECT COUNT(*) AS count FROM provider_attempt_outcomes WHERE checkpointed_at IS NULL AND run_id IN (SELECT run_id FROM generation_recovery WHERE job_id = ?)').get(jobId) as { count: number }).count
            db.prepare("UPDATE outbound_consents SET revoked = 1 WHERE run_id IN (SELECT run_id FROM generation_recovery WHERE job_id = ? AND status IN ('running','paused')) OR run_id = (SELECT run_id FROM analysis_run_state WHERE job_id = ?)").run(jobId, jobId)
            db.prepare("UPDATE generation_recovery SET status = 'cancelled', updated_at = ? WHERE job_id = ? AND status IN ('running','paused')").run(now, jobId)
            for (const [consentToken, value] of pendingOutbound) if (value.jobId === jobId) { if (value.consentId) outboundEngine.revoke(value.consentId); pendingOutbound.delete(consentToken) }
            const analysisRow = db.prepare('SELECT data FROM analysis_run_state WHERE job_id = ?').get(jobId) as { data: string } | undefined
            const earlier = currentAnalysis.get(jobId) ?? (analysisRow ? analysisResultSchema.parse(JSON.parse(analysisRow.data)) : undefined)
            if (earlier?.analysis) saveAnalysisState({ ...earlier, status: 'stale', targetPostingUpdatedAt: prior.updatedAt, progress: `This posting analysis is retained for history but targets an earlier accepted posting. ${unresolved ? `${unresolved} provider request outcome(s) may be uncertain; the old run cannot resume. ` : ''}Review outgoing data and explicitly reassess the current posting.` })
          }
        })
        tx()
        pending.state = { status: 'cancelled' }; pending.reviewed = undefined
        return jobSaveResultSchema.parse({ ok: true, value: record })
      } catch (error) { return invalid(error instanceof Error && error.message === 'STALE_REFRESH' ? 'The saved posting changed during refresh acceptance. Nothing was replaced; compare again.' : 'The refreshed posting could not be saved. No partial source or revision history was retained.') }
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
        const existingRow = input.id ? db.prepare('SELECT created_at, data FROM jobs WHERE id = ?').get(input.id) as { created_at: string; data: string } | undefined : undefined
        if (input.id && !existingRow) return jobSaveResultSchema.parse({ ok: false, error: { code: 'CONFLICT', message: 'This saved job no longer exists.' } })
        const prior = existingRow ? jobRecordSchema.parse(JSON.parse(existingRow.data)) : undefined
        const backupStatus = backupEngine.readBackupStatus()
        const acceptedOptionalDetails = parsed.data.optionalDetails ?? prior?.optionalDetails
        const changed = !prior || prior.title !== parsed.data.title || prior.company !== parsed.data.company || prior.description !== parsed.data.description || (parsed.data.optionalDetails !== undefined && JSON.stringify(prior.optionalDetails) !== JSON.stringify(parsed.data.optionalDetails))
        const now = new Date(Math.max(Date.now(), prior ? Date.parse(prior.updatedAt) + 1 : 0)).toISOString()
        const priorRevisions = prior && prior.revisions.length === 0 && changed ? [{ title: prior.title, company: prior.company, description: prior.description, revision: 1, acceptedAt: prior.updatedAt, provenance: 'legacy-unknown' as const }] : prior?.revisions ?? []
        const acceptedRevision = changed ? { ...parsed.data, optionalDetails: acceptedOptionalDetails, revision: (priorRevisions.at(-1)?.revision ?? 0) + 1, acceptedAt: now, provenance: 'manual' as const } : undefined
        const revisions = acceptedRevision ? [...priorRevisions, acceptedRevision] : priorRevisions
        if (changed && revisions.length > MAX_POSTING_REVISIONS && !backupStatus.legacyOverCap) return jobSaveResultSchema.parse({ ok: false, error: { code: 'REVISION_LIMIT', message: `This saved job reached the ${MAX_POSTING_REVISIONS}-revision history limit. Nothing was changed and no history was deleted.`, fieldErrors: { description: 'The revision limit was reached. Existing posting history remains intact.' } } })
        if (changed && input.id && activeAnalysisByJob.has(input.id)) return jobSaveResultSchema.parse({ ok: false, error: { code: 'CONFLICT', message: 'A provider operation is active for this saved job. Cancel it before changing the posting.' } })
        const record = jobRecordSchema.parse({ ...parsed.data, optionalDetails: acceptedOptionalDetails, id: input.id ?? randomUUID(), createdAt: existingRow?.created_at ?? now, updatedAt: changed ? now : prior!.updatedAt, provenance: changed ? 'manual' : prior?.provenance ?? 'manual', sourceSnapshot: prior?.sourceSnapshot ?? null, sourceHistory: prior?.sourceHistory ?? [], revisions })
        const serializedRecord = JSON.stringify(record)
        if (Buffer.byteLength(serializedRecord, 'utf8') > MAX_JOB_RECORD_UTF8_BYTES && (!backupStatus.legacyOverCap || !existingRow || Buffer.byteLength(serializedRecord, 'utf8') >= Buffer.byteLength(existingRow.data, 'utf8'))) return jobSaveResultSchema.parse({ ok: false, error: { code: 'HISTORY_SIZE_LIMIT', message: 'This saved job and its complete revision history exceed the 4 MiB per-job backup limit. Nothing was changed and no history was deleted.', fieldErrors: { description: 'Review the posting revision history limit; existing versions remain intact.' } } })
        db.prepare('INSERT INTO jobs (id, created_at, updated_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, data=excluded.data').run(record.id, record.createdAt, record.updatedAt, serializedRecord)
        if (changed && prior) {
          const unresolved = (db.prepare('SELECT COUNT(*) AS count FROM provider_attempt_outcomes WHERE checkpointed_at IS NULL AND run_id IN (SELECT run_id FROM generation_recovery WHERE job_id = ?)').get(record.id) as { count: number }).count
          db.prepare("UPDATE outbound_consents SET revoked = 1 WHERE run_id IN (SELECT run_id FROM generation_recovery WHERE job_id = ? AND status IN ('running','paused')) OR run_id = (SELECT run_id FROM analysis_run_state WHERE job_id = ?)").run(record.id, record.id)
          db.prepare("UPDATE generation_recovery SET status = 'cancelled', updated_at = ? WHERE job_id = ? AND status IN ('running','paused')").run(now, record.id)
          for (const [token, pending] of pendingOutbound) if (pending.jobId === record.id) {
            if (pending.consentId) {
              outboundEngine.revoke(pending.consentId)
              db.prepare('UPDATE outbound_consents SET revoked = 1 WHERE id = ?').run(pending.consentId)
            }
            pendingOutbound.delete(token)
          }
          const analysisRow = db.prepare('SELECT data FROM analysis_run_state WHERE job_id = ?').get(record.id) as { data: string } | undefined
          const earlierAnalysis = currentAnalysis.get(record.id) ?? (analysisRow ? analysisResultSchema.parse(JSON.parse(analysisRow.data)) : undefined)
          if (earlierAnalysis?.analysis) saveAnalysisState({ ...earlierAnalysis, status: 'stale', targetPostingUpdatedAt: prior.updatedAt, progress: `This posting analysis is retained for history but targets an earlier accepted posting. ${unresolved ? `${unresolved} provider request outcome(s) from the cancelled run may be uncertain; this old run cannot resume. ` : ''}Review outgoing data and explicitly reassess the current posting.` })
          // Keep prior draft and approval immutable. Public readiness checks compare its target binding to the accepted posting.
        }
        return jobSaveResultSchema.parse({ ok: true, value: record })
      })
      try { return tx() } catch (error) {
        if (error instanceof WorkspaceBackupCapacityError) return jobSaveResultSchema.parse({ ok: false, error: { code: 'BACKUP_LIMIT', message: error.message, fieldErrors: { description: 'Workspace backup capacity would be exceeded. No saved posting or history was changed.' } } })
        return jobSaveResultSchema.parse({ ok: false, error: { code: 'CONFLICT', message: 'The job could not be saved.' } })
      }
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
        const faithfulnessRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('faithfulness-check') as { value: string } | undefined
        pendingOutbound.set(token, { jobId, source, bundle, runId, faithfulnessCheck: faithfulnessRow?.value === 'true' })
        return outboundConsentPreviewSchema.parse({ ok: true, token, jobTitle: source.job.title, jobCompany: source.job.company, outgoing: bundle.outgoing, warning: bundle.preview.residualSensitivityNotice, termsNotice: 'Before a model request, CV Tailor requests OpenRouter model and endpoint capacity metadata using only the selected model ID—no job posting, profile content, or API key. This metadata check is separate from your reviewed outgoing data; the authorized model request is sent only after you approve this panel. OpenRouter routes model requests to third-party providers. Provider data-use policies depend on the chosen model and endpoint. Do not submit personal, sensitive, or confidential information. Redaction cannot guarantee anonymity.' })
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
      // Human-readable local copy only; generation and provider requests continue to use minimized analysis.
      const displayAnalysis = (value: z.infer<typeof postingAnalysisSchema>) => displayPostingAnalysisSchema.parse(Object.fromEntries(Object.entries(value).map(([key, items]) => [key, items.map(item => pending.bundle.restoreIdentifiers(item))])))
      const approvedPayload = authorizeOutboundPayload(pending.runId, pending.bundle.outgoing)
      if (activeAnalysisByJob.has(pending.jobId)) throw new Error('An analysis for this job is already active. Cancel it before starting another run.')
      const cacheKey = analysisCacheKey(pending.source)
      const cached = db.prepare('SELECT data, run_id FROM posting_analysis_cache WHERE cache_key = ?').get(cacheKey) as { data: string; run_id: string } | undefined
      if (cached) {
        dispatcher.authorize(pending.runId, pending.consentId)
        startedAnalysisTokens.add(token)
        const cachedAnalysis = postingAnalysisSchema.parse(JSON.parse(cached.data))
        const value = analysisResultSchema.parse({ jobId: pending.jobId, runId: pending.runId, status: 'complete', analysis: cachedAnalysis, displayAnalysis: displayAnalysis(cachedAnalysis), progress: `Loaded compatible saved analysis.${workingTextScopeNotice(pending.jobId)}`, attempts: 0, cacheHit: true, generationStep: 'parse-posting', completedSteps: ['parse-posting'] })
        saveAnalysisState(value)
        return value
      }
      const credentials = db.prepare('SELECT ciphertext FROM encrypted_credentials WHERE key = ?').get('openrouter-api-key')
      if (!scriptedTransport && !credentials) throw new Error('Save an OpenRouter API key in Settings before starting analysis.')
      if (startedAnalysisTokens.has(token)) throw new Error('This accepted analysis run is already active or has already started. Review outgoing data and accept a new run to continue.')
      startedAnalysisTokens.add(token)
      dispatcher.authorize(pending.runId, pending.consentId)
      activeAnalysisByJob.set(pending.jobId, pending.runId)
      let result: Awaited<ReturnType<typeof dispatcher.analyze>>
      try {
        result = await dispatcher.analyze({ runId: pending.runId, jobId: pending.jobId, model: openRouterModelSchema.parse(pending.source.model.name), prompt: `Extract only explicit qualifications from this authorized minimized posting. Do not infer missing requirements. Return JSON with required, preferred, tools, responsibilities, keywords.\n${JSON.stringify(approvedPayload)}`, consentId: pending.consentId })
      } catch (error) {
        const stillCurrentRun = activeAnalysisByJob.get(pending.jobId) === pending.runId && pendingOutbound.get(token) === pending
        if (activeAnalysisByJob.get(pending.jobId) === pending.runId) activeAnalysisByJob.delete(pending.jobId)
        const failure = error instanceof AnalysisError ? error : new AnalysisError('PROVIDER', 'Analysis could not complete. Check Settings and try again.')
        if (!stillCurrentRun) return analysisResultSchema.parse({ jobId: pending.jobId, runId: pending.runId, targetPostingUpdatedAt: pending.source.job.revision, status: 'cancelled', analysis: null, progress: 'Analysis was cancelled. Its late response was discarded.', attempts: failure.usage?.attempts ?? 0, cacheHit: false })
        const status = failure.code === 'CANCELLED' ? 'cancelled' : 'failed'
        const value = analysisResultSchema.parse({ jobId: pending.jobId, runId: pending.runId, status, analysis: null, progress: failure.message, attempts: failure.usage?.attempts ?? 0, error: failure.message, cacheHit: false })
        if (!(failure.code === 'BUDGET' && /workspace change would exceed a backup safety limit/i.test(failure.message))) saveAnalysisState(value)
        return value
      }
      if (activeAnalysisByJob.get(pending.jobId) !== pending.runId || pendingOutbound.get(token) !== pending) return analysisResultSchema.parse({ jobId: pending.jobId, runId: pending.runId, targetPostingUpdatedAt: pending.source.job.revision, status: 'cancelled', analysis: null, progress: 'Analysis was cancelled. Its late response was discarded.', attempts: result.usage.attempts, cacheHit: false })
      activeAnalysisByJob.delete(pending.jobId)
      db.prepare('INSERT OR REPLACE INTO posting_analysis_cache (cache_key, job_id, run_id, data) VALUES (?, ?, ?, ?)').run(cacheKey, pending.jobId, pending.runId, JSON.stringify(result.analysis))
      db.prepare('UPDATE provider_attempt_outcomes SET checkpointed_at=? WHERE run_id=? AND checkpointed_at IS NULL').run(new Date().toISOString(), pending.runId)
      const value = analysisResultSchema.parse({ jobId: pending.jobId, runId: pending.runId, status: 'complete', analysis: result.analysis, displayAnalysis: displayAnalysis(result.analysis), progress: `Posting analysis complete.${workingTextScopeNotice(pending.jobId)}`, attempts: result.usage.attempts, cacheHit: false, generationStep: 'parse-posting', completedSteps: ['parse-posting'] })
      saveAnalysisState(value)
      return value
    },
    async generateDraft(token: string, pageTarget: 1 | 2 = 1, resumeRunId?: string) {
      if (pageTarget !== 1 && pageTarget !== 2) return { ok: false, message: 'Choose a one- or two-page target.' }
      const pending = pendingOutbound.get(token)
      if (!pending?.consentId) return { ok: false, message: 'Review and authorize this exact outgoing bundle before generation.' }
      const recoveryRow = resumeRunId ? db.prepare('SELECT snapshot, status FROM generation_recovery WHERE run_id=? AND job_id=?').get(resumeRunId, pending.jobId) as { snapshot: string; status: string } | undefined : undefined
      if (resumeRunId && (!recoveryRow || !['running','paused'].includes(recoveryRow.status) || pending.runId !== resumeRunId)) return { ok: false, message: 'This saved run is no longer resumable.' }
      let frozen: ReturnType<typeof generationRecoverySnapshotSchema.parse> | undefined
      if (recoveryRow) {
        try { frozen = generationRecoverySnapshotSchema.parse(JSON.parse(recoveryRow.snapshot)) }
        catch { return { ok: false, message: 'The saved recovery snapshot is corrupt or incompatible. No requests were sent; cancel this run and inspect the source data.' } }
        if (frozen.runId !== resumeRunId || frozen.jobId !== pending.jobId || frozen.consentId !== pending.consentId || frozen.scopeHash !== pending.bundle.scopeHash) return { ok: false, message: 'Saved run identity or consent no longer matches this recovery request. No requests were sent.' }
      }
      const latestScope = resumeRunId ? null : currentConsentSource(pending.jobId)
      if (!resumeRunId && (!latestScope || prepareOutboundBundle(latestScope).scopeHash !== pending.bundle.scopeHash)) return { ok: false, message: 'Your job, profile, or model settings changed after consent. Review the outgoing data again.' }
      const runBudgetOverride = frozen ? { runLimit: frozen.budgets.runLimit, runTimeLimitMs: frozen.budgets.runTimeLimitMs } : undefined
      const analysis = frozen?.analysis ?? await this.getAnalysis(pending.jobId)
      if (!analysis || analysis.status !== 'complete' || !analysis.analysis) return { ok: false, message: 'Complete posting analysis before generating a draft.' }
      if (!resumeRunId && (!startedAnalysisTokens.has(token) || analysis.runId !== pending.runId)) return { ok: false, message: 'Complete posting analysis for this run before generating a draft. Saved analysis can be reused without another provider request.' }
      if (activeAnalysisByJob.has(pending.jobId)) return { ok: false, message: 'Generation is already active for this saved job.' }
      const job = frozen?.job ?? await this.openJob(pending.jobId)
      if (!job) return { ok: false, message: 'The saved job is unavailable.' }
      if (!resumeRunId) {
        const latestScopeAfterAsync = currentConsentSource(pending.jobId)
        if (!latestScopeAfterAsync || prepareOutboundBundle(latestScopeAfterAsync).scopeHash !== pending.bundle.scopeHash) return { ok: false, message: 'Your job, profile, or model settings changed after consent. Review the outgoing data again.' }
      }
      const profile = frozen?.profile ?? readProfile(), experience = frozen?.experience ?? readExperience()
      const draftInputs = frozen?.draftInputs ?? prepareDraftInputs(profile, experience)
      const items = draftInputs.items
      const approvedPayload = authorizeOutboundPayload<OutboundPayload>(pending.runId, pending.bundle.outgoing)
      const minimizeGeneratedPrompt = (text: string) => {
        const prompt = pending.bundle.minimizeIdentifiers(text)
        if (pending.bundle.containsRestoredIdentifier(prompt)) throw new Error('Generated wording still contains a local identifier. No model request was sent.')
        return prompt
      }
      const scrubbed = new Map<string, string>()
      profile.education.forEach((item, i) => { const safe = approvedPayload.profile.education[i]; if (safe) scrubbed.set(item.id, JSON.stringify(safe)) })
      experience.experience.forEach((item, i) => { const safe = approvedPayload.profile.experience[i]; if (safe) { scrubbed.set(item.id, JSON.stringify(safe)); item.factualItems.forEach((fact, n) => scrubbed.set(fact.id, safe.evidence[n] ?? '')) } })
      experience.projects.forEach((item, i) => { const safe = approvedPayload.profile.projects[i]; if (safe) { scrubbed.set(item.id, JSON.stringify(safe)); item.factualItems.forEach((fact, n) => scrubbed.set(fact.id, safe.evidence[n] ?? '')); item.technologies.forEach((fact, n) => scrubbed.set(fact.id, safe.technologies[n] ?? '')) } })
      profile.skills.forEach((item, i) => { const safe = approvedPayload.profile.skills[i]; if (safe) scrubbed.set(item.id, JSON.stringify(safe)) })
      profile.certificates.forEach((item, i) => { const safe = approvedPayload.profile.certificates[i]; if (safe) scrubbed.set(item.id, JSON.stringify(safe)) })
      const safeItems = frozen?.safeItems ?? items.map(item => ({ ...item, text: scrubbed.get(item.id) ?? '' })).filter(item => item.text)
      const minimizedStringPairs: Array<[string, string]> = []
      const collectStringPairs = (original: unknown, minimized: unknown) => {
        if (typeof original === 'string' && typeof minimized === 'string' && original !== minimized) minimizedStringPairs.push([original, minimized])
        else if (Array.isArray(original) && Array.isArray(minimized)) original.forEach((value, index) => collectStringPairs(value, minimized[index]))
        else if (original && minimized && typeof original === 'object' && typeof minimized === 'object') for (const [key, value] of Object.entries(original)) collectStringPairs(value, (minimized as Record<string, unknown>)[key])
      }
      for (const item of items) {
        const safe = scrubbed.get(item.id)
        if (safe) try { collectStringPairs(item.snapshot, JSON.parse(safe)) } catch { /* non-JSON source text is already minimized independently */ }
      }
      const exactLocalDates = [...draftInputs.lockedFields.experience, ...draftInputs.lockedFields.education].flatMap(item => [item.startDate, item.endDate]).filter((value): value is string => Boolean(value))
      for (const date of exactLocalDates) minimizedStringPairs.push([date, ''])
      const minimizeRestoredText = (text: string) => minimizedStringPairs.reduce((value, [restored, minimized]) => value.replaceAll(restored, minimized), text)
      activeAnalysisByJob.set(pending.jobId, pending.runId)
      const failedDraftIdentity = frozen?.identity ?? { id: randomUUID(), jobId: pending.jobId, revision: ((db.prepare('SELECT MAX(revision) AS revision FROM draft_revisions WHERE job_id = ?').get(pending.jobId) as { revision: number | null }).revision ?? 0) + 1, targetPostingUpdatedAt: pending.source.job.revision, createdAt: new Date().toISOString(), lockedFields: draftInputs.lockedFields }
      if (!resumeRunId) {
        const snapshot = generationRecoverySnapshotSchema.parse({ version: 1, runId: pending.runId, jobId: pending.jobId, consentId: pending.consentId, scopeHash: pending.bundle.scopeHash, analysis, job, profile, experience, draftInputs, safeItems, identity: failedDraftIdentity, pageTarget, source: pending.source, faithfulnessCheck: pending.faithfulnessCheck, budgets: readAnalysisBudgets() })
        db.prepare('INSERT OR REPLACE INTO generation_recovery (run_id,job_id,consent_id,scope_hash,status,snapshot,updated_at) VALUES (?,?,?,?,?,?,?)').run(pending.runId,pending.jobId,pending.consentId,pending.bundle.scopeHash,'running',JSON.stringify(snapshot),new Date().toISOString())
      }
      else db.prepare("UPDATE generation_recovery SET status='running',updated_at=? WHERE run_id=?").run(new Date().toISOString(), resumeRunId)
      try {
        const result = await runSourceLinkedGraph({ job: approvedPayload.job, analysis: analysis.analysis, items: safeItems, savedSkillNames: profile.skills.map(skill => skill.name), sourceJobRevision: pending.source.job.revision, pageTarget, restoreText: pending.bundle.restoreIdentifiers, checkpointer: graphCheckpointer, threadId: pending.runId, resume: Boolean(resumeRunId), onProgress: (progress, generationStep, completedSteps) => { const observed = (db.prepare('SELECT COUNT(*) AS count FROM analysis_attempts WHERE run_id = ?').get(pending.runId) as { count: number }).count; saveAnalysisState({ jobId: pending.jobId, runId: pending.runId, status: 'running', analysis: analysis.analysis, progress, attempts: observed, cacheHit: analysis.cacheHit, generationStep, completedSteps }) }, identity: failedDraftIdentity, call: async (prompt, responseSchema) => {
          authorizeOutboundPayload(pending.runId, pending.bundle.outgoing)
          const generated = await dispatcher.generate({ runId: pending.runId, jobId: pending.jobId, model: openRouterModelSchema.parse(pending.source.model.name), prompt, consentId: pending.consentId!, responseSchema, runBudgetOverride })
          authorizeOutboundPayload(pending.runId, pending.bundle.outgoing)
          return { value: responseSchema.parse(JSON.parse(generated.text)), attempts: generated.attempts }
        } })
        authorizeOutboundPayload(pending.runId, pending.bundle.outgoing)
        const saveGenerationStep = (step: 'verify-claims' | 'check-document', progress: string, completed: string[]) => { const observed = (db.prepare('SELECT COUNT(*) AS count FROM analysis_attempts WHERE run_id = ?').get(pending.runId) as { count: number }).count; saveAnalysisState({ jobId: pending.jobId, runId: pending.runId, status: 'running', analysis: analysis.analysis, progress, attempts: observed, cacheHit: analysis.cacheHit, generationStep: step, completedSteps: completed }) }
        saveGenerationStep('verify-claims', 'Checking generated claims against frozen evidence.', ['parse-posting', 'score-evidence', 'select-content', 'tailor-paragraphs'])
        const repairSchema = z.object({ corrections: z.array(z.object({ section: z.enum(['education', 'experience', 'projects', 'skills', 'certificates']), index: z.number().int().nonnegative(), text: z.string().trim().min(1).max(3000), citations: z.array(z.object({ evidenceId: uuidSchema, revision: z.number().int().positive() }).strict()).min(1) }).strict()).max(1) }).strict()
        let report = checkDraftFacts(result.draft, { includeSkillDecisions: false })
        let repairAttempts = 0
        const hasRepairableContentFinding = () => report.findings.some(finding => /^(education|experience|projects|skills|certificates)\[\d+\]/.test(finding.itemPath))
        for (let cycle = 0; cycle < 2 && !report.passed && hasRepairableContentFinding(); cycle++) {
          const failedItems = report.findings.map(finding => {
            const found = /^(education|experience|projects|skills|certificates)\[(\d+)\]/.exec(finding.itemPath)
            if (!found) return { finding }
            const section = found[1] as keyof DraftRevision['content'], index = Number(found[2]), item = result.draft.content[section][index]
            return { finding, section, index, text: item && ('text' in item ? item.text : item.name), citedEvidence: item?.citations.map(citation => ({ ...citation, text: safeItems.find(source => source.id === citation.evidenceId)?.text ?? '' })) }
          })
          authorizeOutboundPayload(pending.runId, pending.bundle.outgoing)
          const repair = await dispatcher.generate({ runId: pending.runId, jobId: pending.jobId, model: openRouterModelSchema.parse(pending.source.model.name), consentId: pending.consentId!, responseSchema: repairSchema, runBudgetOverride, prompt: minimizeGeneratedPrompt(`Factual repair cycle ${cycle + 1} of 2. Correct only the listed failing draft items using only their cited evidence. Preserve every unaffected item. Never infer facts or use uncited evidence. Return corrections for failed item paths only; keep citation IDs/revisions from the supplied evidence. If no safe correction is possible, remove that item by returning no correction for it.\n${JSON.stringify({ findings: failedItems })}`) })
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
          report = checkDraftFacts(result.draft, { includeSkillDecisions: false })
        }
        let coverageRepairAttempts = 0
        if (report.passed) {
          const opportunities = supportedCoverageTerms(analysis.analysis, result.draft)
          if (opportunities.length) {
            const opportunity = opportunities[0]
            const eligible = opportunity.eligible[0]
            const priorItem = result.draft.content[eligible.section][eligible.index]
            const priorText = 'text' in priorItem ? priorItem.text : priorItem.name
            authorizeOutboundPayload(pending.runId, pending.bundle.outgoing)
            const coverageRepair = await dispatcher.generate({ runId: pending.runId, jobId: pending.jobId, model: openRouterModelSchema.parse(pending.source.model.name), consentId: pending.consentId!, responseSchema: repairSchema, runBudgetOverride, prompt: minimizeGeneratedPrompt(`Supported-keyword coverage repair (single exact item). Add only the explicitly supported term to this authored text. Preserve all existing wording, responsibility, scope, ownership, skill level, certainty, and citations exactly; do not change any other item. Return zero or one correction, only for the supplied section/index.\n${JSON.stringify({ opportunity: { qualification: opportunity.qualification, matchedAs: opportunity.matchedAs, section: eligible.section, index: eligible.index, evidenceId: eligible.evidenceId, revision: eligible.revision }, text: priorText, evidence: safeItems.find(source => source.id === eligible.evidenceId)?.text })}`) })
            authorizeOutboundPayload(pending.runId, pending.bundle.outgoing)
            coverageRepairAttempts = coverageRepair.attempts
            const response = repairSchema.parse(JSON.parse(coverageRepair.text))
            for (const correction of response.corrections) {
              if (correction.section !== eligible.section || correction.index !== eligible.index) continue
              const section = [...result.draft.content[eligible.section]], prior = section[eligible.index]
              const expectedCitation = { evidenceId: eligible.evidenceId, revision: eligible.revision }
              if (!prior || correction.citations.length !== 1 || correction.citations[0].evidenceId !== expectedCitation.evidenceId || correction.citations[0].revision !== expectedCitation.revision) continue
              const priorText = 'text' in prior ? prior.text : prior.name
              const term = escapeCoverageTerm(opportunity.matchedAs)
              const withoutTerm = correction.text.replace(new RegExp(`(?:^|\\s)${term}(?=$|\\s)`, 'iu'), ' ').replace(/\s+/g, ' ').trim()
              if (withoutTerm !== pending.bundle.minimizeIdentifiers(priorText).replace(/\s+/g, ' ').trim()) continue
              section[eligible.index] = 'text' in prior ? { ...prior, text: pending.bundle.restoreIdentifiers(correction.text) } : { ...prior, name: pending.bundle.restoreIdentifiers(correction.text) }
              result.draft.content = { ...result.draft.content, [eligible.section]: section }
            }
            result.draft.attempts += coverageRepair.attempts
            report = checkDraftFacts(result.draft, { includeSkillDecisions: false })
          }
        }
        const coverage = { ...qualificationCoverage(analysis.runId ?? analysis.jobId, analysis.displayAnalysis ?? analysis.analysis, result.draft, draftInputs.items.map(item => ({ evidenceId: item.id, revision: item.revision, snapshot: item.snapshot }))), repairAttempts: coverageRepairAttempts }
        const finalSemanticPairs: Array<{ section: keyof DraftRevision['content']; itemPath: string; rewritten: string; evidence: string[] }> = (['education', 'experience', 'projects', 'skills', 'certificates'] as const).flatMap(section => result.draft.content[section].map((item, index) => {
          const citations = item.citations
          const citedSources = citations.flatMap(citation => {
            const frozen = result.draft.evidence.find(evidence => evidence.evidenceId === citation.evidenceId && evidence.revision === citation.revision)
            const source = safeItems.find(candidate => candidate.id === citation.evidenceId && candidate.revision === citation.revision)
            return frozen && source ? [source.text] : []
          })
          return { section, itemPath: `${section}[${index}]`, rewritten: minimizeRestoredText('text' in item ? item.text : item.name), evidence: citedSources }
        }))
        const findingOrigin = { originDraftId: result.draft.id, originDraftRevision: result.draft.revision, originEvidenceRevisionHash: report.evidenceRevisionHash, historical: false }
        const semanticFindings: ReturnType<typeof factualCheckReportSchema.parse>['findings'] = []
        let semanticAttempts = 0
        if (pending.faithfulnessCheck) {
          const semanticSchema = z.object({ results: z.array(z.object({ itemPath: z.string().min(1), supported: z.boolean(), explanation: z.string().trim().min(1).max(500) }).strict()).max(200) }).strict()
          if (pending.bundle.containsRestoredIdentifier(finalSemanticPairs)) {
            semanticFindings.push({ code: 'semantic-unsupported', itemPath: 'faithfulness', ...findingOrigin, message: 'The optional comparison was withheld because a rewritten pair contained a restored identifier or contact detail.', correction: 'Remove the sensitive text and start a fresh authorized review. No semantic request was sent.' })
          } else {
            const attemptsBeforeReview = (db.prepare('SELECT COUNT(*) AS count FROM analysis_attempts WHERE run_id = ?').get(pending.runId) as { count: number }).count
            try {
              authorizeOutboundPayload(pending.runId, pending.bundle.outgoing)
              const review = await dispatcher.generate({ runId: pending.runId, jobId: pending.jobId, model: openRouterModelSchema.parse(pending.source.model.name), consentId: pending.consentId!, responseSchema: semanticSchema, runBudgetOverride, prompt: `Compare all rewritten/source pairs in this single structured batch. Report each exact itemPath once. Mark unsupported only when the rewrite adds or strengthens factual meaning beyond its cited source. This is a second opinion, not proof. Do not rewrite content or request more data.\n${JSON.stringify({ pairs: finalSemanticPairs })}` })
              authorizeOutboundPayload(pending.runId, pending.bundle.outgoing)
              semanticAttempts += review.attempts
              const parsed = semanticSchema.parse(JSON.parse(review.text))
              const expectedPaths = finalSemanticPairs.map(pair => pair.itemPath)
              if (parsed.results.length !== expectedPaths.length || new Set(parsed.results.map(item => item.itemPath)).size !== expectedPaths.length || expectedPaths.some(path => !parsed.results.some(item => item.itemPath === path))) throw new Error('Faithfulness review returned incomplete or duplicate item paths.')
              for (const finding of parsed.results.filter(item => !item.supported)) {
                const pair = finalSemanticPairs.find(item => item.itemPath === finding.itemPath)!
                const index = Number(/\[(\d+)\]/.exec(finding.itemPath)?.[1] ?? -1)
                const contentCitation = result.draft.content[pair.section][index]?.citations[0]
                semanticFindings.push({ code: 'semantic-unsupported', itemPath: finding.itemPath, evidenceId: contentCitation?.evidenceId, ...findingOrigin, message: `Second-opinion faithfulness check: ${finding.explanation}`, correction: 'Correct or remove this wording, then obtain a new authorized faithfulness check. This result is not proof and does not replace human review.' })
              }
            } catch (error) {
              if (error instanceof AnalysisError && error.code === 'CANCELLED') throw error
              const attemptsAfterReview = (db.prepare('SELECT COUNT(*) AS count FROM analysis_attempts WHERE run_id = ?').get(pending.runId) as { count: number }).count
              semanticAttempts = attemptsAfterReview - attemptsBeforeReview
              const reason = error instanceof AnalysisError ? error.code.toLowerCase() : 'malformed structured output'
              semanticFindings.push({ code: 'semantic-unsupported', itemPath: 'faithfulness', ...findingOrigin, message: `Optional faithfulness review did not complete (${reason}); generated wording was retained but remains blocked.`, correction: 'Retry with a fresh authorized run when the shared request/time budget permits. This check is a second opinion, not proof.' })
            }
          }
        }
        saveGenerationStep('check-document', 'Checking draft structure and document readiness.', ['parse-posting', 'score-evidence', 'select-content', 'tailor-paragraphs', 'verify-claims'])
        report = checkDraftFacts(result.draft)
        const findings = [...report.findings, ...semanticFindings]
        const totalAttempts = result.attempts + repairAttempts + coverageRepairAttempts + semanticAttempts
        const mergedReport = factualCheckReportSchema.parse({ ...report, passed: findings.length === 0, findings })
        if (dispatcher.isCancelled(pending.runId) || activeAnalysisByJob.get(pending.jobId) !== pending.runId) {
          if (activeAnalysisByJob.get(pending.jobId) === pending.runId) activeAnalysisByJob.delete(pending.jobId)
          saveAnalysisState({ jobId: pending.jobId, runId: pending.runId, status: 'cancelled', analysis: analysis.analysis, progress: 'Generation cancelled. A late response was discarded; no draft changes were saved.', attempts: (db.prepare('SELECT COUNT(*) AS count FROM analysis_attempts WHERE run_id = ?').get(pending.runId) as { count: number }).count, cacheHit: analysis.cacheHit })
          db.prepare("UPDATE generation_recovery SET status='cancelled',updated_at=? WHERE run_id=?").run(new Date().toISOString(), pending.runId)
          return { ok: false, message: 'Generation was cancelled. Its late response was discarded; no draft changes were saved.' }
        }
        const scopeNotice = workingTextScopeNotice(pending.jobId)
        const checkedDraft = draftRevisionSchema.parse({ ...result.draft, status: findings.length ? 'blocked' : 'unverified', checkReport: mergedReport, coverage, attempts: totalAttempts, progress: `${findings.length ? `Draft saved for its ${result.draft.pageTarget}-page target; blocked by ${findings.length} unresolved finding(s). The optional semantic review is a second opinion, not proof.` : `${result.draft.progress} Automated checks passed; semantic comparison is a second opinion, not proof. Human review remains required.`}${scopeNotice}` })
        result.draft = checkedDraft
        const tx = db.transaction(() => { db.prepare('INSERT INTO draft_revisions (id,job_id,revision,data) VALUES (?,?,?,?)').run(result.draft.id, result.draft.jobId, result.draft.revision, JSON.stringify(result.draft)); db.prepare('UPDATE provider_attempt_outcomes SET checkpointed_at=? WHERE run_id=? AND checkpointed_at IS NULL').run(new Date().toISOString(), pending.runId); db.prepare("UPDATE generation_recovery SET status='complete',updated_at=? WHERE run_id=?").run(new Date().toISOString(), pending.runId) })
        tx()
        if (activeAnalysisByJob.get(pending.jobId) === pending.runId) activeAnalysisByJob.delete(pending.jobId)
        saveAnalysisState({ jobId: pending.jobId, runId: pending.runId, status: 'complete', analysis: analysis.analysis, progress: result.draft.progress, attempts: analysis.attempts + totalAttempts, cacheHit: analysis.cacheHit, generationStep: 'check-document', completedSteps: ['parse-posting', 'score-evidence', 'select-content', 'tailor-paragraphs', 'verify-claims', 'check-document'] })
        return { ok: true, message: `${result.draft.status === 'blocked' ? 'Draft saved locally, editable, and blocked by factual findings.' : 'Draft saved locally. It is unverified and unapproved.'}${scopeNotice}`, draft: result.draft }
      } catch (error) {
        if (activeAnalysisByJob.get(pending.jobId) === pending.runId) activeAnalysisByJob.delete(pending.jobId)
        const cancelled = error instanceof AnalysisError && error.code === 'CANCELLED'
        const observedAttempts = (db.prepare('SELECT COUNT(*) AS count FROM analysis_attempts WHERE run_id = ?').get(pending.runId) as { count: number }).count
        const message = cancelled ? 'Draft generation was cancelled. No generated wording was retained.' : 'The generated response could not be safely validated. No model wording was retained; author a correction in the blocked draft or retry.'
        if (error instanceof IncompatibleGenerationCheckpointError) {
          db.prepare("UPDATE generation_recovery SET status='cancelled',updated_at=? WHERE run_id=?").run(new Date().toISOString(), pending.runId)
          const priorProgress = currentAnalysis.get(pending.jobId)
          saveAnalysisState({ jobId: pending.jobId, runId: pending.runId, status: 'failed', analysis: analysis.analysis, progress: error.message, attempts: observedAttempts, error: error.message, cacheHit: analysis.cacheHit, ...(priorProgress?.runId === pending.runId ? { generationStep: priorProgress.generationStep, completedSteps: priorProgress.completedSteps } : {}) })
          return { ok: false, message: error.message }
        }
        const validationFailure = error instanceof SyntaxError || error instanceof z.ZodError || error instanceof CitationValidationError
        if (validationFailure) {
          const failed = draftRevisionSchema.parse({ ...failedDraftIdentity, pageTarget, status: 'blocked', approved: false, content: { education: [], experience: [], projects: [], skills: [], certificates: [] }, evidence: safeItems.map(item => ({ evidenceId: item.id, revision: item.revision, snapshot: item.snapshot })), progress: 'Generation failed validation; model output was discarded. This empty draft is editable only by adding locally authored content and remains blocked pending factual checks.', attempts: observedAttempts })
          const code = error instanceof CitationValidationError ? error.finding : 'schema'
          const report = factualCheckReportSchema.parse({ ...checkDraftFacts(failed), passed: false, findings: [{ code, itemPath: 'generation', message: code === 'foreign-citation' ? 'The response referenced evidence outside the selected authorized sources. Model output was discarded.' : 'The tailored response did not match the required structured schema. Model output was discarded.', correction: 'Author or correct draft wording using the saved evidence revisions, then run factual checks.' }] })
          const blocked = draftRevisionSchema.parse({ ...failed, checkReport: report })
          db.prepare('INSERT INTO draft_revisions (id,job_id,revision,data) VALUES (?,?,?,?)').run(blocked.id, blocked.jobId, blocked.revision, JSON.stringify(blocked))
          const priorProgress = currentAnalysis.get(pending.jobId)
          saveAnalysisState({ jobId: pending.jobId, runId: pending.runId, status: 'complete', analysis: analysis.analysis, progress: blocked.progress, attempts: observedAttempts, cacheHit: analysis.cacheHit, generationStep: priorProgress?.runId === pending.runId ? priorProgress.generationStep : 'parse-posting', completedSteps: priorProgress?.runId === pending.runId ? priorProgress.completedSteps : ['parse-posting'] })
          return { ok: true, message: 'A blocked draft was saved; no invalid model output was retained.', draft: blocked }
        }
        const paused = error instanceof AnalysisError && ['BUDGET','TIMEOUT','OFFLINE','PROVIDER','INVALID_KEY'].includes(error.code)
        const safeMessage = cancelled ? message : error instanceof AnalysisError ? error.message : error instanceof Error && /scope|authorization|stale|changed/i.test(error.message) ? 'Your authorized scope changed during generation. Review the outgoing data and try again.' : 'Draft generation failed safely. No draft was created; check authorization, connection, and model settings before retrying.'
        if (resumeRunId || !validationFailure) db.prepare('UPDATE generation_recovery SET status=?,updated_at=? WHERE run_id=?').run(cancelled ? 'cancelled' : paused ? 'paused' : 'running', new Date().toISOString(), pending.runId)
        const priorProgress = currentAnalysis.get(pending.jobId)
        saveAnalysisState({ jobId: pending.jobId, runId: pending.runId, status: cancelled ? 'cancelled' : 'failed', analysis: analysis.analysis, progress: safeMessage, attempts: observedAttempts, error: safeMessage, cacheHit: analysis.cacheHit, ...(priorProgress?.runId === pending.runId ? { generationStep: priorProgress.generationStep, completedSteps: priorProgress.completedSteps } : {}) })
        return { ok: false, message: safeMessage }
      }
    },
    async renewDraftReview(jobId: string) {
      if (!uuidSchema.safeParse(jobId).success) return { ok: false, message: 'Choose a valid saved job before renewing its review.' }
      if (activeAnalysisByJob.has(jobId)) return { ok: false, message: 'Wait for the current posting assessment to finish before renewing review.' }
      const job = await this.openJob(jobId)
      const analysis = await this.getAnalysis(jobId)
      const currentScope = job ? currentConsentSource(jobId) : null
      const authorizedCurrentRun = analysis?.runId && currentScope && analysis.targetPostingUpdatedAt === job?.updatedAt
        ? db.prepare('SELECT 1 FROM outbound_consents WHERE run_id = ? AND scope_hash = ? AND revoked = 0').get(analysis.runId, prepareOutboundBundle(currentScope).scopeHash)
        : undefined
      if (!job || analysis?.status !== 'complete' || !analysis.analysis || analysis.targetPostingUpdatedAt !== job.updatedAt || !authorizedCurrentRun) return { ok: false, message: 'Complete an explicitly authorized assessment of the current posting before renewing this review.' }
      const row = db.prepare('SELECT data FROM draft_revisions WHERE job_id = ? ORDER BY revision DESC LIMIT 1').get(jobId) as { data: string } | undefined
      if (!row) return { ok: false, message: 'There is no existing CV wording to renew. Generate a draft when you choose.' }
      const prior = draftRevisionSchema.parse(JSON.parse(row.data))
      if (prior.targetPostingUpdatedAt === job.updatedAt) return { ok: false, message: 'This CV review already targets the current posting.' }
      const revision = ((db.prepare('SELECT MAX(revision) AS revision FROM draft_revisions WHERE job_id = ?').get(jobId) as { revision: number | null }).revision ?? prior.revision) + 1
      const sources = prepareDraftInputs(readProfile(), readExperience()).items.map(item => ({ evidenceId: item.id, revision: item.revision, snapshot: item.snapshot }))
      const coverage = qualificationCoverage(analysis.runId ?? jobId, analysis.displayAnalysis ?? analysis.analysis, prior, sources)
      const renewed = draftRevisionSchema.parse({ ...prior, id: randomUUID(), revision, targetPostingUpdatedAt: job.updatedAt, approved: false, approval: undefined, checkReport: undefined, coverage: { ...coverage, stale: false }, status: 'unverified', progress: 'Existing CV wording retained. Review it against the current posting, then run current checks and page measurement before approval.', createdAt: new Date().toISOString() })
      const tx = db.transaction(() => {
        const latestJob = db.prepare('SELECT updated_at FROM jobs WHERE id = ?').get(jobId) as { updated_at: string } | undefined
        const latest = db.prepare('SELECT data FROM draft_revisions WHERE job_id = ? ORDER BY revision DESC LIMIT 1').get(jobId) as { data: string } | undefined
        if (latestJob?.updated_at !== job.updatedAt || !latest || draftRevisionSchema.parse(JSON.parse(latest.data)).id !== prior.id) return false
        db.prepare('INSERT INTO draft_revisions (id,job_id,revision,data) VALUES (?,?,?,?)').run(renewed.id, jobId, renewed.revision, JSON.stringify(renewed))
        db.prepare('DELETE FROM document_fit_reports WHERE job_id = ?').run(jobId)
        return true
      })
      if (!tx()) return { ok: false, message: 'The posting or CV changed during renewal. Review the current versions and try again.' }
      return { ok: true, message: 'Existing wording is ready for your renewed review against the current posting. Checks and page fit must be refreshed.', draft: renewed }
    },
    async regenerateDraft(token: string, target: RegenerationTarget) {
      const parsedTarget = regenerationTargetSchema.safeParse(target)
      if (!parsedTarget.success) return { ok: false, message: 'Choose a valid section or paragraph to regenerate.' }
      const pending = pendingOutbound.get(token)
      if (!pending?.consentId) return { ok: false, message: 'Inspect and authorize a fresh outgoing-data preview before regeneration.' }
      const latestScope = currentConsentSource(pending.jobId)
      if (!latestScope || prepareOutboundBundle(latestScope).scopeHash !== pending.bundle.scopeHash) return { ok: false, message: 'Your job, profile, or model settings changed after consent. Review the outgoing data again.' }
      if (activeAnalysisByJob.has(pending.jobId)) return { ok: false, message: 'Another provider operation is active for this saved job. Cancel it before regenerating.' }
      const row = db.prepare('SELECT data FROM draft_revisions WHERE job_id = ? ORDER BY revision DESC LIMIT 1').get(pending.jobId) as { data: string } | undefined
      if (!row) return { ok: false, message: 'Create a draft before requesting a replacement proposal.' }
      const base = draftRevisionSchema.parse(JSON.parse(row.data))
      const section = base.content[parsedTarget.data.section]
      if (!section.length || (parsedTarget.data.kind === 'paragraph' && !section[parsedTarget.data.index])) return { ok: false, message: 'The selected section or paragraph is no longer available.' }
      const scoped = parsedTarget.data.kind === 'section' ? section : [section[parsedTarget.data.index]]
      const compatibleCache = db.prepare('SELECT data, run_id FROM posting_analysis_cache WHERE cache_key = ?').get(analysisCacheKey(pending.source)) as { data: string; run_id: string } | undefined
      let analysisResult = compatibleCache ? analysisResultSchema.parse({ jobId: pending.jobId, runId: compatibleCache.run_id, status: 'complete', analysis: postingAnalysisSchema.parse(JSON.parse(compatibleCache.data)), progress: 'Loaded compatible posting analysis for regeneration.', attempts: 0, cacheHit: true }) : null
      if (!analysisResult) analysisResult = await this.startAnalysis(token)
      if (!analysisResult || analysisResult.status !== 'complete' || !analysisResult.analysis) return { ok: false, message: 'Posting analysis must complete before regeneration. Your draft was not changed.' }
      const latestAfterAnalysis = currentConsentSource(pending.jobId)
      if (!latestAfterAnalysis || prepareOutboundBundle(latestAfterAnalysis).scopeHash !== pending.bundle.scopeHash) return { ok: false, message: 'Your authorized inputs changed. Review a fresh outgoing-data preview before retrying.' }
      // Resolve each citation to the corresponding already-inspected, minimized source text.
      // Never include locally authored/generated draft wording or rationale in a provider request.
      const authorizedSources = new Map<string, string[]>()
      const safeProfile = pending.bundle.outgoing.profile
      const sourceStrings = (...values: Array<string | undefined>) => values.filter((value): value is string => Boolean(value?.trim()))
      latestScope.profile.education.forEach((item, index) => { const safe = safeProfile.education[index]; authorizedSources.set(item.id, sourceStrings(safe?.title, safe?.institution, safe?.field, safe?.description)) })
      latestScope.profile.certificates?.forEach((item, index) => { if (item.id) { const safe = safeProfile.certificates[index]; authorizedSources.set(item.id, sourceStrings(safe?.title, safe?.issuer, safe?.description)) } })
      latestScope.profile.skills.forEach((item, index) => { const safe = safeProfile.skills[index]; authorizedSources.set(item.id, sourceStrings(safe?.name, safe?.category, safe?.proficiency)) })
      latestScope.profile.experience.forEach((item, index) => {
        const safe = safeProfile.experience[index]
        authorizedSources.set(item.id, sourceStrings(safe?.kind, safe?.title, safe?.organization, safe?.description, ...(safe?.evidence ?? [])))
        item.factualItems?.forEach((fact, factIndex) => { if (fact.id && safe?.evidence[factIndex] !== undefined) authorizedSources.set(fact.id, [safe.evidence[factIndex]]) })
      })
      latestScope.profile.projects.forEach((item, index) => {
        const safe = safeProfile.projects[index]
        authorizedSources.set(item.id, sourceStrings(safe?.name, safe?.description, ...(safe?.evidence ?? []), ...(safe?.technologies ?? [])))
        item.factualItems?.forEach((fact, factIndex) => { if (fact.id && safe?.evidence[factIndex] !== undefined) authorizedSources.set(fact.id, [safe.evidence[factIndex]]) })
        item.technologies?.forEach((fact, factIndex) => { if (fact.id && safe?.technologies[factIndex] !== undefined) authorizedSources.set(fact.id, [safe.technologies[factIndex]]) })
      })
      const sourceGroups = scoped.map(item => item.citations.flatMap(citation => authorizedSources.get(citation.evidenceId) ?? []))
      if (sourceGroups.some(group => !group.length)) return { ok: false, message: 'The selected draft has a source that is not part of the inspected outgoing bundle. Prepare a fresh proposal from current evidence.' }
      const prompt = `Propose conservative replacement wording for only the selected CV ${parsedTarget.data.section} ${parsedTarget.data.kind}. Use only the authorized, minimized source text grouped by item below; each group corresponds to one existing item in the same order. Do not use or invent any other facts, and preserve responsibility, scope, certainty, ownership and skill level. Return exactly one replacement per source group, in order, with a concise rationale.\\n${JSON.stringify({ target: { section: parsedTarget.data.section, kind: parsedTarget.data.kind }, job: pending.bundle.outgoing.job, analysis: analysisResult.analysis, sourcesByItem: sourceGroups })}`
      const responseSchema = z.object({ items: z.array(z.object({ text: z.string().trim().min(1).max(3000), rationale: z.string().trim().min(1).max(500) }).strict()).min(1).max(100) }).strict()
      if (startedRegenerationTokens.has(token)) return { ok: false, message: 'This authorized regeneration operation has already started. Review a fresh outgoing-data preview for another proposal.' }
      startedRegenerationTokens.add(token)
      const proposalId = randomUUID(), runId = pending.runId
      activeAnalysisByJob.set(pending.jobId, runId)
      const progress = `Preparing a ${parsedTarget.data.kind} replacement proposal…`
      saveAnalysisState({ jobId: pending.jobId, runId, status: 'running', analysis: analysisResult.analysis, progress, attempts: 0, cacheHit: analysisResult.cacheHit })
      try {
        authorizeOutboundPayload(runId, pending.bundle.outgoing)
        authorizeOutboundPayload(runId, sourceGroups)
        dispatcher.authorize(runId, pending.consentId)
        const generated = await dispatcher.generate({ runId, jobId: pending.jobId, model: openRouterModelSchema.parse(pending.source.model.name), prompt, consentId: pending.consentId, responseSchema })
        authorizeOutboundPayload(runId, pending.bundle.outgoing)
        authorizeOutboundPayload(runId, sourceGroups)
        const currentScopeAfterDispatch = currentConsentSource(pending.jobId)
        if (!currentScopeAfterDispatch || prepareOutboundBundle(currentScopeAfterDispatch).scopeHash !== pending.bundle.scopeHash) throw new Error('Authorized scope changed during regeneration.')
        const decoded = responseSchema.parse(JSON.parse(generated.text))
        if (decoded.items.length !== scoped.length) throw new Error('The provider returned a different number of replacement items.')
        const postingScopeNote = workingTextScopeNotice(pending.jobId).trim()
        const proposal = regenerationProposalSchema.parse({ id: proposalId, jobId: base.jobId, jobRevision: String(pending.source.job.revision), baseDraftId: base.id, baseDraftRevision: base.revision, evidenceHash: createHash('sha256').update(JSON.stringify(base.evidence)).digest('hex'), target: parsedTarget.data, before: scoped.map(item => ({ text: 'text' in item ? item.text : item.name, citations: item.citations, rationale: item.rationale })), proposed: decoded.items.map((item, index) => ({ ...item, text: pending.bundle.restoreIdentifiers(item.text), citations: scoped[index].citations })), status: 'pending', attempts: generated.attempts, progress: `Replacement proposal is ready for comparison. The draft has not changed.${postingScopeNote ? ` ${postingScopeNote}` : ''}`, ...(postingScopeNote ? { postingScopeNote } : {}), createdAt: new Date().toISOString() })
        db.prepare('INSERT INTO regeneration_proposals (id,job_id,status,data) VALUES (?,?,?,?)').run(proposal.id, proposal.jobId, proposal.status, JSON.stringify(proposal))
        saveAnalysisState({ jobId: pending.jobId, runId, status: 'complete', analysis: analysisResult.analysis, progress: proposal.progress, attempts: generated.attempts, cacheHit: analysisResult.cacheHit })
        return { ok: true, message: proposal.progress, proposal }
      } catch (error) {
        const cancelled = error instanceof AnalysisError && error.code === 'CANCELLED'
        const message = cancelled ? 'Regeneration was cancelled; the current draft was preserved.' : 'Replacement generation failed safely; the current draft was preserved. Review inputs and budget, then start a fresh authorized operation.'
        saveAnalysisState({ jobId: pending.jobId, runId, status: cancelled ? 'cancelled' : 'failed', analysis: analysisResult.analysis, progress: message, attempts: (db.prepare('SELECT COUNT(*) AS count FROM analysis_attempts WHERE run_id = ?').get(runId) as { count: number }).count, error: message, cacheHit: analysisResult.cacheHit })
        return { ok: false, message }
      } finally { if (activeAnalysisByJob.get(pending.jobId) === runId) activeAnalysisByJob.delete(pending.jobId) }
    },
    async getRegenerationProposal(jobId: string) {
      const row = db.prepare('SELECT data FROM regeneration_proposals WHERE job_id = ? AND status = \'pending\' ORDER BY rowid DESC LIMIT 1').get(jobId) as { data: string } | undefined
      return row ? regenerationProposalSchema.parse(JSON.parse(row.data)) : null
    },
    async resolveRegenerationProposal(jobId: string, proposalId: string, decision: 'accept' | 'reject') {
      const row = db.prepare('SELECT data FROM regeneration_proposals WHERE id = ? AND job_id = ?').get(proposalId, jobId) as { data: string } | undefined
      if (!row) return { ok: false, message: 'This replacement proposal is no longer available.' }
      const proposal = regenerationProposalSchema.parse(JSON.parse(row.data))
      if (proposal.status !== 'pending') return { ok: false, message: 'This proposal has already been resolved.' }
      const proposalScopeSuffix = proposal.postingScopeNote ? ` ${proposal.postingScopeNote}` : ''
      if (decision === 'reject') {
        const rejected = regenerationProposalSchema.parse({ ...proposal, status: 'rejected', progress: `Proposal rejected. The current draft and approval were left unchanged.${proposalScopeSuffix}` })
        db.prepare('UPDATE regeneration_proposals SET status = ?, data = ? WHERE id = ?').run(rejected.status, JSON.stringify(rejected), proposal.id)
        return { ok: true, message: rejected.progress, proposal: rejected }
      }
      const currentRow = db.prepare('SELECT data FROM draft_revisions WHERE job_id = ? ORDER BY revision DESC LIMIT 1').get(jobId) as { data: string } | undefined
      if (!currentRow) return { ok: false, message: 'The base draft no longer exists. This proposal cannot be accepted.' }
      const current = draftRevisionSchema.parse(JSON.parse(currentRow.data))
      const evidenceHash = createHash('sha256').update(JSON.stringify(current.evidence)).digest('hex')
      const latestJob = await this.openJob(jobId)
      if (current.id !== proposal.baseDraftId || current.revision !== proposal.baseDraftRevision || evidenceHash !== proposal.evidenceHash || currentSourceStatus(current).length > 0 || !latestJob || latestJob.updatedAt !== proposal.jobRevision) {
        const stale = regenerationProposalSchema.parse({ ...proposal, status: 'stale', progress: `The draft or evidence changed after this proposal was prepared. Regenerate against the current revision.${proposalScopeSuffix}` })
        db.prepare('UPDATE regeneration_proposals SET status = ?, data = ? WHERE id = ?').run(stale.status, JSON.stringify(stale), proposal.id)
        return { ok: false, message: stale.progress, proposal: stale }
      }
      const nextContent = { ...current.content, [proposal.target.section]: [...current.content[proposal.target.section]] }
      const from = proposal.target.kind === 'paragraph' ? proposal.target.index : 0
      proposal.proposed.forEach((item, offset) => {
        const index = from + offset, prior = nextContent[proposal.target.section][index]
        if (!prior) return
        nextContent[proposal.target.section][index] = 'text' in prior ? { ...prior, text: item.text, rationale: item.rationale, citations: item.citations } : { ...prior, name: item.text, rationale: item.rationale, citations: item.citations }
      })
      const now = new Date().toISOString()
      const candidate = draftRevisionSchema.parse({ ...current, id: randomUUID(), revision: current.revision + 1, createdAt: now, content: nextContent, approved: false, approval: undefined, status: 'unverified', checkReport: undefined, progress: `Replacement accepted and factual checks rerun. Actual Electron PDF page measurement is pending at the application boundary; approval remains blocked.${proposalScopeSuffix}` })
      const checked = checkDraftFacts(candidate)
      const next = draftRevisionSchema.parse({ ...candidate, status: checked.passed ? 'unverified' : 'blocked', checkReport: checked, progress: checked.passed ? candidate.progress : `Accepted replacement is blocked by ${checked.findings.length} factual finding(s). Actual Electron PDF page measurement is pending at the application boundary.${proposalScopeSuffix}` })
      const tx = db.transaction(() => {
        db.prepare('INSERT INTO draft_revisions (id,job_id,revision,data) VALUES (?,?,?,?)').run(next.id, next.jobId, next.revision, JSON.stringify(next))
        db.prepare('DELETE FROM document_fit_reports WHERE job_id = ?').run(jobId)
        const accepted = regenerationProposalSchema.parse({ ...proposal, status: 'accepted', progress: `Proposal accepted as a new draft revision. Factual checks passed; application-boundary PDF measurement and renewed approval are required.${proposalScopeSuffix}` })
        db.prepare('UPDATE regeneration_proposals SET status = ?, data = ? WHERE id = ?').run(accepted.status, JSON.stringify(accepted), proposal.id)
      })
      tx()
      return { ok: false, message: next.progress, proposal: regenerationProposalSchema.parse({ ...proposal, status: 'accepted', progress: `Proposal accepted. PDF page measurement is pending at the application boundary.${proposalScopeSuffix}` }), draft: next }
    },
    async decideSuggestedSkill(input: { jobId: string; draftId: string; skillId: string; decision: 'pending' | 'confirmed' | 'removed' }) {
      const parsed = suggestedSkillDecisionSchema.safeParse(input)
      if (!parsed.success) return { ok: false, message: 'Choose a valid suggestion decision.' }
      const prior = await this.getDraft(parsed.data.jobId)
      if (!prior || prior.id !== parsed.data.draftId) return { ok: false, message: 'This draft changed; reopen the current draft before deciding.' }
      const suggestions = [...(prior.suggestedSkills ?? [])], index = suggestions.findIndex(item => item.id === parsed.data.skillId)
      if (index < 0) return { ok: false, message: 'This skill suggestion is no longer available.' }
      suggestions[index] = { ...suggestions[index], status: parsed.data.decision, ...(parsed.data.decision === 'pending' ? { decidedAt: undefined } : { decidedAt: new Date().toISOString() }) }
      const next = draftRevisionSchema.parse({ ...prior, id: randomUUID(), revision: prior.revision + 1, suggestedSkills: suggestions, approved: false, approval: undefined, checkReport: undefined, status: 'blocked', progress: 'Skill review decision saved. Run checks and review the current draft again.' })
      let report = preserveKnownFindings(checkDraftFacts(next), prior)
      const stale = currentSourceStatus(next)
      if (stale.length) report = factualCheckReportSchema.parse({ ...report, passed: false, findings: [...report.findings, ...stale.map(evidenceId => ({ code: 'stale-source' as const, itemPath: 'sources', evidenceId, message: 'A cited profile source changed or was deleted after this draft was created.', correction: 'Review current evidence and create a draft from its current revision.' }))] })
      const checked = draftRevisionSchema.parse({ ...next, status: report.passed && !suggestions.some(item => item.status === 'pending') ? 'unverified' : 'blocked', checkReport: report })
      const latest = db.prepare('SELECT id FROM draft_revisions WHERE job_id = ? ORDER BY revision DESC LIMIT 1').get(checked.jobId) as { id: string } | undefined
      if (latest?.id !== parsed.data.draftId) return { ok: false, message: 'This draft changed while the decision was being saved. Reopen the current draft.' }
      db.prepare('INSERT INTO draft_revisions (id,job_id,revision,data) VALUES (?,?,?,?)').run(checked.id, checked.jobId, checked.revision, JSON.stringify(checked))
      db.prepare('DELETE FROM document_fit_reports WHERE job_id = ?').run(checked.jobId)
      return { ok: true, message: 'Skill decision saved in this draft only.', draft: checked }
    },
    async correctDraftTailoring(input: { jobId: string; draftId: string; field: 'headline' | 'summary'; text: string }) {
      const parsed = draftTailoringCorrectionSchema.safeParse(input)
      if (!parsed.success || (parsed.success && parsed.data.field === 'headline' && parsed.data.text.length > 160)) return { ok: false, message: 'Enter a headline of at most 160 characters or valid summary wording.' }
      const prior = await this.getDraft(parsed.data.jobId)
      if (!prior || prior.id !== parsed.data.draftId || !prior.tailoring) return { ok: false, message: 'This draft changed or has no tailored narrative to edit.' }
      const tailoring = parsed.data.field === 'headline' ? { ...prior.tailoring, headline: parsed.data.text } : { ...prior.tailoring, summary: { ...prior.tailoring.summary, text: parsed.data.text } }
      const next = draftRevisionSchema.parse({ ...prior, id: randomUUID(), revision: prior.revision + 1, tailoring, approved: false, approval: undefined, checkReport: undefined, status: 'unverified', progress: 'Tailored narrative corrected locally. Recheck and remeasure before approval.' })
      let report = preserveKnownFindings(checkDraftFacts(next), prior)
      const stale = currentSourceStatus(next)
      if (stale.length) report = factualCheckReportSchema.parse({ ...report, passed: false, findings: [...report.findings, ...stale.map(evidenceId => ({ code: 'stale-source' as const, itemPath: 'sources', evidenceId, message: 'A cited profile source changed or was deleted after this draft was created.', correction: 'Review current evidence and create a draft from its current revision.' }))] })
      const checked = draftRevisionSchema.parse({ ...next, status: report.passed ? 'unverified' : 'blocked', checkReport: report })
      const latest = db.prepare('SELECT id FROM draft_revisions WHERE job_id = ? ORDER BY revision DESC LIMIT 1').get(checked.jobId) as { id: string } | undefined
      if (latest?.id !== parsed.data.draftId) return { ok: false, message: 'This draft changed while the correction was being saved. Reopen the current draft.' }
      db.prepare('INSERT INTO draft_revisions (id,job_id,revision,data) VALUES (?,?,?,?)').run(checked.id, checked.jobId, checked.revision, JSON.stringify(checked))
      db.prepare('DELETE FROM document_fit_reports WHERE job_id = ?').run(checked.jobId)
      return { ok: true, message: 'Tailored narrative saved as a new draft revision.', draft: checked }
    },
    async mutateDraftRecord(input: MutateDraftRecordInput) {
      const parsed = mutateDraftRecordInputSchema.safeParse(input)
      if (!parsed.success) return { ok: false, message: 'Check the selected record and its details.' }
      const request = parsed.data
      const row = db.prepare('SELECT data FROM draft_revisions WHERE job_id = ? ORDER BY revision DESC LIMIT 1').get(request.jobId) as { data: string } | undefined
      if (!row) return { ok: false, message: 'There is no current draft to edit.' }
      const prior = draftRevisionSchema.parse(JSON.parse(row.data))
      if (prior.id !== request.draftId || prior.revision !== request.sourceRevision) return { ok: false, message: 'This draft changed. Reopen the current CV and try again.' }
      const items = [...prior.content[request.section]]
      let recordIndex: number | undefined
      if (request.operation !== 'add' && (request.index === undefined || !items[request.index])) return { ok: false, message: 'That CV record is no longer available.' }
      const supplied = request.operation === 'remove' ? undefined : request.section === 'education' ? profileEntryInputSchema.safeParse(request.value) : request.section === 'experience' ? experienceInputSchema.safeParse(request.value) : request.section === 'projects' ? projectInputSchema.safeParse(request.value) : skillInputSchema.safeParse(request.value)
      if (supplied && !supplied.success) return { ok: false, message: 'Check the record fields.', fieldErrors: Object.fromEntries(supplied.error.issues.map(issue => [issue.path.join('.') || '_', issue.message])) }
      if (request.section === 'education' && supplied?.success && (!('section' in supplied.data) || supplied.data.section !== 'education')) return { ok: false, message: 'Choose an education record.', fieldErrors: { section: 'This must be an education record.' } }
      const removeIndexes = new Set<number>(request.index === undefined ? [] : [request.index])
      if (request.operation !== 'add' && (request.section === 'experience' || request.section === 'projects')) {
        const item = items[request.index!]!, citations = item.citations.map(citation => citation.evidenceId)
        const parent = prior.lockedFields[request.section].find(value => ('sourceIds' in value ? value.sourceIds : undefined)?.some(id => citations.includes(id)) || citations.includes(value.evidenceId))
        if (parent) items.forEach((other, index) => { if (other.citations.some(citation => (parent.sourceIds ?? [parent.evidenceId]).includes(citation.evidenceId))) removeIndexes.add(index) })
      }
      const evidence = [...prior.evidence], locks = { ...prior.lockedFields, experience: prior.lockedFields.experience.map(lock => ({ ...lock, sourceIds: lock.sourceIds ? [...lock.sourceIds] : undefined })), projects: prior.lockedFields.projects.map(lock => ({ ...lock, sourceIds: lock.sourceIds ? [...lock.sourceIds] : undefined })), education: prior.lockedFields.education.map(lock => ({ ...lock })), certificates: prior.lockedFields.certificates.map(lock => ({ ...lock })) }
      const citationIds = request.index === undefined ? [] : items[request.index]!.citations.map(citation => citation.evidenceId)
      const citedProfileId = citationIds.find(id => prior.evidence.find(entry => entry.evidenceId === id)?.provenance !== 'manual')
      const ownerLock = request.section === 'experience' || request.section === 'projects' ? prior.lockedFields[request.section].find(lock => (lock.sourceIds ?? [lock.evidenceId]).some(id => citationIds.includes(id))) : undefined
      const sourceId = ownerLock?.evidenceId ?? citedProfileId
      const sourceIsManual = citationIds.some(id => prior.evidence.find(entry => entry.evidenceId === id)?.provenance === 'manual')
      const manualSource = sourceIsManual ? prior.evidence.find(entry => entry.provenance === 'manual' && items[request.index!]?.citations.some(citation => citation.evidenceId === entry.evidenceId && citation.revision === entry.revision)) : undefined
      const profileOrigin = manualSource?.profileOrigin
      const profileSourceId = sourceIsManual ? profileOrigin?.evidenceId : sourceId
      const frozenSource = profileSourceId ? prior.evidence.find(entry => entry.evidenceId === profileSourceId && (!profileOrigin || entry.revision === profileOrigin.revision)) : undefined
      const localSource = request.operation === 'update' ? manualSource : undefined
      const stagedOperation = request.operation === 'update' && sourceIsManual && !profileOrigin ? 'add' : request.operation
      let sourcePlan: DraftProfileMutation | undefined
      let profileInput: unknown = stagedOperation === 'add' && supplied?.success && request.section === 'experience'
        ? (() => { const value = supplied.data as import('../shared/experience').ExperienceInput; return { ...value, factualItems: (value.factualItems ?? []).map(({ text }) => ({ text })) } })()
        : stagedOperation === 'add' && supplied?.success && request.section === 'projects'
          ? (() => { const value = supplied.data as import('../shared/experience').ProjectInput; return { ...value, factualItems: (value.factualItems ?? []).map(({ text }) => ({ text })), technologies: (value.technologies ?? []).map(({ text }) => ({ text })) } })()
          : supplied?.success ? supplied.data : undefined
      if (profileOrigin && supplied?.success && (request.section === 'experience' || request.section === 'projects')) {
        const original = frozenSource?.snapshot as { factualItems?: NestedRecord[]; technologies?: NestedRecord[] } | undefined
        const remap = (facts: NestedInput[], originals: NestedRecord[] = []) => facts.map(fact => { const old = originals.find(item => item.text === fact.text); return { ...(old ? { id: old.id } : {}), text: fact.text } })
        const value = supplied.data as import('../shared/experience').ProjectInput
        profileInput = { ...value, factualItems: remap(value.factualItems ?? [], original?.factualItems), ...(request.section === 'projects' ? { technologies: remap(value.technologies ?? [], original?.technologies) } : {}) }
      }
      try { if (request.scope === 'profile' && !(request.operation === 'remove' && !profileSourceId)) sourcePlan = stageDraftProfileMutation(request.section, stagedOperation, profileSourceId, frozenSource?.revision ?? profileOrigin?.revision, profileInput) }
      catch { return { ok: false, message: 'A nested record identifier is invalid or belongs to another record.' } }
      if (request.scope === 'profile' && request.operation !== 'remove' && !sourcePlan) return { ok: false, message: 'The profile record changed or its fields do not match this section. Reopen the current CV and retry.' }
      if (request.scope === 'profile' && request.operation === 'remove' && profileSourceId && !sourcePlan) return { ok: false, message: 'The profile record changed or was deleted. Reopen the current CV before removing it.' }
      let sectionLocks = request.section === 'skills' ? [] : [...prior.lockedFields[request.section]]
      if (request.operation === 'update' && request.section !== 'skills') sectionLocks = sectionLocks.filter(value => !citationIds.includes(value.evidenceId) && !('sourceIds' in value && value.sourceIds?.some(id => citationIds.includes(id))))
      if (request.operation === 'remove') {
        const removedIds = new Set([...removeIndexes].flatMap(index => items[index]?.citations.map(citation => citation.evidenceId) ?? []))
        const filtered = items.filter((_, index) => !removeIndexes.has(index))
        if (request.section === 'skills') items.splice(0, items.length, ...filtered)
        else items.splice(0, items.length, ...filtered)
        if (request.section !== 'skills') sectionLocks = sectionLocks.filter(value => !removedIds.has(value.evidenceId) && !('sourceIds' in value && value.sourceIds?.some(id => removedIds.has(id))))
      } else {
        const value = supplied!.data
        const evidenceId = sourcePlan?.record.id ?? localSource?.evidenceId ?? randomUUID(), evidenceRevision = sourcePlan?.record.revision ?? (localSource ? localSource.revision + 1 : 1), citation = { evidenceId, revision: evidenceRevision }
        let snapshot: Record<string, unknown>, draftItem: { text: string; citations: typeof citation[]; rationale: string } | { name: string; citations: typeof citation[]; rationale: string }
        if (request.section === 'education') {
          const v = value as import('../shared/profile').ProfileEntryInput
          snapshot = { ...v, id: evidenceId, revision: evidenceRevision }
          draftItem = { text: v.description ?? v.title, citations: [citation], rationale: 'User-authored record; manually declared for this CV.' }
          sectionLocks.push({ evidenceId, title: v.title, ...(v.institution ? { institution: v.institution } : {}), ...(v.startDate ? { startDate: v.startDate } : {}), ...(v.endDate ? { endDate: v.endDate } : {}) })
        } else if (request.section === 'experience') {
          const v = value as import('../shared/experience').ExperienceInput
          const oldFacts = localSource?.snapshot && typeof localSource.snapshot === 'object' && 'factualItems' in localSource.snapshot ? (localSource.snapshot as { factualItems: NestedRecord[] }).factualItems : []
          let factualItems: NestedRecord[]
          try { factualItems = localSource ? reconcileNestedItems(v.factualItems ?? [], oldFacts, 'CV-only experience') : (v.factualItems ?? []).map(fact => ({ id: randomUUID(), revision: 1, text: fact.text })) }
          catch { return { ok: false, message: 'A factual item identifier does not belong to this CV record.' } }
          snapshot = { ...v, id: evidenceId, revision: evidenceRevision, factualItems }
          draftItem = { text: v.description, citations: [citation], rationale: 'User-authored record; manually declared for this CV.' }
          sectionLocks.push({ evidenceId, title: v.title, organization: v.organization, ...(v.startDate ? { startDate: v.startDate } : {}), ...(v.endDate ? { endDate: v.endDate } : {}) })
        } else if (request.section === 'projects') {
          const v = value as import('../shared/experience').ProjectInput
          const oldSnapshot = localSource?.snapshot && typeof localSource.snapshot === 'object' ? localSource.snapshot as { factualItems?: NestedRecord[]; technologies?: NestedRecord[] } : {}
          let factualItems: NestedRecord[], technologies: NestedRecord[]
          try {
            factualItems = localSource ? reconcileNestedItems(v.factualItems ?? [], oldSnapshot.factualItems ?? [], 'CV-only project') : (v.factualItems ?? []).map(fact => ({ id: randomUUID(), revision: 1, text: fact.text }))
            technologies = localSource ? reconcileNestedItems(v.technologies ?? [], oldSnapshot.technologies ?? [], 'CV-only project') : (v.technologies ?? []).map(fact => ({ id: randomUUID(), revision: 1, text: fact.text }))
          } catch { return { ok: false, message: 'A factual item identifier does not belong to this CV record.' } }
          snapshot = { ...v, id: evidenceId, revision: evidenceRevision, factualItems, technologies }
          draftItem = { text: v.description, citations: [citation], rationale: 'User-authored record; manually declared for this CV.' }
          sectionLocks.push({ evidenceId, name: v.name })
        } else {
          const v = value as import('../shared/profile').SkillInput
          snapshot = { ...v, id: evidenceId, revision: evidenceRevision }
          draftItem = { name: v.name, citations: [citation], rationale: 'User-authored record; manually declared for this CV.' }
        }
        if (sourcePlan) snapshot = sourcePlan.record as unknown as Record<string, unknown>
        if (sourcePlan?.operation === 'update' || localSource) evidence.splice(0, evidence.length, ...evidence.filter(entry => entry.evidenceId !== evidenceId))
        evidence.push({ evidenceId, revision: evidenceRevision, snapshot, provenance: sourcePlan ? 'profile' : 'manual', ...(!sourcePlan && (profileOrigin || frozenSource) ? { profileOrigin: profileOrigin ?? { evidenceId: frozenSource!.evidenceId, revision: frozenSource!.revision } } : {}) })
        if (request.operation === 'add') { items.push(draftItem as never); recordIndex = items.length - 1 }
        else {
          const insertion = items.slice(0, request.index!).filter((_, index) => !removeIndexes.has(index)).length
          const kept = items.filter((_, index) => !removeIndexes.has(index))
          items.splice(0, items.length, ...kept)
          recordIndex = Math.min(insertion, items.length)
          items.splice(recordIndex, 0, draftItem as never)
        }
      }
      if (request.section !== 'skills') (locks[request.section] as unknown[]).splice(0, sectionLocks.length, ...sectionLocks)
      const content = { ...prior.content, [request.section]: items } as DraftRevision['content']
      const updatedEvidenceId = sourcePlan?.record.id ?? localSource?.evidenceId
      const updatedEvidenceRevision = sourcePlan?.record.revision ?? (localSource ? localSource.revision + 1 : undefined)
      if (updatedEvidenceId && updatedEvidenceRevision && (sourcePlan?.operation === 'update' || localSource)) for (const section of ['education', 'experience', 'projects', 'skills', 'certificates'] as const) {
        content[section] = content[section].map(item => ({ ...item, citations: item.citations.map(citation => citation.evidenceId === updatedEvidenceId ? { ...citation, revision: updatedEvidenceRevision } : citation) })) as never
      }
      const declaredSkill = request.section === 'skills' && request.operation !== 'remove' && supplied?.success ? (supplied.data as SkillRecord).name.normalize('NFKC').trim().toLocaleLowerCase() : undefined
      // A manual skill declaration resolves its suggestion, but retain posting provenance so it cannot authorize past role usage.
      const suggestedSkills = prior.suggestedSkills?.map(skill => declaredSkill && skill.name.normalize('NFKC').trim().toLocaleLowerCase() === declaredSkill ? { ...skill, status: 'confirmed' as const, decidedAt: new Date().toISOString() } : skill)
      const next = draftRevisionSchema.parse({ ...prior, ...(suggestedSkills ? { suggestedSkills } : {}), id: randomUUID(), revision: prior.revision + 1, createdAt: new Date().toISOString(), content, evidence, lockedFields: locks, approved: false, approval: undefined, checkReport: undefined, coverage: undefined, status: 'blocked', progress: 'Manual CV record saved locally. Recheck the draft and review factual findings before approval.' })
      let report = preserveKnownFindings(checkDraftFacts(next), prior)
      const stale = currentSourceStatus(next).filter(id => !(sourcePlan && id === sourcePlan.record.id))
      if (stale.length) report = factualCheckReportSchema.parse({ ...report, passed: false, findings: [...report.findings, ...stale.map(evidenceId => ({ code: 'stale-source' as const, itemPath: 'sources', evidenceId, message: 'A cited profile source changed or was deleted after this draft was created.', correction: 'Review current evidence and create a draft from its current revision.' }))] })
      const saved = draftRevisionSchema.parse({ ...next, status: report.passed ? 'unverified' : 'blocked', checkReport: report })
      const tx = db.transaction(() => { const latest = db.prepare('SELECT id FROM draft_revisions WHERE job_id = ? ORDER BY revision DESC LIMIT 1').get(request.jobId) as { id: string } | undefined; if (latest?.id !== request.draftId) throw new Error('STALE_DRAFT'); if (sourcePlan) commitDraftProfileMutation(sourcePlan); db.prepare('INSERT INTO draft_revisions (id,job_id,revision,data) VALUES (?,?,?,?)').run(saved.id, saved.jobId, saved.revision, JSON.stringify(saved)); db.prepare('DELETE FROM document_fit_reports WHERE job_id = ?').run(saved.jobId) })
      try { tx() } catch (error) { return { ok: false, message: error instanceof WorkspaceBackupCapacityError ? error.message : error instanceof Error && error.message === 'STALE_DRAFT' ? 'This draft changed while saving. Reopen the current CV.' : 'The record could not be saved.' } }
      const message = sourcePlan ? `Record saved to this CV and profile. Profile history was recorded.${request.operation === 'remove' ? ' This deletion affects your profile and may make other drafts stale.' : ''}` : request.scope === 'profile' && request.operation === 'remove' ? 'This was a CV-only record; it was removed from this CV. No saved profile record existed to delete.' : 'Record saved to this CV only. Your profile was not changed.'
      return { ok: true, message, draft: (await this.getDraft(saved.jobId)) ?? saved, ...(recordIndex === undefined ? {} : { recordIndex }), ...(sourcePlan && request.operation === 'remove' ? { profileDeleteWarning: true } : {}) }
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
      const citations = parsed.data.editIntent === 'new-fact' ? parsed.data.evidence! : target.citations
      const liveItems = prepareDraftInputs(readProfile(), readExperience()).items
      const ownsManualEvidence = (citation: { evidenceId: string; revision: number }) => {
        const source = prior.evidence.find(entry => entry.evidenceId === citation.evidenceId && entry.revision === citation.revision && entry.provenance === 'manual')
        if (!source) return false
        if (parsed.data.section === 'skills') return Boolean(source.snapshot && typeof source.snapshot === 'object' && 'name' in source.snapshot && 'category' in source.snapshot)
        return prior.lockedFields[parsed.data.section].some(parent => (('sourceIds' in parent ? parent.sourceIds : undefined) ?? [parent.evidenceId]).includes(citation.evidenceId))
      }
      if (citations.some(citation => parsed.data.editIntent === 'new-fact'
        ? !liveItems.some(source => source.id === citation.evidenceId && source.revision === citation.revision && source.category === parsed.data.section)
        : !prior.evidence.some(source => source.evidenceId === citation.evidenceId && source.revision === citation.revision) || (ownsManualEvidence(citation) ? false : !liveItems.some(source => source.id === citation.evidenceId && source.revision === citation.revision && source.category === parsed.data.section)))) return null
      const linkedEvidence = parsed.data.editIntent === 'new-fact' ? [...prior.evidence, ...citations.filter(citation => !prior.evidence.some(source => source.evidenceId === citation.evidenceId && source.revision === citation.revision)).map(citation => { const source = liveItems.find(item => item.id === citation.evidenceId)!; return { evidenceId: source.id, revision: source.revision, snapshot: source.snapshot } })] : prior.evidence
      const updatedContent = { ...prior.content, [parsed.data.section]: section.map((item, index) => index !== parsed.data.index ? item : 'text' in item ? { ...item, text: parsed.data.text, citations } : { ...item, name: parsed.data.text, citations }) }
      const next = draftRevisionSchema.parse({ ...prior, id: randomUUID(), revision: prior.revision + 1, status: 'unverified', approved: false, approval: undefined, checkReport: undefined, evidence: linkedEvidence, content: updatedContent, progress: 'Draft wording corrected locally. Recheck before human review.' })
      let report = preserveKnownFindings(checkDraftFacts(next), prior)
      const stale = currentSourceStatus(next)
      if (stale.length) report = factualCheckReportSchema.parse({ ...report, passed: false, findings: [...report.findings, ...stale.map(evidenceId => ({ code: 'stale-source' as const, itemPath: 'sources', evidenceId, message: 'A cited profile source changed or was deleted after this draft was created.', correction: 'Review and save current evidence, then create a draft using its current revision.' }))] })
      const checked = draftRevisionSchema.parse({ ...next, status: report.passed ? 'unverified' : 'blocked', checkReport: report, progress: report.findings.some(finding => finding.itemPath === 'generation') ? 'Correction saved, but the known generation failure remains unresolved. Only a new authorized generation that passes validation can resolve it.' : report.passed ? 'Correction passes deterministic checks; semantic truth still requires human review. Wording-only versus new-fact is user-declared and cannot be inferred perfectly.' : `Blocked by ${report.findings.length} factual finding(s). Use the correction guidance below.` })
      db.prepare('INSERT INTO draft_revisions (id,job_id,revision,data) VALUES (?,?,?,?)').run(checked.id, checked.jobId, checked.revision, JSON.stringify(checked))
      db.prepare('DELETE FROM document_fit_reports WHERE job_id = ?').run(checked.jobId)
      return (await this.getDraft(checked.jobId)) ?? checked
    },
    async addDraftItem(input: { jobId: string; section: 'education' | 'experience' | 'projects' | 'skills' | 'certificates'; text: string; citation: { evidenceId: string; revision: number } }) {
      const parsed = addDraftItemInputSchema.safeParse(input)
      if (!parsed.success) return null
      const prior = await this.getDraft(parsed.data.jobId)
      if (!prior) return null
      const current = prepareDraftInputs(readProfile(), readExperience()).items.find(item => item.id === parsed.data.citation.evidenceId)
      if (!current || current.revision !== parsed.data.citation.revision || current.category !== parsed.data.section) return null
      const selected = prior.evidence.find(item => item.evidenceId === current.id)
      const parent = parsed.data.section === 'experience' ? prior.lockedFields.experience.find(item => item.sourceIds?.includes(current.id)) : parsed.data.section === 'projects' ? prior.lockedFields.projects.find(item => item.sourceIds?.includes(current.id)) : undefined
      if ((parsed.data.section === 'experience' || parsed.data.section === 'projects') && !parent) return null
      const items = [...prior.content[parsed.data.section]]
      const draftItem = parsed.data.section === 'skills' ? { name: parsed.data.text, citations: [parsed.data.citation], rationale: 'Locally authored correction from selected saved evidence.' } : { text: parsed.data.text, citations: [parsed.data.citation], rationale: 'Locally authored correction from selected saved evidence.' }
      items.push(draftItem as never)
      const evidence = selected ? prior.evidence : [...prior.evidence, { evidenceId: current.id, revision: current.revision, snapshot: current.snapshot }]
      const next = draftRevisionSchema.parse({ ...prior, id: randomUUID(), revision: prior.revision + 1, status: 'blocked', approved: false, approval: undefined, checkReport: undefined, evidence, content: { ...prior.content, [parsed.data.section]: items }, progress: 'Locally authored, cited content was saved. Automated checks do not replace human review.' })
      const report = preserveKnownFindings(checkDraftFacts(next), prior)
      const saved = draftRevisionSchema.parse({ ...next, status: report.passed ? 'unverified' : 'blocked', checkReport: report, progress: report.findings.some(finding => finding.itemPath === 'generation') ? 'Locally authored wording was added, but the known generation failure remains unresolved. Only a new authorized generation that passes validation can resolve it.' : next.progress })
      db.prepare('INSERT INTO draft_revisions (id,job_id,revision,data) VALUES (?,?,?,?)').run(saved.id, saved.jobId, saved.revision, JSON.stringify(saved))
      db.prepare('DELETE FROM document_fit_reports WHERE job_id = ?').run(saved.jobId)
      return saved
    },
    async checkDraft(jobId: string) {
      if (!uuidSchema.safeParse(jobId).success) return null
      const row = db.prepare('SELECT data FROM draft_revisions WHERE job_id = ? ORDER BY revision DESC LIMIT 1').get(jobId) as { data: string } | undefined
      if (!row) return null
      const draft = draftRevisionSchema.parse(JSON.parse(row.data))
      let report = preserveKnownFindings(checkDraftFacts(draft), draft)
      const stale = currentSourceStatus(draft)
      const jobRow = db.prepare('SELECT updated_at FROM jobs WHERE id = ?').get(jobId) as { updated_at: string } | undefined
      const staleTarget = !draft.targetPostingUpdatedAt || !jobRow || draft.targetPostingUpdatedAt !== jobRow.updated_at
      if (stale.length || staleTarget) report = factualCheckReportSchema.parse({ ...report, passed: false, findings: [...report.findings, ...stale.map(evidenceId => ({ code: 'stale-source' as const, itemPath: 'sources', evidenceId, message: 'A cited profile source changed or was deleted after this draft was created.', correction: 'Review the current source and regenerate or remove the affected wording.' })), ...(staleTarget ? [{ code: 'stale-source' as const, itemPath: 'job-posting', message: 'The accepted job posting changed after this draft was created.', correction: 'Create a renewed draft for the current posting before approval.' }] : [])] })
      const updated = draftRevisionSchema.parse({ ...draft, status: report.passed ? 'unverified' : 'blocked', checkReport: report, progress: report.passed ? 'Current factual checks passed; citations do not establish semantic truth. Human review remains required.' : `Blocked by ${report.findings.length} factual or source revision finding(s). Correct the draft and check again.` })
      if (!staleTarget) db.prepare('UPDATE draft_revisions SET data = ? WHERE id = ?').run(JSON.stringify(updated), draft.id)
      return report
    },
    async approveDraft(jobId: string) {
      const draft = await this.getDraft(jobId)
      if (!draft) return { ok: false, message: 'There is no saved draft to approve.' }
      if ((draft.suggestedSkills ?? []).some(skill => skill.status === 'pending')) return { ok: false, message: 'Confirm or remove every suggested skill before approval.' }
      const savedReport = draft.checkReport
      const expectedEvidenceHash = createHash('sha256').update(JSON.stringify([...draft.evidence].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)))).digest('hex')
      const stale = currentSourceStatus(draft)
      const jobRow = db.prepare('SELECT updated_at FROM jobs WHERE id = ?').get(jobId) as { updated_at: string } | undefined
      const staleTarget = !draft.targetPostingUpdatedAt || !jobRow || draft.targetPostingUpdatedAt !== jobRow.updated_at
      if (!savedReport?.passed || savedReport.draftId !== draft.id || savedReport.draftRevision !== draft.revision || savedReport.evidenceRevisionHash !== expectedEvidenceHash || draft.status === 'blocked') return { ok: false, message: 'Recheck the current draft and cited source revisions before approval.' }
      let report = preserveKnownFindings(checkDraftFacts(draft), draft)
      if (stale.length) report = factualCheckReportSchema.parse({ ...report, passed: false, findings: [...report.findings, ...stale.map(evidenceId => ({ code: 'stale-source' as const, itemPath: 'sources', evidenceId, message: 'A cited profile source changed or was deleted after this draft was created.', correction: 'Review the current source and regenerate or remove the affected wording.' }))] })
      if (staleTarget || !report.passed || report.draftId !== draft.id || report.draftRevision !== draft.revision || report.evidenceRevisionHash !== expectedEvidenceHash || stale.length) return { ok: false, message: staleTarget ? 'This draft targets an earlier job posting. Create a renewed draft for the current posting before approval.' : 'Current factual checks and cited source revisions must pass before approval.' }
      const canonical = await this.getCanonicalDocument(jobId)
      const fit = await this.getDocumentFitReport(jobId)
      if (!canonical || !fit || fit.overflow || fit.actualPages > fit.targetPages) return { ok: false, message: 'Measure the current document and resolve page overflow before approval.' }
      const contentHash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
      const approval = { contentHash, evidenceHash: report.evidenceRevisionHash, checkHash: createHash('sha256').update(JSON.stringify({ draftId: report.draftId, draftRevision: report.draftRevision, evidenceRevisionHash: report.evidenceRevisionHash, passed: report.passed, findings: report.findings })).digest('hex'), targetPages: canonical.targetPages, approvedAt: new Date().toISOString() }
      const saved = draftRevisionSchema.parse({ ...draft, approved: true, approval, checkReport: report, progress: 'Whole canonical document approved by the user.' })
      db.prepare('UPDATE draft_revisions SET data = ? WHERE id = ?').run(JSON.stringify(saved), draft.id)
      return { ok: true, message: 'Exact measured canonical document approved.', draft: saved }
    },
    async assertDraftExportable(jobId: string) {
      const draft = await this.getDraft(jobId), canonical = await this.getCanonicalDocument(jobId)
      if (!draft || !canonical || !draft.approved || !draft.approval) return { ok: false, message: 'Approve the current canonical document before export.' }
      if ((draft.suggestedSkills ?? []).some(skill => skill.status === 'pending')) return { ok: false, message: 'Confirm or remove every suggested skill before export.' }
      const jobRow = db.prepare('SELECT updated_at FROM jobs WHERE id = ?').get(jobId) as { updated_at: string } | undefined
      if (!draft.targetPostingUpdatedAt || !jobRow || draft.targetPostingUpdatedAt !== jobRow.updated_at) return { ok: false, message: 'This draft targets an earlier job posting. Create a renewed draft for the current posting before export.' }
      const report = await this.checkDraft(jobId), fit = await this.getDocumentFitReport(jobId)
      const contentHash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
      if (!report?.passed || !fit || fit.overflow || fit.actualPages > fit.targetPages || draft.approval.contentHash !== contentHash || draft.approval.evidenceHash !== report.evidenceRevisionHash || draft.approval.targetPages !== canonical.targetPages || draft.approval.checkHash !== createHash('sha256').update(JSON.stringify({ draftId: report.draftId, draftRevision: report.draftRevision, evidenceRevisionHash: report.evidenceRevisionHash, passed: report.passed, findings: report.findings })).digest('hex')) return { ok: false, message: 'Approval is stale or current checks/page fit no longer pass. Review and approve the current document again.' }
      return { ok: true, message: 'Current approved document is eligible for export.', document: canonical }
    },
    async getDraft(jobId: string) {
      if (!uuidSchema.safeParse(jobId).success) return null
      const row = db.prepare('SELECT data FROM draft_revisions WHERE job_id = ? ORDER BY revision DESC LIMIT 1').get(jobId) as { data: string } | undefined
      if (!row) return null
      const stored = JSON.parse(row.data) as Record<string, unknown>
      const draft = draftRevisionSchema.parse({ ...stored, pageTarget: stored.pageTarget ?? 1 })
      // Advisory local comparison is refreshed without a provider request or mutation of historical drafts.
      const analysis = await this.getAnalysis(jobId)
      if (!analysis?.analysis) return draft
      const sources = prepareDraftInputs(readProfile(), readExperience()).items.map(item => ({ evidenceId: item.id, revision: item.revision, snapshot: item.snapshot }))
      const coverage = qualificationCoverage(draft.coverage?.analysisId ?? analysis.runId ?? jobId, analysis.displayAnalysis ?? analysis.analysis, draft, sources)
      if (analysis.status === 'stale') return draftRevisionSchema.parse({ ...draft, coverage: { ...coverage, stale: true, repairAttempts: draft.coverage?.repairAttempts ?? 0, factualChecksRerun: draft.coverage?.factualChecksRerun ?? !!draft.checkReport } })
      return draftRevisionSchema.parse({ ...draft, coverage: { ...coverage, stale: false, repairAttempts: draft.coverage?.repairAttempts ?? 0, factualChecksRerun: draft.coverage?.factualChecksRerun ?? !!draft.checkReport } })
    },
    async getCanonicalDocument(jobId: string) {
      const draft = await this.getDraft(jobId)
      if (!draft) return null
      return createCanonicalDocument(draft, readProfile(), readExperience())
    },
    async saveDocumentFitReport(jobId: string, report: DocumentFitReport) {
      const parsed = documentFitReportSchema.parse(report), canonical = await this.getCanonicalDocument(jobId)
      if (!canonical || canonical.targetPages !== parsed.targetPages || createHash('sha256').update(JSON.stringify(canonical)).digest('hex') !== parsed.documentHash) throw new Error('Document changed during page measurement; measure the current preview again.')
      const tx = db.transaction(() => {
        db.prepare('INSERT INTO document_fit_reports (job_id,data) VALUES (?,?) ON CONFLICT(job_id) DO UPDATE SET data=excluded.data').run(jobId, JSON.stringify(parsed))
        const row = db.prepare('SELECT id,data FROM draft_revisions WHERE job_id = ? ORDER BY revision DESC LIMIT 1').get(jobId) as { id: string; data: string } | undefined
        if (row) {
          const draft = draftRevisionSchema.parse(JSON.parse(row.data))
          if (draft.progress.includes('Actual Electron PDF page measurement is pending at the application boundary.')) {
            const updated = draftRevisionSchema.parse({ ...draft, progress: draft.progress.replace('Actual Electron PDF page measurement is pending at the application boundary.', `Actual Electron PDF page measurement completed: ${parsed.actualPages} page(s), target ${parsed.targetPages}.`) })
            db.prepare('UPDATE draft_revisions SET data = ? WHERE id = ?').run(JSON.stringify(updated), row.id)
          }
        }
      })
      tx()
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
      const canonical = await this.getCanonicalDocument(jobId)
      for (const entry of canonical?.sections.flatMap(section => section.entries) ?? []) {
        if (selected.has(entry.id)) for (const item of entry.reviewItems ?? []) selected.add(item.id)
      }
      const content = { ...current.content }
      for (const section of ['education', 'experience', 'projects', 'skills', 'certificates'] as const) content[section] = content[section].filter((_, index) => !selected.has(`${section}-${index}`)) as never
      const suggestedSkills = current.suggestedSkills?.map(skill => selected.has(`suggested-skills-${skill.id}`) ? { ...skill, status: 'removed' as const, decidedAt: new Date().toISOString() } : skill)
      const revised = draftRevisionSchema.parse({ ...current, ...(suggestedSkills ? { suggestedSkills } : {}), id: randomUUID(), revision: current.revision + 1, content, approved: false, approval: undefined, checkReport: undefined, status: 'unverified', progress: 'Accepted page-fit cuts. Factual checks were invalidated; recheck and remeasure before review.', createdAt: new Date().toISOString() })
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
      if (activeRunId) {
        dispatcher.cancel(activeRunId)
        if (activeAnalysisByJob.get(jobId) === activeRunId) activeAnalysisByJob.delete(jobId)
      }
      const value = analysisResultSchema.parse({ jobId, ...(activeRunId ? { runId: activeRunId } : {}), status: 'cancelled', analysis: null, progress: 'Analysis cancelled. No further requests will be sent.', attempts: previous?.attempts ?? 0, cacheHit: false })
      saveAnalysisState(value)
      return value
    },
    async getGenerationRecovery(jobId: string) {
      const row = db.prepare("SELECT run_id,status,snapshot FROM generation_recovery WHERE job_id=? AND status IN ('running','paused') ORDER BY updated_at DESC LIMIT 1").get(jobId) as { run_id: string; status: 'running' | 'paused'; snapshot: string } | undefined
      if (!row) return null
      const attempts = (db.prepare('SELECT COUNT(*) AS count FROM analysis_attempts WHERE run_id=?').get(row.run_id) as { count: number }).count
      const uncertainAttempts = (db.prepare('SELECT COUNT(*) AS count FROM provider_attempt_outcomes WHERE run_id=? AND checkpointed_at IS NULL').get(row.run_id) as { count: number }).count
      const analysisRow = db.prepare('SELECT data FROM analysis_run_state WHERE job_id=?').get(jobId) as { data: string } | undefined
      const savedProgress = analysisRow ? (JSON.parse(analysisRow.data) as { progress?: string }).progress : undefined
      const budgetNextStep = /budget|time limit|time budget/i.test(savedProgress ?? '') ? ' If you deliberately increase the configured run ceiling in Settings before resuming, the extension is recorded and existing attempt counts are preserved.' : ''
      const progress = uncertainAttempts ? `${uncertainAttempts} dispatched request outcome(s) are uncertain; the provider may have processed them. No requests will be sent until you explicitly choose whether to retry; it may duplicate a request and spend another attempt.` : `${savedProgress ?? 'Generation stopped before completion.'} Completed work, frozen inputs and consent are saved. No requests will be sent until you choose to resume.${budgetNextStep}`
      return generationRecoverySchema.parse({ jobId, runId: row.run_id, status: uncertainAttempts ? 'uncertain' : row.status === 'paused' ? 'paused' : 'interrupted', attempts, uncertainAttempts, progress, canResume: true })
    },
    async resumeGeneration(runId: string, choice?: RecoveryChoice) {
      const row = db.prepare("SELECT job_id,consent_id,scope_hash,status,snapshot FROM generation_recovery WHERE run_id=? AND status IN ('running','paused')").get(runId) as { job_id: string; consent_id: string; scope_hash: string; status: string; snapshot: string } | undefined
      if (!row) return { ok: false, message: 'This generation has no recoverable saved checkpoint.' }
      let frozen: ReturnType<typeof generationRecoverySnapshotSchema.parse>
      try { frozen = generationRecoverySnapshotSchema.parse(JSON.parse(row.snapshot)) }
      catch { return { ok: false, message: 'The saved recovery snapshot is corrupt or incompatible. No requests were sent; cancel this run and inspect the source data.' } }
      if (frozen.runId !== runId || frozen.jobId !== row.job_id || frozen.consentId !== row.consent_id || frozen.scopeHash !== row.scope_hash) return { ok: false, message: 'Saved run identity or consent does not match its recovery record. No requests were sent.' }
      const uncertain = (db.prepare('SELECT COUNT(*) AS count FROM provider_attempt_outcomes WHERE run_id=? AND checkpointed_at IS NULL').get(runId) as { count: number }).count
      if (uncertain && choice !== 'retry-uncertain') return { ok: false, message: 'A provider request may have completed before interruption. Choose explicitly to retry that uncertain step, or cancel this saved run.' }
      if (!uncertain && choice && choice !== 'resume') return { ok: false, message: 'This run has no uncertain request to retry.' }
      const consent = db.prepare('SELECT id,run_id,scope_hash,created_at,revoked FROM outbound_consents WHERE id=? AND run_id=?').get(row.consent_id, runId) as { id: string; run_id: string; scope_hash: string; created_at: string; revoked: number } | undefined
      if (!consent || consent.revoked || consent.scope_hash !== row.scope_hash) return { ok: false, message: 'The saved consent is missing or revoked. This run cannot resume; review outgoing data for a new run.' }
      const bundle = prepareOutboundBundle(frozen.source)
      if (bundle.scopeHash !== row.scope_hash) return { ok: false, message: 'The frozen outgoing bundle failed its integrity check. This run cannot resume.' }
      try { outboundEngine.restoreConsent({ id: consent.id, runId: consent.run_id, scopeHash: consent.scope_hash, createdAt: consent.created_at, revoked: false }) } catch { return { ok: false, message: 'Saved consent could not be restored safely.' } }
      const token = randomUUID()
      pendingOutbound.set(token, { jobId: row.job_id, source: frozen.source, bundle, runId, faithfulnessCheck: frozen.faithfulnessCheck, consentId: consent.id })
      dispatcher.authorize(runId, consent.id)
      const priorBudgets = frozen.budgets ?? readAnalysisBudgets(), configuredBudgets = readAnalysisBudgets()
      const effectiveBudgets = { ...priorBudgets, runLimit: Math.max(priorBudgets.runLimit, configuredBudgets.runLimit), runTimeLimitMs: Math.max(priorBudgets.runTimeLimitMs, configuredBudgets.runTimeLimitMs) }
      if (effectiveBudgets.runLimit !== priorBudgets.runLimit || effectiveBudgets.runTimeLimitMs !== priorBudgets.runTimeLimitMs) {
        db.prepare('INSERT INTO generation_recovery_extensions (run_id,prior_run_limit,new_run_limit,prior_time_limit_ms,new_time_limit_ms,recorded_at) VALUES (?,?,?,?,?,?)').run(runId, priorBudgets.runLimit, effectiveBudgets.runLimit, priorBudgets.runTimeLimitMs, effectiveBudgets.runTimeLimitMs, new Date().toISOString())
        frozen.budgets = effectiveBudgets
        db.prepare('UPDATE generation_recovery SET snapshot=?,updated_at=? WHERE run_id=?').run(JSON.stringify(frozen), new Date().toISOString(), runId)
      }
      recoveredRunIds.add(runId)
      const resume = api.generateDraft as (token: string, pageTarget: 1 | 2, runId: string) => Promise<{ ok: boolean; message: string }>
      const result = await resume(token, frozen.pageTarget, runId)
      if (result.ok) recoveredRunIds.delete(runId)
      return result
    },
    async cancelGenerationRecovery(runId: string) {
      const row = db.prepare("SELECT job_id,consent_id FROM generation_recovery WHERE run_id=? AND status IN ('running','paused')").get(runId) as { job_id: string; consent_id: string } | undefined
      if (!row) return { ok: false, message: 'This generation is no longer awaiting recovery.' }
      dispatcher.cancel(runId)
      outboundEngine.revoke(row.consent_id)
      db.prepare('UPDATE outbound_consents SET revoked=1 WHERE id=?').run(row.consent_id)
      db.prepare("UPDATE generation_recovery SET status='cancelled',updated_at=? WHERE run_id=?").run(new Date().toISOString(), runId)
      recoveredRunIds.delete(runId)
      return { ok: true, message: 'Saved generation cancelled. Its draft and usage history are retained.' }
    },
    async getAnalysisUsage() {
      const day = pacificDay(Date.now())
      const attempts = previousAttempts.filter(timestamp => pacificDay(timestamp) === day).length
      const budgets = readAnalysisBudgets()
      const localNotice = 'Local observations and configured app limits only; other clients or keys are not visible. These are not OpenRouter account limits.'
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
    const latest = recoveredRunIds.has(runId) ? null : currentConsentSource(consent.jobId)
    if (!recoveredRunIds.has(runId) && (!latest || prepareOutboundBundle(latest).scopeHash !== consent.bundle.scopeHash)) {
      outboundEngine.revoke(consent.consentId!)
      db.prepare('UPDATE outbound_consents SET revoked = 1 WHERE id = ?').run(consent.consentId)
      throw new Error('Outbound authorization is stale; review the updated data before sending.')
    }
    return outboundEngine.authorizePayload(runId, consent.bundle, payload)
  }
  const backupEngine = createWorkspaceBackupEngine(db, recoveryHooks?.workspaceBackupMaxBytes)
  const assertIdle = () => { if (activeAnalysisByJob.size) throw new Error('A cloud operation is active. Cancel or finish it before backing up or restoring.') }
  const backup: WorkspaceBackupEngine = {
    readBackupStatus() { return backupEngine.readBackupStatus() },
    assertBackupCapacity(previousBytes) { return backupEngine.assertBackupCapacity(previousBytes) },
    createBackup() { assertIdle(); return backupEngine.createBackup() },
    previewRestore(input) { assertIdle(); return backupEngine.previewRestore(input) },
    applyRestore(token, writeSafety) { assertIdle(); return backupEngine.applyRestore(token, writeSafety) },
    cancelRestore(token) { return backupEngine.cancelRestore(token) }
  }
  let checkingBackupCapacity = false
  const assertBackupable = (previousBytes?: number) => {
    if (checkingBackupCapacity) return
    checkingBackupCapacity = true
    try { backupEngine.assertBackupCapacity(previousBytes) }
    finally { checkingBackupCapacity = false }
  }
  const legacyBackupBaseline = () => {
    const status = backupEngine.readBackupStatus()
    return status.legacyOverCap ? status.bytes : undefined
  }
  const normalizeBackupWriteError = (error: unknown) => error instanceof WorkspaceBackupCapacityError
    ? error
    : error instanceof Error && /WORKSPACE_BACKUP_(?:CAPACITY|ROW_LIMIT|TABLE_LIMIT|JOB_LIMIT)/.test(error.message)
      ? new WorkspaceBackupCapacityError(`The workspace change would exceed a backup safety limit (${error.message}). Nothing was changed and no existing history was deleted.`)
      : error
  // Guard every SQLite write transaction, not just job edits, so provider state, drafts,
  // profile history, fit reports, restore and checkpoint writes cannot overrun backup bounds.
  const nativeTransaction = db.transaction.bind(db)
  const nativeExec = db.exec.bind(db)
  const nativePrepare = db.prepare.bind(db)
  const selectChanges = nativePrepare('SELECT changes() AS count')
  let writeSequence = 0
  const guardedDb = db as unknown as { transaction: (callback: (...args: any[]) => unknown) => any; exec: (source: string) => Database.Database; prepare: (source: string) => any }
  guardedDb.transaction = (callback: (...args: any[]) => unknown) => {
    const priorWrites = writeSequence, priorBackupBytes = legacyBackupBaseline()
    const transaction = nativeTransaction((...args: any[]) => {
      const result = callback(...args)
      if (writeSequence !== priorWrites) assertBackupable(priorBackupBytes)
      return result
    })
    return (...args: any[]) => {
      try { return transaction(...args) }
      catch (error) { throw normalizeBackupWriteError(error) }
    }
  }
  guardedDb.exec = (source: string) => {
    if (checkingBackupCapacity) return nativeExec(source)
    const execute = () => { const result = nativeExec(source); writeSequence++; return result }
    if (db.inTransaction) return execute()
    const priorBackupBytes = legacyBackupBaseline()
    try { return nativeTransaction(() => { const result = execute(); assertBackupable(priorBackupBytes); return result })() }
    catch (error) { throw normalizeBackupWriteError(error) }
  }
  const wrapStatement = (statement: Database.Statement, mutating: boolean): Database.Statement => new Proxy(statement, { get(target, property) {
    if (property === 'run' || property === 'get' || property === 'all') return (...args: any[]) => {
      const execute = () => {
        const result = (target[property as 'run' | 'get' | 'all'] as (...values: any[]) => any)(...args)
        if (mutating && Number((selectChanges.get() as { count: number }).count) > 0) writeSequence++
        return result
      }
      if (!mutating || checkingBackupCapacity || db.inTransaction) return execute()
      const priorWrites = writeSequence, priorBackupBytes = legacyBackupBaseline()
      try { return nativeTransaction(() => { const result = execute(); if (writeSequence !== priorWrites) assertBackupable(priorBackupBytes); return result })() }
      catch (error) { throw normalizeBackupWriteError(error) }
    }
    if (property === 'iterate' && mutating) return (...args: any[]) => {
      const execute = () => {
        const rows = target.all(...args)
        if (Number((selectChanges.get() as { count: number }).count) > 0) writeSequence++
        return rows
      }
      if (db.inTransaction || checkingBackupCapacity) return execute()[Symbol.iterator]()
      const priorWrites = writeSequence, priorBackupBytes = legacyBackupBaseline()
      try {
        const rows = nativeTransaction(() => { const result = execute(); if (writeSequence !== priorWrites) assertBackupable(priorBackupBytes); return result })()
        return rows[Symbol.iterator]()
      } catch (error) { throw normalizeBackupWriteError(error) }
    }
    const value = Reflect.get(target, property, target)
    if (typeof value !== 'function') return value
    return (...args: any[]) => {
      const next = Reflect.apply(value, target, args) as unknown
      const statementResult = next && typeof next === 'object' && typeof (next as Database.Statement).run === 'function' ? next as Database.Statement : null
      return statementResult ? wrapStatement(statementResult, mutating) : next
    }
  } })
  guardedDb.prepare = (source: string) => {
    const statement = nativePrepare(source)
    return wrapStatement(statement, !statement.readonly)
  }
  return { api, authorizeOutboundPayload, backup, hasActiveWork: () => activeAnalysisByJob.size > 0 || activeProfileAiRuns.size > 0 || [...postingFetches.values()].some(fetch => fetch.state.status === 'fetching'), close: () => { for (const fetch of postingFetches.values()) fetch.controller.abort(); postingFetches.clear(); db.close() } }
}
