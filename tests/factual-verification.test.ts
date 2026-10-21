import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { analysisBudgetValues } from '../src/shared/posting-analysis'

const dirs: string[] = [], opened: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const item of opened.splice(0)) item.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

test.each([
  ['invalid citation', JSON.stringify({ headline: 'Engineer', summary: { text: 'Experienced engineer.', evidence: [0], rationale: 'Summary.' }, education: [], experience: [{ text: 'Secret model output', evidence: [99], rationale: 'bad' }], projects: [], skills: [], certificates: [] }), 'foreign-citation'],
  ['malformed JSON', '{"experience":"Sensitive provider output', 'schema'],
  ['missing citations', JSON.stringify({ headline: 'Engineer', summary: { text: 'Experienced engineer.', evidence: [0], rationale: 'Summary.' }, education: [], experience: [{ text: 'Secret model output', rationale: 'bad' }], projects: [], skills: [], certificates: [] }), 'schema']
])('public API persists a blocked editable draft after %s', async (_case, tailored, expectedCode) => {
  const dir = mkdtempSync(join(tmpdir(), 'factual-failure-')); dirs.push(dir)
  const transport: AnalysisTransport = { async generate({ prompt }) {
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) { const { items } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 0.9, rationale: 'Relevant.' })) }) }
    return tailored
  } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(await wb.api.getAnalysisUsage()), minimumSpacingMs: 0 })
  await wb.api.saveContact({ fullName: 'Candidate' })
  const role = await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Example', description: 'Built reliable services.' })
  if (!role.ok) throw new Error('role fixture')
  const job = await wb.api.saveJob({ title: 'Engineer', company: 'Example', description: 'Engineering.' })
  if (!job.ok) throw new Error('job fixture')
  const consent = await wb.api.prepareOutboundConsent(job.value.id)
  if (!consent.ok) throw new Error('consent fixture')
  await wb.api.acceptOutboundConsent(consent.token, true, true)
  await wb.api.startAnalysis(consent.token)
  const result = await wb.api.generateDraft(consent.token)
  expect(result).toMatchObject({ ok: true, draft: { status: 'blocked', approved: false, content: { experience: [] }, checkReport: { passed: false, findings: [{ code: expectedCode }] } } })
  expect(JSON.stringify(result)).not.toContain('Secret model output')
  expect(await wb.api.getDraft(job.value.id)).toMatchObject({ id: result.draft!.id, revision: result.draft!.revision, status: 'blocked', evidence: [{ evidenceId: role.value.experience[0].id, revision: 1 }], checkReport: { draftId: result.draft!.id, draftRevision: result.draft!.revision, evidenceRevisionHash: expect.any(String) } })
  expect(await wb.api.checkDraft(job.value.id)).toMatchObject({ passed: false, findings: [{ code: expectedCode, itemPath: 'generation' }] })
  const authored = await wb.api.addDraftItem({ jobId: job.value.id, section: 'experience', text: 'Built reliable services.', citation: { evidenceId: role.value.experience[0].id, revision: 1 } })
  const preservedFailure = expectedCode === 'foreign-citation' ? 'foreign-citation' : 'schema'
  expect(authored).toMatchObject({ revision: result.draft!.revision + 1, status: 'blocked', checkReport: { passed: false, findings: [{ code: preservedFailure, itemPath: 'generation' }] } })
  expect(await wb.api.checkDraft(job.value.id)).toMatchObject({ passed: false, findings: [{ code: preservedFailure, itemPath: 'generation' }] })
  expect(await wb.api.addDraftItem({ jobId: job.value.id, section: 'projects', text: 'Borrowed.', citation: { evidenceId: role.value.experience[0].id, revision: 1 } })).toBeNull()
  expect(await wb.api.addDraftItem({ jobId: job.value.id, section: 'experience', text: 'Stale.', citation: { evidenceId: role.value.experience[0].id, revision: 9 } })).toBeNull()
})

