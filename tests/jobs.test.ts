import { afterEach, expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { createWorkbench } from '../src/main/workbench'
import { createWorkspaceBackupEngine, registerWorkspaceBackupRowSizer } from '../src/main/workspace-backup'
import { seedHistoricalJob } from './helpers/historical-job'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { jobContactSchema, jobContactsSchema, jobRecordSchema, jobSaveInputSchema } from '../src/shared/jobs'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }, 30_000)
function open(transport?: Parameters<typeof createWorkbench>[2]) {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-jobs-'))
  directories.push(directory)
  return { directory, workbench: createWorkbench(directory, undefined, transport) }
}
test('job contacts are bounded HTTPS-only record data and legacy records receive an empty contact list', () => {
  const id = 'f290c2ee-b6d6-40f1-a039-e7c589db47a8'
  expect(jobContactSchema.parse({ id, name: 'Sam Recruiter', role: 'Recruiter', profileUrl: 'https://example.com/in/sam' })).toMatchObject({ id, name: 'Sam Recruiter' })
  expect(jobContactSchema.safeParse({ id, name: 'IPv6 contact', role: 'Other', profileUrl: 'https://[2606:4700:4700::1111]/profile' }).success).toBe(true)
  expect(jobContactSchema.safeParse({ id, name: 'Sam', role: 'HR', profileUrl: 'http://example.test/profile' }).success).toBe(false)
  expect(jobContactSchema.safeParse({ id, name: 'Sam', role: 'HR', profileUrl: 'https://user:secret@example.com/profile' }).success).toBe(false)
  for (const profileUrl of ['https://localhost/profile', 'https://intranet/profile', 'https://127.0.0.1/profile', 'https://10.0.0.8/profile', 'https://192.168.1.20/profile', 'https://router.local/profile', 'https://[::1]/profile', 'https://[fe80::1]/profile']) expect(jobContactSchema.safeParse({ id, name: 'Sam', role: 'HR', profileUrl }).success).toBe(false)
  const duplicateId = jobContactsSchema.safeParse([{ id, name: 'Sam', role: 'HR', profileUrl: 'https://example.com/sam' }, { id, name: 'Pat', role: 'Other', profileUrl: null }])
  expect(duplicateId.success).toBe(false)
  const invalidInput = jobSaveInputSchema.safeParse({ title: 'Engineer', company: 'Example', description: 'Posting text', contacts: [{ id, name: '', role: '', profileUrl: 'http://localhost/' }] })
  expect(invalidInput.success).toBe(false)
  if (!invalidInput.success) expect(invalidInput.error.issues.map(issue => issue.path.join('.'))).toEqual(expect.arrayContaining(['contacts.0.name', 'contacts.0.role', 'contacts.0.profileUrl']))
  const legacy = jobRecordSchema.parse({ id, title: 'Engineer', company: 'Example', description: 'Manual posting.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), provenance: 'manual', sourceSnapshot: null, sourceHistory: [], revisions: [] })
  expect(legacy.contacts).toEqual([])
})

test('manual contacts save on the current job only, do not create posting revisions, and survive backup and reopen', async () => {
  const { directory, workbench } = open()
  const saved = await workbench.api.saveJob({ title: 'Engineer', company: 'Example', description: 'Complete manual posting text.' })
  if (!saved.ok) throw new Error(saved.error.message)
  const contact = { id: 'b09b9005-0c8f-4a92-9e7e-7a89abfacb93', name: 'Alex Recruiter', role: 'Recruiter', profileUrl: 'https://example.com/in/alex' }
  const withContact = await workbench.api.saveJob({ id: saved.value.id, title: saved.value.title, company: saved.value.company, description: saved.value.description, contacts: [contact] })
  expect(withContact).toMatchObject({ ok: true, value: { contacts: [contact], revisions: saved.value.revisions, updatedAt: saved.value.updatedAt } })
  const postingUpdate = await workbench.api.saveJob({ id: saved.value.id, title: 'Senior Engineer', company: saved.value.company, description: 'Updated accepted posting text.' })
  if (!postingUpdate.ok) throw new Error(postingUpdate.error.message)
  expect(postingUpdate.value).toMatchObject({ contacts: [contact], revisions: [...saved.value.revisions, { title: 'Senior Engineer', company: saved.value.company, description: 'Updated accepted posting text.', revision: 2, provenance: 'manual' }] })
  expect(postingUpdate.value.updatedAt).not.toBe(saved.value.updatedAt)
  const backup = workbench.backup.createBackup()
  expect(backup).toContain(contact.name)
  workbench.close()
  const reopened = createWorkbench(directory)
  expect(await reopened.api.openJob(saved.value.id)).toMatchObject({ contacts: [contact], revisions: postingUpdate.value.revisions })
  const restored = reopened.backup.previewRestore(backup)
  reopened.backup.applyRestore(restored.token, value => value)
  expect(await reopened.api.openJob(saved.value.id)).toMatchObject({ contacts: [contact] })
  reopened.close()
})

test('saved jobs preserve original posting text, have stable IDs, and reopen after SQLite restart', async () => {
  const { directory, workbench } = open()
  const original = '\n  Responsibilities:\n- Build reliable systems.\n  Requirements: TypeScript.  \n'
  const saved = await workbench.api.saveJob({ title: 'Engineer', company: 'Fictional Co', description: original })
  expect(saved.ok).toBe(true)
  if (!saved.ok) throw Error(saved.error.message)
  expect(saved.value).toMatchObject({ title: 'Engineer', company: 'Fictional Co', description: original, provenance: 'manual', sourceSnapshot: null, revisions: [{ title: 'Engineer', company: 'Fictional Co', description: original, revision: 1, provenance: 'manual' }] })
  const id = saved.value.id
  expect(await workbench.api.listJobs()).toEqual([saved.value])
  workbench.close()

  const reopened = createWorkbench(directory)
  expect(await reopened.api.openJob(id)).toEqual(saved.value)
  expect(await reopened.api.listJobs()).toEqual([saved.value])
  reopened.close()
})


test('historical imported posting snapshot and revisions remain backupable, editable, and readable offline', async () => {
  const { directory, workbench } = open()
  const initial = await workbench.api.saveJob({ title: 'Engineer', company: 'Example Co', description: 'Accepted working wording.' })
  if (!initial.ok) throw new Error(initial.error.message)
  const seeded = seedHistoricalJob(directory, initial.value.id, { title: 'Source Engineer', company: 'Source Example Co', description: 'Captured source wording.' }, [
    { title: 'Earlier Engineer', company: 'Older Example Co', description: 'Earlier captured source wording.', capturedAt: '2025-01-01T00:00:00.000Z' }
  ])
  expect(seeded.provenance).toBe('imported')
  expect(seeded.sourceSnapshot?.hashes.description).toBe(createHash('sha256').update('Captured source wording.', 'utf8').digest('hex'))
  expect(await workbench.api.openJob(initial.value.id)).toMatchObject({
    description: 'Accepted working wording.',
    sourceSnapshot: { description: 'Captured source wording.' },
    sourceHistory: [{ description: 'Earlier captured source wording.' }],
    revisions: [{ description: 'Accepted working wording.', provenance: 'imported' }]
  })
  const backup = workbench.backup.createBackup()
  expect(backup).toContain('Captured source wording.')
  expect(backup).toContain(seeded.sourceSnapshot!.hashes.description)
  const preview = workbench.backup.previewRestore(backup)
  workbench.backup.applyRestore(preview.token, value => value)
  const edit = await workbench.api.saveJob({ id: initial.value.id, title: 'Engineer', company: 'Example Co', description: 'User-edited working wording.' })
  expect(edit).toMatchObject({ ok: true, value: { provenance: 'manual', sourceSnapshot: { description: 'Captured source wording.' }, sourceHistory: [{ description: 'Earlier captured source wording.' }], revisions: [{ revision: 1, provenance: 'imported' }, { revision: 2, provenance: 'manual' }] } })
  workbench.close()
  const reopened = createWorkbench(directory)
  expect(await reopened.api.openJob(initial.value.id)).toMatchObject({
    description: 'User-edited working wording.',
    sourceSnapshot: { description: 'Captured source wording.', hashes: seeded.sourceSnapshot?.hashes },
    sourceHistory: [{ description: 'Earlier captured source wording.' }],
    revisions: [{ revision: 1, provenance: 'imported' }, { revision: 2, description: 'User-edited working wording.', provenance: 'manual' }]
  })
  reopened.close()
})

test('job validation is actionable and invalid records do not mutate storage', async () => {
  const { workbench } = open()
  const invalid = await workbench.api.saveJob({ title: '  ', company: '', description: '\n ' })
  expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { title: expect.any(String), company: expect.any(String), description: expect.any(String) } } })
  expect(await workbench.api.listJobs()).toEqual([])
  expect(await workbench.api.openJob('not-a-uuid')).toBeNull()
  const missing = await workbench.api.saveJob({ id: 'b28b5307-07dd-4e39-bc16-849c56b4c331', title: 'Engineer', company: 'Fictional Co', description: 'Build software.' })
  expect(missing).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  workbench.close()
})

