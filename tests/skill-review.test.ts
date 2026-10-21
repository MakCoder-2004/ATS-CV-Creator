import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { analysisBudgetValues } from '../src/shared/posting-analysis'
import { draftRevisionSchema } from '../src/shared/draft'
import { checkDraftFacts } from '../src/main/factual-verification'

test.each(['experience', 'summary'] as const)('confirming a skill cannot establish unsupported usage in %s', section => {
  const roleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const citation = { evidenceId: roleId, revision: 1 }
  const draft = draftRevisionSchema.parse({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', jobId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', revision: 1, pageTarget: 1, status: 'unverified', approved: false, attempts: 0, progress: 'Ready', createdAt: new Date(0).toISOString(),
    lockedFields: { fullName: 'Candidate', experience: [{ evidenceId: roleId, title: 'Engineer', organization: 'Example' }], education: [], projects: [], certificates: [] },
    content: { education: [], projects: [], skills: [], certificates: [], experience: [{ text: section === 'experience' ? 'Built Rust APIs.' : 'Built Python APIs.', citations: [citation], rationale: 'Source role' }] },
    tailoring: { headline: 'Engineer', summary: { text: section === 'summary' ? 'Builds Rust APIs.' : 'Builds Python APIs.', citations: [citation], rationale: 'Source role' } },
    suggestedSkills: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Rust', postingTerm: 'Rust', sourceJobRevision: 1, status: 'confirmed', decidedAt: new Date(0).toISOString() }],
    evidence: [{ ...citation, snapshot: { title: 'Engineer', organization: 'Example', description: 'Built Python APIs.' } }]
  })
  expect(checkDraftFacts(draft)).toMatchObject({ passed: false, findings: expect.arrayContaining([expect.objectContaining({ code: 'unsupported-skill', itemPath: section === 'summary' ? 'tailoring.summary' : 'experience[0]' })]) })
  draft.evidence[0].snapshot = { title: 'Engineer', organization: 'Example', description: 'Built Python and Rust APIs.' }
  expect(checkDraftFacts(draft)).toMatchObject({ passed: true })
})

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
  const restored = await wb.api.decideSuggestedSkill({ jobId: job.value.id, draftId: removed.draft!.id, skillId: suggestion.id, decision: 'confirmed' })
  expect(restored.ok).toBe(true)
  const document = await wb.api.getCanonicalDocument(job.value.id)
  const documentHash = createHash('sha256').update(JSON.stringify(document)).digest('hex')
  // Storage boundary receives the real measurer's fit report; an accepted proposed cut is a removal decision.
  await wb.api.saveDocumentFitReport(job.value.id, { documentHash, targetPages: 1, actualPages: 2, extractedText: ['Engineer', 'Rust'], linkTargets: [], links: [], overflow: true, proposedCuts: [{ entryId: `suggested-skills-${suggestion.id}`, label: 'Rust', section: 'Skills' }], measuredAt: new Date().toISOString() })
  const cut = await wb.api.acceptDocumentCuts(job.value.id, documentHash, [`suggested-skills-${suggestion.id}`])
  expect(cut).toMatchObject({ ok: true, draft: { approved: false, suggestedSkills: [expect.objectContaining({ status: 'removed' })] } })
  expect((await wb.api.getCanonicalDocument(job.value.id))?.sections.flatMap(section => section.entries).some(entry => entry.heading === 'Rust')).toBe(false)
  expect(await wb.api.getDocumentFitReport(job.value.id)).toBeNull()
  wb.close(); opened.pop(); wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  expect(await wb.api.getDraft(job.value.id)).toMatchObject({ id: cut.draft!.id, suggestedSkills: [expect.objectContaining({ status: 'removed' })] })
})
