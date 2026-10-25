import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { registerWorkspaceBackupRowSizer } from '../src/main/workspace-backup'

const dirs: string[] = []
const opened: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const item of opened.splice(0)) item.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })

async function seed(workspace: ReturnType<typeof createWorkbench>) {
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
    return JSON.stringify({ headline: 'Engineer', summary: { text: 'Engineer with relevant evidence.', evidence: [selected[0].index], rationale: 'Selected profile evidence.' }, education: [], experience: selected.filter((item: { category: string }) => item.category === 'experience').map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Relevant.' })), projects: [], skills: [], certificates: [] })
  } }
}

test('public recovery resumes frozen consent after restart when the accepted posting is unchanged', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-public-recovery-')); dirs.push(directory)
  let offlineOnce = true
  const prompts: string[] = []
  const transport = recoveryTransport(async () => {
    if (offlineOnce) { offlineOnce = false; throw Object.assign(new Error('offline'), { code: 'ECONNRESET' }) }
    return ''
  })
  const capturing: AnalysisTransport = { async generate(input) { prompts.push(input.prompt); const answer = await transport.generate(input); if (answer) return answer; const { selected } = JSON.parse(input.prompt.slice(input.prompt.indexOf('{'))); return JSON.stringify({ headline: 'Engineer', summary: { text: 'Engineer with relevant evidence.', evidence: [selected[0].index], rationale: 'Selected profile evidence.' }, education: [], experience: selected.filter((item: { category: string }) => item.category === 'experience').map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Relevant.' })), projects: [], skills: [], certificates: [] }) } }
  let workspace = createWorkbench(directory, undefined, capturing); opened.push(workspace)
  const { jobId, token } = await seed(workspace)
  expect(await workspace.api.generateDraft(token)).toMatchObject({ ok: false })
  const recovery = await workspace.api.getGenerationRecovery(jobId)
  expect(recovery).toMatchObject({ status: 'uncertain', attempts: 3, uncertainAttempts: 1, canResume: true })
  workspace.close(); opened.pop()

  workspace = createWorkbench(directory, undefined, capturing); opened.push(workspace)
  expect((await workspace.api.getGenerationRecovery(jobId))?.runId).toBe(recovery?.runId)
  expect(prompts).toHaveLength(3)

  const resumed = await workspace.api.resumeGeneration(recovery!.runId, 'retry-uncertain')
  expect(resumed.ok).toBe(true)
  expect((await workspace.api.openJob(jobId))?.description).toBe('Original posting wording.')
  expect((await workspace.api.getDraft(jobId))?.content.experience).toHaveLength(1)
  expect(prompts.filter(prompt => prompt.startsWith('Score these numbered'))).toHaveLength(1)
  expect(prompts.at(-1)).toContain('Original posting wording.')
  expect(await workspace.api.getGenerationRecovery(jobId)).toBeNull()
  workspace.close(); opened.pop()
  const attemptsDb = new Database(join(directory, 'workbench.sqlite'))
  expect(attemptsDb.prepare('SELECT COUNT(*) AS count FROM analysis_attempts WHERE run_id=?').get(recovery!.runId)).toMatchObject({ count: 4 })
  attemptsDb.close()
}, 20000)

test('recovering one job cannot block another accepted job from repairing malformed analysis', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-recovery-budget-')); dirs.push(directory)
  let tailorCalls = 0, otherAnalysisCalls = 0
  let announceResume!: () => void, releaseResume!: () => void
  const resumeStarted = new Promise<void>(resolve => { announceResume = resolve })
  const resumeGate = new Promise<void>(resolve => { releaseResume = resolve })
  const ordinary = recoveryTransport()
  const transport: AnalysisTransport = { async generate(input) {
    if (input.prompt.startsWith('Extract only explicit qualifications') && input.prompt.includes('SECOND_POSTING_CANARY')) {
      otherAnalysisCalls++
      return otherAnalysisCalls === 1 ? '{bad' : JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] })
    }
    if (input.prompt.startsWith('Write concise')) {
      tailorCalls++
      if (tailorCalls === 1) throw Object.assign(new Error('offline'), { code: 'ECONNRESET' })
      if (tailorCalls === 2) { announceResume(); await resumeGate }
    }
    return ordinary.generate(input)
  } }
  const workspace = createWorkbench(directory, undefined, transport); opened.push(workspace)
  const { jobId, token } = await seed(workspace)
  expect((await workspace.api.generateDraft(token)).ok).toBe(false)
  const recovery = await workspace.api.getGenerationRecovery(jobId)
  expect(recovery?.status).toBe('uncertain')
  const other = await workspace.api.saveJob({ title: 'Second role', company: 'Example', description: 'SECOND_POSTING_CANARY' })
  if (!other.ok) throw Error('Second job fixture failed')
  const preview = await workspace.api.prepareOutboundConsent(other.value.id)
  if (!preview.ok) throw Error(preview.message)
  await workspace.api.acceptOutboundConsent(preview.token, true, true)
  const resumed = workspace.api.resumeGeneration(recovery!.runId, 'retry-uncertain')
  await resumeStarted
  const otherAnalysis = workspace.api.startAnalysis(preview.token)
  releaseResume()
  expect((await resumed).ok).toBe(true)
  expect(await otherAnalysis).toMatchObject({ status: 'complete', attempts: 2 })
  expect(otherAnalysisCalls).toBe(2)
}, 20000)

