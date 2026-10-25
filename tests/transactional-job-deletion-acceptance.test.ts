import { afterEach, expect, test } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createWorkbench } from '../src/main/workbench'
import { registerWorkspaceBackupRowSizer } from '../src/main/workspace-backup'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { jobDeletionSelectionSchema, MAX_SAVED_JOBS } from '../src/shared/jobs'

const directories: string[] = []
const workbenches: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => {
  for (const workbench of workbenches.splice(0)) workbench.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
const scripted: AnalysisTransport = { async generate({ prompt }) {
  if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: ['TypeScript'], responsibilities: [], keywords: ['TypeScript'] })
  if (prompt.startsWith('Propose conservative replacement wording')) {
    const { sourcesByItem } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    return JSON.stringify({ items: sourcesByItem.map(() => ({ text: 'TypeScript', rationale: 'Saved evidence.' })) })
  }
  if (prompt.startsWith('Score these numbered')) {
    const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant.' })) })
  }
  const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
  const paragraphs = (category: string) => selected.filter((item: { category: string }) => item.category === category).map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Cited.' }))
  return JSON.stringify({ headline: 'Engineer', summary: { text: 'Engineer with saved experience.', evidence: [selected[0].index], rationale: 'Source.' }, education: paragraphs('education'), experience: paragraphs('experience'), projects: paragraphs('projects'), skills: selected.filter((item: { category: string }) => item.category === 'skills').map((item: { index: number; text: string }) => ({ name: JSON.parse(item.text).name, evidence: [item.index], rationale: 'Skill.' })), certificates: paragraphs('certificates') })
} }
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'job-delete-acceptance-'))
  directories.push(directory)
  const workbench = createWorkbench(directory, undefined, scripted)
  workbenches.push(workbench)
  await workbench.api.saveContact({ fullName: 'Synthetic Candidate' })
  await workbench.api.saveSkill({ name: 'TypeScript', category: 'Programming' })
  const jobs: string[] = []
  const runs: Array<{ runId: string; token: string }> = []
  for (const title of ['Alpha', 'Beta', 'Gamma']) {
    const saved = await workbench.api.saveJob({ title, company: `${title} Labs`, description: 'TypeScript required.' })
    if (!saved.ok) throw Error('job fixture failed')
    const consent = await workbench.api.prepareOutboundConsent(saved.value.id)
    if (!consent.ok) throw Error('consent fixture failed')
    const accepted = await workbench.api.acceptOutboundConsent(consent.token, true, true)
    if (!accepted.ok) throw Error('consent save failed')
    expect((await workbench.api.startAnalysis(consent.token)).status).toBe('complete')
    expect((await workbench.api.generateDraft(consent.token)).ok).toBe(true)
    jobs.push(saved.value.id)
    runs.push({ runId: accepted.runId, token: consent.token })
  }
  return { directory, workbench, jobs, runs }
}
function dbFor(directory: string) { const db = new Database(join(directory, 'workbench.sqlite')); registerWorkspaceBackupRowSizer(db); return db }
function backupRows(workbench: ReturnType<typeof createWorkbench>) { return JSON.parse(workbench.backup.createBackup()).tables as Record<string, { rows: Array<Record<string, unknown>> }> }

