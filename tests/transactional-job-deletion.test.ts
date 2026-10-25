import { afterEach, expect, test } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'

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