test('accepted target edits after restart revoke paused recovery consent without dispatching stale inputs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-public-recovery-')); dirs.push(directory)
  let offlineOnce = true
  const prompts: string[] = []
  const transport = recoveryTransport(async () => {
    if (offlineOnce) { offlineOnce = false; throw Object.assign(new Error('offline'), { code: 'ECONNRESET' }) }
    return ''
  })
  const capturing: AnalysisTransport = { async generate(input) { prompts.push(input.prompt); const answer = await transport.generate(input); if (answer) return answer; const { selected } = JSON.parse(input.prompt.slice(input.prompt.indexOf('{'))); return JSON.stringify({ headline: 'Engineer', summary: { text: 'Engineer with relevant evidence.', evidence: [selected[0].index], rationale: 'Selected profile evidence.' }, education: [], experience: selected.filter((item: { category: string }) => item.category === 'experience').map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Relevant.' })), projects: [], skills: [], certificates: [] }) } }
  let workspace = createWorkbench(directory, undefined, capturing); opened.push(workspace)
  const { jobId, token } = await seed(workspace)
  const interrupted = await workspace.api.generateDraft(token)
  expect(interrupted.ok).toBe(false)
  const recovery = await workspace.api.getGenerationRecovery(jobId)
  expect(recovery).toMatchObject({ status: 'uncertain', attempts: 3, uncertainAttempts: 1, canResume: true })
  workspace.close(); opened.pop()

  workspace = createWorkbench(directory, undefined, capturing); opened.push(workspace)
  expect((await workspace.api.getGenerationRecovery(jobId))?.runId).toBe(recovery?.runId)
  expect(prompts).toHaveLength(3)
  const changedJob = await workspace.api.saveJob({ id: jobId, title: 'Changed target', company: 'New company', description: 'Changed posting must not replace frozen inputs.' })
  expect(changedJob.ok).toBe(true)
  expect(await workspace.api.getAnalysis(jobId)).toMatchObject({ status: 'stale', progress: expect.stringMatching(/may be uncertain.*cannot resume/i) })

  const requestsBeforeResume = prompts.length
  const resumed = await workspace.api.resumeGeneration(recovery!.runId, 'retry-uncertain')
  expect(resumed).toMatchObject({ ok: false, message: expect.stringMatching(/no longer resumable|no recoverable|consent.*revoked/i) })
  expect(prompts).toHaveLength(requestsBeforeResume)
  expect(await workspace.api.getGenerationRecovery(jobId)).toBeNull()
  expect(await workspace.api.getDraft(jobId)).toBeNull()
  workspace.close(); opened.pop()
}, 20000)

test('a provider response without its graph checkpoint remains uncertain after restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-response-gap-')); dirs.push(directory)
  let failBeforeCheckpoint = true
  const prompts: string[] = []
  const transport: AnalysisTransport = { async generate(input) { prompts.push(input.prompt); return recoveryTransport().generate(input) } }
  let workspace = createWorkbench(directory, undefined, transport, { beforeGraphCheckpoint(metadata) {
    if (metadata.source === 'loop' && failBeforeCheckpoint) { failBeforeCheckpoint = false; throw new Error('simulated process loss after response, before graph checkpoint') }
  } }); opened.push(workspace)
  const { jobId, token } = await seed(workspace)
  expect(await workspace.api.generateDraft(token)).toMatchObject({ ok: false })
  const recovery = await workspace.api.getGenerationRecovery(jobId)
  expect(recovery).toMatchObject({ status: 'uncertain', uncertainAttempts: 2 })
  expect(prompts.filter(prompt => prompt.startsWith('Score these numbered'))).toHaveLength(1)
  workspace.close(); opened.pop()

  workspace = createWorkbench(directory, undefined, transport); opened.push(workspace)
  expect((await workspace.api.getGenerationRecovery(jobId))?.status).toBe('uncertain')
  expect(prompts.filter(prompt => prompt.startsWith('Score these numbered'))).toHaveLength(1)
  const resumed = await workspace.api.resumeGeneration(recovery!.runId)
  expect(resumed).toMatchObject({ ok: false, message: expect.stringMatching(/uncertain|explicitly/i) })
  expect(prompts.filter(prompt => prompt.startsWith('Score these numbered'))).toHaveLength(1)
  expect((await workspace.api.resumeGeneration(recovery!.runId, 'retry-uncertain')).ok).toBe(true)
  expect(prompts.filter(prompt => prompt.startsWith('Score these numbered'))).toHaveLength(2)
  expect((await workspace.api.getDraft(jobId))?.content.experience).toHaveLength(1)
}, 20000)