test('opening another job returns only its posting and updating one keeps its identity', async () => {
  const { directory, workbench } = open()
  const first = await workbench.api.saveJob({ title: 'Engineer', company: 'Northwind', description: 'Design compiler tools.' })
  const second = await workbench.api.saveJob({ title: 'Analyst', company: 'Contoso', description: 'Review fictional datasets.' })
  if (!first.ok || !second.ok) throw Error('Fixture save failed')
  expect(await workbench.api.openJob(first.value.id)).toMatchObject({ title: 'Engineer', company: 'Northwind', description: 'Design compiler tools.' })
  expect(await workbench.api.openJob(second.value.id)).toMatchObject({ title: 'Analyst', company: 'Contoso', description: 'Review fictional datasets.' })
  const updated = await workbench.api.saveJob({ id: first.value.id, title: 'Senior Engineer', company: 'Northwind', description: 'Design compiler tools with a fictional team.' })
  expect(updated).toMatchObject({ ok: true, value: { id: first.value.id, createdAt: first.value.createdAt, title: 'Senior Engineer', revisions: [{ title: 'Engineer', revision: 1, provenance: 'manual' }, { title: 'Senior Engineer', revision: 2, provenance: 'manual' }] } })
  expect(await workbench.api.openJob(first.value.id)).toMatchObject({ revisions: [{ description: 'Design compiler tools.' }, { description: 'Design compiler tools with a fictional team.' }] })
  expect(await workbench.api.listJobs()).toHaveLength(2)
  expect(await workbench.api.openJob(second.value.id)).toEqual(second.value)
  workbench.close()
  const reopened = createWorkbench(directory)
  expect(await reopened.api.openJob(first.value.id)).toMatchObject({ id: first.value.id, createdAt: first.value.createdAt, description: 'Design compiler tools with a fictional team.', revisions: [{ description: 'Design compiler tools.' }, { description: 'Design compiler tools with a fictional team.' }] })
  reopened.close()
})

