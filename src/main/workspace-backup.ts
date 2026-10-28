import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { MAX_WORKSPACE_BACKUP_BYTES, MAX_WORKSPACE_BACKUP_POSTING_REVISIONS, MAX_WORKSPACE_BACKUP_ROW_BYTES, WORKSPACE_BACKUP_SIZE_TABLE, WORKSPACE_BACKUP_STATE_TABLE, WORKSPACE_BACKUP_TABLE_ROW_LIMITS, workspaceBackupSchema, workspaceBackupStatusSchema, workspaceBackupWarning, type WorkspaceBackupEngine, type WorkspaceRestorePreview } from '../shared/workspace-backup'
import { contactRecordSchema, skillRecordSchema, profileEntrySchema, evidenceRevisionSchema, uuidSchema } from '../shared/profile'
import { experienceRecordSchema, projectRecordSchema } from '../shared/experience'
import { emptyPostingOptionalDetails, jobRecordSchema, MAX_JOB_RECORD_UTF8_BYTES, legacyDraftTargetBaseline, releasedV2JobRecordSchema } from '../shared/jobs'
import { draftRevisionSchema } from '../shared/draft'
import { analysisResultSchema, analysisBudgetsSchema, postingAnalysisSchema } from '../shared/posting-analysis'
import { regenerationProposalSchema } from '../shared/regeneration'
import { generationRecoverySnapshotSchema } from '../shared/generation-recovery'
import { documentFitReportSchema } from '../shared/document'
import { appearanceSchema } from '../shared/appearance'
import { openRouterModelSchema } from '../shared/openrouter-settings'
import { piModelSelectionSchema } from '../shared/pi-model'
import { coverLetterOperationSchema, coverLetterPurposeSchema, coverLetterRevisionSchema } from '../shared/cover-letter'
import { legacyV3TableSchemas } from './workspace-backup-legacy-v3'

// Keep this explicit: credentials are never serialized; all workspace persistence tables, including
// migrations and LangGraph checkpoints, are represented in the versioned format.
const tables = [
  'schema_migrations', 'settings', 'profile_contact', 'profile_skills', 'profile_entries', 'evidence_revisions', 'profile_import_provenance',
  'profile_experience', 'profile_projects', 'jobs', 'outbound_consents', 'posting_analysis_cache',
  'analysis_run_state', 'analysis_attempts', 'provider_attempt_outcomes', 'generation_recovery',
  'generation_recovery_extensions', 'draft_revisions', 'regeneration_proposals', 'document_fit_reports',
  'cover_letter_revisions', 'cover_letter_operations', 'langgraph_checkpoints', 'langgraph_checkpoint_writes'
]
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

type TableBackup = { schema: string; rows: Array<Record<string, unknown>> }
type Pending = { input: ReturnType<typeof workspaceBackupSchema.parse>; token: string }
export class WorkspaceBackupCapacityError extends Error { constructor(message: string) { super(message); this.name = 'WorkspaceBackupCapacityError' } }
const registeredRowSizers = new WeakSet<object>()
export function registerWorkspaceBackupRowSizer(db: Database.Database): void {
  if (registeredRowSizers.has(db)) return
  db.function('cv_workspace_backup_row_bytes', { deterministic: true }, (rowJson: string) => Buffer.byteLength(JSON.stringify(JSON.parse(rowJson)), 'utf8'))
  registeredRowSizers.add(db)
}

