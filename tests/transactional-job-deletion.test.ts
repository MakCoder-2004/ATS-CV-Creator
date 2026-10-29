import { afterEach, expect, test } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { coverLetterOperationSchema, coverLetterRevisionSchema } from '../src/shared/cover-letter'

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
    return JSON.stringify({ items: sourcesByItem.map(() => ({ text: 'TypeScript', rationale: 'Retains cited evidence.' })) })
  }
  if (prompt.startsWith('Score these numbered')) {
    const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant source.' })) })
  }
  const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
  const paragraphs = (category: string) => selected.filter((item: { category: string }) => item.category === category).map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Cited source.' }))
  return JSON.stringify({ headline: 'Engineer', summary: { text: 'Engineer with saved experience.', evidence: [selected[0].index], rationale: 'Saved source.' }, education: paragraphs('education'), experience: paragraphs('experience'), projects: paragraphs('projects'), skills: selected.filter((item: { category: string }) => item.category === 'skills').map((item: { index: number; text: string }) => ({ name: JSON.parse(item.text).name, evidence: [item.index], rationale: 'Saved skill.' })), certificates: paragraphs('certificates') })
} }

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'job-deletion-'))
  directories.push(directory)
  const workbench = createWorkbench(directory, undefined, scripted)
  workbenches.push(workbench)
  expect((await workbench.api.saveContact({ fullName: 'Synthetic Candidate' })).ok).toBe(true)
  expect((await workbench.api.saveSkill({ name: 'TypeScript', category: 'Programming' })).ok).toBe(true)
  const jobs = []
  const runs = []
  for (const title of ['Alpha', 'Beta', 'Gamma']) {
    const saved = await workbench.api.saveJob({ title, company: `${title} Labs`, description: 'TypeScript required.' })
    if (!saved.ok) throw Error('job fixture failed')
    const consent = await workbench.api.prepareOutboundConsent(saved.value.id)
    if (!consent.ok) throw Error('consent fixture failed')
    const accepted = await workbench.api.acceptOutboundConsent(consent.token, true, true)
    if (!accepted.ok) throw Error('consent save failed')
    expect((await workbench.api.startAnalysis(consent.token)).status).toBe('complete')
    expect((await workbench.api.generateDraft(consent.token)).ok).toBe(true)
    jobs.push(saved.value)
    runs.push({ runId: accepted.runId, consentToken: consent.token })
  }
  return { directory, workbench, jobs, runs }
}

