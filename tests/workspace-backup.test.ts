import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createWorkbench } from '../src/main/workbench'
import Database from 'better-sqlite3'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { seedHistoricalJob } from './helpers/historical-job'
import { MAX_WORKSPACE_BACKUP_BYTES, MAX_WORKSPACE_BACKUP_POSTING_REVISIONS, MAX_WORKSPACE_BACKUP_ROW_BYTES, WORKSPACE_BACKUP_TABLE_ROW_LIMITS } from '../src/shared/workspace-backup'

const directories: string[] = []
const instances: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => {
  for (const item of instances.splice(0)) item.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
const scripted: AnalysisTransport = { async generate({ prompt }) {
  if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: ['TypeScript'], responsibilities: [], keywords: ['TypeScript'] })
  if (prompt.startsWith('Propose conservative replacement wording')) {
    const { sourcesByItem } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    return JSON.stringify({ items: sourcesByItem.map(() => ({ text: 'TypeScript', rationale: 'Retains cited saved evidence.' })) })
  }
  if (prompt.startsWith('Score these numbered')) {
    const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant profile source.' })) })
  }
  const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
  const paragraphs = (category: string) => selected.filter((item: { category: string }) => item.category === category).map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Cited authorized evidence.' }))
  return JSON.stringify({ headline: 'Engineer', summary: { text: 'Engineer with saved experience.', evidence: [selected[0].index], rationale: 'Selected source.' }, education: paragraphs('education'), experience: paragraphs('experience'), projects: paragraphs('projects'), skills: selected.filter((item: { category: string }) => item.category === 'skills').map((item: { index: number; text: string }) => ({ name: JSON.parse(item.text).name, evidence: [item.index], rationale: 'Saved skill.' })), certificates: paragraphs('certificates') })
} }
function open(directory: string) { const instance = createWorkbench(directory, undefined, scripted); instances.push(instance); return instance }
function fixture() { const dir = mkdtempSync(join(tmpdir(), 'cv-tailor-complete-backup-')); directories.push(dir); return { dir, workbench: open(dir) } }
function safetyBackup(dir: string) {
  return (content: string) => {
    const path = join(dir, 'verified-safety.json')
    writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' })
    return readFileSync(path, 'utf8')
  }
}