test('posting revision write ceiling matches backup limits and refuses without pruning or partial mutation', async () => {
  const { directory, workbench } = open()
  let saved = await workbench.api.saveJob({ title: 'History-bound role', company: 'Example', description: 'Revision 1.' })
  if (!saved.ok) throw Error(saved.error.message)
  for (let revision = 2; revision <= 256; revision++) {
    saved = await workbench.api.saveJob({ id: saved.value.id, title: 'History-bound role', company: 'Example', description: `Revision ${revision}.` })
    if (!saved.ok) throw Error(`Revision ${revision} was refused before the advertised history limit.`)
  }
  expect(saved.value.revisions).toHaveLength(256)
  const atLimit = saved.value
  const rejected = await workbench.api.saveJob({ id: saved.value.id, title: 'History-bound role', company: 'Example', description: 'Revision 257.' })
  expect(rejected).toMatchObject({ ok: false, error: { code: 'REVISION_LIMIT', message: expect.stringMatching(/256-revision history limit/) } })
  expect(await workbench.api.openJob(saved.value.id)).toEqual(atLimit)
  const backup = workbench.backup.createBackup()
  const preview = workbench.backup.previewRestore(backup)
  workbench.backup.applyRestore(preview.token, safety => safety)
  expect(await workbench.api.openJob(saved.value.id)).toEqual(atLimit)
  workbench.close()
  const reopened = createWorkbench(directory)
  expect(await reopened.api.openJob(saved.value.id)).toEqual(atLimit)
  reopened.close()
}, 15_000)

