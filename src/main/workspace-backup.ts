import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { MAX_WORKSPACE_BACKUP_BYTES, MAX_WORKSPACE_BACKUP_POSTING_REVISIONS, MAX_WORKSPACE_BACKUP_ROW_BYTES, WORKSPACE_BACKUP_SIZE_TABLE, WORKSPACE_BACKUP_STATE_TABLE, WORKSPACE_BACKUP_TABLE_ROW_LIMITS, workspaceBackupSchema, workspaceBackupWarning, type WorkspaceBackupEngine, type WorkspaceRestorePreview } from '../shared/workspace-backup'
import { contactRecordSchema, skillRecordSchema, profileEntrySchema, evidenceRevisionSchema, uuidSchema } from '../shared/profile'
import { experienceRecordSchema, projectRecordSchema } from '../shared/experience'
import { jobRecordSchema, MAX_JOB_RECORD_UTF8_BYTES, legacyDraftTargetBaseline } from '../shared/jobs'
import { draftRevisionSchema } from '../shared/draft'
import { analysisResultSchema, analysisBudgetsSchema, postingAnalysisSchema } from '../shared/posting-analysis'
import { regenerationProposalSchema } from '../shared/regeneration'
import { generationRecoverySnapshotSchema } from '../shared/generation-recovery'
import { documentFitReportSchema } from '../shared/document'
import { appearanceSchema } from '../shared/appearance'
import { openRouterModelSchema } from '../shared/openrouter-settings'

// Keep this explicit: credentials are never serialized; all workspace persistence tables, including
// migrations and LangGraph checkpoints, are represented in the versioned format.
const tables = [
  'schema_migrations', 'settings', 'profile_contact', 'profile_skills', 'profile_entries', 'evidence_revisions', 'profile_import_provenance',
  'profile_experience', 'profile_projects', 'jobs', 'outbound_consents', 'posting_analysis_cache',
  'analysis_run_state', 'analysis_attempts', 'provider_attempt_outcomes', 'generation_recovery',
  'generation_recovery_extensions', 'draft_revisions', 'regeneration_proposals', 'document_fit_reports',
  'langgraph_checkpoints', 'langgraph_checkpoint_writes'
]
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

type TableBackup = { schema: string; rows: Array<Record<string, unknown>> }
type Pending = { input: ReturnType<typeof workspaceBackupSchema.parse>; token: string }
export class WorkspaceBackupCapacityError extends Error { constructor(message: string) { super(message); this.name = 'WorkspaceBackupCapacityError' } }

