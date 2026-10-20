import { afterEach, expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { analysisBudgetValues } from '../src/shared/posting-analysis'

const directories: string[] = []
const opened: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const workspace of opened.splice(0)) workspace.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

async function fixture(regenerationTransport?: (signal: AbortSignal) => Promise<string>) {
  const directory = mkdtempSync(join(tmpdir(), 'approval-contract-')); directories.push(directory)
  const transport: AnalysisTransport = { async generate({ prompt, signal }) {
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) { const { items } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant saved evidence.' })) }) }
    if (prompt.startsWith('Factual repair cycle')) return JSON.stringify({ corrections: [] })
    if (prompt.startsWith('Propose conservative replacement wording')) {
      if (regenerationTransport) return regenerationTransport(signal)
      const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ items: items.map((item: { text: string }) => ({ text: item.text, rationale: 'Retains the cited source while emphasizing its relevance.' })) })
    }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    return JSON.stringify({ education: [], experience: [], projects: [], skills: selected.filter((item: { category: string }) => item.category === 'skills').map((item: { index: number; text: string }) => ({ name: JSON.parse(item.text).name, evidence: [item.index], rationale: 'Saved skill.' })), certificates: [] })
  } }
  const workspace = createWorkbench(directory, undefined, transport); opened.push(workspace)
  const budgets = await workspace.api.getAnalysisUsage()
  await workspace.api.setAnalysisBudgets({ ...analysisBudgetValues(budgets), minimumSpacingMs: 0, rateLimitWindowMs: 1000 })
  const skill = await workspace.api.saveSkill({ name: 'TypeScript', category: 'Programming' })
  if (!skill.ok) throw new Error('Could not create source fixture')
  const job = await workspace.api.saveJob({ title: 'Engineer', company: 'Example', description: 'TypeScript required.' })
  if (!job.ok) throw new Error('Could not create job fixture')
  const preview = await workspace.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw new Error('Could not prepare consent fixture')
  await workspace.api.acceptOutboundConsent(preview.token, true, true)
  await workspace.api.startAnalysis(preview.token)
  const generated = await workspace.api.generateDraft(preview.token)
  if (!generated.ok || !generated.draft) throw new Error('Could not generate draft fixture')
  return { directory, workspace, jobId: job.value.id, draft: generated.draft, skillId: skill.value.skills[0].id }
}

async function measure(workspace: ReturnType<typeof createWorkbench>, jobId: string, overflow = false) {
  const canonical = await workspace.api.getCanonicalDocument(jobId)
  if (!canonical) throw new Error('Canonical document unavailable')
  const documentHash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  return workspace.api.saveDocumentFitReport(jobId, { documentHash, targetPages: canonical.targetPages, actualPages: overflow ? canonical.targetPages + 1 : canonical.targetPages, extractedText: ['CV'], linkTargets: [], overflow, proposedCuts: overflow ? [{ entryId: 'skills-0', label: 'TypeScript', section: 'Skills' }] : [], measuredAt: new Date().toISOString() })
}

test('regeneration proposals require fresh consent, compare without mutation, reject cleanly, accept scoped edits, and reject stale bases', async () => {
  const { workspace, jobId } = await fixture()
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
  expect(accepted).toMatchObject({ ok: true, draft: { revision: restored.revision + 1, approved: false, approval: undefined, content: { skills: [{ name: 'TypeScript' }, { name: 'Rust' }] }, checkReport: { passed: true } } })
  expect(await workspace.api.getDocumentFitReport(jobId)).toBeNull()
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
  expect(await reopened.api.assertDraftExportable(state.jobId)).toMatchObject({ ok: true, document: { style: { background: '#ffffff', fontFamily: 'Arial' } } })
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
