import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { MAX_WORKSPACE_BACKUP_BYTES, MAX_WORKSPACE_BACKUP_POSTING_REVISIONS, MAX_WORKSPACE_BACKUP_ROW_BYTES, WORKSPACE_BACKUP_TABLE_ROW_LIMITS, workspaceBackupSchema, workspaceBackupWarning, type WorkspaceBackupEngine, type WorkspaceRestorePreview } from '../shared/workspace-backup'
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
  const pending = new Map<string, Pending>()
  const tableSchema = (name: string): string => {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name) as { sql: string } | undefined
    if (!row) throw new Error(`Workspace table is missing: ${name}`)
    return row.sql
  }
  const actualTables = () => {
    const present = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'encrypted_credentials'").all() as Array<{ name: string }>).map(row => row.name)
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
  const buildSnapshot = (jobOverride?: import('../shared/workspace-backup').WorkspaceJobBackupRow) => {
    const names = actualTables()
    const tables = Object.fromEntries(names.map(name => {
      const maxRows = WORKSPACE_BACKUP_TABLE_ROW_LIMITS[name]!
      const currentCount = (db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get() as { count: number }).count
      const existing = name === 'jobs' && jobOverride ? db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(jobOverride.id) !== undefined : false
      const count = currentCount + (name === 'jobs' && jobOverride && !existing ? 1 : 0)
      if (count > maxRows) throw new WorkspaceBackupCapacityError(`Workspace table ${name} would exceed its ${maxRows}-row backup safety limit; nothing was saved.`)
      const rows = rowsFor(name)
      if (name === 'jobs' && jobOverride) {
        const replacement = { id: jobOverride.id, created_at: jobOverride.created_at, updated_at: jobOverride.updated_at, data: jobOverride.data }
        const index = rows.findIndex(row => row.id === jobOverride.id)
        if (index < 0) rows.push(replacement)
        else rows[index] = replacement
      }
      return [name, { schema: tableSchema(name), rows }]
    }))
    const snapshot = { format: 'cv-tailor-workspace-backup', version: 2 as const, createdAt: new Date().toISOString(), warning: workspaceBackupWarning, tables }
    validateRawBounds(snapshot)
    const encoded = JSON.stringify(snapshot)
    if (Buffer.byteLength(encoded, 'utf8') > maxBackupBytes) {
      const limitMessage = `The ${Math.round(maxBackupBytes / (1024 * 1024))} MiB workspace backup limit would be exceeded.`
      if (jobOverride) throw new WorkspaceBackupCapacityError(`This job change would exceed ${limitMessage} Nothing was saved and no existing history was deleted; export the current workspace or use a shorter working posting.`)
      throw new Error(`Backup exceeds ${limitMessage}`)
    }
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
    assertJobSaveFits(row) {
      try { buildSnapshot(row) }
      catch (error) {
        if (error instanceof WorkspaceBackupCapacityError) throw error
        const detail = error instanceof Error ? error.message : 'backup validation failed'
        throw new WorkspaceBackupCapacityError(`This job change would exceed a workspace backup safety limit (${detail}). Nothing was saved and no existing history was deleted.`)
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
