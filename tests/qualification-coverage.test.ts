import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { analysisBudgetValues } from '../src/shared/posting-analysis'

const workspaces: Array<ReturnType<typeof createWorkbench>> = [], directories: string[] = []
afterEach(() => { for (const workspace of workspaces.splice(0)) workspace.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })

test('public workbench repairs one supported keyword, preserves absent must-haves as advisory gaps, and rechecks facts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qualification-coverage-')); directories.push(dir)
  const requests: string[] = []
  let roleId = ''
  const transport: AnalysisTransport = { async generate({ prompt }) {
    requests.push(prompt)
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['JavaScript', 'Leadership'], preferred: ['Kubernetes'], tools: [], responsibilities: [], keywords: ['JavaScript', 'Leadership', 'Kubernetes'] })
    if (prompt.startsWith('Score these numbered')) { const { items } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant source.' })) }) }
    if (prompt.startsWith('Supported-keyword coverage repair')) return JSON.stringify({ corrections: [{ section: 'experience', index: 0, text: 'Built JS applications.', citations: [{ evidenceId: roleId, revision: 1 }] }] })
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const experience = selected.filter((item: { category: string }) => item.category === 'experience')
    return JSON.stringify({ education: [], experience: experience.map((item: { index: number }) => ({ text: 'Built applications.', evidence: [item.index], rationale: 'Directly supported.' })), projects: [], skills: [], certificates: [] })
  } }
  const wb = createWorkbench(dir, undefined, transport); workspaces.push(wb)
  const usage = await wb.api.getAnalysisUsage(); await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(usage), minimumSpacingMs: 0, runLimit: 4 })
  const role = await wb.api.saveExperience({ kind: 'employment', title: 'Developer', organization: 'Local Employer', description: 'Built JS applications.' })
  const job = await wb.api.saveJob({ title: 'Developer', company: 'Target', description: 'JavaScript and leadership required; Kubernetes preferred.' })
  if (!role.ok || !job.ok) throw Error('Could not create coverage fixtures')
  roleId = role.value.experience[0].id
  const consent = await wb.api.prepareOutboundConsent(job.value.id); if (!consent.ok) throw Error('Could not prepare consent')
  await wb.api.acceptOutboundConsent(consent.token, true, true)
  await wb.api.startAnalysis(consent.token)
  const generated = await wb.api.generateDraft(consent.token)
  expect(requests.filter(prompt => prompt.startsWith('Supported-keyword coverage repair'))).toHaveLength(1)
  expect(generated).toMatchObject({ ok: true, draft: { status: 'unverified', attempts: 3, coverage: { label: expect.stringContaining('not a universal ATS score'), repairAttempts: 1, factualChecksRerun: true, supportedMatches: [{ qualification: 'JavaScript', kind: 'required', matchedAs: 'js' }], gaps: [{ qualification: 'Leadership', kind: 'required' }, { qualification: 'Kubernetes', kind: 'preferred' }] } } })
  expect(generated.draft?.content.experience[0]?.text).toBe('Built JS applications.')
  expect(requests.find(prompt => prompt.startsWith('Supported-keyword coverage repair'))).not.toContain('Leadership')
  expect(await wb.api.getDraft(job.value.id)).toMatchObject({ coverage: { repairAttempts: 1, factualChecksRerun: true, gaps: [{ qualification: 'Leadership', kind: 'required' }, { qualification: 'Kubernetes', kind: 'preferred' }] } })
  expect(await wb.api.getAnalysis(job.value.id)).toMatchObject({ status: 'complete', attempts: 4 })
})

test('public workbench records a strong supported match without unnecessary repair', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qualification-coverage-')); directories.push(dir)
  const requests: string[] = []
  const transport: AnalysisTransport = { async generate({ prompt }) {
    requests.push(prompt)
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: [], responsibilities: [], keywords: ['TypeScript'] })
    if (prompt.startsWith('Score these numbered')) { const { items } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant source.' })) }) }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    return JSON.stringify({ education: [], experience: selected.filter((item: { category: string }) => item.category === 'experience').map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Directly supported.' })), projects: [], skills: [], certificates: [] })
  } }
  const wb = createWorkbench(dir, undefined, transport); workspaces.push(wb)
  const usage = await wb.api.getAnalysisUsage(); await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(usage), minimumSpacingMs: 0 })
  const role = await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Local Employer', description: 'Built TypeScript services.' })
  const job = await wb.api.saveJob({ title: 'Engineer', company: 'Target', description: 'TypeScript required.' })
  if (!role.ok || !job.ok) throw Error('Could not create strong-match fixtures')
  const consent = await wb.api.prepareOutboundConsent(job.value.id); if (!consent.ok) throw Error('Could not prepare consent')
  await wb.api.acceptOutboundConsent(consent.token, true, true)
  await wb.api.startAnalysis(consent.token)
  const generated = await wb.api.generateDraft(consent.token)
  expect(generated).toMatchObject({ ok: true, draft: { status: 'unverified', coverage: { repairAttempts: 0, supportedMatches: [{ qualification: 'TypeScript', kind: 'required', matchedAs: 'TypeScript' }], gaps: [] } } })
  expect(requests.filter(prompt => prompt.startsWith('Supported-keyword coverage repair'))).toHaveLength(0)
})