test('corrupt recovery snapshots fail closed without dispatch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-corrupt-recovery-')); dirs.push(directory)
  const transport = recoveryTransport(async () => { throw Object.assign(new Error('offline'), { code: 'ECONNRESET' }) })
  let workspace = createWorkbench(directory, undefined, transport); opened.push(workspace)
  const { jobId, token } = await seed(workspace)
  expect((await workspace.api.generateDraft(token)).ok).toBe(false)
  const recovery = await workspace.api.getGenerationRecovery(jobId)
  workspace.close(); opened.pop()
  const sqlite = new Database(join(directory, 'workbench.sqlite'))
  registerWorkspaceBackupRowSizer(sqlite)
  sqlite.prepare('UPDATE generation_recovery SET snapshot=? WHERE run_id=?').run('{invalid', recovery!.runId)
  sqlite.close()
  let calls = 0
  workspace = createWorkbench(directory, undefined, { async generate() { calls++; throw new Error('must not dispatch') } }); opened.push(workspace)
  expect(await workspace.api.resumeGeneration(recovery!.runId, 'retry-uncertain')).toMatchObject({ ok: false, message: expect.stringMatching(/corrupt|incompatible/i) })
  expect(calls).toBe(0)
}, 20000)

test.each([1, 2])('pre-paragraph recovery v%s remains readable but cannot dispatch under old consent', async version => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-old-prompt-recovery-')); dirs.push(directory)
  const initial = createWorkbench(directory, undefined, recoveryTransport(async () => { throw Object.assign(new Error('interrupted'), { code: 'ECONNRESET' }) })); opened.push(initial)
  const { jobId, token } = await seed(initial)
  expect((await initial.api.generateDraft(token)).ok).toBe(false)
  const recovery = await initial.api.getGenerationRecovery(jobId)
  initial.close(); opened.pop()
  const sqlite = new Database(join(directory, 'workbench.sqlite'))
  registerWorkspaceBackupRowSizer(sqlite)
  const row = sqlite.prepare('SELECT snapshot FROM generation_recovery WHERE run_id=?').get(recovery!.runId) as { snapshot: string }
  const snapshot = JSON.parse(row.snapshot)
  snapshot.version = version
  if (version === 1) snapshot.budgets = { minimumSpacingMs: 0, rateLimitAttempts: 100, rateLimitWindowMs: 86400000, configuredDailyLimit: 10000, runLimit: 12, runTimeLimitMs: 300000 }
  else { snapshot.source.model = { name: 'test/model', providerId: 'test', thinkingLevel: 'medium' }; snapshot.model = { providerId: 'test', modelId: 'test/model', thinkingLevel: 'medium' } }
  sqlite.prepare('UPDATE generation_recovery SET snapshot=? WHERE run_id=?').run(JSON.stringify(snapshot), recovery!.runId)
  sqlite.close()
  let calls = 0
  const reopened = createWorkbench(directory, undefined, { async generate() { calls++; throw new Error('old consent must never dispatch') } }); opened.push(reopened)
  expect(await reopened.api.getGenerationRecovery(jobId)).toMatchObject({ status: 'uncertain', uncertainAttempts: 1, canResume: false, progress: expect.stringMatching(/may have completed.*authorize fresh/i) })
  expect(await reopened.api.resumeGeneration(recovery!.runId, 'retry-uncertain')).toMatchObject({ ok: false, message: expect.stringMatching(/predates paragraph generation.*fresh run/i) })
  expect(calls).toBe(0)
  const backup = reopened.backup.createBackup()
  expect(JSON.parse(backup).tables.generation_recovery.rows).toHaveLength(1)
  expect(reopened.backup.previewRestore(backup).rowCounts.generation_recovery.restored).toBe(1)
  expect(await reopened.api.cancelGenerationRecovery(recovery!.runId)).toMatchObject({ ok: true })
}, 20000)

