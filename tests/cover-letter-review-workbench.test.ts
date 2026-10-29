import { afterEach, expect, test } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { coverLetterOperationSchema, coverLetterRevisionSchema } from '../src/shared/cover-letter'
import { defaultOpenRouterModel } from '../src/shared/openrouter-settings'

const dirs: string[] = []
const workbenches: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const wb of workbenches.splice(0)) wb.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const transport: AnalysisTransport = { async generate({ prompt }) {
  if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: [], responsibilities: [], keywords: ['TypeScript'] })
  if (prompt.startsWith('Score these numbered')) { const { items } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Matches saved evidence.' })) }) }
  const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
  const skill = selected.find((item: { category: string }) => item.category === 'skills')
  return JSON.stringify({ headline: 'Engineer', summary: { text: 'Engineer with saved skills.', evidence: [skill.index], rationale: 'Uses a saved skill.' }, education: [], experience: [], projects: [], skills: [{ name: 'TypeScript', evidence: [skill.index], rationale: 'Saved skill.' }] })
} }
function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }

test('letter edits and recipient stay local, acknowledgments bind to current text, and approval refuses absent actual fit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'letter-review-')); dirs.push(dir)
  const wb = createWorkbench(dir, undefined, transport); workbenches.push(wb)
  const skill = await wb.api.saveSkill({ name: 'TypeScript', category: 'Programming' })
  const job = await wb.api.saveJob({ title: 'Engineer', company: 'Example', description: 'Build TypeScript systems.' })
  if (!skill.ok || !job.ok) throw new Error('Fixture setup failed.')
  const preview = await wb.api.prepareOutboundConsent(job.value.id, 'cv+cover-letter')
  if (!preview.ok) throw new Error(preview.message)
  const consent = await wb.api.acceptOutboundConsent(preview.token, true, true)
  if (!consent.ok) throw new Error(consent.message)
  expect((await wb.api.startAnalysis(preview.token)).status).toBe('complete')
  const generated = await wb.api.generateDraft(preview.token)
  if (!generated.ok || !generated.draft) throw new Error('CV fixture failed.')
  const foreignJob = await wb.api.saveJob({ title: 'Other Engineer', company: 'Other Example', description: 'Build TypeScript systems.' })
  if (!foreignJob.ok) throw new Error('Foreign job fixture failed.')
  const foreignPreview = await wb.api.prepareOutboundConsent(foreignJob.value.id)
  if (!foreignPreview.ok) throw new Error(foreignPreview.message)
  const foreignConsent = await wb.api.acceptOutboundConsent(foreignPreview.token, true, true)
  if (!foreignConsent.ok) throw new Error(foreignConsent.message)
  expect((await wb.api.startAnalysis(foreignPreview.token)).status).toBe('complete')
  const foreignDraft = await wb.api.generateDraft(foreignPreview.token)
  if (!foreignDraft.ok || !foreignDraft.draft) throw new Error('Foreign CV fixture failed.')
  const sourceDb = new Database(join(dir, 'workbench.sqlite'), { readonly: true })
  let sourceHash: { scope_hash: string }
  try { sourceHash = sourceDb.prepare('SELECT scope_hash FROM outbound_consents WHERE run_id=?').get(consent.runId) as { scope_hash: string } } finally { sourceDb.close() }
  const letterId = randomUUID(), operationId = randomUUID(), now = new Date().toISOString()
  // This fixture has a real current v5 parent: use its issued skill JSON, not a historical display label.
  const dataSource = { ordinal: 1, evidenceId: skill.value.skills[0].id, revision: skill.value.skills[0].revision, category: 'skill' as const, heading: 'TypeScript', passage: JSON.stringify({ name: 'TypeScript', category: 'Programming' }) }
  const currentSettings = await wb.api.getSettings()
  const letter = coverLetterRevisionSchema.parse({ id: letterId, jobId: job.value.id, parentRunId: consent.runId, operationId, cvRevisionId: generated.draft.id, revision: 1, createdAt: now, bindings: { postingUpdatedAt: job.value.updatedAt, scopeHash: sourceHash.scope_hash, modelHash: digest({ name: defaultOpenRouterModel }), sources: [dataSource] }, date: '28 October 2026', subject: 'Application for Engineer', paragraphs: [{ id: randomUUID(), text: 'I have built TypeScript systems.', citations: [{ ordinal: 1 }] }], findings: [], acknowledgments: {}, fit: { documentHash: 'c'.repeat(64), actualPages: 1, overflow: false, measuredAt: now }, approved: false })
  const db = new Database(join(dir, 'workbench.sqlite'))
  db.function('cv_workspace_backup_row_bytes', { deterministic: true }, (rowJson: string) => Buffer.byteLength(JSON.stringify(JSON.parse(rowJson)), 'utf8'))
  try {
    const grant = db.prepare('SELECT id,purpose_hash FROM outbound_consents WHERE run_id=?').get(consent.runId) as { id: string; purpose_hash: string }
    const operation = coverLetterOperationSchema.parse({ id: operationId, jobId: job.value.id, parentRunId: consent.runId, consentId: grant.id, purposeHash: grant.purpose_hash, status: 'saved', createdAt: now, updatedAt: now })
    db.prepare('INSERT INTO cover_letter_operations(id,job_id,parent_run_id,consent_id,status,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(operation.id, operation.jobId, operation.parentRunId, operation.consentId, operation.status, JSON.stringify(operation), now, now)
    db.prepare('INSERT INTO cover_letter_revisions(id,job_id,revision,data) VALUES(?,?,?,?)').run(letter.id, letter.jobId, letter.revision, JSON.stringify(letter))
  } finally { db.close() }
  const beforeProfile = await wb.api.getProfile(), beforeCv = await wb.api.getDraft(job.value.id)
  expect(await wb.api.getCoverLetter(job.value.id)).toEqual(letter)
  const validBackup = JSON.parse(wb.backup.createBackup())
  const foreignOwner = structuredClone(validBackup)
  foreignOwner.tables.cover_letter_operations.rows[0].job_id = randomUUID()
  expect(() => wb.backup.previewRestore(JSON.stringify(foreignOwner))).toThrow(/cover_letter_operations/)
  const orphanedCv = structuredClone(validBackup)
  const orphanedLetter = JSON.parse(orphanedCv.tables.cover_letter_revisions.rows[0].data)
  orphanedLetter.cvRevisionId = randomUUID()
  orphanedCv.tables.cover_letter_revisions.rows[0].data = JSON.stringify(orphanedLetter)
  expect(() => wb.backup.previewRestore(JSON.stringify(orphanedCv))).toThrow(/cover_letter_revisions/)
  const foreignCv = structuredClone(validBackup)
  const foreignLetter = JSON.parse(foreignCv.tables.cover_letter_revisions.rows[0].data)
  foreignLetter.cvRevisionId = foreignDraft.draft.id
  foreignCv.tables.cover_letter_revisions.rows[0].data = JSON.stringify(foreignLetter)
  expect(() => wb.backup.previewRestore(JSON.stringify(foreignCv))).toThrow(/cover_letter_revisions/)
  const missingCv = structuredClone(validBackup)
  const missingLetter = JSON.parse(missingCv.tables.cover_letter_revisions.rows[0].data)
  delete missingLetter.cvRevisionId
  missingCv.tables.cover_letter_revisions.rows[0].data = JSON.stringify(missingLetter)
  expect(() => wb.backup.previewRestore(JSON.stringify(missingCv))).toThrow()
  const injected = await wb.api.editCoverLetter({ jobId: job.value.id, letterId, paragraphs: letter.paragraphs, recipient: null, acknowledgments: { [letter.paragraphs[0]!.id]: 'f'.repeat(64) } } as never)
  expect(injected).toMatchObject({ ok: false })
  const wording = await wb.api.editCoverLetter({ jobId: job.value.id, letterId, paragraphs: [{ ...letter.paragraphs[0]!, text: 'I have built and maintained TypeScript systems.' }], recipient: null })
  expect(wording).toMatchObject({ ok: true, letter: { revision: 2, acknowledgments: {}, approved: false } })
  if (!wording.letter) throw new Error('Wording edit was not saved.')
  const ack = await wb.api.acknowledgeCoverLetterParagraph({ jobId: job.value.id, letterId: wording.letter.id, paragraphId: wording.letter.paragraphs[0]!.id, acknowledged: true })
  expect(ack).toMatchObject({ ok: true })
  const approved = await wb.api.approveCoverLetter(job.value.id)
  expect(approved).toMatchObject({ ok: false, message: expect.stringMatching(/main-generated PDF fit measurement/i) })
  const edited = await wb.api.setCoverLetterRecipient({ jobId: job.value.id, letterId: wording.letter.id, recipient: 'Local Recipient' })
  expect(edited).toMatchObject({ ok: true, letter: { recipient: 'Local Recipient', acknowledgments: {}, approved: false } })
  expect(await wb.api.approveCoverLetter(job.value.id)).toMatchObject({ ok: false })
  expect(await wb.api.getProfile()).toEqual(beforeProfile)
  expect(await wb.api.getDraft(job.value.id)).toEqual(beforeCv)
  expect(currentSettings.pi).toBeNull()
  expect((await wb.api.getCoverLetter(job.value.id))?.fit).toBeUndefined()
  await wb.api.saveSkill({ id: skill.value.skills[0]!.id, name: 'TypeScript 5', category: 'Programming' })
  expect(await wb.api.checkCoverLetter(job.value.id)).toMatchObject({ ok: false, message: expect.stringMatching(/source scope|career fact changed/i) })
  wb.close(); workbenches.pop()
  const reopened = createWorkbench(dir, undefined, transport); workbenches.push(reopened)
  expect(await reopened.api.getCoverLetter(job.value.id)).toMatchObject({ recipient: 'Local Recipient', approved: false })
  const forgedApproval = JSON.parse(reopened.backup.createBackup())
  const currentLetterIndex = forgedApproval.tables.cover_letter_revisions.rows.reduce((latest: number, row: { data: string }, index: number, rows: Array<{ data: string }>) => JSON.parse(row.data).revision > JSON.parse(rows[latest]!.data).revision ? index : latest, 0)
  const forgedLetter = JSON.parse(forgedApproval.tables.cover_letter_revisions.rows[currentLetterIndex].data)
  forgedLetter.acknowledgments = { [forgedLetter.paragraphs[0].id]: 'f'.repeat(64) }
  forgedLetter.approved = true
  forgedLetter.approvedAt = now
  forgedLetter.fit = { documentHash: 'c'.repeat(64), actualPages: 1, overflow: false, measuredAt: now }
  forgedApproval.tables.cover_letter_revisions.rows[currentLetterIndex].data = JSON.stringify(forgedLetter)
  const restore = reopened.backup.previewRestore(JSON.stringify(forgedApproval))
  reopened.backup.applyRestore(restore.token, content => content)
  expect(await reopened.api.getCoverLetter(job.value.id)).toMatchObject({ approved: false, acknowledgments: {} })
  expect(await reopened.api.getCoverLetter(job.value.id)).not.toHaveProperty('fit')
  const blockingFinding = structuredClone(forgedApproval)
  const findingLetter = JSON.parse(blockingFinding.tables.cover_letter_revisions.rows[currentLetterIndex].data)
  findingLetter.approved = false
  delete findingLetter.approvedAt
  findingLetter.findings = [{ code: 'unsupported-claim', message: 'A known unsupported claim still blocks review.' }]
  blockingFinding.tables.cover_letter_revisions.rows[currentLetterIndex].data = JSON.stringify(findingLetter)
  const findingRestore = reopened.backup.previewRestore(JSON.stringify(blockingFinding))
  reopened.backup.applyRestore(findingRestore.token, content => content)
  expect(await reopened.api.getCoverLetter(job.value.id)).toMatchObject({ approved: false, findings: [{ code: 'unsupported-claim' }] })
})
