import { afterEach, expect, test } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { analysisBudgetValues } from '../src/shared/posting-analysis'
import { mapProfilePdfPages } from '../src/shared/profile-pdf-import'

const directories: string[] = []
const opened: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const workspace of opened.splice(0)) workspace.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

async function fixture(regenerationTransport?: (signal: AbortSignal) => Promise<string>, legacySources = false) {
  const prompts: string[] = []
  const directory = mkdtempSync(join(tmpdir(), 'approval-contract-')); directories.push(directory)
  const transport: AnalysisTransport = { async generate({ prompt, signal }) {
    prompts.push(prompt)
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) { const { items } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant saved evidence.' })) }) }
    if (prompt.startsWith('Factual repair cycle')) return JSON.stringify({ corrections: [] })
    if (prompt.startsWith('Propose conservative replacement wording')) {
      if (regenerationTransport) return regenerationTransport(signal)
      const { sourcesByItem } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ items: sourcesByItem.map((sources: string[]) => ({ text: sources[0], rationale: 'Retains the cited source while emphasizing its relevance.' })) })
    }
    const { selected, experienceGroups = [], projectGroups = [] } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    return JSON.stringify({ headline: 'Engineer', summary: { text: 'Engineer with saved technical skills.', evidence: [selected[0].index], rationale: 'Selected profile evidence.' }, education: [], experience: legacySources ? experienceGroups.map((group: { indexes: number[] }) => ({ text: 'Delivered saved work.', evidence: group.indexes, rationale: 'Saved role wording.' })) : [], projects: legacySources ? projectGroups.map((group: { indexes: number[] }) => ({ text: 'Delivered saved project work.', evidence: group.indexes, rationale: 'Saved project wording.' })) : [], skills: selected.filter((item: { category: string }) => item.category === 'skills').map((item: { index: number; text: string }) => ({ name: JSON.parse(item.text).name, evidence: [item.index], rationale: 'Saved skill. PRIVATE_DRAFT_RATIONALE_CANARY' })), certificates: [] })
  } }
  const workspace = createWorkbench(directory, undefined, transport); opened.push(workspace)
  const budgets = await workspace.api.getAnalysisUsage()
  await workspace.api.setAnalysisBudgets({ ...analysisBudgetValues(budgets), minimumSpacingMs: 0, rateLimitWindowMs: 1000 })
  const skill = await workspace.api.saveSkill({ name: 'TypeScript', category: 'Programming' })
  if (!skill.ok) throw new Error('Could not create source fixture')
  const legacyRole = legacySources ? await workspace.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Example Employer', description: 'Built systems.', factualItems: [{ text: 'Reduced failures.' }] }) : undefined
  const legacyProject = legacySources ? await workspace.api.saveProject({ name: 'Compiler', description: 'Improved builds.', factualItems: [{ text: 'Added diagnostics.' }] }) : undefined
  if (legacyRole && !legacyRole.ok || legacyProject && !legacyProject.ok) throw new Error('Could not create legacy grouping source fixture')
  const job = await workspace.api.saveJob({ title: 'Engineer', company: 'Example', description: 'TypeScript required.' })
  if (!job.ok) throw new Error('Could not create job fixture')
  const preview = await workspace.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw new Error('Could not prepare consent fixture')
  await workspace.api.acceptOutboundConsent(preview.token, true, true)
  await workspace.api.startAnalysis(preview.token)
  const generated = await workspace.api.generateDraft(preview.token)
  if (!generated.ok || !generated.draft) throw new Error('Could not generate draft fixture')
  return { directory, workspace, jobId: job.value.id, draft: generated.draft, skillId: skill.value.skills[0].id, prompts, legacyRole: legacyRole?.ok ? legacyRole.value.experience[0] : undefined, legacyProject: legacyProject?.ok ? legacyProject.value.projects[0] : undefined }
}

