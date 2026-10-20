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
  const transport: AnalysisTransport = { async generate({ prompt }) {
    requests.push(prompt)
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: ['TypeScript'], responsibilities: ['Build reliable services'], keywords: ['TypeScript'] })
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
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(budget), minimumSpacingMs: 0 })
  const contact = await wb.api.saveContact({ fullName: 'Private Candidate', headline: 'Senior engineer', email: 'private@example.test' })
  expect(contact.ok).toBe(true)
  const skill = await wb.api.saveSkill({ name: 'TypeScript', category: 'Programming' })
  if (!skill.ok) throw Error('skill fixture')
  const role = await wb.api.saveExperience({ kind: 'employment', title: 'Developer', organization: 'Secret Employer', startDate: '2021', endDate: '2023', description: 'Built reliable services with TypeScript.' })
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
  const consent = await wb.api.prepareOutboundConsent(job.value.id)
  if (!consent.ok) throw Error('consent fixture')
  await wb.api.acceptOutboundConsent(consent.token, true, true)
  expect(await wb.api.startAnalysis(consent.token)).toMatchObject({ status: 'complete' })
  const generated = await wb.api.generateDraft(consent.token)
  expect(generated).toMatchObject({ ok: true, draft: { jobId: job.value.id, pageTarget: 1, progress: expect.stringContaining('1-page target'), status: 'unverified', approved: false, lockedFields: { fullName: 'Private Candidate', experience: [{ evidenceId: role.value.experience[0].id, title: 'Developer', organization: 'Secret Employer', startDate: '2021', endDate: '2023' }, { evidenceId: tiedRole.value.experience[1].id, title: 'Consultant', organization: 'Other Employer', startDate: '2022', endDate: '2023' }, { evidenceId: olderRole.value.experience[2].id, title: 'Junior Developer', organization: 'Old Employer', startDate: '2018', endDate: '2020' }] } } })
  expect(generated.draft!.content.experience.map(paragraph => paragraph.citations[0].evidenceId)).toEqual([role.value.experience[0].id, tiedRole.value.experience[1].id, olderRole.value.experience[2].id])
  expect(generated.draft!.content.projects.map(paragraph => paragraph.citations[0].evidenceId)).toEqual([projectA.value.projects[0].id, projectB.value.projects[1].id])
  expect(generated.draft!.content.skills.length).toBeGreaterThan(24)
  expect(generated.draft!.content.skills.every(entry => entry.citations.length > 0)).toBe(true)
  expect(requests).toHaveLength(3)
  expect(requests.join('\n')).not.toContain('Private Candidate')
  expect(requests.join('\n')).not.toContain('private@example.test')
  expect(requests.join('\n')).not.toContain('Secret Employer')
  expect(requests.join('\n')).not.toContain('2021')
  const originalDraft = generated.draft!
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
  expect(await wb.api.generateDraft(thirdConsent.token)).toMatchObject({ ok: false, message: expect.stringContaining('different experience or project parents') })
  crossParentProjectCitation = false
  expect(originalDraft.content.experience[0].citations).toContainEqual({ evidenceId: role.value.experience[0].id, revision: 1 })
  expect(originalDraft.content.projects[0].citations).toContainEqual({ evidenceId: projectA.value.projects[0].id, revision: 1 })
  expect(originalDraft.content.skills[0].citations).toContainEqual({ evidenceId: skill.value.skills[0].id, revision: 1 })
  expect(originalDraft.evidence.map(e => e.evidenceId)).toContain(role.value.experience[0].id)
  const staleJob = await wb.api.saveJob({ title: 'Stale scope role', company: 'Scope Company', description: 'TypeScript engineering.' })
  if (!staleJob.ok) throw Error('stale-scope job fixture')
  const staleConsent = await wb.api.prepareOutboundConsent(staleJob.value.id)
  if (!staleConsent.ok) throw Error('stale-scope consent fixture')
  await wb.api.acceptOutboundConsent(staleConsent.token, true, true)
  expect(await wb.api.startAnalysis(staleConsent.token)).toMatchObject({ status: 'complete' })
  unsupportedClaim = 'responsibility'
  const semanticallyUnverified = await wb.api.generateDraft(staleConsent.token)
  expect(semanticallyUnverified).toMatchObject({ ok: true, draft: { checkReport: { limitation: expect.stringContaining('do not prove semantic truth') } } })
  unsupportedClaim = null
  const changedRole = await wb.api.saveExperience({ id: role.value.experience[0].id, kind: 'employment', title: 'Developer', organization: 'Secret Employer', startDate: '2021', endDate: '2023', description: 'Led a global team of 500 people.' })
  expect(changedRole.ok).toBe(true)
  const requestCountBeforeStaleGeneration = requests.length
  expect(await wb.api.generateDraft(staleConsent.token)).toMatchObject({ ok: false, message: expect.stringMatching(/changed|scope|review/i) })
  expect(requests).toHaveLength(requestCountBeforeStaleGeneration)

  wb.close(); opened.pop()
  wb = createWorkbench(dir, undefined, { async generate() { throw Error('offline') } }); opened.push(wb)
  const reopened = await wb.api.getDraft(job.value.id)
  expect(reopened).toEqual(originalDraft)
  expect(await wb.api.getDraft(secondJob.value.id)).toEqual(secondDraft.draft)
  expect(await wb.api.getAnalysis(job.value.id)).toMatchObject({ status: 'complete', progress: expect.stringContaining('Draft generated'), attempts: 3, runId: expect.any(String) })
}, 20000)
