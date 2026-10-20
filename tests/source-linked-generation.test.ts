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
  const transport: AnalysisTransport = { async generate({ prompt }) {
    requests.push(prompt)
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: ['TypeScript'], responsibilities: ['Build reliable services'], keywords: ['TypeScript'] })
    if (prompt.startsWith('Score these numbered')) {
      const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 0.9, rationale: 'Directly supports the posting.' })) })
    }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const byCategory = (category: string) => selected.filter((item: { category: string }) => item.category === category).map((item: { index: number; category: string; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Selected for direct relevance.' }))
    return JSON.stringify({ education: byCategory('education'), experience: byCategory('experience'), projects: byCategory('projects'), skills: selected.filter((item: { category: string }) => item.category === 'skills').map((item: { index: number; text: string }) => ({ name: 'TypeScript', evidence: [item.index], rationale: 'Profile skill matches the posting.' })), certificates: byCategory('certificates') })
  } }
  let wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  const budget = await wb.api.getAnalysisUsage()
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(budget), minimumSpacingMs: 0 })
  const contact = await wb.api.saveContact({ fullName: 'Private Candidate', headline: 'Senior engineer', email: 'private@example.test' })
  expect(contact.ok).toBe(true)
  const skill = await wb.api.saveSkill({ name: 'TypeScript', category: 'Programming' })
  if (!skill.ok) throw Error('skill fixture')
  const role = await wb.api.saveExperience({ kind: 'employment', title: 'Developer', organization: 'Secret Employer', startDate: '2021', endDate: '2023', description: 'Built reliable services with TypeScript.' })
  if (!role.ok) throw Error('experience fixture')
  const job = await wb.api.saveJob({ title: 'Engineer', company: 'Private Company', description: 'TypeScript and reliable services required.' })
  if (!job.ok) throw Error('job fixture')
  const consent = await wb.api.prepareOutboundConsent(job.value.id)
  if (!consent.ok) throw Error('consent fixture')
  await wb.api.acceptOutboundConsent(consent.token, true, true)
  expect(await wb.api.startAnalysis(consent.token)).toMatchObject({ status: 'complete' })
  const generated = await wb.api.generateDraft(consent.token)
  expect(generated).toMatchObject({ ok: true, draft: { jobId: job.value.id, status: 'unverified', approved: false, lockedFields: { fullName: 'Private Candidate', experience: [{ evidenceId: role.ok ? role.value.experience[0].id : '', title: 'Developer', organization: 'Secret Employer', startDate: '2021', endDate: '2023' }] } } })
  expect(requests).toHaveLength(3)
  expect(requests.join('\n')).not.toContain('Private Candidate')
  expect(requests.join('\n')).not.toContain('private@example.test')
  expect(requests.join('\n')).not.toContain('Secret Employer')
  expect(requests.join('\n')).not.toContain('2021')
  const originalDraft = generated.draft!
  expect(originalDraft.content.experience[0].citations).toContainEqual({ evidenceId: role.value.experience[0].id, revision: 1 })
  expect(originalDraft.content.skills[0].citations).toContainEqual({ evidenceId: skill.value.skills[0].id, revision: 1 })
  expect(originalDraft.evidence.map(e => e.evidenceId)).toContain(role.value.experience[0].id)
  wb.close(); opened.pop()
  wb = createWorkbench(dir, undefined, { async generate() { throw Error('offline') } }); opened.push(wb)
  const reopened = await wb.api.getDraft(job.value.id)
  expect(reopened).toEqual(originalDraft)
})
