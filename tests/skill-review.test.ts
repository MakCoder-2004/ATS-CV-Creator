import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { analysisBudgetValues } from '../src/shared/posting-analysis'

const dirs: string[] = [], opened: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const wb of opened.splice(0)) wb.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

test('suggested skill decisions are draft-local, stale-safe, approval-gated, and survive reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'skill-review-')); dirs.push(dir)
  const transport: AnalysisTransport = { async generate({ prompt }) {
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['Rust'], preferred: [], tools: ['Rust'], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) { const { items } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant saved evidence.' })) }) }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const entries = (category: string) => selected.filter((item: { category: string }) => item.category === category).map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Selected source evidence.' }))
    const experience = entries('experience')
    return JSON.stringify({ headline: 'Engineer', summary: { text: 'Engineer with relevant experience.', evidence: [selected[0].index], rationale: 'Selected source evidence.' }, education: entries('education'), experience, projects: entries('projects'), skills: [], certificates: entries('certificates') })
  } }
  let wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  const budgets = await wb.api.getAnalysisUsage()
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(budgets), minimumSpacingMs: 0, rateLimitAttempts: 100, rateLimitWindowMs: 1000 })
  await wb.api.saveSkill({ name: 'TypeScript', category: 'Programming' })
  const role = await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Example', description: 'Built backend services.' })
  const job = await wb.api.saveJob({ title: 'Rust Engineer', company: 'Example', description: 'Rust required.' })
  if (!role.ok || !job.ok) throw new Error('fixture setup failed')
  const preview = await wb.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw new Error('consent preview failed')
  await wb.api.acceptOutboundConsent(preview.token, true, true)
  expect(await wb.api.startAnalysis(preview.token)).toMatchObject({ status: 'complete' })
  const generated = await wb.api.generateDraft(preview.token)
  expect(generated.ok).toBe(true)
  const draft = generated.draft!
  expect(draft.suggestedSkills).toHaveLength(1)
  const suggestion = draft.suggestedSkills![0]
  expect(suggestion).toMatchObject({ name: 'Rust', sourceJobRevision: job.value.updatedAt, status: 'pending' })
  expect(draft.content.skills).toHaveLength(0)
  expect((await wb.api.getProfile()).skills.map(item => item.name)).not.toContain('Rust')
  expect(await wb.api.checkDraft(job.value.id)).toMatchObject({ passed: false, findings: expect.arrayContaining([expect.objectContaining({ code: 'unconfirmed-skill' })]) })
  expect(await wb.api.decideSuggestedSkill({ jobId: job.value.id, draftId: '00000000-0000-4000-8000-000000000000', skillId: suggestion.id, decision: 'confirmed' })).toMatchObject({ ok: false })
  expect(await wb.api.approveDraft(job.value.id)).toMatchObject({ ok: false })
  expect(await wb.api.assertDraftExportable(job.value.id)).toMatchObject({ ok: false })
  const confirmed = await wb.api.decideSuggestedSkill({ jobId: job.value.id, draftId: draft.id, skillId: suggestion.id, decision: 'confirmed' })
  expect(confirmed).toMatchObject({ ok: true, draft: { suggestedSkills: [expect.objectContaining({ status: 'confirmed' })] } })
  expect((await wb.api.getProfile()).skills.map(item => item.name)).not.toContain('Rust')
  expect(await wb.api.decideSuggestedSkill({ jobId: job.value.id, draftId: draft.id, skillId: suggestion.id, decision: 'removed' })).toMatchObject({ ok: false })
  const removed = await wb.api.decideSuggestedSkill({ jobId: job.value.id, draftId: confirmed.draft!.id, skillId: suggestion.id, decision: 'removed' })
  expect(removed).toMatchObject({ ok: true, draft: { suggestedSkills: [expect.objectContaining({ status: 'removed' })] } })
  wb.close(); opened.pop(); wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  expect(await wb.api.getDraft(job.value.id)).toMatchObject({ id: removed.draft!.id, suggestedSkills: [expect.objectContaining({ status: 'removed' })] })
})