async function approvedLegacyWorkspaceWithoutTargetBinding() {
  const state = await fixture()
  await state.workspace.api.checkDraft(state.jobId)
  await measure(state.workspace, state.jobId)
  expect(await state.workspace.api.approveDraft(state.jobId)).toMatchObject({ ok: true })
  state.workspace.close(); opened.splice(opened.indexOf(state.workspace), 1)
  const database = new Database(join(state.directory, 'workbench.sqlite'))
  const row = database.prepare('SELECT id, data FROM draft_revisions WHERE job_id = ? ORDER BY revision DESC LIMIT 1').get(state.jobId) as { id: string; data: string }
  const legacy = JSON.parse(row.data) as Record<string, unknown>
  delete legacy.targetPostingUpdatedAt
  database.prepare('UPDATE draft_revisions SET data = ? WHERE id = ?').run(JSON.stringify(legacy), row.id)
  database.prepare('DELETE FROM schema_migrations WHERE version = 8').run()
  database.close()
  const reopened = createWorkbench(state.directory); opened.push(reopened)
  return { ...state, workspace: reopened }
}

async function measure(workspace: ReturnType<typeof createWorkbench>, jobId: string, overflow = false) {
  const canonical = await workspace.api.getCanonicalDocument(jobId)
  if (!canonical) throw new Error('Canonical document unavailable')
  const documentHash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  return workspace.api.saveDocumentFitReport(jobId, { documentHash, targetPages: canonical.targetPages, actualPages: overflow ? canonical.targetPages + 1 : canonical.targetPages, extractedText: ['CV'], linkTargets: [], links: [], overflow, proposedCuts: overflow ? [{ entryId: 'skills-0', label: 'TypeScript', section: 'Skills' }] : [], measuredAt: new Date().toISOString() })
}

test('public export guard rejects unapproved, overflowing, and source-stale canonical documents', async () => {
  const { workspace, jobId } = await fixture()
  expect(await workspace.api.assertDraftExportable(jobId)).toMatchObject({ ok: false, message: expect.stringMatching(/approve/i) })
  await workspace.api.checkDraft(jobId)
  await measure(workspace, jobId)
  expect(await workspace.api.approveDraft(jobId)).toMatchObject({ ok: true })
  expect(await workspace.api.assertDraftExportable(jobId)).toMatchObject({ ok: true, document: expect.any(Object) })

  const canonical = await workspace.api.getCanonicalDocument(jobId)
  if (!canonical) throw new Error('Expected current canonical document')
  const hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  await workspace.api.saveDocumentFitReport(jobId, { documentHash: hash, targetPages: canonical.targetPages, actualPages: canonical.targetPages + 1, extractedText: ['CV'], linkTargets: [], links: [], overflow: true, proposedCuts: [{ entryId: 'skills-0', label: 'TypeScript', section: 'Skills' }], measuredAt: new Date().toISOString() })
  expect(await workspace.api.assertDraftExportable(jobId)).toMatchObject({ ok: false })

  const other = await fixture()
  await other.workspace.api.checkDraft(other.jobId)
  await measure(other.workspace, other.jobId)
  await other.workspace.api.approveDraft(other.jobId)
  await other.workspace.api.saveSkill({ id: other.skillId, name: 'Changed source', category: 'Programming' })
  expect(await other.workspace.api.assertDraftExportable(other.jobId)).toMatchObject({ ok: false, message: expect.stringMatching(/stale|current checks/i) })
})