test('job history byte ceiling refuses atomically and the last accepted full history remains backupable', async () => {
  const { directory, workbench } = open()
  const description = (revision: number) => `${revision.toString().padStart(2, '0')}${'x'.repeat(199998)}`
  let saved = await workbench.api.saveJob({ title: 'Large history role', company: 'Example', description: description(0) })
  if (!saved.ok) throw Error(saved.error.message)
  let refused: unknown
  for (let revision = 1; revision <= 30; revision++) {
    const result = await workbench.api.saveJob({ id: saved.value.id, title: 'Large history role', company: 'Example', description: description(revision) })
    if (!result.ok) { refused = result; break }
    saved = result
  }
  expect(refused).toMatchObject({ ok: false, error: { code: 'HISTORY_SIZE_LIMIT', message: expect.stringMatching(/4 MiB/) } })
  if (!saved.ok) throw new Error('The last accepted job revision was lost.')
  const lastAccepted = saved.value
  expect(await workbench.api.openJob(lastAccepted.id)).toEqual(lastAccepted)
  const backup = workbench.backup.createBackup()
  const restore = workbench.backup.previewRestore(backup)
  workbench.backup.applyRestore(restore.token, safety => safety)
  expect(await workbench.api.openJob(lastAccepted.id)).toEqual(lastAccepted)
  workbench.close()
  const reopened = createWorkbench(directory)
  expect(await reopened.api.openJob(lastAccepted.id)).toEqual(lastAccepted)
  reopened.close()
}, 20_000)

test('legacy over-cap workspaces open safely while non-reducing edits remain blocked', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-legacy-over-cap-'))
  directories.push(directory)
  const legacyDb = new Database(join(directory, 'workbench.sqlite'))
  legacyDb.exec('CREATE TABLE jobs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL)')
  const id = '3b8fdc59-cdd0-4f9e-a4d9-e42f0f8f6b62', at = new Date().toISOString(), oldText = 'L'.repeat(20_000)
  const revisions = Array.from({ length: 300 }, (_, index) => ({ title: 'Legacy role', company: 'Example', description: oldText, revision: index + 1, acceptedAt: at, provenance: 'manual' as const }))
  const legacyRecord = { id, title: 'Legacy role', company: 'Example', description: oldText, createdAt: at, updatedAt: at, provenance: 'manual' as const, sourceSnapshot: null, revisions }
  legacyDb.prepare('INSERT INTO jobs (id,created_at,updated_at,data) VALUES (?,?,?,?)').run(id, at, at, JSON.stringify(legacyRecord))
  legacyDb.close()

  const workbench = createWorkbench(directory)
  try {
    expect(await workbench.api.getWorkspaceBackupStatus()).toMatchObject({ backupable: false, legacyOverCap: true })
    expect(await workbench.api.openJob(id)).toMatchObject({ ...legacyRecord, revisions: legacyRecord.revisions })
    const reduced = await workbench.api.saveJob({ id, title: legacyRecord.title, company: legacyRecord.company, description: 'Shorter reviewed wording.' })
    expect(reduced).toMatchObject({ ok: false, error: { code: 'HISTORY_SIZE_LIMIT' } })
    expect(await workbench.api.openJob(id)).toMatchObject({ ...legacyRecord, description: oldText })
    expect(() => workbench.backup.createBackup()).toThrow(/safety limit|accepted-storage limit/i)
  } finally { workbench.close() }
  const reopened = createWorkbench(directory)
  expect((await reopened.api.openJob(id))?.revisions).toHaveLength(300)
  expect((await reopened.api.getWorkspaceBackupStatus()).legacyOverCap).toBe(true)
  reopened.close()
})

test('corrupt over-cap saved-job rows are rejected rather than classified as recoverable legacy data', () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE jobs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL)')
  const at = new Date().toISOString()
  const corrupt = { id: 'not-a-uuid', title: 'Legacy role', company: 'Example', description: 'x'.repeat(200_001), createdAt: at, updatedAt: at, provenance: 'manual', sourceSnapshot: null, revisions: [] }
  db.prepare('INSERT INTO jobs (id,created_at,updated_at,data) VALUES (?,?,?,?)').run('not-a-uuid', at, at, JSON.stringify(corrupt))
  registerWorkspaceBackupRowSizer(db)
  try { expect(() => createWorkspaceBackupEngine(db)).toThrow(/corrupt saved-job data/i) }
  finally { db.close() }
})