test('two-job deletion removes owned records, preserves third job and profile, and a new backup restores without deleted jobs', async () => {
  const { directory, workbench, jobs, runs } = await fixture()
  const db = dbFor(directory)
  try {
    const oldBackup = workbench.backup.createBackup()
    const exported = join(directory, 'already-exported.pdf')
    writeFileSync(exported, 'synthetic exported file')
    const profileBefore = JSON.stringify(backupRows(workbench).profile_skills.rows)
    const evidenceBefore = JSON.stringify(backupRows(workbench).evidence_revisions.rows)
    const thirdBefore = JSON.stringify(backupRows(workbench).jobs.rows.find(row => row.id === jobs[2]))
    const recovery = db.prepare('SELECT snapshot FROM generation_recovery WHERE run_id=?').get(runs[0].runId) as { snapshot: string }
    expect(JSON.parse(recovery.snapshot).jobId).toBe(jobs[0])
    db.prepare("UPDATE generation_recovery SET status='paused' WHERE run_id=?").run(runs[0].runId)
    db.prepare('INSERT INTO generation_recovery_extensions (run_id,prior_run_limit,new_run_limit,prior_time_limit_ms,new_time_limit_ms,recorded_at) VALUES (?,?,?,?,?,?)').run(runs[0].runId, 1, 2, 100, 200, new Date().toISOString())
    const unused = await workbench.api.prepareOutboundConsent(jobs[0])
    if (!unused.ok) throw Error('unused consent preview failed')
    const acceptedUnused = await workbench.api.acceptOutboundConsent(unused.token, true, true)
    if (!acceptedUnused.ok) throw Error('unused consent save failed')
    const next = await workbench.api.prepareOutboundConsent(jobs[1])
    if (!next.ok) throw Error('proposal preview failed')
    await workbench.api.acceptOutboundConsent(next.token, true, true)
    expect((await workbench.api.regenerateDraft(next.token, { kind: 'section', section: 'skills' })).ok).toBe(true)
    const document = await workbench.api.getCanonicalDocument(jobs[2])
    if (!document) throw Error('document fixture failed')
    await workbench.api.saveDocumentFitReport(jobs[2], { documentHash: createHash('sha256').update(JSON.stringify(document)).digest('hex'), targetPages: 1, actualPages: 1, extractedText: ['CV'], linkTargets: [], links: [], overflow: false, proposedCuts: [], measuredAt: new Date().toISOString() })
    const before = backupRows(workbench)
    expect(before.jobs.rows).toHaveLength(3)
    expect(before.outbound_consents.rows.some(row => row.run_id === acceptedUnused.runId && row.job_id === jobs[0])).toBe(true)
    expect(before.draft_revisions.rows).toHaveLength(3)
    expect(before.generation_recovery_extensions.rows).toHaveLength(1)
    expect(before.regeneration_proposals.rows).toHaveLength(1)
    expect(before.document_fit_reports.rows).toHaveLength(1)
    const preview = await workbench.api.previewJobDeletion(jobs.slice(0, 2))
    expect(preview).toMatchObject({ ok: true, draftCount: 2 })
    expect(preview.jobs?.map(job => job.id)).toEqual(jobs.slice(0, 2).sort())
    expect(preview.jobs?.map(job => job.draftCount)).toEqual([1, 1])
    expect(await workbench.api.executeJobDeletion(preview.token!, jobs.slice(0, 2))).toMatchObject({ ok: true, deletedCount: 2 })
    const after = backupRows(workbench)
    expect(after.jobs.rows.map(row => row.id)).toEqual([jobs[2]])
    for (const table of ['posting_analysis_cache', 'analysis_run_state', 'generation_recovery', 'draft_revisions', 'regeneration_proposals', 'document_fit_reports']) {
      expect(after[table].rows, table).toEqual(before[table].rows.filter(row => row.job_id === jobs[2]))
    }
    const ownedRuns = new Set(before.outbound_consents.rows.filter(row => jobs.slice(0, 2).includes(String(row.job_id))).map(row => String(row.run_id)))
    for (const table of ['outbound_consents', 'analysis_attempts', 'provider_attempt_outcomes', 'generation_recovery_extensions']) {
      expect(after[table].rows, table).toEqual(before[table].rows.filter(row => !ownedRuns.has(String(row.run_id))))
    }
    for (const table of ['langgraph_checkpoints', 'langgraph_checkpoint_writes']) expect(after[table].rows, table).toEqual(before[table].rows.filter(row => !ownedRuns.has(String(row.thread_id))))
    expect(JSON.stringify(after.profile_skills.rows)).toBe(profileBefore)
    expect(JSON.stringify(after.evidence_revisions.rows)).toBe(evidenceBefore)
    expect(JSON.stringify(after.jobs.rows[0])).toBe(thirdBefore)
    expect(readFileSync(exported, 'utf8')).toBe('synthetic exported file')
    expect(after.outbound_consents.rows.some(row => row.run_id === acceptedUnused.runId)).toBe(false)
    expect(oldBackup).toContain(jobs[0])
    expect(workbench.backup.createBackup()).not.toContain(jobs[0])
    expect(await workbench.api.executeJobDeletion(preview.token!, jobs.slice(0, 2))).toMatchObject({ ok: false, deletedCount: 0 })
    expect(await workbench.api.resumeGeneration(runs[0].runId)).toMatchObject({ ok: false })
    await expect(workbench.api.startAnalysis(unused.token)).rejects.toThrow()
    await expect(workbench.api.startAnalysis(runs[0].token)).rejects.toThrow()
    const reopenedDir = join(directory, 'restored')
    const reopened = createWorkbench(reopenedDir, undefined, scripted)
    workbenches.push(reopened)
    const newBackup = workbench.backup.createBackup()
    const restore = reopened.backup.previewRestore(newBackup)
    reopened.backup.applyRestore(restore.token, text => text)
    expect((await reopened.api.listJobs()).map(job => job.id)).toEqual([jobs[2]])
    expect(await reopened.api.getDraft(jobs[0])).toBeNull()
  } finally { db.close() }
}, 30_000)