test('complete workspace backup restores draft revisions, evidence, posting, preferences and run history from real persistence without automatically dispatching', async () => {
  const { dir, workbench: wb } = fixture()
  const requests: string[] = []
  const capture: AnalysisTransport = { async generate(input) { requests.push(input.prompt); return scripted.generate(input) } }
  wb.close(); instances.pop()
  const active = createWorkbench(dir, undefined, capture); instances.push(active)

  const contact = await active.api.saveContact({ fullName: 'Example Candidate' })
  const skill = await active.api.saveSkill({ name: 'TypeScript', category: 'Programming' })
  if (!contact.ok || !skill.ok) throw Error('profile fixture failed')
  const skillId = skill.value.skills[0].id
  expect((await active.api.saveSkill({ id: skillId, name: 'TypeScript', category: 'Technical' })).ok).toBe(true)
  const job = await active.api.saveJob({ title: 'Engineer', company: 'Example Co', description: 'TypeScript required.' })
  if (!job.ok) throw Error('job fixture failed')
  const consent = await active.api.prepareOutboundConsent(job.value.id)
  if (!consent.ok) throw Error('consent fixture failed')
  await active.api.acceptOutboundConsent(consent.token, true, true)
  expect((await active.api.startAnalysis(consent.token)).status).toBe('complete')
  const generated = await active.api.generateDraft(consent.token)
  expect(generated.ok).toBe(true)
  const original = generated.draft!
  expect(original.evidence.length).toBeGreaterThan(0)
  expect(await active.api.checkDraft(job.value.id)).toMatchObject({ passed: true })
  const document = await active.api.getCanonicalDocument(job.value.id)
  if (!document) throw Error('document fixture failed')
  await active.api.saveDocumentFitReport(job.value.id, { documentHash: createHash('sha256').update(JSON.stringify(document)).digest('hex'), targetPages: document.targetPages, actualPages: document.targetPages, extractedText: ['CV'], linkTargets: [], links: [], overflow: false, proposedCuts: [], measuredAt: new Date().toISOString() })
  expect(await active.api.approveDraft(job.value.id)).toMatchObject({ ok: true })
  const approved = await active.api.getDraft(job.value.id)
  const nextConsent = await active.api.prepareOutboundConsent(job.value.id)
  if (!nextConsent.ok) throw Error('regeneration fixture failed')
  await active.api.acceptOutboundConsent(nextConsent.token, true, true)
  const proposal = await active.api.regenerateDraft(nextConsent.token, { kind: 'section', section: 'skills' })
  expect(proposal).toMatchObject({ ok: true, proposal: { status: 'pending' } })
  const backup = active.backup.createBackup()
  expect(JSON.parse(backup).tables.draft_revisions.rows.length).toBeGreaterThan(0)
  expect(JSON.parse(backup).tables.langgraph_checkpoints.rows.length).toBeGreaterThan(0)
  expect(backup).not.toContain('encrypted_credentials')
  const later = await active.api.saveSkill({ name: 'New later evidence', category: 'Technical' })
  expect(later.ok).toBe(true)
  const preview = active.backup.previewRestore(backup)
  expect(preview.rowCounts.profile_skills).toEqual({ current: 2, restored: 1 })
  active.backup.applyRestore(preview.token, safetyBackup(dir))
  active.close(); instances.pop()
  const attemptsBeforeReopen = requests.length
  const reopened = createWorkbench(dir, undefined, capture); instances.push(reopened)
  expect((await reopened.api.getProfile()).skills.map(item => item.name)).toEqual(['TypeScript'])
  expect(await reopened.api.getEvidenceHistory(skillId)).toMatchObject([{ revision: 1, action: 'created' }, { revision: 2, action: 'updated' }])
  expect(await reopened.api.openJob(job.value.id)).toMatchObject({ title: 'Engineer', provenance: 'manual', revisions: [{ revision: 1, description: 'TypeScript required.', provenance: 'manual' }] })
  expect((await reopened.api.listJobs()).map(item => item.title)).toEqual(['Engineer'])
  expect((await reopened.api.getDraft(job.value.id))?.id).toBe(original.id)
  expect((await reopened.api.getDraft(job.value.id))?.evidence).toEqual(original.evidence)
  expect((await reopened.api.getDraft(job.value.id))?.checkReport).toEqual(approved?.checkReport)
  expect((await reopened.api.getDraft(job.value.id))?.approval).toEqual(approved?.approval)
  expect(await reopened.api.getRegenerationProposal(job.value.id)).toMatchObject({ id: proposal.proposal!.id, status: 'pending' })
  expect(JSON.parse(reopened.backup.createBackup()).tables.langgraph_checkpoints.rows).toEqual(JSON.parse(backup).tables.langgraph_checkpoints.rows)
  expect(requests.length).toBe(attemptsBeforeReopen)
  expect(await reopened.api.getAnalysis(job.value.id)).toMatchObject({ status: 'complete' })
  expect(await reopened.api.assertDraftExportable(job.value.id)).toMatchObject({ ok: true })
  await expect(reopened.api.startAnalysis(consent.token)).rejects.toThrow()
  expect(requests.length).toBe(attemptsBeforeReopen)
}, 30_000)

test('legacy enabled review setting cannot survive backup restore or reopen', async () => {
  const { dir, workbench } = fixture()
  const old = JSON.parse(workbench.backup.createBackup())
  old.tables.settings.rows.push({ key: 'faithfulness-check', value: 'true' })
  const preview = workbench.backup.previewRestore(JSON.stringify(old))
  workbench.backup.applyRestore(preview.token, safetyBackup(dir))
  expect(JSON.parse(workbench.backup.createBackup()).tables.settings.rows).not.toContainEqual({ key: 'faithfulness-check', value: 'true' })
  workbench.close(); instances.pop()
  const reopened = open(dir)
  expect(await reopened.api.getSettings()).not.toHaveProperty('faithfulnessCheck')
  expect(JSON.parse(reopened.backup.createBackup()).tables.settings.rows).not.toContainEqual({ key: 'faithfulness-check', value: 'true' })
})