test('aggregate backup ceiling rejects a multi-job save before mutation and preserves a restorable workspace', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-backup-capacity-'))
  directories.push(directory)
  const baseline = createWorkbench(directory)
  const first = await baseline.api.saveJob({ title: 'First role', company: 'Example', description: 'A'.repeat(2000) })
  const second = await baseline.api.saveJob({ title: 'Second role', company: 'Example', description: 'B'.repeat(2000) })
  if (!first.ok || !second.ok) throw Error('Job fixtures failed')
  const twoJobBackup = baseline.backup.createBackup()
  const backupBoundary = Buffer.byteLength(twoJobBackup, 'utf8') + 256
  baseline.close()

  const workbench = createWorkbench(directory, undefined, undefined, { workspaceBackupMaxBytes: backupBoundary })
  try {
    expect(Buffer.byteLength(workbench.backup.createBackup(), 'utf8')).toBeLessThanOrEqual(backupBoundary)
    const rejected = await workbench.api.saveJob({ title: 'Third role', company: 'Example', description: 'C'.repeat(1000) })
    expect(rejected).toMatchObject({ ok: false, error: { code: 'BACKUP_LIMIT', message: expect.stringMatching(/exceed.*backup safety limit/i) } })
    expect(await workbench.api.listJobs()).toHaveLength(2)
    expect(await workbench.api.openJob(first.value.id)).toEqual(first.value)
    expect(await workbench.api.openJob(second.value.id)).toEqual(second.value)
    const directWriter = new Database(join(directory, 'workbench.sqlite'))
    registerWorkspaceBackupRowSizer(directWriter)
    const directId = 'fd570a2e-53b5-4e2d-9e3d-8019ed4cc367', createdAt = new Date().toISOString()
    const directRecord = { id: directId, title: 'Direct SQL role', company: 'Example', description: 'D'.repeat(1000), createdAt, updatedAt: createdAt, provenance: 'manual', sourceSnapshot: null, revisions: [{ title: 'Direct SQL role', company: 'Example', description: 'D'.repeat(1000), revision: 1, acceptedAt: createdAt, provenance: 'manual' }] }
    expect(() => directWriter.prepare('INSERT INTO jobs (id, created_at, updated_at, data) VALUES (?, ?, ?, ?) RETURNING id').get(directId, createdAt, createdAt, JSON.stringify(directRecord))).toThrow(/WORKSPACE_BACKUP_CAPACITY/)
    expect((directWriter.prepare('SELECT COUNT(*) AS count FROM jobs').get() as { count: number }).count).toBe(2)
    directWriter.close()
    const currentBackup = workbench.backup.createBackup()
    expect(Buffer.byteLength(currentBackup, 'utf8')).toBeLessThanOrEqual(backupBoundary)
    const preview = workbench.backup.previewRestore(currentBackup)
    workbench.backup.applyRestore(preview.token, safety => safety)
    expect(await workbench.api.listJobs()).toHaveLength(2)
  } finally { workbench.close() }
})

test('backup capacity also guards non-job SQLite writes and keeps them atomic', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-nonjob-backup-capacity-'))
  directories.push(directory)
  const probe = createWorkbench(directory)
  const currentBytes = Buffer.byteLength(probe.backup.createBackup(), 'utf8')
  probe.close()
  const maxBytes = currentBytes + 512
  const workbench = createWorkbench(directory, undefined, undefined, { workspaceBackupMaxBytes: maxBytes })
  try {
    const result = await workbench.api.saveExperience({ kind: 'employment', title: 'Large record', organization: 'Example', description: 'profile evidence '.repeat(1000), factualItems: [] })
    expect(result).toMatchObject({ ok: false, error: { code: 'BACKUP_LIMIT', message: expect.stringMatching(/backup safety limit/i) } })
    expect(await workbench.api.getExperience()).toEqual({ experience: [], projects: [] })
    const backup = workbench.backup.createBackup()
    expect(Buffer.byteLength(backup, 'utf8')).toBeLessThanOrEqual(maxBytes)
  } finally { workbench.close() }
  const reopened = createWorkbench(directory)
  expect(await reopened.api.getExperience()).toEqual({ experience: [], projects: [] })
  reopened.close()
})