test('accepting a grouped legacy page-fit cut removes every source paragraph while preserving the prior draft revision', async () => {
  const { workspace, jobId, legacyRole, legacyProject } = await fixture(undefined, true)
  if (!legacyRole || !legacyProject) throw new Error('Legacy source fixture unavailable')
  await workspace.api.addDraftItem({ jobId, section: 'experience', text: 'Engineer — Example Employer | Built systems.', citation: { evidenceId: legacyRole.id, revision: legacyRole.revision } })
  await workspace.api.addDraftItem({ jobId, section: 'experience', text: 'Engineer — Example Employer | Reduced failures.', citation: { evidenceId: legacyRole.factualItems[0].id, revision: legacyRole.factualItems[0].revision } })
  await workspace.api.addDraftItem({ jobId, section: 'projects', text: 'Compiler — Improved builds.', citation: { evidenceId: legacyProject.id, revision: legacyProject.revision } })
  await workspace.api.addDraftItem({ jobId, section: 'projects', text: 'Compiler — Added diagnostics.', citation: { evidenceId: legacyProject.factualItems[0].id, revision: legacyProject.factualItems[0].revision } })
  const prior = await workspace.api.getDraft(jobId)
  const canonical = await workspace.api.getCanonicalDocument(jobId)
  if (!prior || !canonical) throw new Error('Legacy draft unavailable')
  expect(canonical.sections.find(section => section.name === 'Experience')!.entries).toHaveLength(1)
  expect(canonical.sections.find(section => section.name === 'Projects')!.entries).toHaveLength(1)
  const documentHash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  await workspace.api.saveDocumentFitReport(jobId, { documentHash, targetPages: canonical.targetPages, actualPages: canonical.targetPages + 1, extractedText: ['CV'], linkTargets: [], links: [], overflow: true, proposedCuts: [{ entryId: 'experience-0', label: 'Engineer', section: 'Experience' }, { entryId: 'projects-0', label: 'Compiler', section: 'Projects' }], measuredAt: new Date().toISOString() })
  const result = await workspace.api.acceptDocumentCuts(jobId, documentHash, ['experience-0', 'projects-0'])
  expect(result).toMatchObject({ ok: true })
  expect(result.draft?.content.experience).toEqual([])
  expect(result.draft?.content.projects).toEqual([])
  expect(result.draft?.revision).toBe(prior.revision + 1)
  expect(prior.content.experience).toHaveLength(3)
  expect(prior.content.projects).toHaveLength(2)
})

test('regeneration proposals require fresh consent, compare without mutation, reject cleanly, accept scoped edits, and reject stale bases', async () => {
  const { workspace, jobId, prompts } = await fixture()
  const extra = await workspace.api.saveSkill({ name: 'Rust', category: 'Programming' })
  if (!extra.ok) throw new Error('Could not create unrelated evidence')
  const withExtra = await workspace.api.addDraftItem({ jobId, section: 'skills', text: 'Rust', citation: { evidenceId: extra.value.skills.find(item => item.name === 'Rust')!.id, revision: 1 } })
  if (!withExtra) throw new Error('Could not add unrelated draft wording')
  expect(await workspace.api.checkDraft(jobId)).toMatchObject({ passed: true })
  await measure(workspace, jobId)
  expect(await workspace.api.approveDraft(jobId)).toMatchObject({ ok: true, draft: { approved: true } })
  const initial = await workspace.api.getDraft(jobId)
  if (!initial) throw new Error('Draft fixture unavailable')
  const beforeText = initial.content.skills[0].name
  const authorize = async () => {
    const preview = await workspace.api.prepareOutboundConsent(jobId)
    if (!preview.ok) throw new Error('Regeneration consent preview unavailable')
    expect(await workspace.api.regenerateDraft(preview.token, { kind: 'paragraph', section: 'skills', index: 0 })).toMatchObject({ ok: false, message: expect.stringMatching(/authorize/i) })
    expect(await workspace.api.acceptOutboundConsent(preview.token, true, true)).toMatchObject({ ok: true })
    return preview.token
  }
  const token = await authorize()
  const generated = await workspace.api.regenerateDraft(token, { kind: 'paragraph', section: 'skills', index: 0 })
  expect(generated).toMatchObject({ ok: true, proposal: { target: { kind: 'paragraph', section: 'skills', index: 0 }, status: 'pending', before: [{ text: beforeText }], proposed: [{ text: 'TypeScript' }] } })
  expect(await workspace.api.getDraft(jobId)).toMatchObject({ id: initial.id, revision: initial.revision, approved: initial.approved, content: initial.content })
  expect(await workspace.api.regenerateDraft(token, { kind: 'paragraph', section: 'skills', index: 0 })).toMatchObject({ ok: false, message: expect.stringMatching(/fresh outgoing-data preview/i) })
  const proposal = generated.proposal!
  const regenPrompt = prompts.find(prompt => prompt.startsWith('Propose conservative replacement wording'))!
  expect(regenPrompt).not.toContain('PRIVATE_DRAFT_RATIONALE_CANARY')
  expect(regenPrompt).toContain('TypeScript')
  expect(await workspace.api.resolveRegenerationProposal(jobId, proposal.id, 'reject')).toMatchObject({ ok: true, proposal: { status: 'rejected' } })
  expect(await workspace.api.getDraft(jobId)).toMatchObject({ id: initial.id, revision: initial.revision, content: initial.content })

  const token2 = await authorize()
  const second = await workspace.api.regenerateDraft(token2, { kind: 'section', section: 'skills' })
  expect(second).toMatchObject({ ok: true, proposal: { target: { kind: 'section', section: 'skills' } } })
  const local = await workspace.api.correctDraft({ jobId, section: 'skills', index: 0, text: 'Programming TypeScript' })
  if (!local) throw new Error('Manual edit fixture failed')
  const stale = await workspace.api.resolveRegenerationProposal(jobId, second.proposal!.id, 'accept')
  expect(stale).toMatchObject({ ok: false, proposal: { status: 'stale' } })
  expect((await workspace.api.getDraft(jobId))?.content.skills).toMatchObject([{ name: 'Programming TypeScript' }, { name: 'Rust' }])
  const restored = await workspace.api.correctDraft({ jobId, section: 'skills', index: 0, text: 'TypeScript' })
  if (!restored) throw new Error('Could not restore supported wording')

  const token3 = await authorize()
  const third = await workspace.api.regenerateDraft(token3, { kind: 'section', section: 'skills' })
  const accepted = await workspace.api.resolveRegenerationProposal(jobId, third.proposal!.id, 'accept')
  expect(accepted).toMatchObject({ ok: false, message: expect.stringMatching(/PDF page measurement is pending/i), draft: { revision: restored.revision + 1, approved: false, approval: undefined, content: { skills: [{ name: 'TypeScript' }, { name: 'Rust' }] }, checkReport: { passed: true } } })
  expect(await workspace.api.getDocumentFitReport(jobId)).toBeNull()
})