test('stale, malformed, missing and busy selections never partially delete', async () => {
  const { directory, workbench, jobs } = await fixture()
  expect((await workbench.api.previewJobDeletion([])).ok).toBe(false)
  expect((await workbench.api.previewJobDeletion([jobs[0], jobs[0]])).ok).toBe(false)
  expect((await workbench.api.previewJobDeletion([jobs[0], randomUUID()])).ok).toBe(false)
  const first = await workbench.api.previewJobDeletion(jobs.slice(0, 2))
  const release = workbench.beginJobOperation(jobs[1], 'DOCX export')
  try { expect(await workbench.api.executeJobDeletion(first.token!, jobs.slice(0, 2))).toMatchObject({ ok: false, deletedCount: 0, message: expect.stringContaining('DOCX export') }) }
  finally { release() }
  expect(await workbench.api.executeJobDeletion(first.token!, [jobs[0]])).toMatchObject({ ok: false, deletedCount: 0 })
  const db = dbFor(directory)
  try { db.prepare("UPDATE generation_recovery SET status='paused' WHERE job_id=?").run(jobs[0]) }
  finally { db.close() }
  expect(await workbench.api.executeJobDeletion(first.token!, jobs.slice(0, 2))).toMatchObject({ ok: false, deletedCount: 0, message: expect.stringContaining('changed') })
  expect(await workbench.api.previewJobDeletion(jobs.slice(0, 2))).toMatchObject({ ok: true })
  expect(await workbench.api.listJobs()).toHaveLength(3)
})

test.each(['draft_revisions', 'jobs'])('injected SQLite failure at %s rolls back all rows and authorization', async table => {
  const { directory, workbench, jobs, runs } = await fixture()
  const baseline = backupRows(workbench)
  const preview = await workbench.api.previewJobDeletion(jobs.slice(0, 2))
  const db = dbFor(directory)
  try {
    db.exec(`CREATE TRIGGER refuse_job_deletion BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`)
    expect(await workbench.api.executeJobDeletion(preview.token!, jobs.slice(0, 2))).toMatchObject({ ok: false, deletedCount: 0 })
    db.exec('DROP TRIGGER refuse_job_deletion')
    expect(backupRows(workbench)).toEqual(baseline)
    expect((await workbench.api.listJobs()).map(job => job.id).sort()).toEqual([...jobs].sort())
    expect(() => workbench.authorizeOutboundPayload(runs[0].runId, { probe: true })).toThrow('outside the authorized bundle')
  } finally { db.close() }
}, 30_000)