test('aggregate backup guard blocks model dispatch before accounting can overrun its capacity', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-backup-dispatch-capacity-'))
  directories.push(directory)
  let modelDispatches = 0
  const scripted = { async generate() { modelDispatches++; return JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] }) } }
  const probe = createWorkbench(directory, undefined, scripted)
  const job = await probe.api.saveJob({ title: 'Capacity role', company: 'Example', description: 'Bounded posting.' })
  if (!job.ok) throw Error('Job fixture failed')
  const consentA = await probe.api.prepareOutboundConsent(job.value.id)
  if (!consentA.ok) throw Error(consentA.message)
  await probe.api.acceptOutboundConsent(consentA.token, true, true)
  const backupA = probe.backup.createBackup()
  const consentB = await probe.api.prepareOutboundConsent(job.value.id)
  if (!consentB.ok) throw Error(consentB.message)
  await probe.api.acceptOutboundConsent(consentB.token, true, true)
  const backupB = probe.backup.createBackup()
  const consentRowBytes = Buffer.byteLength(backupB, 'utf8') - Buffer.byteLength(backupA, 'utf8')
  probe.close()

  const maxBytes = Buffer.byteLength(backupB, 'utf8') + consentRowBytes + 80
  const workbench = createWorkbench(directory, undefined, scripted, { workspaceBackupMaxBytes: maxBytes })
  try {
    const consent = await workbench.api.prepareOutboundConsent(job.value.id)
    if (!consent.ok) throw Error(consent.message)
    expect((await workbench.api.acceptOutboundConsent(consent.token, true, true)).ok).toBe(true)
    const result = await workbench.api.startAnalysis(consent.token)
    expect(result).toMatchObject({ status: 'failed', attempts: 0 })
    expect(result.progress).toMatch(/backup safety limit/i)
    expect(modelDispatches).toBe(0)
    expect(await workbench.api.openJob(job.value.id)).toEqual(job.value)
    expect(Buffer.byteLength(workbench.backup.createBackup(), 'utf8')).toBeLessThanOrEqual(maxBytes)
  } finally { workbench.close() }
})

test('measures a saved-job write with a sizable bounded SQLite workspace', async () => {
  const { directory, workbench } = open()
  try {
    const backup = JSON.parse(workbench.backup.createBackup())
    const createdAt = new Date().toISOString()
    backup.tables.jobs.rows = Array.from({ length: 300 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
      const description = `${'Bounded synthetic posting context. '.repeat(30)} requirement ${index}.`
      const value = { id, title: `Synthetic role ${index}`, company: 'Benchmark Systems', description, createdAt, updatedAt: createdAt, provenance: 'manual', sourceSnapshot: null, revisions: [{ title: `Synthetic role ${index}`, company: 'Benchmark Systems', description, revision: 1, acceptedAt: createdAt, provenance: 'manual' }] }
      return { id, created_at: createdAt, updated_at: createdAt, data: JSON.stringify(value) }
    })
    const restore = workbench.backup.previewRestore(JSON.stringify(backup))
    workbench.backup.applyRestore(restore.token, safety => safety)
    const started = performance.now()
    const final = await workbench.api.saveJob({ title: 'Synthetic role 300', company: 'Benchmark Systems', description: 'A measurable final bounded posting.' })
    const elapsedMs = performance.now() - started
    expect(final.ok).toBe(true)
    expect(elapsedMs).toBeLessThan(5_000)
    console.info(`backupability preflight save over 300 SQLite jobs: ${elapsedMs.toFixed(1)}ms`)
    expect(Buffer.byteLength(workbench.backup.createBackup(), 'utf8')).toBeLessThan(64 * 1024 * 1024)
  } finally { workbench.close() }
}, 30_000)