test('regeneration reuses cached analysis and shared run ceilings bound retries and elapsed time', async () => {
  let retryCalls = 0
  const retryState = await fixture(async () => { retryCalls++; throw Object.assign(new Error('temporary provider failure'), { status: 503 }) })
  const retryBudgets = await retryState.workspace.api.getAnalysisUsage()
  await retryState.workspace.api.setAnalysisBudgets({ ...analysisBudgetValues(retryBudgets), runLimit: 1, runTimeLimitMs: 5000, minimumSpacingMs: 0, rateLimitWindowMs: 1000 })
  const retryPreview = await retryState.workspace.api.prepareOutboundConsent(retryState.jobId)
  if (!retryPreview.ok) throw new Error('Could not prepare retry preview')
  await retryState.workspace.api.acceptOutboundConsent(retryPreview.token, true, true)
  const retryResult = await retryState.workspace.api.regenerateDraft(retryPreview.token, { kind: 'paragraph', section: 'skills', index: 0 })
  expect(retryResult).toMatchObject({ ok: false })
  expect(retryCalls).toBe(1)
  expect(retryState.prompts.filter(prompt => prompt.includes('Extract only explicit qualifications'))).toHaveLength(1)
  expect(await retryState.workspace.api.getDraft(retryState.jobId)).toMatchObject({ revision: retryState.draft.revision })

  let timedOutCalls = 0
  const timeoutState = await fixture(signal => new Promise<string>((_resolve, reject) => {
    timedOutCalls++
    signal.addEventListener('abort', () => reject(new Error('transport aborted')), { once: true })
  }))
  const timeoutBudgets = await timeoutState.workspace.api.getAnalysisUsage()
  await timeoutState.workspace.api.setAnalysisBudgets({ ...analysisBudgetValues(timeoutBudgets), runTimeLimitMs: 1000, minimumSpacingMs: 0, rateLimitWindowMs: 1000 })
  const timeoutPreview = await timeoutState.workspace.api.prepareOutboundConsent(timeoutState.jobId)
  if (!timeoutPreview.ok) throw new Error('Could not prepare timeout preview')
  await timeoutState.workspace.api.acceptOutboundConsent(timeoutPreview.token, true, true)
  const timedOut = await timeoutState.workspace.api.regenerateDraft(timeoutPreview.token, { kind: 'paragraph', section: 'skills', index: 0 })
  expect(timedOut).toMatchObject({ ok: false })
  expect(timedOutCalls).toBe(1)
  expect(await timeoutState.workspace.api.getDraft(timeoutState.jobId)).toMatchObject({ revision: timeoutState.draft.revision })
  expect(await timeoutState.workspace.api.getAnalysis(timeoutState.jobId)).toMatchObject({ status: 'failed' })
})

