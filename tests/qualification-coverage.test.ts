import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'

const workspaces: Array<ReturnType<typeof createWorkbench>> = [], directories: string[] = []
afterEach(() => { for (const workspace of workspaces.splice(0)) workspace.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })

test('public workbench repairs one supported keyword, preserves absent must-haves as advisory gaps, and rechecks facts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qualification-coverage-')); directories.push(dir)
  const requests: string[] = []
  const transport: AnalysisTransport = { async generate({ prompt }) {
    requests.push(prompt)
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['JavaScript', 'Leadership'], preferred: ['Kubernetes'], tools: [], responsibilities: [], keywords: ['JavaScript', 'Leadership', 'Kubernetes'] })
    if (prompt.startsWith('Score these numbered')) { const { items } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant source.' })) }) }
    if (prompt.startsWith('Supported-keyword coverage repair')) { const request = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ corrections: [{ section: request.opportunity.section, index: request.opportunity.index, text: 'Built JS applications.', citations: [{ evidenceId: request.opportunity.evidenceId, revision: request.opportunity.revision }] }] }) }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const experience = selected.filter((item: { category: string }) => item.category === 'experience')
    return JSON.stringify({ headline: 'Developer', summary: { text: 'Developer with application experience.', evidence: [experience[0].index], rationale: 'Saved role evidence.' }, education: [], experience: experience.map((item: { index: number }) => ({ text: 'Built applications.', evidence: [item.index], rationale: 'Directly supported.' })), projects: [], skills: [], certificates: [] })
  } }
  const wb = createWorkbench(dir, undefined, transport); workspaces.push(wb)

  const role = await wb.api.saveExperience({ kind: 'employment', title: 'Developer', organization: 'Local Employer', description: 'Built JS applications.' })
  const secondRole = await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Local Employer', description: 'Built JS services.' })
  const job = await wb.api.saveJob({ title: 'Developer', company: 'Target', description: 'JavaScript and leadership required; Kubernetes preferred.' })
  if (!role.ok || !secondRole.ok || !job.ok) throw Error('Could not create coverage fixtures')
  const consent = await wb.api.prepareOutboundConsent(job.value.id); if (!consent.ok) throw Error('Could not prepare consent')
  await wb.api.acceptOutboundConsent(consent.token, true, true)
  await wb.api.startAnalysis(consent.token)
  const generated = await wb.api.generateDraft(consent.token)
  expect(requests.filter(prompt => prompt.startsWith('Supported-keyword coverage repair'))).toHaveLength(1)
  expect(generated).toMatchObject({ ok: true, draft: { status: 'unverified', attempts: 3, coverage: { label: expect.stringContaining('not a universal ATS score'), repairAttempts: 1, factualChecksRerun: true, supportedMatches: [{ qualification: 'JavaScript', kind: 'required', matchedAs: 'js' }], gaps: [{ qualification: 'Leadership', kind: 'required' }, { qualification: 'Kubernetes', kind: 'preferred' }] } } })
  expect(generated.draft?.content.experience[0]?.text).toBe('Built JS applications.')
  expect(generated.draft?.content.experience[1]?.text).toBe('Built applications.')
  expect(requests.find(prompt => prompt.startsWith('Supported-keyword coverage repair'))).not.toContain('Leadership')
  expect(await wb.api.getDraft(job.value.id)).toMatchObject({ coverage: { repairAttempts: 1, factualChecksRerun: true, gaps: [{ qualification: 'Leadership', kind: 'required' }, { qualification: 'Kubernetes', kind: 'preferred' }] } })
  expect(await wb.api.getAnalysis(job.value.id)).toMatchObject({ status: 'complete', attempts: 4 })
})