test('backupability guard rolls back non-job profile writes at the aggregate boundary', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-nonjob-backup-capacity-'))
  directories.push(directory)
  const baseline = createWorkbench(directory)
  const currentBytes = Buffer.byteLength(baseline.backup.createBackup(), 'utf8')
  baseline.close()
  const maxBytes = currentBytes + 512
  const workbench = createWorkbench(directory, undefined, undefined, { workspaceBackupMaxBytes: maxBytes })
  try {
    const result = await workbench.api.saveExperience({ kind: 'employment', title: 'Large record', organization: 'Example', description: 'profile evidence '.repeat(500), factualItems: [] })
    expect(result).toMatchObject({ ok: false, error: { code: 'BACKUP_LIMIT', message: expect.stringMatching(/backup safety limit/i) } })
    expect(await workbench.api.getExperience()).toEqual({ experience: [], projects: [] })
    expect(Buffer.byteLength(workbench.backup.createBackup(), 'utf8')).toBeLessThanOrEqual(maxBytes)
  } finally { workbench.close() }
  const reopened = createWorkbench(directory)
  expect(await reopened.api.getExperience()).toEqual({ experience: [], projects: [] })
  reopened.close()
})

test('scripted provider dispatch accepts long reviewed posting text without capacity metadata', async () => {
  let modelDispatches = 0
  const transport = {
    async generate() { modelDispatches++; return JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] }) }
  }
  const { workbench } = open(transport)
  const text = 'Complete requirements.\n'.repeat(1500)
  const job = await workbench.api.saveJob({ title: 'Engineer', company: 'Example', description: text })
  if (!job.ok) throw Error(job.error.message)
  const consent = await workbench.api.prepareOutboundConsent(job.value.id)
  if (!consent.ok) throw Error(consent.message)
  await workbench.api.acceptOutboundConsent(consent.token, true, true)
  const analysis = await workbench.api.startAnalysis(consent.token)
  expect(analysis).toMatchObject({ status: 'complete', attempts: 1 })
  expect(modelDispatches).toBe(1)
  expect((await workbench.api.openJob(job.value.id))?.description).toBe(text)
  workbench.close()
})

test('v3 backup byte ledger matches Unicode posting JSON and restores exact accepted text', async () => {
  const { directory, workbench } = open()
  const description = `設計と分析 — 👩🏽‍💻\n\nResponsibilities\n• Reliable services\n${JSON.stringify({ 日本語: '候補者', emoji: '🧪🚀', quote: '"quoted"' })}`
  const saved = await workbench.api.saveJob({ title: 'Senior Engineer – 東京', company: '例え株式会社', description })
  if (!saved.ok) throw new Error(saved.error.message)
  const backup = workbench.backup.createBackup()
  const decoded = JSON.parse(backup)
  expect(decoded.version).toBe(3)
  expect(Buffer.byteLength(backup, 'utf8')).toBe((await workbench.api.getWorkspaceBackupStatus()).bytes)
  const restore = workbench.backup.previewRestore(backup)
  workbench.backup.applyRestore(restore.token, safety => safety)
  expect((await workbench.api.openJob(saved.value.id))?.description).toBe(description)
  expect((await workbench.api.openJob(saved.value.id))?.title).toBe('Senior Engineer – 東京')
  expect(Buffer.byteLength(workbench.backup.createBackup(), 'utf8')).toBe((await workbench.api.getWorkspaceBackupStatus()).bytes)
  workbench.close()
  const reopened = createWorkbench(directory)
  expect((await reopened.api.openJob(saved.value.id))?.description).toBe(description)
  reopened.close()
})

test('complete long postings reopen exactly and text above the shared safety ceiling is refused', async () => {
  const { directory, workbench } = open()
  const complete = `Requirements:\n${'Unicode ☕ responsibilities and qualifications.\n'.repeat(1100)}`
  expect(Array.from(complete).length).toBeGreaterThan(30000)
  const saved = await workbench.api.saveJob({ title: 'Engineer', company: 'Example', description: complete })
  expect(saved.ok).toBe(true)
  if (!saved.ok) throw Error(saved.error.message)
  workbench.close()

  const reopened = createWorkbench(directory)
  expect((await reopened.api.openJob(saved.value.id))?.description).toBe(complete)
  const oversized = await reopened.api.saveJob({ title: 'Engineer', company: 'Example', description: 'x'.repeat(200001) })
  expect(oversized).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { description: expect.stringMatching(/200,000/) } } })
  expect((await reopened.api.openJob(saved.value.id))?.description).toBe(complete)
  reopened.close()
})
