import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import Database from 'better-sqlite3'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { analysisBudgetValues } from '../src/shared/posting-analysis'

const directories: string[] = []
const instances: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => {
  for (const item of instances.splice(0)) item.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
const scripted: AnalysisTransport = { async generate({ prompt }) {
  if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: ['TypeScript'], responsibilities: [], keywords: ['TypeScript'] })
  if (prompt.startsWith('Score these numbered')) {
    const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant profile source.' })) })
  }
  const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
  const paragraphs = (category: string) => selected.filter((item: { category: string }) => item.category === category).map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Cited authorized evidence.' }))
  return JSON.stringify({ education: paragraphs('education'), experience: paragraphs('experience'), projects: paragraphs('projects'), skills: selected.filter((item: { category: string }) => item.category === 'skills').map((item: { index: number; text: string }) => ({ name: JSON.parse(item.text).name, evidence: [item.index], rationale: 'Saved skill.' })), certificates: paragraphs('certificates') })
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

test('complete workspace backup restores draft revisions, evidence, posting, preferences and usage from real persistence without automatically dispatching', async () => {
  const { dir, workbench: wb } = fixture()
  const requests: string[] = []
  const capture: AnalysisTransport = { async generate(input) { requests.push(input.prompt); return scripted.generate(input) } }
  wb.close(); instances.pop()
  const active = createWorkbench(dir, undefined, capture); instances.push(active)
  const budget = analysisBudgetValues(await active.api.getAnalysisUsage())
  await active.api.setAnalysisBudgets({ ...budget, minimumSpacingMs: 0, rateLimitWindowMs: 1000 })
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
  const backup = active.backup.createBackup()
  expect(JSON.parse(backup).tables.draft_revisions.rows).toHaveLength(1)
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
  expect((await reopened.api.listJobs()).map(item => item.title)).toEqual(['Engineer'])
  expect((await reopened.api.getDraft(job.value.id))?.id).toBe(original.id)
  expect((await reopened.api.getDraft(job.value.id))?.evidence).toEqual(original.evidence)
  expect((await reopened.api.getAnalysisUsage()).attempts).toBeGreaterThan(0)
  expect((await reopened.api.getAnalysisUsage()).minimumSpacingMs).toBe(0)
  expect(requests.length).toBe(attemptsBeforeReopen)
  expect(await reopened.api.getAnalysis(job.value.id)).toMatchObject({ status: 'complete' })
  await expect(reopened.api.startAnalysis(consent.token)).rejects.toThrow()
  expect(requests.length).toBe(attemptsBeforeReopen)
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
