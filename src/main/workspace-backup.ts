import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { workspaceBackupSchema, workspaceBackupWarning, type WorkspaceBackupEngine, type WorkspaceRestorePreview } from '../shared/workspace-backup'
import { contactRecordSchema, skillRecordSchema, profileEntrySchema, evidenceRevisionSchema, uuidSchema } from '../shared/profile'
import { experienceRecordSchema, projectRecordSchema } from '../shared/experience'
import { jobRecordSchema } from '../shared/jobs'
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
  'schema_migrations', 'settings', 'profile_contact', 'profile_skills', 'profile_entries', 'evidence_revisions',
  'profile_experience', 'profile_projects', 'jobs', 'outbound_consents', 'posting_analysis_cache',
  'analysis_run_state', 'analysis_attempts', 'provider_attempt_outcomes', 'generation_recovery',
  'generation_recovery_extensions', 'draft_revisions', 'regeneration_proposals', 'document_fit_reports',
  'langgraph_checkpoints', 'langgraph_checkpoint_writes'
]
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

type TableBackup = { schema: string; rows: Array<Record<string, unknown>> }
type Pending = { input: ReturnType<typeof workspaceBackupSchema.parse>; token: string }

export function createWorkspaceBackupEngine(db: Database.Database): WorkspaceBackupEngine {
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
    const snapshot = {
      format: 'cv-tailor-workspace-backup', version: 1 as const,
      createdAt: new Date().toISOString(), warning: workspaceBackupWarning,
      tables: Object.fromEntries(actualTables().map(name => [name, { schema: tableSchema(name), rows: rowsFor(name) }]))
    }
    const result = JSON.stringify(snapshot)
    validate(result)
    return result
  }
  const validate = (text: string) => {
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { throw new Error('Backup is invalid or incompatible.') }
    const result = workspaceBackupSchema.safeParse(parsed)
    if (!result.success) throw new Error('Backup is invalid or incompatible.')
    const backup = result.data
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