test.each(['wrong-index', 'wrong-section', 'wrong-citation', 'unsupported-claim'] as const)('public workbench rejects scripted coverage correction: %s', async mode => {
  const dir = mkdtempSync(join(tmpdir(), 'qualification-coverage-')); directories.push(dir)
  const requests: string[] = []
  const transport: AnalysisTransport = { async generate({ prompt }) {
    requests.push(prompt)
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['JavaScript'], preferred: [], tools: [], responsibilities: [], keywords: ['JavaScript'] })
    if (prompt.startsWith('Score these numbered')) { const { items } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant source.' })) }) }
    if (prompt.startsWith('Supported-keyword coverage repair')) { const request = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ corrections: [{ section: mode === 'wrong-section' ? 'skills' : request.opportunity.section, index: request.opportunity.index + (mode === 'wrong-index' ? 7 : 0), text: mode === 'unsupported-claim' ? 'Built applications and led JavaScript teams.' : 'Built JS applications.', citations: [{ evidenceId: mode === 'wrong-citation' ? '00000000-0000-4000-8000-000000000001' : request.opportunity.evidenceId, revision: request.opportunity.revision }] }] }) }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const item = selected.find((entry: { category: string }) => entry.category === 'experience')
    return JSON.stringify({ headline: 'Developer', summary: { text: 'Developer with application experience.', evidence: [item.index], rationale: 'Saved role evidence.' }, education: [], experience: [{ text: 'Built applications.', evidence: [item.index], rationale: 'Directly supported.' }], projects: [], skills: [], certificates: [] })
  } }
  const wb = createWorkbench(dir, undefined, transport); workspaces.push(wb)

  const role = await wb.api.saveExperience({ kind: 'employment', title: 'Developer', organization: 'Local Employer', description: 'Built JS applications.' })
  const job = await wb.api.saveJob({ title: 'Developer', company: 'Target', description: 'JavaScript required.' })
  if (!role.ok || !job.ok) throw Error('Could not create correction fixtures')
  const consent = await wb.api.prepareOutboundConsent(job.value.id); if (!consent.ok) throw Error('Could not prepare consent')
  await wb.api.acceptOutboundConsent(consent.token, true, true)
  await wb.api.startAnalysis(consent.token)
  const generated = await wb.api.generateDraft(consent.token)
  expect(requests.filter(prompt => prompt.startsWith('Supported-keyword coverage repair'))).toHaveLength(1)
  expect(generated).toMatchObject({ ok: true, draft: { status: 'unverified', attempts: 3, coverage: { repairAttempts: 1, supportedMatches: [], gaps: [{ qualification: 'JavaScript', kind: 'required' }] } } })
  expect(generated.draft?.content.experience[0]?.text).toBe('Built applications.')
  expect(generated.draft?.approved).toBe(false)
})

test('public workbench keeps rationale-only and unrelated-citation keywords advisory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qualification-coverage-')); directories.push(dir)
  const requests: string[] = []
  const transport: AnalysisTransport = { async generate({ prompt }) {
    requests.push(prompt)
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['JavaScript'], preferred: [], tools: [], responsibilities: [], keywords: ['JavaScript'] })
    if (prompt.startsWith('Score these numbered')) { const { items } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ relevance: items.map((item: { index: number; text: string }) => ({ index: item.index, score: item.text.includes('Unrelated') ? 1 : 0, rationale: 'Only the unrelated source is selected.' })) }) }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const unrelated = selected.find((item: { text: string }) => item.text.includes('Unrelated'))
    return JSON.stringify({ headline: 'Developer', summary: { text: 'Developer with application experience.', evidence: [unrelated.index], rationale: 'Saved role evidence.' }, education: [], experience: selected.filter((item: { category: string }) => item.category === 'experience').map((item: { index: number }) => ({ text: 'Built useful applications.', evidence: [item.index], rationale: 'JavaScript is relevant.' })), projects: [], skills: [], certificates: [] })
  } }
  const wb = createWorkbench(dir, undefined, transport); workspaces.push(wb)

  const unrelated = await wb.api.saveExperience({ kind: 'employment', title: 'Developer', organization: 'Local Employer', description: 'Unrelated application delivery.' })
  const keyword = await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Local Employer', description: 'Used JavaScript on production services.' })
  const job = await wb.api.saveJob({ title: 'Developer', company: 'Target', description: 'JavaScript required.' })
  if (!unrelated.ok || !keyword.ok || !job.ok) throw Error('Could not create adversarial coverage fixtures')
  const consent = await wb.api.prepareOutboundConsent(job.value.id); if (!consent.ok) throw Error('Could not prepare consent')
  await wb.api.acceptOutboundConsent(consent.token, true, true)
  await wb.api.startAnalysis(consent.token)
  const generated = await wb.api.generateDraft(consent.token)
  expect(generated).toMatchObject({ ok: true, draft: { status: 'unverified', coverage: { repairAttempts: 0, supportedMatches: [], gaps: [{ qualification: 'JavaScript', kind: 'required' }] } } })
  expect(generated.draft?.content.experience[0]?.text).toBe('Built useful applications.')
  expect(requests.filter(prompt => prompt.startsWith('Supported-keyword coverage repair'))).toHaveLength(0)
})

test('public workbench records a strong supported match without unnecessary repair', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qualification-coverage-')); directories.push(dir)
  const requests: string[] = []
  const transport: AnalysisTransport = { async generate({ prompt }) {
    requests.push(prompt)
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: [], responsibilities: [], keywords: ['TypeScript'] })
    if (prompt.startsWith('Score these numbered')) { const { items } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant source.' })) }) }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    return JSON.stringify({ headline: 'Engineer', summary: { text: 'Engineer with service experience.', evidence: [selected[0].index], rationale: 'Saved profile evidence.' }, education: [], experience: selected.filter((item: { category: string }) => item.category === 'experience').map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Directly supported.' })), projects: [], skills: [], certificates: [] })
  } }
  const wb = createWorkbench(dir, undefined, transport); workspaces.push(wb)

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