test('released version-1 job backups without provenance upgrade to honest legacy records on restore', async () => {
  const { dir, workbench } = fixture()
  const saved = await workbench.api.saveJob({ title: 'Engineer', company: 'Example', description: 'Original wording.' })
  if (!saved.ok) throw new Error('Job fixture failed')
  const old = JSON.parse(workbench.backup.createBackup())
  old.version = 1
  old.tables.schema_migrations.rows = old.tables.schema_migrations.rows.filter((row: { version: number }) => row.version !== 7)
  old.tables.jobs.rows[0].data = JSON.stringify({ id: saved.value.id, title: 'Engineer', company: 'Example', description: 'Original wording.', createdAt: saved.value.createdAt, updatedAt: saved.value.updatedAt })
  const preview = workbench.backup.previewRestore(JSON.stringify(old))
  workbench.backup.applyRestore(preview.token, safetyBackup(dir))
  workbench.close(); instances.pop()
  const reopened = open(dir)
  expect(await reopened.api.openJob(saved.value.id)).toMatchObject({ provenance: 'legacy-unknown', sourceSnapshot: null, revisions: [], contacts: [] })
  const edited = await reopened.api.saveJob({ id: saved.value.id, title: 'Engineer', company: 'Example', description: 'Corrected wording.' })
  expect(edited).toMatchObject({ ok: true, value: { revisions: [{ description: 'Original wording.', revision: 1, provenance: 'legacy-unknown' }, { description: 'Corrected wording.', revision: 2, provenance: 'manual' }] } })
})

test('released version-2 backups upgrade optional posting details to honest unknowns', async () => {
  const { dir, workbench } = fixture()
  const saved = await workbench.api.saveJob({ title: 'Engineer', company: 'Example', description: 'Original posting.' })
  if (!saved.ok) throw new Error('Job fixture failed')
  const old = JSON.parse(workbench.backup.createBackup())
  old.version = 2
  for (const row of old.tables.jobs.rows) {
    const job = JSON.parse(row.data)
    delete job.contacts
    delete job.optionalDetails
    for (const revision of job.revisions) delete revision.optionalDetails
    if (job.sourceSnapshot) {
      delete job.sourceSnapshot.optionalDetails
      delete job.sourceSnapshot.fieldOrigins.optionalDetails
    }
    row.data = JSON.stringify(job)
  }
  const preview = workbench.backup.previewRestore(JSON.stringify(old))
  workbench.backup.applyRestore(preview.token, safetyBackup(dir))
  const restored = await workbench.api.openJob(saved.value.id)
  expect(restored?.contacts).toEqual([])
  expect(restored?.optionalDetails.location).toMatchObject({ value: null, origin: 'unknown' })
  expect(restored?.revisions[0].optionalDetails.compensation).toMatchObject({ value: null, origin: 'unknown' })
})

test('captured public v3 backup restores synthetic profile, job and contact data', async () => {
  const { dir, workbench } = fixture()
  const backup = readFileSync(join(process.cwd(), 'tests/fixtures/cover-letter-legacy-v3.json'), 'utf8')
  expect(JSON.parse(backup).version).toBe(3)
  const preview = workbench.backup.previewRestore(backup)
  workbench.backup.applyRestore(preview.token, safetyBackup(dir))
  const restoredDb = new Database(join(dir, 'workbench.sqlite'), { readonly: true })
  try { expect(restoredDb.prepare('SELECT purpose_version,purpose,purpose_hash FROM outbound_consents').get()).toMatchObject({ purpose_version: 1, purpose: 'cv', purpose_hash: expect.stringMatching(/^[a-f0-9]{64}$/) }) } finally { restoredDb.close() }
  expect((await workbench.api.getProfile()).contact).toMatchObject({ fullName: 'Fixture Candidate', email: 'candidate@example.test' })
  expect((await workbench.api.getProfile()).skills).toMatchObject([{ name: 'TypeScript', category: 'Programming' }])
  expect(await workbench.api.listJobs()).toMatchObject([{ title: 'Software Engineer', company: 'Fixture Systems' }])
  workbench.close(); instances.pop()
  const reopened = open(dir)
  expect((await reopened.api.getProfile()).contact).toMatchObject({ fullName: 'Fixture Candidate' })
  expect(await reopened.api.listJobs()).toMatchObject([{ title: 'Software Engineer' }])
})

test('captured v3 backup refuses a changed consent schema before migration', async () => {
  const { workbench } = fixture()
  const backup = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/cover-letter-legacy-v3.json'), 'utf8'))
  backup.tables.outbound_consents.schema = 'CREATE TABLE outbound_consents (id TEXT PRIMARY KEY, run_id TEXT)'
  expect(() => workbench.backup.previewRestore(JSON.stringify(backup))).toThrow(/consent schema is incompatible/i)
})

