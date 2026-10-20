import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { analysisBudgetValues } from '../src/shared/posting-analysis'

const dirs: string[] = [], opened: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const item of opened.splice(0)) item.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

test('accepted frozen consent generates a batched source-linked draft that reopens offline with stable identity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'source-linked-draft-')); dirs.push(dir)
  const requests: string[] = []
  let crossParentProjectCitation = false
  let unsupportedClaim: 'responsibility' | 'number' | null = null
  let repairWording = false
  let repairCitation: { evidenceId: string; revision: number } | undefined
  let semanticMode: 'supported' | 'malformed' = 'supported'
  const transport: AnalysisTransport = { async generate({ prompt }) {
    requests.push(prompt)
    if (prompt.startsWith('Compare all rewritten/source pairs')) {
      if (semanticMode === 'malformed') return '{ malformed faithfulness response'
      const { pairs } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ results: pairs.map((pair: { itemPath: string; rewritten: string }) => ({ itemPath: pair.itemPath, supported: !(unsupportedClaim === 'responsibility' && pair.rewritten.includes('Led a global team')), explanation: 'The wording matches the cited evidence.' })) })
    }
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: ['TypeScript'], responsibilities: ['Build reliable services'], keywords: ['TypeScript'] })
    if (prompt.startsWith('Factual repair cycle')) return JSON.stringify({ corrections: repairWording ? [{ section: 'experience', index: 0, text: 'Built reliable services with TypeScript in 2021.', citations: repairCitation ? [repairCitation] : [] }] : [] })
    if (prompt.startsWith('Score these numbered')) {
      const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 0.9, rationale: 'Directly supports the posting.' })) })
    }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const byCategory = (category: string) => selected.filter((item: { category: string }) => item.category === category).map((item: { index: number; category: string; text: string }) => ({ text: category === 'experience' && unsupportedClaim === 'responsibility' ? 'Led a global team and owned architecture.' : category === 'experience' && unsupportedClaim === 'number' ? 'Delivered 500 percent growth.' : item.text, evidence: [item.index], rationale: 'Selected for direct relevance.' }))
    const projects = selected.filter((item: { category: string }) => item.category === 'projects')
    const projectOutput = crossParentProjectCitation && projects.length > 1 ? [{ text: 'Combined project claims.', evidence: projects.slice(0, 2).map((item: { index: number }) => item.index), rationale: 'Test invalid cross-project association.' }] : byCategory('projects')
    return JSON.stringify({ education: byCategory('education'), experience: byCategory('experience'), projects: projectOutput, skills: selected.filter((item: { category: string }) => item.category === 'skills').map((item: { index: number; text: string }) => ({ name: JSON.parse(item.text).name, evidence: [item.index], rationale: 'Profile skill matches the posting.' })), certificates: byCategory('certificates') })
  } }
  let wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  const budget = await wb.api.getAnalysisUsage()
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(budget), minimumSpacingMs: 0, rateLimitWindowMs: 1000 })
  const contact = await wb.api.saveContact({ fullName: 'Private Candidate', headline: 'Senior engineer', email: 'private@example.test' })
  expect(contact.ok).toBe(true)
  const skill = await wb.api.saveSkill({ name: 'TypeScript', category: 'Programming' })
  if (!skill.ok) throw Error('skill fixture')
  const role = await wb.api.saveExperience({ kind: 'employment', title: 'Developer', organization: 'Secret Employer', startDate: '2021', endDate: '2023', description: 'Built reliable services with TypeScript.' })
  if (role.ok) repairCitation = { evidenceId: role.value.experience[0].id, revision: role.value.experience[0].revision }
  const tiedRole = await wb.api.saveExperience({ kind: 'employment', title: 'Consultant', organization: 'Other Employer', startDate: '2022', endDate: '2023', description: 'Delivered reliable services.' })
  const olderRole = await wb.api.saveExperience({ kind: 'employment', title: 'Junior Developer', organization: 'Old Employer', startDate: '2018', endDate: '2020', description: 'Maintained reliable services.' })
  const projectA = await wb.api.saveProject({ name: 'Telemetry Toolkit', description: 'Built a toolkit for telemetry.' })
  const projectB = await wb.api.saveProject({ name: 'Deployment Toolkit', description: 'Built a toolkit for deployment.' })
  if (!role.ok || !tiedRole.ok || !olderRole.ok || !projectA.ok || !projectB.ok) throw Error('experience/project fixture')
  for (let index = 0; index < 70; index++) {
    const saved = await wb.api.saveSkill({ name: `Skill ${index.toString().padStart(2, '0')}`, category: 'Programming' })
    if (!saved.ok) throw Error('skill fixture')
  }
  const job = await wb.api.saveJob({ title: 'Engineer', company: 'Private Company', description: 'TypeScript and reliable services required.' })
  if (!job.ok) throw Error('job fixture')
  await wb.api.setFaithfulnessCheck(true)
  const consent = await wb.api.prepareOutboundConsent(job.value.id)
  if (!consent.ok) throw Error('consent fixture')
  await wb.api.acceptOutboundConsent(consent.token, true, true)
  await wb.api.setFaithfulnessCheck(false)
  expect(await wb.api.startAnalysis(consent.token)).toMatchObject({ status: 'complete' })
  const generated = await wb.api.generateDraft(consent.token)
  expect(generated).toMatchObject({ ok: true, draft: { jobId: job.value.id, pageTarget: 1, progress: expect.stringContaining('1-page target'), status: 'unverified', approved: false, checkReport: { passed: true, limitation: expect.stringContaining('second opinions, not proof') }, lockedFields: { fullName: 'Private Candidate', experience: [{ evidenceId: role.value.experience[0].id, title: 'Developer', organization: 'Secret Employer', startDate: '2021', endDate: '2023' }, { evidenceId: tiedRole.value.experience[1].id, title: 'Consultant', organization: 'Other Employer', startDate: '2022', endDate: '2023' }, { evidenceId: olderRole.value.experience[2].id, title: 'Junior Developer', organization: 'Old Employer', startDate: '2018', endDate: '2020' }] } } })
  expect(generated.draft!.attempts).toBe(3)
  expect(generated.draft!.content.experience.map(paragraph => paragraph.citations[0].evidenceId)).toEqual([role.value.experience[0].id, tiedRole.value.experience[1].id, olderRole.value.experience[2].id])
  expect(generated.draft!.content.projects.map(paragraph => paragraph.citations[0].evidenceId)).toEqual([projectA.value.projects[0].id, projectB.value.projects[1].id])
  expect(generated.draft!.content.skills.length).toBeGreaterThan(24)
  expect(generated.draft!.content.skills.every(entry => entry.citations.length > 0)).toBe(true)
  expect(requests).toHaveLength(4)
  const faithfulnessRequest = requests.find(prompt => prompt.startsWith('Compare all rewritten/source pairs'))
  expect(faithfulnessRequest).toBeDefined()
  expect(faithfulnessRequest).not.toContain('Private Candidate')
  expect(faithfulnessRequest).not.toContain('Secret Employer')
  expect(faithfulnessRequest).not.toContain('2021')
  expect(requests.join('\n')).not.toContain('Private Candidate')
  expect(requests.join('\n')).not.toContain('private@example.test')
  expect(requests.join('\n')).not.toContain('Secret Employer')
  expect(requests.join('\n')).not.toContain('2021')
  const originalDraft = generated.draft!
  const malformedJob = await wb.api.saveJob({ title: 'Malformed review case', company: 'Another Private Company', description: 'TypeScript service engineering.' })
  if (!malformedJob.ok) throw Error('malformed review job fixture')
  await wb.api.setFaithfulnessCheck(true)
  const malformedConsent = await wb.api.prepareOutboundConsent(malformedJob.value.id)
  if (!malformedConsent.ok) throw Error('malformed review consent fixture')
  await wb.api.acceptOutboundConsent(malformedConsent.token, true, true)
  expect(await wb.api.startAnalysis(malformedConsent.token)).toMatchObject({ status: 'complete' })
  semanticMode = 'malformed'
  const malformedReview = await wb.api.generateDraft(malformedConsent.token)
  expect(malformedReview).toMatchObject({ ok: true, draft: { status: 'blocked', checkReport: { findings: expect.arrayContaining([expect.objectContaining({ code: 'semantic-unsupported', itemPath: 'faithfulness', message: expect.stringContaining('malformed structured output') })]) } } })
  expect((await wb.api.getDraft(malformedJob.value.id))?.content.experience.length).toBeGreaterThan(0)
  semanticMode = 'supported'
  await wb.api.setFaithfulnessCheck(false)
  const quotaJob = await wb.api.saveJob({ title: 'Bounded review case', company: 'Budget Company', description: 'TypeScript service engineering.' })
  if (!quotaJob.ok) throw Error('quota review job fixture')
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(await wb.api.getAnalysisUsage()), runLimit: 3 })
  await wb.api.setFaithfulnessCheck(true)
  const quotaConsent = await wb.api.prepareOutboundConsent(quotaJob.value.id)
  if (!quotaConsent.ok) throw Error('quota review consent fixture')
  await wb.api.acceptOutboundConsent(quotaConsent.token, true, true)
  expect(await wb.api.startAnalysis(quotaConsent.token)).toMatchObject({ status: 'complete' })
  const budgetExhaustedReview = await wb.api.generateDraft(quotaConsent.token)
  expect(budgetExhaustedReview).toMatchObject({ ok: true, draft: { status: 'blocked', attempts: 2, checkReport: { findings: expect.arrayContaining([expect.objectContaining({ itemPath: 'faithfulness', message: expect.stringContaining('budget') })]) } } })
  expect((await wb.api.getAnalysisUsage()).attempts).toBeGreaterThanOrEqual(3)
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(budget), minimumSpacingMs: 0, rateLimitWindowMs: 1000 })
  await wb.api.setFaithfulnessCheck(false)
  const secondJob = await wb.api.saveJob({ title: 'Analyst', company: 'Different Company', description: 'TypeScript analysis.' })
  if (!secondJob.ok) throw Error('second job fixture')
  const secondConsent = await wb.api.prepareOutboundConsent(secondJob.value.id)
  if (!secondConsent.ok) throw Error('second consent fixture')
  await wb.api.acceptOutboundConsent(secondConsent.token, true, true)
  expect(await wb.api.startAnalysis(secondConsent.token)).toMatchObject({ jobId: secondJob.value.id, status: 'complete' })
  const secondDraft = await wb.api.generateDraft(secondConsent.token, 2)
  expect(secondDraft).toMatchObject({ ok: true, draft: { jobId: secondJob.value.id, pageTarget: 2, progress: expect.stringContaining('2-page target') } })
  expect(secondDraft.draft!.content.skills.length).toBeGreaterThan(generated.draft!.content.skills.length)
  expect((await wb.api.getDraft(job.value.id))?.id).toBe(originalDraft.id)
  const thirdJob = await wb.api.saveJob({ title: 'Platform Specialist', company: 'Another Company', description: 'Platform development with TypeScript.' })
  if (!thirdJob.ok) throw Error('third job fixture')
  const thirdConsent = await wb.api.prepareOutboundConsent(thirdJob.value.id)
  if (!thirdConsent.ok) throw Error('third consent fixture')
  await wb.api.acceptOutboundConsent(thirdConsent.token, true, true)
  expect(await wb.api.startAnalysis(thirdConsent.token)).toMatchObject({ status: 'complete' })
  crossParentProjectCitation = true
  expect(await wb.api.generateDraft(thirdConsent.token)).toMatchObject({ ok: true, draft: { status: 'blocked', checkReport: { passed: false, findings: expect.arrayContaining([expect.objectContaining({ code: 'wrong-parent' })]) } } })
  crossParentProjectCitation = false
  expect(originalDraft.content.experience[0].citations).toContainEqual({ evidenceId: role.value.experience[0].id, revision: 1 })
  expect(originalDraft.content.projects[0].citations).toContainEqual({ evidenceId: projectA.value.projects[0].id, revision: 1 })
  expect(originalDraft.content.skills[0].citations).toContainEqual({ evidenceId: skill.value.skills[0].id, revision: 1 })
  expect(originalDraft.evidence.map(e => e.evidenceId)).toContain(role.value.experience[0].id)
  const staleJob = await wb.api.saveJob({ title: 'Stale scope role', company: 'Scope Company', description: 'TypeScript engineering.' })
  if (!staleJob.ok) throw Error('stale-scope job fixture')
  await wb.api.setFaithfulnessCheck(true)
  const staleConsent = await wb.api.prepareOutboundConsent(staleJob.value.id)
  if (!staleConsent.ok) throw Error('stale-scope consent fixture')
  await wb.api.acceptOutboundConsent(staleConsent.token, true, true)
  await wb.api.setFaithfulnessCheck(false)
  expect(await wb.api.startAnalysis(staleConsent.token)).toMatchObject({ status: 'complete' })
  unsupportedClaim = 'responsibility'
  const semanticallyUnverified = await wb.api.generateDraft(staleConsent.token)
  expect(semanticallyUnverified).toMatchObject({ ok: true, draft: { status: 'blocked', checkReport: { limitation: expect.stringContaining('second opinions, not proof'), findings: expect.arrayContaining([expect.objectContaining({ code: 'semantic-unsupported', itemPath: 'experience[0]' })]) } } })
  const semanticDraft = semanticallyUnverified.draft!
  expect(semanticDraft.checkReport?.findings.find(finding => finding.code === 'semantic-unsupported')).toMatchObject({ originDraftId: semanticDraft.id, originDraftRevision: semanticDraft.revision, originEvidenceRevisionHash: semanticDraft.checkReport?.evidenceRevisionHash, historical: false })
  const editedAfterFinding = await wb.api.correctDraft({ jobId: staleJob.value.id, section: 'experience', index: 0, text: 'Built services with TypeScript.' })
  expect(editedAfterFinding?.revision).toBe(semanticDraft.revision + 1)
  expect(await wb.api.checkDraft(staleJob.value.id)).toMatchObject({ passed: false, findings: expect.arrayContaining([expect.objectContaining({ code: 'semantic-unsupported', originDraftId: semanticDraft.id, originDraftRevision: semanticDraft.revision, originEvidenceRevisionHash: semanticDraft.checkReport?.evidenceRevisionHash, historical: true })]) })
  expect((await wb.api.getDraft(staleJob.value.id))?.revision).toBe(editedAfterFinding?.revision)
  unsupportedClaim = null
  const changedRole = await wb.api.saveExperience({ id: role.value.experience[0].id, kind: 'employment', title: 'Developer', organization: 'Secret Employer', startDate: '2021', endDate: '2023', description: 'Led a global team of 500 people.' })
  expect(changedRole.ok).toBe(true)
  if (changedRole.ok) repairCitation = { evidenceId: changedRole.value.experience[0].id, revision: changedRole.value.experience[0].revision }
  const requestCountBeforeStaleGeneration = requests.length
  expect(await wb.api.generateDraft(staleConsent.token)).toMatchObject({ ok: false, message: expect.stringMatching(/changed|scope|review/i) })
  expect(requests).toHaveLength(requestCountBeforeStaleGeneration)
  const repairJob = await wb.api.saveJob({ title: 'Repair verification', company: 'Repair Company', description: 'TypeScript service engineering.' })
  if (!repairJob.ok) throw Error('repair job fixture')
  await wb.api.setFaithfulnessCheck(true)
  const repairConsent = await wb.api.prepareOutboundConsent(repairJob.value.id)
  if (!repairConsent.ok) throw Error('repair consent fixture')
  await wb.api.acceptOutboundConsent(repairConsent.token, true, true)
  expect(await wb.api.startAnalysis(repairConsent.token)).toMatchObject({ status: 'complete' })
  unsupportedClaim = 'number'
  repairWording = true
  const requestStart = requests.length
  const repaired = await wb.api.generateDraft(repairConsent.token)
  expect(repaired).toMatchObject({ ok: true, draft: { status: expect.any(String) } })
  const postRepairReview = requests.slice(requestStart).find(prompt => prompt.startsWith('Compare all rewritten/source pairs'))
  expect(postRepairReview).toBeDefined()
  const repairedPairs = JSON.parse(postRepairReview!.slice(postRepairReview!.indexOf('{'))).pairs as Array<{ itemPath: string; rewritten: string; evidence: string[] }>
  expect(repairedPairs.find(pair => pair.itemPath === 'experience[0]')?.rewritten).toBe('Built reliable services with TypeScript in .')
  expect(postRepairReview).not.toContain('Secret Employer')
  expect(postRepairReview).not.toContain('2021')

  wb.close(); opened.pop()
  wb = createWorkbench(dir, undefined, { async generate() { throw Error('offline') } }); opened.push(wb)
  const reopened = await wb.api.getDraft(job.value.id)
  expect(reopened).toEqual(originalDraft)
  expect(await wb.api.getDraft(secondJob.value.id)).toEqual(secondDraft.draft)
  expect(await wb.api.getAnalysis(job.value.id)).toMatchObject({ status: 'complete', progress: expect.stringContaining('Draft generated'), attempts: 4, runId: expect.any(String) })
}, 20000)

