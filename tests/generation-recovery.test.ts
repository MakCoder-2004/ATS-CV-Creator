import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { analysisBudgetValues } from '../src/shared/posting-analysis'

const dirs: string[] = []
const opened: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const item of opened.splice(0)) item.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })

async function seed(workspace: ReturnType<typeof createWorkbench>, runLimit = 12) {
  const budget = await workspace.api.getAnalysisUsage()
  await workspace.api.setAnalysisBudgets({ ...analysisBudgetValues(budget), minimumSpacingMs: 0, rateLimitWindowMs: 1000, runLimit })
  const role = await workspace.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Frozen Employer', description: 'Built durable systems.' })
  const job = await workspace.api.saveJob({ title: 'Engineer', company: 'Target Inc', description: 'Original posting wording.' })
  if (!role.ok || !job.ok) throw new Error('Recovery fixture could not be saved')
  const preview = await workspace.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw new Error('Recovery consent preview could not be prepared')
  await workspace.api.acceptOutboundConsent(preview.token, true, true)
  expect((await workspace.api.startAnalysis(preview.token)).status).toBe('complete')
  return { jobId: job.value.id, token: preview.token }
}

function recoveryTransport(onTailor?: () => Promise<string>): AnalysisTransport {
  return { async generate({ prompt }) {
    if (prompt.startsWith('Extract only explicit qualifications')) return JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) {
      const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant evidence.' })) })
    }
    if (onTailor) return onTailor()
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    return JSON.stringify({ education: [], experience: selected.filter((item: { category: string }) => item.category === 'experience').map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Relevant.' })), projects: [], skills: [], certificates: [] })
  } }
}

test('public recovery restores frozen consent and resumes a confirmed checkpoint after workspace reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-public-recovery-')); dirs.push(directory)
  let offlineOnce = true
  const prompts: string[] = []
  const transport = recoveryTransport(async () => {
    if (offlineOnce) { offlineOnce = false; throw Object.assign(new Error('offline'), { code: 'ECONNRESET' }) }
    return ''
  })
  const capturing: AnalysisTransport = { async generate(input) { prompts.push(input.prompt); const answer = await transport.generate(input); if (answer) return answer; const { selected } = JSON.parse(input.prompt.slice(input.prompt.indexOf('{'))); return JSON.stringify({ education: [], experience: selected.filter((item: { category: string }) => item.category === 'experience').map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Relevant.' })), projects: [], skills: [], certificates: [] }) } }
  let workspace = createWorkbench(directory, undefined, capturing); opened.push(workspace)
  const { jobId, token } = await seed(workspace, 3)
  const interrupted = await workspace.api.generateDraft(token)
  expect(interrupted.ok).toBe(false)
  const recovery = await workspace.api.getGenerationRecovery(jobId)
  expect(recovery).toMatchObject({ status: 'paused', attempts: 3, uncertainAttempts: 0, canResume: true })
  workspace.close(); opened.pop()

  workspace = createWorkbench(directory, undefined, capturing); opened.push(workspace)
  expect((await workspace.api.getGenerationRecovery(jobId))?.runId).toBe(recovery?.runId)
  expect(prompts).toHaveLength(3)
  const changedJob = await workspace.api.saveJob({ id: jobId, title: 'Changed target', company: 'New company', description: 'Changed posting must not replace frozen inputs.' })
  expect(changedJob.ok).toBe(true)
  const savedBudget = await workspace.api.getAnalysisUsage()
  await workspace.api.setAnalysisBudgets({ ...analysisBudgetValues(savedBudget), runLimit: 4 })
  const resumed = await workspace.api.resumeGeneration(recovery!.runId)
  expect(resumed.ok).toBe(true)
  expect((await workspace.api.getDraft(jobId))?.content.experience).toHaveLength(1)
  expect(prompts.filter(prompt => prompt.startsWith('Score these numbered'))).toHaveLength(1)
  expect(prompts.at(-1)).toContain('Original posting wording.')
  expect(prompts.join('\n')).not.toContain('Changed posting must not replace frozen inputs.')
  expect(await workspace.api.getGenerationRecovery(jobId)).toBeNull()
  workspace.close(); opened.pop()
  const extensionDb = new Database(join(directory, 'workbench.sqlite'))
  expect(extensionDb.prepare('SELECT prior_run_limit,new_run_limit FROM generation_recovery_extensions WHERE run_id=?').get(recovery!.runId)).toEqual({ prior_run_limit: 3, new_run_limit: 4 })
  expect(extensionDb.prepare('SELECT COUNT(*) AS count FROM analysis_attempts WHERE run_id=?').get(recovery!.runId)).toMatchObject({ count: 4 })
  extensionDb.close()
}, 20000)

test('an uncertain dispatched request requires an explicit duplicate-risk choice before replay', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-uncertain-recovery-')); dirs.push(directory)
  const initialTransport = recoveryTransport(async () => { throw Object.assign(new Error('response was interrupted'), { code: 'ECONNRESET' }) })
  let workspace = createWorkbench(directory, undefined, initialTransport); opened.push(workspace)
  const { jobId, token } = await seed(workspace, 3)
  expect((await workspace.api.generateDraft(token)).ok).toBe(false)
  const paused = await workspace.api.getGenerationRecovery(jobId)
  workspace.close(); opened.pop()

  // Model the crash window after durable dispatch accounting but before the response outcome was checkpointed.
  const sqlite = new Database(join(directory, 'workbench.sqlite'))
  sqlite.prepare("UPDATE provider_attempt_outcomes SET outcome='dispatched',settled_at=NULL WHERE id=(SELECT id FROM provider_attempt_outcomes WHERE run_id=? AND outcome='error' ORDER BY id DESC LIMIT 1)").run(paused!.runId)
  sqlite.close()

  let retryRequests = 0
  const retryTransport: AnalysisTransport = { async generate(input) { retryRequests++; return recoveryTransport().generate(input) } }
  workspace = createWorkbench(directory, undefined, retryTransport); opened.push(workspace)
  const recovery = await workspace.api.getGenerationRecovery(jobId)
  expect(recovery).toMatchObject({ status: 'uncertain', uncertainAttempts: 1 })
  const declined = await workspace.api.resumeGeneration(recovery!.runId)
  expect(declined).toMatchObject({ ok: false, message: expect.stringMatching(/uncertain|explicitly/i) })
  expect(retryRequests).toBe(0)
  const budget = await workspace.api.getAnalysisUsage()
  await workspace.api.setAnalysisBudgets({ ...analysisBudgetValues(budget), runLimit: 4 })
  const resumed = await workspace.api.resumeGeneration(recovery!.runId, 'retry-uncertain')
  expect(resumed.ok).toBe(true)
  expect(retryRequests).toBe(1)
  expect((await workspace.api.getDraft(jobId))?.content.experience).toHaveLength(1)
}, 20000)