test('released v3 backups without the contact field restore contacts as empty', async () => {
  const { dir, workbench } = fixture()
  const saved = await workbench.api.saveJob({ title: 'Legacy v3 role', company: 'Example', description: 'Historical posting text.' })
  if (!saved.ok) throw new Error('Job fixture failed')
  const oldV3 = JSON.parse(workbench.backup.createBackup())
  expect(oldV3.version).toBe(3)
  for (const row of oldV3.tables.jobs.rows) { const record = JSON.parse(row.data); delete record.contacts; row.data = JSON.stringify(record) }
  const restore = workbench.backup.previewRestore(JSON.stringify(oldV3))
  workbench.backup.applyRestore(restore.token, safetyBackup(dir))
  expect(await workbench.api.openJob(saved.value.id)).toMatchObject({ contacts: [] })
})

test('released v2 backups retain historical JSON and HTML provenance through v3 restore without fetching', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cv-tailor-historical-backup-'))
  directories.push(dir)
  const wb = createWorkbench(dir, undefined, scripted)
  instances.push(wb)
  const records: Array<{ id: string; method: string; sourceHash: string; workingHash: string; sourceText: string; workingText: string }> = []
  try {
    for (const [method, title] of [
      ['lever-json-v1', 'JSON Systems Engineer'],
      ['lever-html-jsonld-v1', 'HTML JSON-LD Engineer'],
      ['lever-html-static-v1', 'HTML Static Engineer']
    ] as const) {
      const sourceText = `Historical ${title} posting wording.`
      const workingText = `Reviewed working wording for ${title}.`
      const saved = await wb.api.saveJob({ title, company: 'Synthetic Employer', description: workingText })
      if (!saved.ok) throw new Error(saved.error.message)
      const historic = seedHistoricalJob(dir, saved.value.id, { title, company: 'Synthetic Employer', description: sourceText, extractionMethod: method })
      records.push({ id: historic.id, method, sourceHash: historic.sourceSnapshot!.hashes.description, workingHash: createHash('sha256').update(workingText, 'utf8').digest('hex'), sourceText, workingText })
    }
    const v3 = JSON.parse(wb.backup.createBackup())
    const v2 = structuredClone(v3)
    v2.version = 2
    for (const row of v2.tables.jobs.rows) {
      const job = JSON.parse(row.data)
      delete job.contacts
      delete job.optionalDetails
      for (const revision of job.revisions) delete revision.optionalDetails
      if (job.sourceSnapshot) {
        delete job.sourceSnapshot.optionalDetails
        delete job.sourceSnapshot.conflicts
        delete job.sourceSnapshot.fieldOrigins.optionalDetails
      }
      row.data = JSON.stringify(job)
    }
    const restore = wb.backup.previewRestore(JSON.stringify(v2))
    wb.backup.applyRestore(restore.token, safetyBackup(dir))
    for (const record of records) {
      const restored = await wb.api.openJob(record.id)
      expect(restored?.sourceSnapshot?.extractionMethod).toBe(record.method)
      expect(restored?.sourceSnapshot?.description).toBe(record.sourceText)
      expect(restored?.sourceSnapshot?.hashes.description).toBe(record.sourceHash)
      expect(restored?.description).toBe(record.workingText)
      expect(restored?.contacts).toEqual([])
      expect(createHash('sha256').update(restored!.description, 'utf8').digest('hex')).toBe(record.workingHash)
    }
    wb.close(); instances.pop()
    const reopened = open(dir)
    for (const record of records) expect(await reopened.api.openJob(record.id)).toMatchObject({ sourceSnapshot: { extractionMethod: record.method, description: record.sourceText, hashes: { description: record.sourceHash } }, description: record.workingText, contacts: [] })
  } finally { wb.close() }
}, 30_000)