export function createWorkspaceBackupEngine(db: Database.Database, maxBackupBytes = MAX_WORKSPACE_BACKUP_BYTES): WorkspaceBackupEngine {
  if (!Number.isSafeInteger(maxBackupBytes) || maxBackupBytes < 1) throw new Error('Workspace backup byte ceiling must be a positive safe integer.')
  registerWorkspaceBackupRowSizer(db)
  db.pragma('recursive_triggers = ON')
  db.exec(`CREATE TABLE IF NOT EXISTS ${WORKSPACE_BACKUP_STATE_TABLE} (singleton INTEGER PRIMARY KEY CHECK(singleton=1), max_bytes INTEGER NOT NULL, base_bytes INTEGER NOT NULL, legacy_over_cap INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS ${WORKSPACE_BACKUP_SIZE_TABLE} (table_name TEXT PRIMARY KEY, row_count INTEGER NOT NULL, row_bytes INTEGER NOT NULL);`)
  const stateColumns = db.pragma(`table_info(${WORKSPACE_BACKUP_STATE_TABLE})`) as Array<{ name: string }>
  if (!stateColumns.some(column => column.name === 'legacy_over_cap')) db.exec(`ALTER TABLE ${WORKSPACE_BACKUP_STATE_TABLE} ADD COLUMN legacy_over_cap INTEGER NOT NULL DEFAULT 0`)
  db.prepare(`INSERT INTO ${WORKSPACE_BACKUP_STATE_TABLE} (singleton,max_bytes,base_bytes,legacy_over_cap) VALUES (1,?,0,0) ON CONFLICT(singleton) DO UPDATE SET max_bytes=excluded.max_bytes`).run(maxBackupBytes)
  const pending = new Map<string, Pending>()
  const tableSchema = (name: string): string => {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name) as { sql: string } | undefined
    if (!row) throw new Error(`Workspace table is missing: ${name}`)
    return row.sql
  }
  const actualTables = () => {
    const present = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('encrypted_credentials', ?, ?)").all(WORKSPACE_BACKUP_STATE_TABLE, WORKSPACE_BACKUP_SIZE_TABLE) as Array<{ name: string }>).map(row => row.name)
    const unsupported = present.filter(name => !tables.includes(name))
    if (unsupported.length) throw new Error(`Unsupported workspace tables prevent a complete backup: ${unsupported.join(', ')}`)
    return tables.filter(name => present.includes(name))
  }
  const rowsFor = (name: string) => db.prepare(`SELECT * FROM "${name}"`).all() as Array<Record<string, unknown>>
  const parseJson = (table: string, value: string): unknown => {
    try { return JSON.parse(value) } catch { throw new Error(`Backup contains corrupt JSON: ${table}`) }
  }
  const assertValid = <T>(schema: { safeParse(value: unknown): { success: boolean } }, value: unknown, table: string) => {
    if (!schema.safeParse(value).success) throw new Error(`Backup row violates the ${table} domain schema.`)
  }
  const validateRawBounds = (input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return
    const tablesValue = (input as Record<string, unknown>).tables
    if (!tablesValue || typeof tablesValue !== 'object' || Array.isArray(tablesValue)) return
    for (const [name, rawTable] of Object.entries(tablesValue)) {
      const maxRows = WORKSPACE_BACKUP_TABLE_ROW_LIMITS[name]
      if (maxRows === undefined) throw new Error(`Backup contains an unsupported table: ${name}`)
      if (!rawTable || typeof rawTable !== 'object' || Array.isArray(rawTable)) continue
      const table = rawTable as Record<string, unknown>
      if (!Array.isArray(table.rows)) continue
      if (table.rows.length > maxRows) throw new Error(`Backup table ${name} exceeds its ${maxRows}-row safety limit.`)
      if (typeof table.schema === 'string' && Buffer.byteLength(table.schema, 'utf8') > 64 * 1024) throw new Error(`Backup table schema ${name} exceeds its safety limit.`)
      for (const row of table.rows) {
        let encoded: string
        try { encoded = JSON.stringify(row) } catch { throw new Error(`Backup table ${name} contains an invalid row.`) }
        if (Buffer.byteLength(encoded, 'utf8') > MAX_WORKSPACE_BACKUP_ROW_BYTES) throw new Error(`Backup row ${name} exceeds the 16 MiB safety limit.`)
        if (name === 'jobs' && row && typeof row === 'object' && !Array.isArray(row)) {
          const value = (row as Record<string, unknown>).data
          if (typeof value === 'string') {
            if (Buffer.byteLength(value, 'utf8') > MAX_JOB_RECORD_UTF8_BYTES) throw new Error(`Backup job row exceeds the ${MAX_JOB_RECORD_UTF8_BYTES / (1024 * 1024)} MiB accepted-storage limit.`)
            let job: unknown
            try { job = JSON.parse(value) } catch { continue }
            if (job && typeof job === 'object' && !Array.isArray(job)) {
              const revisions = (job as Record<string, unknown>).revisions
              if (Array.isArray(revisions) && revisions.length > MAX_WORKSPACE_BACKUP_POSTING_REVISIONS) throw new Error(`Backup job posting history exceeds the ${MAX_WORKSPACE_BACKUP_POSTING_REVISIONS}-revision safety limit.`)
            }
          }
        }
      }
    }
  }
  const jsonRowExpression = (prefix: 'NEW' | 'OLD', columns: Array<{ name: string }>) => `json_object(${columns.map(column => `'${column.name}', ${prefix}."${column.name}"`).join(',')})`
  const rowBytesExpression = (prefix: 'NEW' | 'OLD', columns: Array<{ name: string }>) => `cv_workspace_backup_row_bytes(${jsonRowExpression(prefix, columns)})`
  const backupBytesFromLedger = () => {
    const state = db.prepare(`SELECT max_bytes, base_bytes, legacy_over_cap FROM ${WORKSPACE_BACKUP_STATE_TABLE} WHERE singleton=1`).get() as { max_bytes: number; base_bytes: number; legacy_over_cap: number }
    const sizes = db.prepare(`SELECT table_name, row_count, row_bytes FROM ${WORKSPACE_BACKUP_SIZE_TABLE}`).all() as Array<{ table_name: string; row_count: number; row_bytes: number }>
    const byName = new Map(sizes.map(item => [item.table_name, item]))
    const overTableLimits = Object.entries(WORKSPACE_BACKUP_TABLE_ROW_LIMITS).some(([name, maxRows]) => (byName.get(name)?.row_count ?? 0) > maxRows)
    const rowsAndSeparators = sizes.reduce((sum, item) => sum + item.row_bytes + Math.max(0, item.row_count - 1), 0)
    return { bytes: state.base_bytes + rowsAndSeparators, maxBytes: state.max_bytes, legacyOverCap: state.legacy_over_cap === 1, overTableLimits }
  }
  const installBackupAccountingTriggers = () => {
    const names = actualTables()
    const emptySnapshot = { format: 'cv-tailor-workspace-backup', version: 4 as const, createdAt: new Date().toISOString(), warning: workspaceBackupWarning, tables: Object.fromEntries(names.map(name => [name, { schema: tableSchema(name), rows: [] }])) }
    const baseBytes = Buffer.byteLength(JSON.stringify(emptySnapshot), 'utf8')
    for (const name of names) for (const suffix of ['insert', 'update', 'delete']) db.exec(`DROP TRIGGER IF EXISTS "cv_backup_${name}_${suffix}"`)
    db.prepare(`DELETE FROM ${WORKSPACE_BACKUP_SIZE_TABLE}`).run()
    const insertSize = db.prepare(`INSERT INTO ${WORKSPACE_BACKUP_SIZE_TABLE} (table_name,row_count,row_bytes) VALUES (?,?,?)`)
    for (const name of names) {
      const rows = rowsFor(name), bytes = rows.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row), 'utf8'), 0)
      insertSize.run(name, rows.length, bytes)
    }
        const capacityCheck = `SELECT CASE WHEN (SELECT legacy_over_cap FROM ${WORKSPACE_BACKUP_STATE_TABLE} WHERE singleton=1)=0 AND (SELECT base_bytes FROM ${WORKSPACE_BACKUP_STATE_TABLE} WHERE singleton=1) + (SELECT COALESCE(SUM(row_bytes + CASE WHEN row_count > 0 THEN row_count-1 ELSE 0 END),0) FROM ${WORKSPACE_BACKUP_SIZE_TABLE}) > (SELECT max_bytes FROM ${WORKSPACE_BACKUP_STATE_TABLE} WHERE singleton=1) THEN RAISE(ABORT,'WORKSPACE_BACKUP_CAPACITY') END;`
    for (const name of names) {
      const table = `"${name}"`, maxRows = WORKSPACE_BACKUP_TABLE_ROW_LIMITS[name]!, columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>
      const newJson = jsonRowExpression('NEW', columns), oldJson = jsonRowExpression('OLD', columns)
      const newBytes = rowBytesExpression('NEW', columns), oldBytes = rowBytesExpression('OLD', columns)
      const jobGuard = name === 'jobs' ? `SELECT CASE WHEN (SELECT legacy_over_cap FROM ${WORKSPACE_BACKUP_STATE_TABLE} WHERE singleton=1)=0 AND (length(CAST(NEW."data" AS BLOB)) > ${MAX_JOB_RECORD_UTF8_BYTES} OR NOT json_valid(NEW."data") OR COALESCE(json_array_length(NEW."data",'$.revisions'),0) > ${MAX_WORKSPACE_BACKUP_POSTING_REVISIONS}) THEN RAISE(ABORT,'WORKSPACE_BACKUP_JOB_LIMIT') END;` : ''
      db.exec(`CREATE TRIGGER "cv_backup_${name}_insert" AFTER INSERT ON ${table} BEGIN
        SELECT CASE WHEN (SELECT legacy_over_cap FROM ${WORKSPACE_BACKUP_STATE_TABLE} WHERE singleton=1)=0 AND ${newBytes} > ${MAX_WORKSPACE_BACKUP_ROW_BYTES} THEN RAISE(ABORT,'WORKSPACE_BACKUP_ROW_LIMIT') END;
        ${jobGuard}
        UPDATE ${WORKSPACE_BACKUP_SIZE_TABLE} SET row_count=row_count+1,row_bytes=row_bytes+${newBytes} WHERE table_name='${name}';
        SELECT CASE WHEN (SELECT legacy_over_cap FROM ${WORKSPACE_BACKUP_STATE_TABLE} WHERE singleton=1)=0 AND (SELECT row_count FROM ${WORKSPACE_BACKUP_SIZE_TABLE} WHERE table_name='${name}') > ${maxRows} THEN RAISE(ABORT,'WORKSPACE_BACKUP_TABLE_LIMIT') END;
        ${capacityCheck}
      END;
      CREATE TRIGGER "cv_backup_${name}_update" AFTER UPDATE ON ${table} BEGIN
        SELECT CASE WHEN (SELECT legacy_over_cap FROM ${WORKSPACE_BACKUP_STATE_TABLE} WHERE singleton=1)=0 AND ${newBytes} > ${MAX_WORKSPACE_BACKUP_ROW_BYTES} THEN RAISE(ABORT,'WORKSPACE_BACKUP_ROW_LIMIT') END;
        ${jobGuard}
        UPDATE ${WORKSPACE_BACKUP_SIZE_TABLE} SET row_bytes=row_bytes-${oldBytes}+${newBytes} WHERE table_name='${name}';
        ${capacityCheck}
      END;
      CREATE TRIGGER "cv_backup_${name}_delete" AFTER DELETE ON ${table} BEGIN
        UPDATE ${WORKSPACE_BACKUP_SIZE_TABLE} SET row_count=row_count-1,row_bytes=row_bytes-${oldBytes} WHERE table_name='${name}';
        ${capacityCheck}
      END;`)
    }
    const currentSnapshot = { ...emptySnapshot, tables: Object.fromEntries(names.map(name => [name, { schema: tableSchema(name), rows: rowsFor(name) }])) }
    // An over-cap label is recovery mode for valid historical data, never a blanket excuse for corrupt rows.
    for (const row of currentSnapshot.tables.jobs?.rows ?? []) {
      let parsed: unknown
      try { parsed = JSON.parse(String(row.data)) } catch { throw new Error('Workspace contains corrupt saved-job data; it was not classified as a recoverable legacy workspace.') }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Workspace contains corrupt saved-job data; it was not classified as a recoverable legacy workspace.')
      const job = structuredClone(parsed) as Record<string, unknown>
      const sanitizeText = (record: Record<string, unknown>, allowEmpty = false) => {
        if (typeof record.description !== 'string' || (!allowEmpty && !record.description.trim())) throw new Error('Workspace contains corrupt saved-job data; it was not classified as a recoverable legacy workspace.')
        record.description = 'Legacy posting text omitted for structural validation.'
      }
      sanitizeText(job)
      if (Array.isArray(job.revisions)) for (const revision of job.revisions) {
        if (!revision || typeof revision !== 'object' || Array.isArray(revision)) throw new Error('Workspace contains corrupt saved-job history; it was not classified as recoverable legacy data.')
        sanitizeText(revision as Record<string, unknown>)
      }
      if (job.sourceSnapshot && typeof job.sourceSnapshot === 'object' && !Array.isArray(job.sourceSnapshot)) sanitizeText(job.sourceSnapshot as Record<string, unknown>, true)
      if (Array.isArray(job.sourceHistory)) for (const snapshot of job.sourceHistory) {
        if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('Workspace contains corrupt saved-job history; it was not classified as recoverable legacy data.')
        sanitizeText(snapshot as Record<string, unknown>, true)
      }
      if (!jobRecordSchema.safeParse(job).success) throw new Error('Workspace contains corrupt saved-job data; it was not classified as a recoverable legacy workspace.')
    }
    let legacyOverCap = false
    try { validateRawBounds(currentSnapshot) } catch { legacyOverCap = true }
    const snapshotBytes = Buffer.byteLength(JSON.stringify(currentSnapshot), 'utf8')
    const rowBytesAndSeparators = (db.prepare(`SELECT COALESCE(SUM(row_bytes + CASE WHEN row_count > 0 THEN row_count-1 ELSE 0 END),0) AS value FROM ${WORKSPACE_BACKUP_SIZE_TABLE}`).get() as { value: number }).value
    const calibratedBaseBytes = snapshotBytes - rowBytesAndSeparators
    db.prepare(`UPDATE ${WORKSPACE_BACKUP_STATE_TABLE} SET max_bytes=?,base_bytes=?,legacy_over_cap=? WHERE singleton=1`).run(maxBackupBytes, calibratedBaseBytes, legacyOverCap ? 1 : 0)
    const bytes = backupBytesFromLedger().bytes
    if (bytes !== snapshotBytes) throw new Error(`Workspace backup byte ledger is inconsistent with stored rows (${bytes} accounted, ${snapshotBytes} serialized).`)
    if (bytes > maxBackupBytes) { legacyOverCap = true; db.prepare(`UPDATE ${WORKSPACE_BACKUP_STATE_TABLE} SET legacy_over_cap=1 WHERE singleton=1`).run() }
    if (actualTables().some(name => (db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get() as { count: number }).count > WORKSPACE_BACKUP_TABLE_ROW_LIMITS[name]!)) { legacyOverCap = true; db.prepare(`UPDATE ${WORKSPACE_BACKUP_STATE_TABLE} SET legacy_over_cap=1 WHERE singleton=1`).run() }
  }
  installBackupAccountingTriggers()
  const buildSnapshot = () => {
    const names = actualTables()
    const tables = Object.fromEntries(names.map(name => {
      const maxRows = WORKSPACE_BACKUP_TABLE_ROW_LIMITS[name]!
      const count = (db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get() as { count: number }).count
      if (count > maxRows) throw new Error(`Workspace table ${name} exceeds its ${maxRows}-row backup safety limit.`)
      return [name, { schema: tableSchema(name), rows: rowsFor(name) }]
    }))
    const snapshot = { format: 'cv-tailor-workspace-backup', version: 4 as const, createdAt: new Date().toISOString(), warning: workspaceBackupWarning, tables }
    validateRawBounds(snapshot)
    const encoded = JSON.stringify(snapshot)
    if (Buffer.byteLength(encoded, 'utf8') > maxBackupBytes) throw new Error(`Backup exceeds the ${Math.round(maxBackupBytes / (1024 * 1024))} MiB workspace safety limit.`)
    return { snapshot, encoded }
  }
  const validateDomainRows = (backup: ReturnType<typeof workspaceBackupSchema.parse>) => {
    const rows = backup.tables
    const fail = (table: string): never => { throw new Error(`Backup row violates the ${table} domain schema.`) }
    for (const row of rows.settings?.rows ?? []) {
      const allowed = ['appearance', 'openrouter-model', 'faithfulness-check', 'analysis-budgets', 'pi-model']
      if (!allowed.includes(String(row.key))) fail('settings')
      if (row.key === 'appearance' && !appearanceSchema.safeParse(row.value).success) fail('settings')
      if (row.key === 'openrouter-model' && !openRouterModelSchema.safeParse(row.value).success) fail('settings')
      if (row.key === 'faithfulness-check' && row.value !== 'true' && row.value !== 'false') fail('settings')
      if (row.key === 'analysis-budgets') assertValid(analysisBudgetsSchema, parseJson('settings', row.value as string), 'settings')
      if (row.key === 'pi-model') assertValid(piModelSelectionSchema, parseJson('settings', row.value as string), 'settings')
    }
    for (const row of rows.profile_contact?.rows ?? []) { const data = parseJson('profile_contact', row.data as string); assertValid(contactRecordSchema, data, 'profile_contact'); if ((data as { id: string }).id !== row.id || (data as { revision: number }).revision !== row.revision || row.singleton !== 1) fail('profile_contact') }
    for (const row of rows.profile_skills?.rows ?? []) { const data = parseJson('profile_skills', row.data as string); assertValid(skillRecordSchema, data, 'profile_skills'); if ((data as { id: string }).id !== row.id || (data as { revision: number }).revision !== row.revision) fail('profile_skills') }
    for (const row of rows.profile_entries?.rows ?? []) { const data = parseJson('profile_entries', row.data as string); assertValid(profileEntrySchema, data, 'profile_entries'); if ((data as { id: string }).id !== row.id || (data as { revision: number }).revision !== row.revision || (data as { section: string }).section !== row.section) fail('profile_entries') }
    for (const [table, schema] of [['profile_experience', experienceRecordSchema], ['profile_projects', projectRecordSchema]] as const) for (const row of rows[table]?.rows ?? []) { const data = parseJson(table, row.data as string); assertValid(schema, data, table); if ((data as { id: string }).id !== row.id || (data as { revision: number }).revision !== row.revision) fail(table) }
    for (const row of rows.evidence_revisions?.rows ?? []) { assertValid(evidenceRevisionSchema, { id: row.id, revision: row.revision, action: row.action, snapshot: parseJson('evidence_revisions', row.snapshot as string), createdAt: row.created_at }, 'evidence_revisions') }
    const evidence = (rows.evidence_revisions?.rows ?? []).map(row => ({ id: String(row.id), revision: Number(row.revision), snapshot: parseJson('evidence_revisions', row.snapshot as string) as Record<string, unknown> }))
    const revisions = new Set(evidence.map(row => `${row.id}:${row.revision}`))
    const isRecord = (snapshot: Record<string, unknown>, key: string) => Array.isArray(snapshot[key])
    const ownerFieldMatches = (ownerId: string, ownerRevision: number, field: string) => {
      const revision = evidence.find(item => item.id === ownerId && item.revision === ownerRevision)
      if (!revision) return false
      const snapshot = revision.snapshot
      if (field.startsWith('contact.')) {
        const property = field.slice('contact.'.length)
        return 'fullName' in snapshot && ['fullName', 'headline', 'email', 'phone', 'location', 'links'].includes(property) && Object.hasOwn(snapshot, property) && (property !== 'links' || (Array.isArray(snapshot.links) && snapshot.links.length > 0))
      }
      if (field.startsWith('skills.')) return 'category' in snapshot && typeof snapshot.name === 'string' && field === `skills.${snapshot.name}`
      if (field === 'experience.role' || field === 'experience.role.date') return 'organization' in snapshot && 'kind' in snapshot && 'title' in snapshot
      if (field === 'projects.project' || field === 'projects.links') return typeof snapshot.name === 'string' && isRecord(snapshot, 'factualItems') && isRecord(snapshot, 'technologies') && (field !== 'projects.links' || (Array.isArray(snapshot.links) && snapshot.links.length > 0))
      const nestedParentContains = (parentField: 'factualItems' | 'technologies', parentType: 'experience' | 'project') => evidence.some(item => {
        const parent = item.snapshot
        const children = parent[parentField]
        const matchingType = parentType === 'experience' ? 'kind' in parent && !('technologies' in parent) : 'technologies' in parent
        return Array.isArray(children) && matchingType && children.some(child => child && typeof child === 'object' && 'id' in child && 'revision' in child && (child as { id: unknown }).id === ownerId && (child as { revision: unknown }).revision === ownerRevision)
      })
      if (field === 'experience.factualItem') return 'text' in snapshot && nestedParentContains('factualItems', 'experience') && evidence.some(item => item.id === ownerId && item.revision === ownerRevision && 'text' in item.snapshot)
      if (field === 'projects.factualItem') return 'text' in snapshot && nestedParentContains('factualItems', 'project') && evidence.some(item => item.id === ownerId && item.revision === ownerRevision && 'text' in item.snapshot)
      if (field === 'projects.technology') return 'text' in snapshot && nestedParentContains('technologies', 'project') && evidence.some(item => item.id === ownerId && item.revision === ownerRevision && 'text' in item.snapshot)
      const entryField = field.match(/^entries\.(education|certificates|summary|languages|extras)(?:\.(date|year|institution|description|link))?$/)
      if (entryField) {
        if (snapshot.section !== entryField[1]) return false
        const property = entryField[2]
        if (!property) return true
        if (property === 'date') return entryField[1] === 'education'
        if (property === 'year') return entryField[1] === 'certificates' && Number.isInteger(snapshot.year)
        if (property === 'link') return entryField[1] === 'certificates' && typeof snapshot.link === 'string'
        return entryField[1] === 'education' && typeof snapshot[property] === 'string'
      }
      return false
    }
    for (const row of rows.profile_import_provenance?.rows ?? []) {
      if (!uuidSchema.safeParse(row.owner_id).success || !Number.isInteger(row.owner_revision) || Number(row.owner_revision) < 1 || typeof row.field !== 'string' || !row.field || !/^[a-f0-9]{64}$/.test(String(row.source_hash)) || !Number.isInteger(row.page) || Number(row.page) < 1 || typeof row.passage !== 'string' || !row.passage || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at)) || !revisions.has(`${row.owner_id}:${row.owner_revision}`) || !ownerFieldMatches(String(row.owner_id), Number(row.owner_revision), row.field)) fail('profile_import_provenance')
    }
    for (const row of rows.jobs?.rows ?? []) { const data = parseJson('jobs', row.data as string); assertValid(jobRecordSchema, data, 'jobs'); if ((data as { id: string }).id !== row.id || (data as { createdAt: string }).createdAt !== row.created_at || (data as { updatedAt: string }).updatedAt !== row.updated_at) fail('jobs') }
    for (const row of rows.draft_revisions?.rows ?? []) { const data = parseJson('draft_revisions', row.data as string); assertValid(draftRevisionSchema, data, 'draft_revisions'); if ((data as { id: string }).id !== row.id || (data as { jobId: string }).jobId !== row.job_id || (data as { revision: number }).revision !== row.revision) fail('draft_revisions') }
    for (const row of rows.regeneration_proposals?.rows ?? []) { const data = parseJson('regeneration_proposals', row.data as string); assertValid(regenerationProposalSchema, data, 'regeneration_proposals'); if ((data as { id: string }).id !== row.id || (data as { jobId: string }).jobId !== row.job_id || (data as { status: string }).status !== row.status) fail('regeneration_proposals') }
    for (const row of rows.posting_analysis_cache?.rows ?? []) assertValid(postingAnalysisSchema, parseJson('posting_analysis_cache', row.data as string), 'posting_analysis_cache')
    for (const row of rows.analysis_run_state?.rows ?? []) { const data = parseJson('analysis_run_state', row.data as string); assertValid(analysisResultSchema, data, 'analysis_run_state'); if ((data as { jobId: string }).jobId !== row.job_id || (data as { runId?: string }).runId !== row.run_id) fail('analysis_run_state') }
    for (const row of rows.generation_recovery?.rows ?? []) { const data = parseJson('generation_recovery', row.snapshot as string); assertValid(generationRecoverySnapshotSchema, data, 'generation_recovery'); if ((data as { runId: string }).runId !== row.run_id || (data as { jobId: string }).jobId !== row.job_id || (data as { consentId: string }).consentId !== row.consent_id || (data as { scopeHash: string }).scopeHash !== row.scope_hash) fail('generation_recovery') }
    for (const row of rows.document_fit_reports?.rows ?? []) assertValid(documentFitReportSchema, parseJson('document_fit_reports', row.data as string), 'document_fit_reports')
    for (const row of rows.cover_letter_revisions?.rows ?? []) {
      const data = parseJson('cover_letter_revisions', row.data as string)
      assertValid(coverLetterRevisionSchema, data, 'cover_letter_revisions')
      if ((data as { id: string }).id !== row.id || (data as { jobId: string }).jobId !== row.job_id || (data as { revision: number }).revision !== row.revision) fail('cover_letter_revisions')
    }
    const operationRecords = new Map<string, ReturnType<typeof coverLetterOperationSchema.parse>>()
    for (const row of rows.cover_letter_operations?.rows ?? []) {
      const data = parseJson('cover_letter_operations', row.data as string)
      assertValid(coverLetterOperationSchema, data, 'cover_letter_operations')
      const operation = data as ReturnType<typeof coverLetterOperationSchema.parse>
      if (operation.id !== row.id || operation.jobId !== row.job_id || operation.parentRunId !== row.parent_run_id || operation.consentId !== row.consent_id || operation.status !== row.status || operation.createdAt !== row.created_at || operation.updatedAt !== row.updated_at) fail('cover_letter_operations')
      operationRecords.set(operation.id, operation)
    }
    const consentRecords = new Map((rows.outbound_consents?.rows ?? []).map(row => [String(row.id), row]))
    for (const row of rows.cover_letter_operations?.rows ?? []) {
      const operation = operationRecords.get(String(row.id))!
      const consent = consentRecords.get(operation.consentId)
      if (!consent || consent.run_id !== operation.parentRunId || consent.job_id !== operation.jobId || consent.purpose === 'cv' || consent.purpose_hash !== operation.purposeHash) fail('cover_letter_operations')
    }
    const draftOwners = new Map((rows.draft_revisions?.rows ?? []).map(row => [String(row.id), String(row.job_id)]))
    for (const row of rows.cover_letter_revisions?.rows ?? []) {
      const letter = coverLetterRevisionSchema.parse(parseJson('cover_letter_revisions', row.data as string))
      const operation = operationRecords.get(letter.operationId)
      if (!operation || operation.jobId !== letter.jobId || operation.parentRunId !== letter.parentRunId || operation.status !== 'saved' || draftOwners.get(letter.cvRevisionId) !== letter.jobId) fail('cover_letter_revisions')
    }
    for (const row of rows.outbound_consents?.rows ?? []) {
      const purpose = coverLetterPurposeSchema.safeParse(row.purpose)
      const expected = typeof row.scope_hash === 'string' && purpose.success ? hash(JSON.stringify({ version: 1, scopeHash: row.scope_hash, purpose: purpose.data })) : ''
      if (row.purpose_version !== 1 || !purpose.success || row.purpose_hash !== expected) fail('outbound_consents')
    }
    for (const table of ['outbound_consents','analysis_attempts','provider_attempt_outcomes','generation_recovery_extensions'] as const) for (const row of rows[table]?.rows ?? []) {
      const runId = row.run_id
      const profileImportRun = (table === 'analysis_attempts' || table === 'provider_attempt_outcomes') && typeof runId === 'string' && runId.startsWith('profile-import:') && uuidSchema.safeParse(runId.slice('profile-import:'.length)).success
      if (runId !== undefined && !uuidSchema.safeParse(runId).success && !profileImportRun) fail(table)
      for (const key of ['created_at','attempted_at','dispatched_at','settled_at','checkpointed_at','recorded_at','updated_at']) if (row[key] !== null && row[key] !== undefined && typeof row[key] === 'string' && !Number.isFinite(Date.parse(row[key] as string))) fail(table)
    }
    const jobs = new Set((rows.jobs?.rows ?? []).map(row => row.id))
    for (const row of rows.outbound_consents?.rows ?? []) if (row.job_id !== null && row.job_id !== undefined && !jobs.has(row.job_id)) fail('outbound_consents')
    for (const table of ['draft_revisions','regeneration_proposals','document_fit_reports','cover_letter_revisions','cover_letter_operations','posting_analysis_cache','analysis_run_state','generation_recovery'] as const) for (const row of rows[table]?.rows ?? []) if (!jobs.has(row.job_id)) fail(table)
  }
  const workspaceFingerprint = () => JSON.stringify({
    tables: Object.fromEntries(actualTables().map(name => [name, { schema: tableSchema(name), rows: rowsFor(name) }])),
    credentialsDigest: db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='encrypted_credentials'").get()
      ? hash(JSON.stringify(rowsFor('encrypted_credentials'))) : null
  })
  const createBackup = () => {
    const { encoded } = buildSnapshot()
    validate(encoded)
    if (backupBytesFromLedger().bytes !== Buffer.byteLength(encoded, 'utf8')) throw new Error('Workspace backup size accounting is inconsistent with the stored rows.')
    return encoded
  }
  const validate = (text: string) => {
    if (Buffer.byteLength(text, 'utf8') > maxBackupBytes) throw new Error(`Backup exceeds the ${Math.round(maxBackupBytes / (1024 * 1024))} MiB workspace safety limit.`)
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { throw new Error('Backup is invalid or incompatible.') }
    validateRawBounds(parsed)
    const result = workspaceBackupSchema.safeParse(parsed)
    if (!result.success) throw new Error('Backup is invalid or incompatible.')
    let backup = result.data
    const incomingVersion = backup.version
    const consentTable = backup.tables.outbound_consents
    const migrationVersions = backup.tables.schema_migrations?.rows.map(row => Number(row.version)).sort((a, b) => a - b)
    const oldConsentSchema = legacyV3TableSchemas.outbound_consents
    const preOwnershipConsentSchema = oldConsentSchema.replace(', job_id TEXT)', ')')
    const oldConsentColumns = ['id', 'run_id', 'scope_hash', 'created_at', 'revoked']
    const preOwnershipConsentColumns = [...oldConsentColumns, 'job_id']
    const hasMigration10 = migrationVersions?.includes(10) ?? false
    const hasMigration11 = migrationVersions?.includes(11) ?? false
    if (incomingVersion <= 3 && consentTable) {
      const allowedLegacy = [
        { schema: oldConsentSchema, rowColumns: [preOwnershipConsentColumns] },
        { schema: preOwnershipConsentSchema, rowColumns: [oldConsentColumns, preOwnershipConsentColumns] },
      ]
      const legacyShape = allowedLegacy.find(candidate => candidate.schema === consentTable.schema)
      const currentPurposeShape = consentTable.schema === tableSchema('outbound_consents') && hasMigration10 && hasMigration11
      if (!legacyShape && !currentPurposeShape) throw new Error('Backup legacy consent schema is incompatible.')
      if (legacyShape && ((incomingVersion === 3 && hasMigration10 !== (legacyShape.schema === oldConsentSchema)) || consentTable.rows.some(row => !legacyShape.rowColumns.some(columns => JSON.stringify(Object.keys(row).sort()) === JSON.stringify([...columns].sort()))))) throw new Error('Backup legacy consent rows or migration history are incompatible.')
    }
    if (incomingVersion === 3) {
      const names = Object.keys(backup.tables).sort()
      const expectedNames = Object.keys(legacyV3TableSchemas).sort()
      const versions = migrationVersions
      const acceptedLedgers = [[1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 5, 6, 7, 8, 10], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]
      if (JSON.stringify(names) !== JSON.stringify(expectedNames) || !versions || !acceptedLedgers.some(ledger => JSON.stringify(ledger) === JSON.stringify(versions))) throw new Error('Backup v3 inventory or migration history is incompatible.')
      const legacy = new Database(':memory:')
      try {
        for (const name of expectedNames) {
          const item = backup.tables[name]
          const acceptedSchemas = name === 'outbound_consents' && !hasMigration10 ? [preOwnershipConsentSchema] : [legacyV3TableSchemas[name]]
          if (!acceptedSchemas.includes(item.schema)) throw new Error(`Backup v3 schema is incompatible: ${name}`)
          legacy.exec(item.schema)
          const columns = (legacy.pragma(`table_info("${name}")`) as Array<{ name: string }>).map(column => column.name).sort()
          const acceptedRowColumns = name === 'outbound_consents' && !hasMigration10 ? [columns, preOwnershipConsentColumns.slice().sort()] : [columns]
          for (const row of item.rows) if (!acceptedRowColumns.some(expected => JSON.stringify(Object.keys(row).sort()) === JSON.stringify(expected))) throw new Error(`Backup v3 row columns are incompatible: ${name}`)
        }
      } finally { legacy.close() }
    }
    // Version-1 was the released workspace representation before posting provenance/revisions.
    // Upgrade only this known shape in memory; leave the supplied file and live workspace untouched.
    if (backup.version === 1) {
      const upgraded = structuredClone(backup) as typeof backup
      const jobs = upgraded.tables.jobs
      if (!jobs) throw new Error('Backup is invalid or incompatible with this workspace schema.')
      for (const row of jobs.rows) {
        let oldJob: unknown
        try { oldJob = JSON.parse(String(row.data)) } catch { throw new Error('Backup contains corrupt JSON: jobs') }
        if (!oldJob || typeof oldJob !== 'object' || Array.isArray(oldJob)) throw new Error('Backup row violates the jobs domain schema.')
        const value = oldJob as Record<string, unknown>
        const knownLegacy = ['id', 'title', 'company', 'description', 'createdAt', 'updatedAt']
        if (Object.keys(value).some(key => !knownLegacy.includes(key))) throw new Error('Backup row violates the jobs domain schema.')
        row.data = JSON.stringify({ ...value, provenance: 'legacy-unknown', sourceSnapshot: null, revisions: [] })
      }
      upgraded.version = 2
      backup = upgraded
    }
    if (backup.version === 2) {
      const upgraded = structuredClone(backup) as typeof backup
      const jobs = upgraded.tables.jobs
      if (!jobs) throw new Error('Backup is invalid or incompatible with this workspace schema.')
      for (const row of jobs.rows) {
        let rawJob: unknown
        try { rawJob = JSON.parse(String(row.data)) } catch { throw new Error('Backup contains corrupt JSON: jobs') }
        const oldJob = releasedV2JobRecordSchema.safeParse(rawJob)
        if (!oldJob.success) throw new Error('Backup row violates the released v2 jobs domain schema.')
        const emptyDetails = emptyPostingOptionalDetails()
        const value = oldJob.data
        const upgradeSnapshot = (snapshot: typeof value.sourceSnapshot) => snapshot ? { ...snapshot, optionalDetails: emptyDetails, conflicts: [], fieldOrigins: { ...snapshot.fieldOrigins, optionalDetails: {} } } : null
        row.data = JSON.stringify({ ...value, optionalDetails: emptyDetails, revisions: value.revisions.map(revision => ({ ...revision, optionalDetails: emptyDetails })), sourceSnapshot: upgradeSnapshot(value.sourceSnapshot), sourceHistory: value.sourceHistory.map(snapshot => upgradeSnapshot(snapshot)) })
      }
      upgraded.version = 3
      backup = upgraded
    }
    // Earlier released workspaces may not have the CV import provenance relation.
    if (!backup.tables.profile_import_provenance && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='profile_import_provenance'").get()) {
      const upgraded = structuredClone(backup) as typeof backup
      upgraded.tables.profile_import_provenance = { schema: tableSchema('profile_import_provenance'), rows: [] }
      if (upgraded.tables.schema_migrations && !upgraded.tables.schema_migrations.rows.some(row => row.version === 6)) upgraded.tables.schema_migrations.rows.push({ version: 6 })
      backup = upgraded
    }
    if (backup.tables.schema_migrations && !backup.tables.schema_migrations.rows.some(row => row.version === 7)) {
      const upgraded = structuredClone(backup) as typeof backup
      upgraded.tables.schema_migrations!.rows.push({ version: 7 })
      backup = upgraded
    }
    if (backup.tables.schema_migrations) {
      const upgraded = structuredClone(backup) as typeof backup
      const jobs = new Map((upgraded.tables.jobs?.rows ?? []).map(row => {
        const job = jobRecordSchema.parse(parseJson('jobs', String(row.data)))
        return [job.id, legacyDraftTargetBaseline(job)] as const
      }))
      for (const row of upgraded.tables.draft_revisions?.rows ?? []) {
        const stored = parseJson('draft_revisions', String(row.data)) as Record<string, unknown>
        if (typeof stored.targetPostingUpdatedAt === 'string') continue
        if (!jobs.has(String(row.job_id))) throw new Error('A legacy CV draft has no saved-job target to bind.')
        const baseline = jobs.get(String(row.job_id))
        if (!baseline) continue
        row.data = JSON.stringify(draftRevisionSchema.parse({ ...stored, pageTarget: stored.pageTarget ?? 1, targetPostingUpdatedAt: baseline }))
      }
      if (!upgraded.tables.schema_migrations!.rows.some(row => row.version === 8)) upgraded.tables.schema_migrations!.rows.push({ version: 8 })
      backup = upgraded
    }
    if (backup.tables.schema_migrations && rowsFor('schema_migrations').some(row => row.version === 9)) {
      const upgraded = structuredClone(backup) as typeof backup
      upgraded.tables.schema_migrations!.rows = upgraded.tables.schema_migrations!.rows.filter(row => row.version !== 9)
      upgraded.tables.schema_migrations!.rows.push({ version: 9 })
      if (upgraded.tables.settings) upgraded.tables.settings.rows = upgraded.tables.settings.rows.filter(row => row.key !== 'openrouter-model' && row.key !== 'analysis-budgets')
      backup = upgraded
    }
    if (backup.tables.outbound_consents && backup.tables.schema_migrations && !backup.tables.schema_migrations.rows.some(row => row.version === 10)) {
      const upgraded = structuredClone(backup) as typeof backup
      const owners = new Map<string, string>()
      for (const name of ['generation_recovery', 'analysis_run_state', 'posting_analysis_cache'] as const) {
        for (const row of upgraded.tables[name]?.rows ?? []) owners.set(String(row.run_id), String(row.job_id))
      }
      upgraded.tables.outbound_consents!.schema = tableSchema('outbound_consents')
      for (const row of upgraded.tables.outbound_consents!.rows) {
        row.job_id = owners.get(String(row.run_id)) ?? null
        row.purpose_version = 1
        row.purpose = 'cv'
        row.purpose_hash = hash(JSON.stringify({ version: 1, scopeHash: row.scope_hash, purpose: 'cv' }))
      }
      upgraded.tables.schema_migrations!.rows.push({ version: 10 })
      backup = upgraded
    }
    if (backup.tables.outbound_consents && backup.tables.schema_migrations && !backup.tables.schema_migrations.rows.some(row => row.version === 11)) {
      const upgraded = structuredClone(backup) as typeof backup
      const table = upgraded.tables.outbound_consents!
      const legacySchema = 'CREATE TABLE outbound_consents (id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, scope_hash TEXT NOT NULL, created_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, job_id TEXT)'
      const expectedLegacyColumns = ['id', 'run_id', 'scope_hash', 'created_at', 'revoked', 'job_id']
      const expectedVersions = [1, 2, 3, 4, 5, 6, 7, 8, ...(rowsFor('schema_migrations').some(row => row.version === 9) ? [9] : []), 10]
      const versions = upgraded.tables.schema_migrations!.rows.map(row => row.version).sort((a, b) => Number(a) - Number(b))
      const currentConsentSchema = tableSchema('outbound_consents')
      if ((table.schema !== legacySchema && table.schema !== currentConsentSchema) || JSON.stringify(versions) !== JSON.stringify(expectedVersions)) throw new Error('Backup migration history or consent schema is incompatible.')
      const legacyHash = (scopeHash: string) => hash(JSON.stringify({ version: 1, scopeHash, purpose: 'cv' }))
      for (const row of table.rows) {
        if (typeof row.scope_hash !== 'string' || !/^[a-f0-9]{64}$/.test(row.scope_hash)) throw new Error('Backup legacy consent row is incompatible.')
        if (table.schema === legacySchema) {
          if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...expectedLegacyColumns].sort())) throw new Error('Backup legacy consent row is incompatible.')
          row.purpose_version = 1
          row.purpose = 'cv'
          row.purpose_hash = legacyHash(row.scope_hash)
        } else if (row.purpose_version !== 1 || row.purpose !== 'cv' || row.purpose_hash !== legacyHash(row.scope_hash)) throw new Error('Backup legacy consent purpose is incompatible.')
      }
      table.schema = currentConsentSchema
      upgraded.tables.schema_migrations!.rows.push({ version: 11 })
      backup = upgraded
    }
    if (backup.tables.schema_migrations && !backup.tables.schema_migrations.rows.some(row => row.version === 12)) {
      const upgraded = structuredClone(backup) as typeof backup
      for (const name of ['cover_letter_revisions', 'cover_letter_operations'] as const) {
        if (upgraded.tables[name]) throw new Error(`Backup contains an unexpected legacy table: ${name}`)
        upgraded.tables[name] = { schema: tableSchema(name), rows: [] }
      }
      upgraded.tables.schema_migrations!.rows.push({ version: 12 })
      upgraded.version = 4
      backup = upgraded
    } else if (backup.tables.schema_migrations?.rows.some(row => row.version === 12)) {
      backup.version = 4
    }
    for (const row of backup.tables.cover_letter_revisions?.rows ?? []) {
      const letter = coverLetterRevisionSchema.parse(parseJson('cover_letter_revisions', String(row.data)))
      const { fit: _fit, approvedAt: _approvedAt, ...reviewed } = letter
      row.data = JSON.stringify({ ...reviewed, acknowledgments: {}, approved: false })
    }
    const expected = actualTables().sort()
    const names = Object.keys(backup.tables).sort()
    if (names.length !== expected.length || names.some((name, i) => name !== expected[i])) throw new Error('Backup is invalid or incompatible with this workspace schema.')
    for (const name of names) {
      const item = backup.tables[name] as TableBackup
      if (item.schema !== tableSchema(name)) throw new Error(`Backup schema is incompatible: ${name}`)
      const columns = db.pragma(`table_info("${name}")`) as Array<{ name: string }>
      for (const row of item.rows) {
        if (Object.keys(row).length !== columns.length || columns.some(column => !Object.hasOwn(row, column.name))) throw new Error(`Backup row is invalid: ${name}`)
        for (const [key, value] of Object.entries(row)) {
          if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error(`Backup row is invalid: ${name}.${key}`)
          if (typeof value === 'string' && (['data', 'snapshot', 'metadata', 'checkpoint'].includes(key) || (name === 'langgraph_checkpoint_writes' && key === 'value'))) {
            try { JSON.parse(value) } catch { throw new Error(`Backup contains corrupt JSON: ${name}.${key}`) }
          }
        }
      }
    }
    validateDomainRows(backup)
    // The migration ledger determines how this schema is interpreted after reopening. A candidate
    // with missing or invented migration versions could replay migrations against already-restored rows.
    if (backup.tables.schema_migrations) {
      const versions = backup.tables.schema_migrations.rows.map(row => row.version).sort()
      const currentVersions = rowsFor('schema_migrations').map(row => row.version).sort()
      if (JSON.stringify(versions) !== JSON.stringify(currentVersions)) throw new Error('Backup migration history is incompatible with this workspace.')
    }
    // Replay the candidate rows into an isolated schema clone to exercise SQLite primary keys,
    // uniqueness and CHECK constraints before any live transaction can begin.
    const clone = new Database(':memory:')
    try {
      for (const name of names) clone.exec(tableSchema(name))
      for (const name of names) {
        const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(name) as Array<{ sql: string }>
        for (const index of indexes) clone.exec(index.sql)
      }
      for (const name of names) {
        const cols = db.pragma(`table_info("${name}")`) as Array<{ name: string }>
        const insert = clone.prepare(`INSERT INTO "${name}" (${cols.map(c => `"${c.name}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
        for (const row of backup.tables[name]!.rows) insert.run(...cols.map(c => row[c.name] as never))
      }
    } catch { throw new Error('Backup contains invalid, duplicate, or incompatible table rows.') }
    finally { clone.close() }
    return backup
  }
  return {
    readBackupStatus() {
      const state = backupBytesFromLedger()
      return { backupable: !state.legacyOverCap && !state.overTableLimits && state.bytes <= state.maxBytes, legacyOverCap: state.legacyOverCap, bytes: state.bytes, maxBytes: state.maxBytes }
    },
    assertBackupCapacity(previousBytes) {
      const state = backupBytesFromLedger()
      if (state.legacyOverCap) {
        if (previousBytes !== undefined && state.bytes < previousBytes) {
          if (state.bytes <= state.maxBytes) {
            try { buildSnapshot(); db.prepare(`UPDATE ${WORKSPACE_BACKUP_STATE_TABLE} SET legacy_over_cap=0 WHERE singleton=1`).run() }
            catch { /* Keep the legacy read-only recovery mode until every backup limit is met. */ }
          }
          return
        }
        throw new WorkspaceBackupCapacityError(`This legacy workspace exceeds current backup limits. Only a transaction that reduces its stored backup size is allowed; no history was removed.`)
      }
      try {
        if (state.overTableLimits) throw new Error('A workspace table exceeds its row count limit.')
        if (state.bytes > state.maxBytes) throw new Error(`Backup exceeds the ${Math.round(state.maxBytes / (1024 * 1024))} MiB workspace safety limit.`)
      } catch (error) {
        if (error instanceof WorkspaceBackupCapacityError) throw error
        const detail = error instanceof Error ? error.message : 'backup validation failed'
        throw new WorkspaceBackupCapacityError(`The workspace change would exceed a backup safety limit (${detail}). Nothing was changed and no existing history was deleted.`)
      }
    },
    createBackup,
    previewRestore(input) {
      const backup = validate(input)
      const token = randomUUID()
      pending.set(token, { input: backup, token })
      const rowCounts = Object.fromEntries(Object.keys(backup.tables).map(name => [name, { current: rowsFor(name).length, restored: backup.tables[name]!.rows.length }]))
      return { token, warning: workspaceBackupWarning, replaceTables: Object.keys(backup.tables), rowCounts, credentialsRemoved: Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='encrypted_credentials'").get()), consentInvalidated: true, automaticRunsResumed: false }
    },
    applyRestore(token, writeAndVerifySafetyBackup) {
      const prepared = pending.get(token)
      if (!prepared) throw new Error('Restore preview is missing, expired, or cancelled.')
      pending.delete(token)
      const safety = createBackup()
      const beforeSafetyWrite = workspaceFingerprint()
      const written = writeAndVerifySafetyBackup(safety)
      if (typeof written !== 'string' || hash(written) !== hash(safety)) throw new Error('Safety backup could not be verified; workspace was not changed.')
      if (workspaceFingerprint() !== beforeSafetyWrite) throw new Error('Workspace changed while the safety backup was being written; restore was not applied.')
      // Revalidate after potentially slow external I/O and before entering the replacement transaction.
      validate(JSON.stringify(prepared.input))
      const transaction = db.transaction(() => {
        // Autoincrement sequence state is SQLite-internal (not exported); inserting restored IDs
        // advances sqlite_sequence as needed, while a pre-existing higher sequence may stay higher.
        const names = actualTables()
        for (const name of names) db.exec(`DELETE FROM "${name}"`)
        for (const name of names) {
          const rows = prepared.input.tables[name]!.rows
          if (!rows.length) continue
          const columns = db.pragma(`table_info("${name}")`) as Array<{ name: string }>
          const quoted = columns.map(column => `"${column.name}"`).join(',')
          const insert = db.prepare(`INSERT INTO "${name}" (${quoted}) VALUES (${columns.map(() => '?').join(',')})`)
          for (const row of rows) insert.run(...columns.map(column => row[column.name] as never))
        }
        // The restored history remains inspectable, but old authorizations and paused work cannot run.
        if (names.includes('settings') && names.includes('schema_migrations') && db.prepare('SELECT 1 FROM schema_migrations WHERE version=9').get()) db.exec("DELETE FROM settings WHERE key IN ('openrouter-model','analysis-budgets')")
        if (names.includes('settings')) db.exec("DELETE FROM settings WHERE key='faithfulness-check'")
        if (names.includes('outbound_consents')) db.exec('UPDATE outbound_consents SET revoked=1')
        if (names.includes('generation_recovery')) db.exec("UPDATE generation_recovery SET status='cancelled' WHERE status IN ('running','paused')")
        if (names.includes('cover_letter_operations')) {
          const operations = db.prepare("SELECT id,data,status FROM cover_letter_operations WHERE status IN ('prepared','dispatched')").all() as Array<{ id: string; data: string; status: string }>
          const update = db.prepare('UPDATE cover_letter_operations SET status=?,data=?,updated_at=? WHERE id=?')
          const now = new Date().toISOString()
          for (const row of operations) {
            const operation = coverLetterOperationSchema.parse(JSON.parse(row.data))
            const status = row.status === 'dispatched' ? 'uncertain' : 'cancelled'
            update.run(status, JSON.stringify({ ...operation, status, updatedAt: now }), now, row.id)
          }
        }
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='encrypted_credentials'").get()) db.exec('DELETE FROM encrypted_credentials')
      })
      transaction()
    },
    cancelRestore(token) { return pending.delete(token) }
  }
}