test('public API rejects unsupported skill equivalence and binds the blocked report to frozen evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'factual-adversarial-')); dirs.push(dir)
  const transport: AnalysisTransport = { async generate({ prompt }) {
    if (prompt.startsWith('Factual repair cycle')) return JSON.stringify({ corrections: [] })
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) { const { items } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 0.9, rationale: 'Relevant.' })) }) }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const skill = selected.find((item: { category: string }) => item.category === 'skills')
    const experience = selected.find((item: { category: string }) => item.category === 'experience')
    const project = selected.find((item: { category: string }) => item.category === 'projects')
    return JSON.stringify({ headline: 'Finance Engineer', summary: experience ? { text: 'Experienced finance engineer.', evidence: [experience.index], rationale: 'Saved experience.' } : { text: 'Experienced engineer.', evidence: [selected[0].index], rationale: 'Saved evidence.' }, education: [], experience: experience ? [{ text: 'Managed budgets over $5,000.', evidence: [experience.index], rationale: 'Relevant.' }] : [], projects: project ? [{ text: project.text, evidence: [project.index], rationale: 'Project.' }] : [], skills: skill ? [{ name: 'Cloud architecture', evidence: [skill.index], rationale: 'Equivalent terminology.' }] : [], certificates: [] })
  } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(await wb.api.getAnalysisUsage()), minimumSpacingMs: 0 })
  const role = await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Sample Org', description: 'Managed engineering budgets of about $5,000 and oversaw finance operations.' })
  const project = await wb.api.saveProject({ name: 'Harbor Console', description: 'Built a deployment tool.' })
  const skill = await wb.api.saveSkill({ name: 'Cloud operations', category: 'Tools' })
  const job = await wb.api.saveJob({ title: 'Finance Engineer', company: 'Target Org', description: 'Engineering budgets and finance operations.' })
  if (!role.ok || !project.ok || !skill.ok || !job.ok) throw new Error('adversarial fixture')
  const consent = await wb.api.prepareOutboundConsent(job.value.id)
  if (!consent.ok) throw new Error('consent fixture')
  await wb.api.acceptOutboundConsent(consent.token, true, true)
  await wb.api.startAnalysis(consent.token)
  const result = await wb.api.generateDraft(consent.token)
  expect(result).toMatchObject({ ok: true, draft: { status: 'blocked', approved: false } })
  const report = result.draft!.checkReport!
  expect(report.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'unsupported-skill', itemPath: 'skills[0]' }),
    expect.objectContaining({ code: 'unsupported-number', itemPath: 'experience[0]' })
  ]))
  expect(report.findings.some(finding => finding.code === 'wrong-parent' && finding.itemPath === 'projects[0]')).toBe(false)
  expect(await wb.api.getDraft(job.value.id)).toMatchObject({ status: 'blocked', checkReport: { draftId: result.draft!.id, draftRevision: result.draft!.revision, evidenceRevisionHash: expect.any(String), passed: false } })
})

test('public API saves revision-bound factual check reports and rejects unsupported metrics on their own cited evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'factual-check-')); dirs.push(dir)
  const requests: string[] = []
  const transport: AnalysisTransport = { async generate({ prompt }) {
    requests.push(prompt)
    if (prompt.startsWith('Factual repair cycle')) return JSON.stringify({ corrections: [] })
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) { const { items } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 0.9, rationale: 'Relevant.' })) }) }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const experience = selected.filter((item: { category: string }) => item.category === 'experience').map((item: { index: number }) => ({ text: 'Reduced latency by over 12 dollars.', evidence: [item.index], rationale: 'Relevant result.' }))
    const projects = selected.filter((item: { category: string }) => item.category === 'projects').map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Separate project evidence.' }))
    return JSON.stringify({ headline: 'Engineer', summary: experience.length ? { text: 'Reduced latency across engineering work.', evidence: [experience[0].evidence[0]], rationale: 'Saved role evidence.' } : { text: 'Professional engineer.', evidence: [selected[0].index], rationale: 'Saved evidence.' }, education: [], experience, projects, skills: [], certificates: [] })
  } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  const budgets = await wb.api.getAnalysisUsage()
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(budgets), minimumSpacingMs: 0 })
  await wb.api.saveContact({ fullName: 'Candidate' })
  const role = await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Example', description: 'Reduced latency by 12 percent.' })
  if (!role.ok) throw new Error('role fixture')
  const project = await wb.api.saveProject({ name: 'Unrelated benchmark', description: 'Improved throughput by 500 percent.' })
  if (!project.ok) throw new Error('project fixture')
  const job = await wb.api.saveJob({ title: 'Engineer', company: 'Example', description: 'Engineering.' })
  if (!job.ok) throw new Error('job fixture')
  const consent = await wb.api.prepareOutboundConsent(job.value.id)
  if (!consent.ok) throw new Error('consent fixture')
  await wb.api.acceptOutboundConsent(consent.token, true, true)
  await wb.api.startAnalysis(consent.token)
  const generated = await wb.api.generateDraft(consent.token)
  expect(generated.ok).toBe(true)
  const checked = await wb.api.checkDraft(job.value.id)
  expect(checked).toMatchObject({ draftId: generated.draft!.id, draftRevision: generated.draft!.revision, passed: false })
  expect(requests.filter(prompt => prompt.startsWith('Factual repair cycle'))).toHaveLength(2)
  expect(generated.draft!.attempts).toBe(4)
  expect(await wb.api.getAnalysis(job.value.id)).toMatchObject({ status: 'complete', attempts: 5 })
  expect(checked?.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unsupported-number', evidenceId: role.value.experience[0].id })]))
  expect(generated.draft!.content.projects[0].citations[0].evidenceId).toBe(project.value.projects[0].id)
  expect(checked?.findings.some(finding => finding.code === 'unsupported-number' && finding.itemPath.startsWith('projects['))).toBe(false)
  expect(await wb.api.getDraft(job.value.id)).toMatchObject({ checkReport: checked, status: 'blocked' })
  const corrected = await wb.api.correctDraft({ jobId: job.value.id, section: 'experience', index: 0, text: 'Reduced latency by 12 percent.' })
  expect(corrected).toMatchObject({ status: 'unverified', revision: generated.draft!.revision + 1, checkReport: { passed: true, findings: [] } })
  expect(await wb.api.getDraft(job.value.id)).toEqual(corrected)
})