test('legacy backups bind untagged approved drafts to their accepted posting before later edits', async () => {
  const { dir, workbench } = fixture()
  await workbench.api.saveSkill({ name: 'TypeScript', category: 'Programming' })
  const job = await workbench.api.saveJob({ title: 'Engineer', company: 'Example', description: 'TypeScript required.' })
  if (!job.ok) throw new Error('Job fixture failed')
  const consent = await workbench.api.prepareOutboundConsent(job.value.id)
  if (!consent.ok) throw new Error('Consent fixture failed')
  await workbench.api.acceptOutboundConsent(consent.token, true, true)
  await workbench.api.startAnalysis(consent.token)
  const generated = await workbench.api.generateDraft(consent.token)
  if (!generated.ok || !generated.draft) throw new Error('Draft fixture failed')
  const corrected = await workbench.api.correctDraft({ jobId: job.value.id, section: 'skills', index: 0, text: 'TypeScript' })
  if (!corrected) throw new Error('Second draft revision fixture failed')
  await workbench.api.checkDraft(job.value.id)
  const document = await workbench.api.getCanonicalDocument(job.value.id)
  if (!document) throw new Error('Document fixture failed')
  await workbench.api.saveDocumentFitReport(job.value.id, { documentHash: createHash('sha256').update(JSON.stringify(document)).digest('hex'), targetPages: document.targetPages, actualPages: document.targetPages, extractedText: ['CV'], linkTargets: [], links: [], overflow: false, proposedCuts: [], measuredAt: new Date().toISOString() })
  expect(await workbench.api.approveDraft(job.value.id)).toMatchObject({ ok: true })
  expect(await workbench.api.saveJob({ id: job.value.id, title: job.value.title, company: job.value.company, description: 'First accepted manual revision.' })).toMatchObject({ ok: true })
  expect(await workbench.api.saveJob({ id: job.value.id, title: job.value.title, company: job.value.company, description: 'Second accepted manual revision.' })).toMatchObject({ ok: true })
  const currentJob = await workbench.api.openJob(job.value.id)
  if (!currentJob) throw new Error('Edited job fixture failed')
  const legacy = JSON.parse(workbench.backup.createBackup())
  const legacyDraftRows = legacy.tables.draft_revisions.rows.filter((row: { job_id: string }) => row.job_id === job.value.id)
  expect(legacyDraftRows.length).toBeGreaterThan(1)
  for (const draftRow of legacyDraftRows) {
    const legacyDraft = JSON.parse(draftRow.data)
    delete legacyDraft.targetPostingUpdatedAt
    draftRow.data = JSON.stringify(legacyDraft)
  }
  legacy.tables.schema_migrations.rows = legacy.tables.schema_migrations.rows.filter((row: { version: number }) => row.version !== 8)
  const preview = workbench.backup.previewRestore(JSON.stringify(legacy))
  workbench.backup.applyRestore(preview.token, safetyBackup(dir))
  workbench.close(); instances.pop()
  const reopened = open(dir)
  const restored = await reopened.api.getDraft(job.value.id)
  expect(restored).toMatchObject({ id: corrected.id, approved: true, targetPostingUpdatedAt: currentJob.revisions[0].acceptedAt })
  expect(restored?.targetPostingUpdatedAt).not.toBe(currentJob.updatedAt)
  expect(await reopened.api.assertDraftExportable(job.value.id)).toMatchObject({ ok: false })
  expect(await reopened.api.saveJob({ id: job.value.id, title: job.value.title, company: job.value.company, description: `${currentJob.description} Another requirement.` })).toMatchObject({ ok: true })
  expect(await reopened.api.approveDraft(job.value.id)).toMatchObject({ ok: false })
  expect(await reopened.api.assertDraftExportable(job.value.id)).toMatchObject({ ok: false })
}, 20000)

test('restore rejects oversized aggregate, table, row, and posting-revision inputs before replacing workspace data', async () => {
  const { dir, workbench } = fixture()
  const saved = await workbench.api.saveJob({ title: 'Preserved job', company: 'Example', description: 'Unchanged source.' })
  if (!saved.ok) throw new Error('Job fixture failed')
  const base = JSON.parse(workbench.backup.createBackup())

  expect(() => workbench.backup.previewRestore(' '.repeat(MAX_WORKSPACE_BACKUP_BYTES + 1))).toThrow(/64 MiB/)
  const tooManyRows = structuredClone(base)
  tooManyRows.tables.schema_migrations.rows = Array.from({ length: WORKSPACE_BACKUP_TABLE_ROW_LIMITS.schema_migrations + 1 }, (_, version) => ({ version }))
  expect(() => workbench.backup.previewRestore(JSON.stringify(tooManyRows))).toThrow(/schema_migrations.*row safety limit/i)
  const tooWideRow = structuredClone(base)
  tooWideRow.tables.jobs.rows[0].data = 'x'.repeat(MAX_WORKSPACE_BACKUP_ROW_BYTES + 1)
  expect(() => workbench.backup.previewRestore(JSON.stringify(tooWideRow))).toThrow(/row jobs.*16 MiB/i)
  const tooManyRevisions = structuredClone(base)
  const jobData = JSON.parse(tooManyRevisions.tables.jobs.rows[0].data)
  jobData.revisions = Array.from({ length: MAX_WORKSPACE_BACKUP_POSTING_REVISIONS + 1 }, () => null)
  tooManyRevisions.tables.jobs.rows[0].data = JSON.stringify(jobData)
  expect(() => workbench.backup.previewRestore(JSON.stringify(tooManyRevisions))).toThrow(/100000-revision safety limit/i)
  expect(await workbench.api.openJob(saved.value.id)).toEqual(saved.value)
  workbench.close(); instances.pop()
  expect(await open(dir).api.openJob(saved.value.id)).toEqual(saved.value)
})