test('cancelling an in-flight authorized regeneration preserves the current draft and creates no proposal', async () => {
  let announceStarted!: () => void
  const started = new Promise<void>(resolve => { announceStarted = resolve })
  const { workspace, jobId, draft } = await fixture(signal => new Promise<string>((_resolve, reject) => {
    announceStarted()
    signal.addEventListener('abort', () => reject(new Error('cancelled by user')), { once: true })
  }))
  const consent = await workspace.api.prepareOutboundConsent(jobId)
  if (!consent.ok) throw new Error('Could not prepare regeneration consent')
  await workspace.api.acceptOutboundConsent(consent.token, true, true)
  const operation = workspace.api.regenerateDraft(consent.token, { kind: 'paragraph', section: 'skills', index: 0 })
  await started
  await workspace.api.cancelAnalysis(jobId)
  expect(await operation).toMatchObject({ ok: false, message: expect.stringMatching(/cancel/i) })
  expect(await workspace.api.getRegenerationProposal(jobId)).toBeNull()
  expect(await workspace.api.getDraft(jobId)).toMatchObject({ id: draft.id, revision: draft.revision, content: draft.content })
})

test('new factual wording requires an explicitly saved cited source and keeps semantic novelty user-declared', async () => {
  const { workspace, jobId, skillId } = await fixture()
  const draft = await workspace.api.getDraft(jobId)
  expect(draft?.content.skills).toHaveLength(1)
  const unsupported = await workspace.api.correctDraft({ jobId, section: 'skills', index: 0, text: 'Newly claimed expertise', editIntent: 'new-fact' } as never)
  expect(unsupported).toBeNull()
  const cited = await workspace.api.correctDraft({ jobId, section: 'skills', index: 0, text: 'TypeScript', editIntent: 'new-fact', evidence: [{ evidenceId: skillId, revision: 1 }] })
  expect(cited).toMatchObject({ content: { skills: [{ name: 'TypeScript', citations: [{ evidenceId: skillId, revision: 1 }] }] }, progress: expect.stringContaining('user-declared') })
})

test('an approved legacy CV without a target binding remains usable until its accepted posting changes', async () => {
  const { workspace, jobId, draft } = await approvedLegacyWorkspaceWithoutTargetBinding()
  const job = await workspace.api.openJob(jobId)
  expect(await workspace.api.getDraft(jobId)).toMatchObject({ id: draft.id, approved: true, targetPostingUpdatedAt: job?.updatedAt })
  expect(await workspace.api.assertDraftExportable(jobId)).toMatchObject({ ok: true })
  if (!job) throw new Error('Job fixture unavailable')
  expect(await workspace.api.saveJob({ id: jobId, title: job.title, company: job.company, description: `${job.description} New requirement.` })).toMatchObject({ ok: true })
  expect(await workspace.api.approveDraft(jobId)).toMatchObject({ ok: false })
  expect(await workspace.api.assertDraftExportable(jobId)).toMatchObject({ ok: false })
})