test('old superseded analysis and regeneration runs without surviving job links keep unknown history after deletion', async () => {
  const { directory, workbench, jobs, runs } = await fixture()
  const legacy = JSON.parse(workbench.backup.createBackup())
  legacy.tables.schema_migrations.rows = legacy.tables.schema_migrations.rows.filter((row: { version: number }) => row.version !== 10)
  legacy.tables.outbound_consents.schema = String(legacy.tables.outbound_consents.schema).replace(', job_id TEXT', '')
  for (const row of legacy.tables.outbound_consents.rows) delete row.job_id
  const oldAnalysisRun = randomUUID(), oldRegenerationRun = randomUUID()
  const consent = legacy.tables.outbound_consents.rows[0]
  const nextId = Math.max(...legacy.tables.analysis_attempts.rows.map((row: { id: number }) => row.id)) + 1
  for (const runId of [oldAnalysisRun, oldRegenerationRun]) {
    legacy.tables.outbound_consents.rows.push({ ...consent, id: randomUUID(), run_id: runId, revoked: 1 })
    legacy.tables.analysis_attempts.rows.push({ id: nextId + (runId === oldAnalysisRun ? 0 : 1), run_id: runId, attempted_at: '2026-01-01T00:00:00.000Z' })
  }
  const outcome = legacy.tables.provider_attempt_outcomes.rows[0]
  legacy.tables.provider_attempt_outcomes.rows.push({ ...outcome, id: Math.max(...legacy.tables.provider_attempt_outcomes.rows.map((row: { id: number }) => row.id)) + 1, run_id: oldAnalysisRun })
  legacy.tables.generation_recovery_extensions.rows.push({ id: 1, run_id: oldRegenerationRun, prior_run_limit: 1, new_run_limit: 2, prior_time_limit_ms: 100, new_time_limit_ms: 200, recorded_at: '2026-01-01T00:00:00.000Z' })
  const preview = workbench.backup.previewRestore(JSON.stringify(legacy))
  workbench.backup.applyRestore(preview.token, text => text)
  expect((await workbench.api.listJobs()).map(job => job.id).sort()).toEqual([...jobs].sort())
  const db = dbFor(directory)
  try {
    const ownership = db.prepare('SELECT job_id FROM outbound_consents WHERE run_id=?')
    expect((ownership.get(runs[0].runId) as { job_id: string }).job_id).toBe(jobs[0])
    for (const runId of [oldAnalysisRun, oldRegenerationRun]) expect((ownership.get(runId) as { job_id: string | null }).job_id).toBeNull()
    const deletion = await workbench.api.previewJobDeletion([jobs[0]])
    expect(deletion.ok).toBe(true)
    expect(await workbench.api.executeJobDeletion(deletion.token!, [jobs[0]])).toMatchObject({ ok: true, deletedCount: 1 })
    expect(ownership.get(runs[0].runId)).toBeUndefined()
    expect(db.prepare('SELECT 1 FROM analysis_attempts WHERE run_id=?').get(runs[0].runId)).toBeUndefined()
    for (const runId of [oldAnalysisRun, oldRegenerationRun]) {
      expect((ownership.get(runId) as { job_id: string | null }).job_id).toBeNull()
      expect(db.prepare('SELECT 1 FROM analysis_attempts WHERE run_id=?').get(runId)).toBeDefined()
    }
    expect(db.prepare('SELECT 1 FROM provider_attempt_outcomes WHERE run_id=?').get(oldAnalysisRun)).toBeDefined()
    expect(db.prepare('SELECT 1 FROM generation_recovery_extensions WHERE run_id=?').get(oldRegenerationRun)).toBeDefined()
    expect((await workbench.api.listJobs()).map(job => job.id).sort()).toEqual(jobs.slice(1).sort())
  } finally { db.close() }
}, 30_000)

test('the public deletion selection accepts the workspace capacity and rejects one more', () => {
  const ids = Array.from({ length: MAX_SAVED_JOBS + 1 }, () => randomUUID())
  expect(jobDeletionSelectionSchema.parse(ids.slice(0, MAX_SAVED_JOBS))).toHaveLength(5_000)
  expect(jobDeletionSelectionSchema.safeParse(ids).success).toBe(false)
})