test('failed database write rolls back the full replacement, including current credentials', async () => {
  const { dir, workbench: wb } = fixture()
  await wb.api.saveSkill({ name: 'First', category: 'Technical' })
  const backup = wb.backup.createBackup()
  await wb.api.saveSkill({ name: 'Later', category: 'Technical' })
  const external = new Database(join(dir, 'workbench.sqlite'))
  external.exec("CREATE TRIGGER refuse_restore BEFORE INSERT ON profile_skills BEGIN SELECT RAISE(ABORT, 'simulated transaction failure'); END")
  external.close()
  const preview = wb.backup.previewRestore(backup)
  expect(() => wb.backup.applyRestore(preview.token, safetyBackup(dir))).toThrow(/transaction failure/)
  expect((await wb.api.getProfile()).skills.map(skill => skill.name)).toEqual(['First', 'Later'])
  wb.close(); instances.pop()
  expect((await open(dir).api.getProfile()).skills.map(skill => skill.name)).toEqual(['First', 'Later'])
})

test('active cloud work blocks backup and restore until the operation settles', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cv-tailor-active-backup-')); directories.push(dir)
  let release: ((result: string) => void) | undefined
  let dispatched: (() => void) | undefined
  const atDispatch = new Promise<void>(resolve => { dispatched = resolve })
  const pendingResponse = new Promise<string>(resolve => { release = resolve })
  const wb = createWorkbench(dir, undefined, { generate: async () => { dispatched?.(); return pendingResponse } }); instances.push(wb)
  const job = await wb.api.saveJob({ title: 'Engineer', company: 'Example', description: 'TypeScript required.' })
  if (!job.ok) throw Error('job fixture failed')
  const saved = wb.backup.createBackup()
  const preview = wb.backup.previewRestore(saved)
  const consent = await wb.api.prepareOutboundConsent(job.value.id)
  if (!consent.ok) throw Error('consent fixture failed')
  await wb.api.acceptOutboundConsent(consent.token, true, true)
  const analysis = wb.api.startAnalysis(consent.token)
  await atDispatch
  expect(wb.hasActiveWork()).toBe(true)
  expect(() => wb.backup.createBackup()).toThrow(/active/i)
  expect(() => wb.backup.previewRestore(saved)).toThrow(/active/i)
  expect(() => wb.backup.applyRestore(preview.token, safetyBackup(dir))).toThrow(/active/i)
  release!(JSON.stringify({ required: ['TypeScript'], preferred: [], tools: [], responsibilities: [], keywords: ['TypeScript'] }))
  await analysis
  expect(wb.hasActiveWork()).toBe(false)
  expect(wb.backup.createBackup()).toContain('cv-tailor-workspace-backup')
})

test('failed safety backup and invalid input preserve a usable prior workspace across reopen', async () => {
  const { dir, workbench: wb } = fixture()
  const first = await wb.api.saveSkill({ name: 'Persisted', category: 'Technical' })
  if (!first.ok) throw Error('skill fixture failed')
  const backup = wb.backup.createBackup()
  await wb.api.saveSkill({ name: 'Not in backup', category: 'Technical' })
  expect(() => wb.backup.previewRestore('{')).toThrow(/invalid/i)
  const incompatible = JSON.parse(backup)
  incompatible.tables.schema_migrations.rows = []
  expect(() => wb.backup.previewRestore(JSON.stringify(incompatible))).toThrow(/incompatible|migration/i)
  const selected = wb.backup.previewRestore(backup)
  expect(() => wb.backup.applyRestore(selected.token, () => { throw Error('No space for safety backup') })).toThrow(/No space/)
  expect((await wb.api.getProfile()).skills).toHaveLength(2)
  wb.close(); instances.pop()
  expect((await open(dir).api.getProfile()).skills.map(item => item.name)).toEqual(['Persisted', 'Not in backup'])
})