test('cancellation during the shared semantic batch suppresses its late response and draft persistence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cancel-semantic-batch-')); dirs.push(dir)
  let resolveSemantic!: (value: string) => void
  let semanticStarted!: () => void
  const started = new Promise<void>(resolve => { semanticStarted = resolve })
  const transport: AnalysisTransport = { async generate({ prompt }) {
    if (prompt.startsWith('Compare all rewritten/source pairs')) {
      semanticStarted()
      return new Promise<string>(resolve => { resolveSemantic = resolve })
    }
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) {
      const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant.' })) })
    }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    return JSON.stringify({ education: [], experience: selected.filter((item: { category: string }) => item.category === 'experience').map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Relevant.' })), projects: [], skills: [], certificates: [] })
  } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  const usage = await wb.api.getAnalysisUsage()
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(usage), minimumSpacingMs: 0, rateLimitWindowMs: 1000 })
  const role = await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Example Org', description: 'Built reliable services.' })
  if (!role.ok) throw Error('cancel role fixture')
  const job = await wb.api.saveJob({ title: 'Engineer', company: 'Example Co', description: 'Build reliable systems.' })
  if (!job.ok) throw Error('cancel job fixture')
  await wb.api.setFaithfulnessCheck(true)
  const consent = await wb.api.prepareOutboundConsent(job.value.id)
  if (!consent.ok) throw Error('cancel consent fixture')
  await wb.api.acceptOutboundConsent(consent.token, true, true)
  expect(await wb.api.startAnalysis(consent.token)).toMatchObject({ status: 'complete' })
  const generation = wb.api.generateDraft(consent.token)
  await started
  await wb.api.cancelAnalysis(job.value.id)
  resolveSemantic(JSON.stringify({ results: [{ itemPath: 'experience[0]', supported: true, explanation: 'Supported.' }] }))
  expect(await generation).toMatchObject({ ok: false, message: expect.stringMatching(/cancel/i) })
  expect(await wb.api.getDraft(job.value.id)).toBeNull()
}, 20000)