test('preview and execute delete 501 selected jobs and more than 999 owned runs without removing an unselected job', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'job-delete-large-selection-'))
  directories.push(directory)
  const workbench = createWorkbench(directory, undefined, scripted)
  workbenches.push(workbench)
  const ids: string[] = []
  for (let i = 0; i < 502; i++) {
    const result = await workbench.api.saveJob({ title: `Posting ${i}`, company: 'Synthetic Co', description: 'TypeScript required.' })
    if (!result.ok) throw Error(`failed to save posting ${i}`)
    ids.push(result.value.id)
  }
  const db = dbFor(directory)
  try {
    const selected = ids.slice(0, 501)
    const unselected = ids[501]
    const insert = db.prepare('INSERT INTO outbound_consents (id,run_id,scope_hash,created_at,revoked,job_id) VALUES (?,?,?,?,1,?)')
    const insertAttempt = db.prepare('INSERT INTO analysis_attempts (run_id,attempted_at) VALUES (?,?)')
    db.transaction(() => {
      for (let i = 0; i < 1_102; i++) {
        const runId = randomUUID()
        insert.run(randomUUID(), runId, 'synthetic', '2026-01-01T00:00:00.000Z', i === 1_101 ? unselected : selected[i % selected.length])
        insertAttempt.run(runId, '2026-01-01T00:00:00.000Z')
      }
    })()
    const preview = await workbench.api.previewJobDeletion(selected)
    expect(preview).toMatchObject({ ok: true })
    expect(preview.jobs).toHaveLength(501)
    expect(await workbench.api.executeJobDeletion(preview.token!, selected)).toMatchObject({ ok: true, deletedCount: 501 })
    expect((await workbench.api.listJobs()).map(job => job.id)).toEqual([unselected])
    expect((db.prepare('SELECT COUNT(*) AS count FROM outbound_consents').get() as { count: number }).count).toBe(1)
    expect((db.prepare('SELECT COUNT(*) AS count FROM analysis_attempts').get() as { count: number }).count).toBe(1)
  } finally { db.close() }
}, 120_000)

test('cancelled in-flight analysis remains busy until its late response has settled', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'job-delete-late-response-'))
  directories.push(directory)
  let respond!: (value: string) => void
  let began!: () => void
  const dispatched = new Promise<void>(resolve => { began = resolve })
  const transport: AnalysisTransport = { generate: () => { began(); return new Promise<string>(resolve => { respond = resolve }) } }
  const workbench = createWorkbench(directory, undefined, transport)
  workbenches.push(workbench)
  const saved = await workbench.api.saveJob({ title: 'Wait', company: 'Synthetic Co', description: 'TypeScript required.' })
  if (!saved.ok) throw Error('job fixture failed')
  const consent = await workbench.api.prepareOutboundConsent(saved.value.id)
  if (!consent.ok) throw Error('consent preview failed')
  await workbench.api.acceptOutboundConsent(consent.token, true, true)
  const running = workbench.api.startAnalysis(consent.token)
  await dispatched
  expect((await workbench.api.previewJobDeletion([saved.value.id])).ok).toBe(false)
  await workbench.api.cancelAnalysis(saved.value.id)
  expect((await workbench.api.previewJobDeletion([saved.value.id])).ok).toBe(false)
  respond(JSON.stringify({ required: ['TypeScript'], preferred: [], tools: [], responsibilities: [], keywords: [] }))
  await running
  const preview = await workbench.api.previewJobDeletion([saved.value.id])
  expect(preview.ok).toBe(true)
  expect(await workbench.api.executeJobDeletion(preview.token!, [saved.value.id])).toMatchObject({ ok: true, deletedCount: 1 })
  workbench.close(); workbenches.pop()
  const reopened = createWorkbench(directory, undefined, scripted)
  workbenches.push(reopened)
  expect(await reopened.api.listJobs()).toEqual([])
  expect(await reopened.api.getAnalysis(saved.value.id)).toBeNull()
  expect(backupRows(reopened).analysis_attempts.rows).toEqual([])
}, 30_000)