test('material posting edits preserve approved history and require explicit current reassessment before renewing unchanged wording', async () => {
  const { workspace, jobId, prompts } = await fixture()
  await workspace.api.checkDraft(jobId)
  await measure(workspace, jobId)
  expect(await workspace.api.approveDraft(jobId)).toMatchObject({ ok: true })
  const before = await workspace.api.getDraft(jobId)
  const job = await workspace.api.openJob(jobId)
  if (!job || !before) throw new Error('Job or draft fixture unavailable')
  const originalContent = JSON.stringify(before.content)
  const callsBeforeEdit = prompts.length
  expect(await workspace.api.saveJob({ id: jobId, title: job.title, company: job.company, description: `${job.description} Additional requirement.` })).toMatchObject({ ok: true })
  expect(prompts).toHaveLength(callsBeforeEdit)
  expect(await workspace.api.getDraft(jobId)).toMatchObject({ id: before.id, content: before.content, approved: true, approval: before.approval })
  expect(await workspace.api.checkDraft(jobId)).toMatchObject({ passed: false })
  expect(await workspace.api.getDraft(jobId)).toMatchObject({ id: before.id, content: before.content, approved: true, approval: before.approval })
  expect(await workspace.api.assertDraftExportable(jobId)).toMatchObject({ ok: false, message: expect.stringMatching(/earlier job posting/i) })
  expect(await workspace.api.getAnalysis(jobId)).toMatchObject({ status: 'stale' })
  expect(await workspace.api.renewDraftReview(jobId)).toMatchObject({ ok: false, message: expect.stringMatching(/current posting/i) })

  const renewalConsent = await workspace.api.prepareOutboundConsent(jobId)
  if (!renewalConsent.ok) throw new Error('Could not prepare current-target consent')
  expect(await workspace.api.acceptOutboundConsent(renewalConsent.token, true, true)).toMatchObject({ ok: true })
  expect(await workspace.api.startAnalysis(renewalConsent.token)).toMatchObject({ status: 'complete' })
  const reassessed = await workspace.api.getAnalysis(jobId)
  expect(reassessed).toMatchObject({ status: 'complete', targetPostingUpdatedAt: (await workspace.api.openJob(jobId))?.updatedAt })
  const renewed = await workspace.api.renewDraftReview(jobId)
  expect(renewed).toMatchObject({ ok: true, draft: { approved: false, approval: undefined, checkReport: undefined, content: before.content, targetPostingUpdatedAt: (await workspace.api.openJob(jobId))?.updatedAt } })
  expect(JSON.stringify((await workspace.api.getDraft(jobId))?.content)).toBe(originalContent)
  expect(await workspace.api.assertDraftExportable(jobId)).toMatchObject({ ok: false })
  expect(await workspace.api.checkDraft(jobId)).toMatchObject({ passed: true })
  await measure(workspace, jobId)
  expect(await workspace.api.approveDraft(jobId)).toMatchObject({ ok: true, draft: { approved: true } })
  expect(await workspace.api.assertDraftExportable(jobId)).toMatchObject({ ok: true })
})

test('approval requires a persisted current check after accepting cuts, not merely a fresh measure', async () => {
  const { workspace, jobId } = await fixture()
  const before = await workspace.api.getDraft(jobId)
  const fit = await measure(workspace, jobId, true)
  expect(await workspace.api.acceptDocumentCuts(jobId, fit.documentHash, ['skills-0'])).toMatchObject({ ok: true })
  await measure(workspace, jobId)
  expect(await workspace.api.approveDraft(jobId)).toMatchObject({ ok: false, message: expect.stringMatching(/recheck/i) })
  expect((await workspace.api.getDraft(jobId))?.checkReport).toBeUndefined()
  expect(before?.approved).toBe(false)
})

test('approval and eligibility survive SQLite reopen, theme changes, and unchanged canonical content', async () => {
  const state = await fixture()
  await state.workspace.api.checkDraft(state.jobId)
  await measure(state.workspace, state.jobId)
  expect(await state.workspace.api.approveDraft(state.jobId)).toMatchObject({ ok: true, draft: { approved: true, approval: expect.any(Object) } })
  expect(await state.workspace.api.setAppearance('dark')).toMatchObject({ appearance: 'dark' })
  state.workspace.close(); opened.splice(opened.indexOf(state.workspace), 1)
  const reopened = createWorkbench(state.directory); opened.push(reopened)
  expect(await reopened.api.getDraft(state.jobId)).toMatchObject({ approved: true, approval: expect.any(Object) })
  expect(await reopened.api.assertDraftExportable(state.jobId)).toMatchObject({ ok: true, document: { style: { background: '#ffffff', fontFamily: 'Lato', pageSize: 'Letter' } } })
})

