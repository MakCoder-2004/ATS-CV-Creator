import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { analysisBudgetValues } from '../src/shared/posting-analysis'

const workspaces: Array<ReturnType<typeof createWorkbench>> = []
const directories: string[] = []
afterEach(() => { for (const workspace of workspaces.splice(0)) workspace.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

test('public generation contract persists a blocked editable draft when a number is absent from cited evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'unsupported-number-')); directories.push(directory)
  const transport: AnalysisTransport = { async generate({ prompt }) {
    if (prompt.startsWith('Factual repair cycle')) return JSON.stringify({ corrections: [] })
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: [], responsibilities: [], keywords: ['TypeScript'] })
    if (prompt.startsWith('Score these numbered')) {
      const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant evidence.' })) })
    }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const experience = selected.filter((item: { category: string }) => item.category === 'experience')
    return JSON.stringify({ education: [], experience: experience.map((item: { index: number }) => ({ text: 'Improved service throughput by 500 percent.', evidence: [item.index], rationale: 'Relevant to delivery.' })), projects: [], skills: [], certificates: [] })
  } }
  const workspace = createWorkbench(directory, undefined, transport); workspaces.push(workspace)
  const budgets = await workspace.api.getAnalysisUsage()
  await workspace.api.setAnalysisBudgets({ ...analysisBudgetValues(budgets), minimumSpacingMs: 0 })
  const role = await workspace.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Local Employer', description: 'Contributed to reliable TypeScript services.' })
  const job = await workspace.api.saveJob({ title: 'Engineer', company: 'Target Co', description: 'TypeScript engineering.' })
  if (!role.ok || !job.ok) throw Error('generation fixtures could not be saved')
  const preview = await workspace.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw Error('consent preview could not be prepared')
  await workspace.api.acceptOutboundConsent(preview.token, true, true)
  expect(await workspace.api.startAnalysis(preview.token)).toMatchObject({ status: 'complete' })
  const generated = await workspace.api.generateDraft(preview.token)
  expect(generated).toMatchObject({ ok: true, draft: { status: 'blocked', checkReport: { passed: false, findings: [expect.objectContaining({ code: 'unsupported-number' })] } } })
  expect(await workspace.api.getAnalysis(job.value.id)).toMatchObject({ status: 'complete', attempts: 5 })
  workspace.close(); workspaces.pop()
  const reopened = createWorkbench(directory, undefined, { async generate() { throw Error('offline') } }); workspaces.push(reopened)
  expect(await reopened.api.getDraft(job.value.id)).toMatchObject({ status: 'blocked', checkReport: { passed: false, findings: [expect.objectContaining({ code: 'unsupported-number' })] } })
  expect(await reopened.api.getAnalysis(job.value.id)).toMatchObject({ status: 'complete', attempts: 5 })
})

test('public generation contract discards a provider response if its consent scope changes in flight', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'changed-in-flight-')); directories.push(directory)
  let notifyDispatch!: () => void, releaseProvider!: () => void
  const dispatched = new Promise<void>(resolve => { notifyDispatch = resolve })
  const providerGate = new Promise<void>(resolve => { releaseProvider = resolve })
  const transport: AnalysisTransport = { async generate({ prompt }) {
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: [], responsibilities: [], keywords: ['TypeScript'] })
    if (prompt.startsWith('Score these numbered')) {
      const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant evidence.' })) })
    }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const experience = selected.filter((item: { category: string }) => item.category === 'experience')
    notifyDispatch()
    await providerGate
    return JSON.stringify({ education: [], experience: experience.map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Relevant evidence.' })), projects: [], skills: [], certificates: [] })
  } }
  const workspace = createWorkbench(directory, undefined, transport); workspaces.push(workspace)
  const budgets = await workspace.api.getAnalysisUsage()
  await workspace.api.setAnalysisBudgets({ ...analysisBudgetValues(budgets), minimumSpacingMs: 0 })
  const role = await workspace.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Local Employer', description: 'Contributed to reliable TypeScript services.' })
  const job = await workspace.api.saveJob({ title: 'Engineer', company: 'Target Co', description: 'TypeScript engineering.' })
  if (!role.ok || !job.ok) throw Error('generation fixtures could not be saved')
  const preview = await workspace.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw Error('consent preview could not be prepared')
  await workspace.api.acceptOutboundConsent(preview.token, true, true)
  expect(await workspace.api.startAnalysis(preview.token)).toMatchObject({ status: 'complete' })
  const generation = workspace.api.generateDraft(preview.token)
  await dispatched
  const changed = await workspace.api.saveExperience({ id: role.value.experience[0].id, kind: 'employment', title: 'Engineer', organization: 'Local Employer', description: 'Managed a global team of 50 engineers.' })
  expect(changed.ok).toBe(true)
  releaseProvider()
  expect(await generation).toMatchObject({ ok: false, message: expect.stringMatching(/changed|scope|review/i) })
  expect(await workspace.api.getDraft(job.value.id)).toBeNull()
})