export function createWorkspaceBackupEngine(db: Database.Database, maxBackupBytes = MAX_WORKSPACE_BACKUP_BYTES): WorkspaceBackupEngine {
  if (!Number.isSafeInteger(maxBackupBytes) || maxBackupBytes < 1) throw new Error('Workspace backup byte ceiling must be a positive safe integer.')
  db.pragma('recursive_triggers = ON')
  db.exec(`CREATE TABLE IF NOT EXISTS ${WORKSPACE_BACKUP_STATE_TABLE} (singleton INTEGER PRIMARY KEY CHECK(singleton=1), max_bytes INTEGER NOT NULL, base_bytes INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ${WORKSPACE_BACKUP_SIZE_TABLE} (table_name TEXT PRIMARY KEY, row_count INTEGER NOT NULL, row_bytes INTEGER NOT NULL);`)
  db.prepare(`INSERT INTO ${WORKSPACE_BACKUP_STATE_TABLE} (singleton,max_bytes,base_bytes) VALUES (1,?,0) ON CONFLICT(singleton) DO UPDATE SET max_bytes=excluded.max_bytes`).run(maxBackupBytes)
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
  const rowBytesExpression = (prefix: 'NEW' | 'OLD', columns: Array<{ name: string }>) => `length(CAST(${jsonRowExpression(prefix, columns)} AS BLOB))`
  const backupBytesFromLedger = () => {
    const state = db.prepare(`SELECT max_bytes, base_bytes FROM ${WORKSPACE_BACKUP_STATE_TABLE} WHERE singleton=1`).get() as { max_bytes: number; base_bytes: number }
    const sizes = db.prepare(`SELECT table_name, row_count, row_bytes FROM ${WORKSPACE_BACKUP_SIZE_TABLE}`).all() as Array<{ table_name: string; row_count: number; row_bytes: number }>
    const byName = new Map(sizes.map(item => [item.table_name, item]))
    for (const [name, maxRows] of Object.entries(WORKSPACE_BACKUP_TABLE_ROW_LIMITS)) if ((byName.get(name)?.row_count ?? 0) > maxRows) throw new WorkspaceBackupCapacityError(`Workspace table ${name} exceeds its ${maxRows}-row backup safety limit.`)
    const rowsAndSeparators = sizes.reduce((sum, item) => sum + item.row_bytes + Math.max(0, item.row_count - 1), 0)
    return { bytes: state.base_bytes + rowsAndSeparators, maxBytes: state.max_bytes }
  }
  const installBackupAccountingTriggers = () => {
    const names = actualTables()
    const emptySnapshot = { format: 'cv-tailor-workspace-backup', version: 2 as const, createdAt: new Date().toISOString(), warning: workspaceBackupWarning, tables: Object.fromEntries(names.map(name => [name, { schema: tableSchema(name), rows: [] }])) }
    const baseBytes = Buffer.byteLength(JSON.stringify(emptySnapshot), 'utf8')
    for (const name of names) for (const suffix of ['insert', 'update', 'delete']) db.exec(`DROP TRIGGER IF EXISTS "cv_backup_${name}_${suffix}"`)
    db.prepare(`DELETE FROM ${WORKSPACE_BACKUP_SIZE_TABLE}`).run()
    const insertSize = db.prepare(`INSERT INTO ${WORKSPACE_BACKUP_SIZE_TABLE} (table_name,row_count,row_bytes) VALUES (?,?,?)`)
    for (const name of names) {
      const rows = rowsFor(name), bytes = rows.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row), 'utf8'), 0)
      insertSize.run(name, rows.length, bytes)
    }
    db.prepare(`UPDATE ${WORKSPACE_BACKUP_STATE_TABLE} SET max_bytes=?,base_bytes=? WHERE singleton=1`).run(maxBackupBytes, baseBytes)
    const capacityCheck = `SELECT CASE WHEN (SELECT base_bytes FROM ${WORKSPACE_BACKUP_STATE_TABLE} WHERE singleton=1) + (SELECT COALESCE(SUM(row_bytes + CASE WHEN row_count > 0 THEN row_count-1 ELSE 0 END),0) FROM ${WORKSPACE_BACKUP_SIZE_TABLE}) > (SELECT max_bytes FROM ${WORKSPACE_BACKUP_STATE_TABLE} WHERE singleton=1) THEN RAISE(ABORT,'WORKSPACE_BACKUP_CAPACITY') END;`
    for (const name of names) {
      const table = `"${name}"`, maxRows = WORKSPACE_BACKUP_TABLE_ROW_LIMITS[name]!, columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>
      const newJson = jsonRowExpression('NEW', columns), oldJson = jsonRowExpression('OLD', columns)
      const newBytes = rowBytesExpression('NEW', columns), oldBytes = rowBytesExpression('OLD', columns)
      const jobGuard = name === 'jobs' ? `SELECT CASE WHEN length(CAST(NEW."data" AS BLOB)) > ${MAX_JOB_RECORD_UTF8_BYTES} OR NOT json_valid(NEW."data") OR COALESCE(json_array_length(NEW."data",'$.revisions'),0) > ${MAX_WORKSPACE_BACKUP_POSTING_REVISIONS} THEN RAISE(ABORT,'WORKSPACE_BACKUP_JOB_LIMIT') END;` : ''
      db.exec(`CREATE TRIGGER "cv_backup_${name}_insert" AFTER INSERT ON ${table} BEGIN
        SELECT CASE WHEN ${newBytes} > ${MAX_WORKSPACE_BACKUP_ROW_BYTES} THEN RAISE(ABORT,'WORKSPACE_BACKUP_ROW_LIMIT') END;
        ${jobGuard}
        UPDATE ${WORKSPACE_BACKUP_SIZE_TABLE} SET row_count=row_count+1,row_bytes=row_bytes+${newBytes} WHERE table_name='${name}';
        SELECT CASE WHEN (SELECT row_count FROM ${WORKSPACE_BACKUP_SIZE_TABLE} WHERE table_name='${name}') > ${maxRows} THEN RAISE(ABORT,'WORKSPACE_BACKUP_TABLE_LIMIT') END;
        ${capacityCheck}
      END;
      CREATE TRIGGER "cv_backup_${name}_update" AFTER UPDATE ON ${table} BEGIN
        SELECT CASE WHEN ${newBytes} > ${MAX_WORKSPACE_BACKUP_ROW_BYTES} THEN RAISE(ABORT,'WORKSPACE_BACKUP_ROW_LIMIT') END;
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
    validateRawBounds(currentSnapshot)
    const bytes = backupBytesFromLedger().bytes
    if (bytes !== Buffer.byteLength(JSON.stringify(currentSnapshot), 'utf8')) throw new Error('Workspace backup byte ledger is inconsistent with stored rows.')
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
    const snapshot = { format: 'cv-tailor-workspace-backup', version: 2 as const, createdAt: new Date().toISOString(), warning: workspaceBackupWarning, tables }
    validateRawBounds(snapshot)
    const encoded = JSON.stringify(snapshot)
    if (Buffer.byteLength(encoded, 'utf8') > maxBackupBytes) throw new Error(`Backup exceeds the ${Math.round(maxBackupBytes / (1024 * 1024))} MiB workspace safety limit.`)
    return { snapshot, encoded }
  }
  const validateDomainRows = (backup: ReturnType<typeof workspaceBackupSchema.parse>) => {
    const rows = backup.tables
    const fail = (table: string): never => { throw new Error(`Backup row violates the ${table} domain schema.`) }
    for (const row of rows.settings?.rows ?? []) {
      const allowed = ['appearance', 'openrouter-model', 'faithfulness-check', 'analysis-budgets']
      if (!allowed.includes(String(row.key))) fail('settings')
      if (row.key === 'appearance' && !appearanceSchema.safeParse(row.value).success) fail('settings')
      if (row.key === 'openrouter-model' && !openRouterModelSchema.safeParse(row.value).success) fail('settings')
      if (row.key === 'faithfulness-check' && row.value !== 'true' && row.value !== 'false') fail('settings')
      if (row.key === 'analysis-budgets') assertValid(analysisBudgetsSchema, parseJson('settings', row.value as string), 'settings')
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
      const entryField = field.match(/^entries\.(education|certificates|summary|languages|extras)(?:\.(date|year))?$/)
      if (entryField) return snapshot.section === entryField[1] && (!entryField[2] || (entryField[2] === 'date' && entryField[1] === 'education') || (entryField[2] === 'year' && entryField[1] === 'certificates'))
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
    for (const table of ['outbound_consents','analysis_attempts','provider_attempt_outcomes','generation_recovery_extensions'] as const) for (const row of rows[table]?.rows ?? []) {
      const runId = row.run_id
      if (runId !== undefined && !uuidSchema.safeParse(runId).success) fail(table)
      for (const key of ['created_at','attempted_at','dispatched_at','settled_at','checkpointed_at','recorded_at','updated_at']) if (row[key] !== null && row[key] !== undefined && typeof row[key] === 'string' && !Number.isFinite(Date.parse(row[key] as string))) fail(table)
    }
    const jobs = new Set((rows.jobs?.rows ?? []).map(row => row.id))
    for (const table of ['draft_revisions','regeneration_proposals','document_fit_reports','posting_analysis_cache','analysis_run_state','generation_recovery'] as const) for (const row of rows[table]?.rows ?? []) if (!jobs.has(row.job_id)) fail(table)
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
    assertBackupCapacity() {
      try {
        const { bytes, maxBytes } = backupBytesFromLedger()
        if (bytes > maxBytes) throw new Error(`Backup exceeds the ${Math.round(maxBytes / (1024 * 1024))} MiB workspace safety limit.`)
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
        if (names.includes('outbound_consents')) db.exec('UPDATE outbound_consents SET revoked=1')
        if (names.includes('generation_recovery')) db.exec("UPDATE generation_recovery SET status='cancelled' WHERE status IN ('running','paused')")
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='encrypted_credentials'").get()) db.exec('DELETE FROM encrypted_credentials')
      })
      transaction()
    },
    cancelRestore(token) { return pending.delete(token) }
  }
}