test('an uncertain dispatched request requires an explicit duplicate-risk choice before replay', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-uncertain-recovery-')); dirs.push(directory)
  const initialTransport = recoveryTransport(async () => { throw Object.assign(new Error('response was interrupted'), { code: 'ECONNRESET' }) })
  let workspace = createWorkbench(directory, undefined, initialTransport); opened.push(workspace)
  const { jobId, token } = await seed(workspace)
  expect((await workspace.api.generateDraft(token)).ok).toBe(false)
  const paused = await workspace.api.getGenerationRecovery(jobId)
  expect(paused).toMatchObject({ status: 'uncertain', uncertainAttempts: 1 })
  workspace.close(); opened.pop()

  let retryRequests = 0
  const retryTransport: AnalysisTransport = { async generate(input) { retryRequests++; return recoveryTransport().generate(input) } }
  workspace = createWorkbench(directory, undefined, retryTransport); opened.push(workspace)
  const recovery = await workspace.api.getGenerationRecovery(jobId)
  expect(recovery).toMatchObject({ status: 'uncertain', uncertainAttempts: 1 })
  const declined = await workspace.api.resumeGeneration(recovery!.runId)
  expect(declined).toMatchObject({ ok: false, message: expect.stringMatching(/uncertain|explicitly/i) })
  expect(retryRequests).toBe(0)

  const resumed = await workspace.api.resumeGeneration(recovery!.runId, 'retry-uncertain')
  expect(resumed.ok).toBe(true)
  expect(retryRequests).toBe(1)
  expect((await workspace.api.getDraft(jobId))?.content.experience).toHaveLength(1)
}, 20000)