test('a changed or deleted cited source blocks approval while an unrelated new source does not stale it', async () => {
  const state = await fixture()
  await state.workspace.api.checkDraft(state.jobId)
  await measure(state.workspace, state.jobId)
  await state.workspace.api.saveSkill({ name: 'Unrelated new skill', category: 'Programming' })
  expect(await state.workspace.api.approveDraft(state.jobId)).toMatchObject({ ok: true })
  const other = await fixture()
  await other.workspace.api.checkDraft(other.jobId)
  await measure(other.workspace, other.jobId)
  await other.workspace.api.deleteSkill(other.skillId)
  expect(await other.workspace.api.approveDraft(other.jobId)).toMatchObject({ ok: false })
  expect(await other.workspace.api.assertDraftExportable(other.jobId)).toMatchObject({ ok: false })
})

test('a populated CV merge updating a cited source makes the affected draft stale', async () => {
  const { workspace, jobId, skillId } = await fixture()
  await workspace.api.checkDraft(jobId)
  await measure(workspace, jobId)
  expect(await workspace.api.approveDraft(jobId)).toMatchObject({ ok: true })
  const baseline = await workspace.api.getProfileImportBaseline()
  const draft = mapProfilePdfPages([{ page: 1, text: 'SKILLS: TypeScript 6' }])
  const refs = [...draft.skills.map(item => item.proposalRef), ...draft.sources.map(source => source.proposalRef)]
  const proposalIds = Object.fromEntries([...new Set(refs)].map(ref => [ref, randomUUID()]))
  const proposals = { ...draft, proposalIds, decisions: { [draft.skills[0].proposalRef]: { action: 'update' as const, targetId: skillId } }, sources: draft.sources.map(source => ({ ...source, proposalId: proposalIds[source.proposalRef] })) }
  const merged = await workspace.api.importEmptyProfilePdf('e'.repeat(64), baseline, proposals)
  expect(merged.ok).toBe(true)
  expect(await workspace.api.assertDraftExportable(jobId)).toMatchObject({ ok: false, message: expect.stringMatching(/stale|current checks/i) })
})

test('known unresolved generation failure remains blocked through direct public approval and export APIs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'approval-failure-')); directories.push(directory)
  const workspace = createWorkbench(directory, undefined, { async generate({ prompt }) { if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: [], responsibilities: [], keywords: ['TypeScript'] }); if (prompt.startsWith('Score these numbered')) { const { items } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant.' })) }) } return '{bad json' } }); opened.push(workspace)
  const budgets = await workspace.api.getAnalysisUsage()
  await workspace.api.setAnalysisBudgets({ ...analysisBudgetValues(budgets), minimumSpacingMs: 0, rateLimitWindowMs: 1000 })
  await workspace.api.saveSkill({ name: 'TypeScript', category: 'Programming' })
  const job = await workspace.api.saveJob({ title: 'Engineer', company: 'Example', description: 'Build systems.' })
  if (!job.ok) throw new Error('Could not create job fixture')
  const preview = await workspace.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw new Error('Could not prepare consent fixture')
  await workspace.api.acceptOutboundConsent(preview.token, true, true)
  await workspace.api.startAnalysis(preview.token)
  const failed = await workspace.api.generateDraft(preview.token)
  expect(failed).toMatchObject({ ok: true, draft: { status: 'blocked', checkReport: { passed: false } } })
  expect(await workspace.api.approveDraft(job.value.id)).toMatchObject({ ok: false })
  expect(await workspace.api.assertDraftExportable(job.value.id)).toMatchObject({ ok: false })
})