function snapshot(directory: string) {
  const db = new Database(join(directory, 'workbench.sqlite'), { readonly: true })
  try {
    return Object.fromEntries(['jobs', 'outbound_consents', 'posting_analysis_cache', 'analysis_run_state', 'analysis_attempts', 'provider_attempt_outcomes', 'generation_recovery', 'generation_recovery_extensions', 'draft_revisions', 'regeneration_proposals', 'document_fit_reports', 'langgraph_checkpoints', 'langgraph_checkpoint_writes', 'profile_skills', 'evidence_revisions'].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
  } finally { db.close() }
}

test('job deletion fingerprints and removes only the selected job cover-letter rows', async () => {
  const { directory, workbench, jobs, runs } = await fixture()
  const db = new Database(join(directory, 'workbench.sqlite'))
  db.function('cv_workspace_backup_row_bytes', { deterministic: true }, (rowJson: string) => Buffer.byteLength(JSON.stringify(JSON.parse(rowJson)), 'utf8'))
  const now = new Date().toISOString()
  try { for (const [index, job] of jobs.slice(0, 2).entries()) {
    const parentRunId = runs[index]!.runId
    const operationId = randomUUID(), letterId = randomUUID()
    const consent = db.prepare('SELECT id,purpose_hash FROM outbound_consents WHERE run_id=?').get(parentRunId) as { id: string; purpose_hash: string }
    const skill = (await workbench.api.getProfile()).skills[0]!
    const draft = await workbench.api.getDraft(job.id)
    const operation = coverLetterOperationSchema.parse({ id: operationId, jobId: job.id, parentRunId, consentId: consent.id, purposeHash: consent.purpose_hash, status: 'saved', createdAt: now, updatedAt: now })
    const letter = coverLetterRevisionSchema.parse({ id: letterId, jobId: job.id, parentRunId, operationId, cvRevisionId: draft!.id, revision: 1, createdAt: now, bindings: { postingUpdatedAt: job.updatedAt, scopeHash: 'a'.repeat(64), modelHash: 'b'.repeat(64), sources: [{ ordinal: 1, evidenceId: skill.id, revision: skill.revision, category: 'skill', heading: skill.name, passage: skill.name }] }, date: '28 October 2026', subject: job.title, paragraphs: [{ id: randomUUID(), text: 'Saved evidence supports this paragraph.', citations: [{ ordinal: 1 }] }], findings: [], acknowledgments: {}, approved: false })
    db.prepare('INSERT INTO cover_letter_revisions(id,job_id,revision,data) VALUES(?,?,?,?)').run(letter.id, job.id, letter.revision, JSON.stringify(letter))
    db.prepare('INSERT INTO cover_letter_operations(id,job_id,parent_run_id,consent_id,status,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(operation.id, operation.jobId, operation.parentRunId, operation.consentId, operation.status, JSON.stringify(operation), now, now)
  } } finally { db.close() }
  const preview = await workbench.api.previewJobDeletion([jobs[0]!.id])
  expect(preview).toMatchObject({ ok: true })
  if (!preview.ok) throw new Error(preview.message)
  expect(await workbench.api.executeJobDeletion(preview.token!, [jobs[0]!.id])).toMatchObject({ ok: true, deletedCount: 1 })
  const read = new Database(join(directory, 'workbench.sqlite'), { readonly: true })
  try {
    expect(read.prepare('SELECT job_id FROM cover_letter_revisions').all()).toEqual([{ job_id: jobs[1]!.id }])
    expect(read.prepare('SELECT job_id FROM cover_letter_operations').all()).toEqual([{ job_id: jobs[1]!.id }])
    expect(read.prepare('SELECT COUNT(*) AS count FROM jobs').get()).toEqual({ count: 2 })
  } finally { read.close() }
})

test('a dispatched letter operation reopens as uncertain without permanently blocking deletion', async () => {
  const { directory, workbench, jobs, runs } = await fixture()
  const now = new Date().toISOString(), id = randomUUID(), parentRunId = runs[0]!.runId
  const db = new Database(join(directory, 'workbench.sqlite'))
  db.function('cv_workspace_backup_row_bytes', { deterministic: true }, (rowJson: string) => Buffer.byteLength(JSON.stringify(JSON.parse(rowJson)), 'utf8'))
  try {
    const consent = db.prepare('SELECT id,purpose_hash FROM outbound_consents WHERE run_id=?').get(parentRunId) as { id: string; purpose_hash: string }
    const operation = coverLetterOperationSchema.parse({ id, jobId: jobs[0]!.id, parentRunId, consentId: consent.id, purposeHash: consent.purpose_hash, status: 'dispatched', createdAt: now, updatedAt: now })
    db.prepare('INSERT INTO cover_letter_operations(id,job_id,parent_run_id,consent_id,status,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, jobs[0]!.id, parentRunId, consent.id, operation.status, JSON.stringify(operation), now, now)
  } finally { db.close() }
  workbench.close(); workbenches.pop()
  const reopened = createWorkbench(directory, undefined, scripted); workbenches.push(reopened)
  const state = new Database(join(directory, 'workbench.sqlite'), { readonly: true })
  try { expect(state.prepare('SELECT status FROM cover_letter_operations WHERE id=?').get(id)).toEqual({ status: 'uncertain' }) } finally { state.close() }
  expect(await reopened.api.previewJobDeletion([jobs[0]!.id])).toMatchObject({ ok: true })
})

test('pre-change public-workflow baseline has three drafts, analysis, consent and checkpoints in a backup', async () => {
  const { directory, workbench, jobs } = await fixture()
  const rows = snapshot(directory)
  expect(rows.jobs).toHaveLength(3)
  expect(rows.draft_revisions).toHaveLength(3)
  expect(rows.outbound_consents).toHaveLength(3)
  expect(rows.analysis_run_state).toHaveLength(3)
  expect((rows.langgraph_checkpoints as unknown[]).length).toBeGreaterThan(0)
  const backup = JSON.parse(workbench.backup.createBackup())
  for (const job of jobs) expect(backup.tables.jobs.rows.some((row: { id: string }) => row.id === job.id)).toBe(true)
  expect(backup.tables.draft_revisions.rows).toHaveLength(3)
  expect(backup.tables.langgraph_checkpoints.rows.length).toBeGreaterThan(0)
})
