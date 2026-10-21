import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { runSourceLinkedGraph, CitationValidationError } from '../src/main/source-linked-generation'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { analysisBudgetValues } from '../src/shared/posting-analysis'

const dirs: string[] = [], opened: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const item of opened.splice(0)) item.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

test('cross-category model citations get one bounded correction request without weakening citation checks', async () => {
  const experienceId = randomUUID(), skillId = randomUUID()
  const items = [
    { id: experienceId, revision: 1, category: 'experience' as const, snapshot: {}, text: '{"title":"Engineer","description":"Built TypeScript tools"}' },
    { id: skillId, revision: 1, category: 'skills' as const, snapshot: { name: 'TypeScript' }, text: '{"name":"TypeScript","category":"Programming"}' }
  ]
  const calls: string[] = []
  const progress: Array<{ step?: string; completed?: string[] }> = []
  let correctOnRetry = true
  const invoke = () => runSourceLinkedGraph({ onProgress: (_message, step, completed) => progress.push({ step, completed }), job: { title: 'Engineer' }, sourceJobRevision: 'job-revision-2', analysis: { tools: ['TypeScript', 'Rust'], keywords: ['Senior'] }, items, identity: { id: randomUUID(), jobId: randomUUID(), revision: 1, createdAt: new Date().toISOString(), lockedFields: { fullName: 'Synthetic Candidate', experience: [], education: [], projects: [], certificates: [] } }, call: async prompt => {
    calls.push(prompt)
    if (prompt.startsWith('Score these numbered')) return { value: { relevance: items.map((_, index) => ({ index, score: 1, rationale: 'Relevant synthetic source.' })) }, attempts: 1 }
    const invalid = calls.length === 2 || !correctOnRetry
    return { value: { headline: 'Engineer', summary: { text: 'Engineer with TypeScript experience.', evidence: [0], rationale: 'Synthetic source.' }, education: [], experience: [{ text: 'Built TypeScript tools', evidence: [0], rationale: 'Synthetic source.' }], projects: [], skills: [{ name: 'TypeScript', evidence: invalid ? [1, 0] : [1], rationale: 'Saved skill.' }], certificates: [] }, attempts: 1 }
  } })
  const result = await invoke()
  expect(calls).toHaveLength(3)
  expect(calls[1]).toContain('allowedEvidenceBySection')
  expect(calls[1].match(/Built TypeScript tools/g)).toHaveLength(1) // parent groups reference indexes, not duplicate source text
  expect(result.draft.attempts).toBe(3)
  expect(result.draft.content.skills[0].citations).toEqual([{ evidenceId: skillId, revision: 1 }])
  expect(progress.map(item => item.step)).toEqual(expect.arrayContaining(['score-evidence', 'select-content', 'tailor-paragraphs']))
  expect(progress.at(-1)?.completed).toEqual(expect.arrayContaining(['parse-posting', 'score-evidence', 'select-content', 'tailor-paragraphs']))
  expect(result.draft.suggestedSkills).toEqual([expect.objectContaining({ name: 'Rust', sourceJobRevision: 'job-revision-2', status: 'pending' })])
  expect(result.draft.suggestedSkills?.some(skill => skill.name === 'Senior')).toBe(false)
  calls.length = 0; correctOnRetry = false
  await expect(invoke()).rejects.toBeInstanceOf(CitationValidationError)
  expect(calls).toHaveLength(3)
})

test('restores target wording and suggested tool names locally without exposing identifiers in generation requests', async () => {
  const calls: string[] = []
  const source = { id: randomUUID(), revision: 1, category: 'skills' as const, snapshot: { name: 'Google Cloud Platform', category: 'Cloud' }, text: '{"name":"[[EMPLOYER_1]] Cloud Platform","category":"Cloud"}' }
  const result = await runSourceLinkedGraph({ job: { title: '[[EMPLOYER_1]] Cloud Engineer' }, analysis: { tools: ['[[EMPLOYER_1]] Cloud Platform', '[[EMPLOYER_1]] Kubernetes Engine'] }, items: [source], savedSkillNames: ['Google Cloud Platform'], sourceJobRevision: 'posting-v1', restoreText: text => text.replaceAll('[[EMPLOYER_1]]', 'Google'),
    identity: { id: randomUUID(), jobId: randomUUID(), revision: 1, createdAt: new Date().toISOString(), lockedFields: { fullName: 'Candidate', experience: [], education: [], projects: [], certificates: [] } },
    call: async prompt => {
      calls.push(prompt)
      return { attempts: 1, value: prompt.startsWith('Score these numbered') ? { relevance: [{ index: 0, score: 1, rationale: 'Relevant cloud skill' }] } : { headline: '[[EMPLOYER_1]] Cloud Engineer', summary: { text: 'Uses [[EMPLOYER_1]] Cloud Platform.', evidence: [0], rationale: 'Saved [[EMPLOYER_1]] Cloud Platform skill.' }, education: [], experience: [], projects: [], certificates: [], skills: [{ name: '[[EMPLOYER_1]] Cloud Platform', evidence: [0], rationale: 'Relevant [[EMPLOYER_1]] technology.' }] } }
    }
  })
  expect(calls.join('\n')).not.toContain('Google')
  expect('tailoring' in result.draft).toBe(false)
  expect(result.draft.content.skills[0]).toMatchObject({ name: 'Google Cloud Platform', rationale: 'Relevant Google technology.' })
  expect(result.draft.suggestedSkills).toEqual([expect.objectContaining({ name: 'Google Kubernetes Engine', postingTerm: 'Google Kubernetes Engine', status: 'pending' })])
})

test('posting analysis restores a display copy while cached and generated provider data stays minimized', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-display-')); dirs.push(dir)
  const requests: string[] = []
  const transport: AnalysisTransport = { async generate({ prompt }) {
    requests.push(prompt)
    if (prompt.startsWith('Extract only explicit')) {
      const { job } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      const brand = /\[\[EMPLOYER_\d+\]\]/.exec(job.title)?.[0]
      return JSON.stringify({ required: [`${brand} Cloud Platform`], preferred: [], tools: [`${brand} Cloud Platform`], responsibilities: [], keywords: [] })
    }
    if (prompt.startsWith('Score these numbered')) return JSON.stringify({ relevance: [{ index: 0, score: 1, rationale: 'Relevant skill' }] })
    return JSON.stringify({ headline: '[[EMPLOYER_1]] Cloud Engineer', summary: { text: 'Uses [[EMPLOYER_1]] Cloud Platform.', evidence: [0], rationale: 'Saved cloud skill' }, education: [], experience: [], projects: [], certificates: [], skills: [{ name: '[[EMPLOYER_1]] Cloud Platform', evidence: [0], rationale: 'Saved skill' }] })
  } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(await wb.api.getAnalysisUsage()), minimumSpacingMs: 0, rateLimitAttempts: 100, rateLimitWindowMs: 1000 })
  await wb.api.saveContact({ fullName: 'Local Candidate' })
  await wb.api.saveSkill({ name: 'Google Cloud Platform', category: 'Cloud' })
  const job = await wb.api.saveJob({ title: 'Google Cloud Engineer', company: 'Google', description: 'Google Cloud Platform skills required.' })
  if (!job.ok) throw new Error('Fixture job failed')
  const authorize = async () => { const preview = await wb.api.prepareOutboundConsent(job.value.id); if (!preview.ok) throw new Error(preview.message); await wb.api.acceptOutboundConsent(preview.token, true, true); return preview.token }
  const token = await authorize()
  expect(await wb.api.startAnalysis(token)).toMatchObject({ analysis: { tools: ['[[EMPLOYER_1]] Cloud Platform'] }, displayAnalysis: { tools: ['Google Cloud Platform'] } })
  const generated = await wb.api.generateDraft(token)
  expect(generated).toMatchObject({ ok: true, draft: { content: { certificates: [] } } })
  expect(generated.draft && 'tailoring' in generated.draft).toBe(false)
  expect(await wb.api.startAnalysis(await authorize())).toMatchObject({ cacheHit: true, displayAnalysis: { tools: ['Google Cloud Platform'] } })
  expect(requests).toHaveLength(3)
  await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'A considerably longer employer name', description: 'Built services.' })
  expect(await wb.api.startAnalysis(await authorize())).toMatchObject({ cacheHit: false, analysis: { tools: ['[[EMPLOYER_2]] Cloud Platform'] }, displayAnalysis: { tools: ['Google Cloud Platform'] } })
  expect(requests).toHaveLength(4)
  expect(requests.join('\n')).not.toContain('Google')
})

test('content-only generation groups role evidence and bounds concise bullets without retaining narrative fields', async () => {
  const roleId = randomUUID(), factId = randomUUID()
  const items = [
    { id: roleId, revision: 1, category: 'experience' as const, parentId: roleId, snapshot: { title: 'Engineer', organization: 'Example Co', description: 'Built services.' }, text: 'Built services.' },
    { id: factId, revision: 1, category: 'experience' as const, parentId: roleId, snapshot: { text: 'Improved reliability.' }, text: 'Improved reliability.' },
    { id: randomUUID(), revision: 1, category: 'certificates' as const, snapshot: { title: 'Private certificate' }, text: 'Private certificate credential.' }
  ]
  const prompts: Array<{ prompt: string; schema: { safeParse(value: unknown): { success: boolean; data?: unknown } } }> = []
  const result = await runSourceLinkedGraph({ job: { title: 'Engineer' }, analysis: {}, items, identity: { id: randomUUID(), jobId: randomUUID(), revision: 1, createdAt: new Date().toISOString(), lockedFields: { fullName: 'Candidate', experience: [{ evidenceId: roleId, title: 'Engineer', organization: 'Example Co' }], education: [], projects: [], certificates: [] } }, call: async (prompt, schema) => {
    prompts.push({ prompt, schema })
    if (prompt.startsWith('Score these numbered')) return { value: { relevance: items.flatMap((item, index) => item.category === 'certificates' ? [] : [{ index, score: 1, rationale: 'Relevant.' }]) }, attempts: 1 }
    return { value: { experience: [{ text: 'Built reliable services.\nImproved reliability.', evidence: [0, 1], rationale: 'Relevant facts.' }], education: [], projects: [], skills: [], headline: 'Legacy headline', summary: { text: 'Legacy summary', evidence: [0], rationale: 'Legacy' }, certificates: [{ text: 'Ignore me', evidence: [0], rationale: 'Legacy' }] }, attempts: 1 }
  } })
  expect(prompts[0].prompt).not.toContain('Private certificate')
  expect(prompts[1].schema.safeParse({ experience: [], education: [], projects: [], skills: [], headline: 'legacy', summary: {}, certificates: [] }).data).toEqual({ experience: [], education: [], projects: [], skills: [] })
  expect(result.draft.content.experience).toHaveLength(1)
  expect(result.draft.content.experience[0].citations).toEqual([{ evidenceId: roleId, revision: 1 }, { evidenceId: factId, revision: 1 }])
  expect(result.draft.content.experience[0].text.split(/\r?\n/)).toHaveLength(2)
  expect(result.draft.content.certificates).toEqual([])
  expect('tailoring' in result.draft).toBe(false)
})

test('content generation retries repeated/overlong bullets and rejects cross-parent citations', async () => {
  const roleId = randomUUID(), secondRoleId = randomUUID()
  const items = [
    { id: roleId, revision: 1, category: 'experience' as const, parentId: roleId, snapshot: {}, text: 'Built APIs.' },
    { id: secondRoleId, revision: 1, category: 'experience' as const, parentId: secondRoleId, snapshot: {}, text: 'Maintained systems.' }
  ]
  let tailoringCalls = 0
  const invoke = () => runSourceLinkedGraph({ job: { title: 'Engineer' }, analysis: {}, items, identity: { id: randomUUID(), jobId: randomUUID(), revision: 1, createdAt: new Date().toISOString(), lockedFields: { fullName: 'Candidate', experience: [{ evidenceId: roleId, title: 'Engineer', organization: 'Alpha' }, { evidenceId: secondRoleId, title: 'Developer', organization: 'Beta' }], education: [], projects: [], certificates: [] } }, call: async prompt => {
    if (prompt.startsWith('Score these numbered')) return { value: { relevance: items.map((_, index) => ({ index, score: 1, rationale: 'Relevant.' })) }, attempts: 1 }
    tailoringCalls++
    return { value: { education: [], projects: [], skills: [], experience: [{ text: tailoringCalls === 1 ? `Engineer at Alpha ${'x'.repeat(301)}` : 'Built APIs.', evidence: tailoringCalls === 1 ? [0, 1] : [0], rationale: 'Relevant.' }, { text: 'Maintained systems.', evidence: [1], rationale: 'Relevant.' }] }, attempts: 1 }
  } })
  const result = await invoke()
  expect(tailoringCalls).toBe(2)
  expect(result.draft.content.experience.map(item => item.citations[0].evidenceId)).toEqual([roleId, secondRoleId])
  tailoringCalls = 0
  await expect(runSourceLinkedGraph({ job: { title: 'Engineer' }, analysis: {}, items, identity: { id: randomUUID(), jobId: randomUUID(), revision: 1, createdAt: new Date().toISOString(), lockedFields: { fullName: 'Candidate', experience: [], education: [], projects: [], certificates: [] } }, call: async prompt => prompt.startsWith('Score these numbered') ? { value: { relevance: items.map((_, index) => ({ index, score: 1, rationale: 'Relevant.' })) }, attempts: 1 } : { value: { education: [], projects: [], skills: [], experience: [{ text: 'Built APIs.', evidence: [0, 1], rationale: 'Mixed roles.' }] }, attempts: 1 } })).rejects.toThrow()
})

test('an extra foreign parent entry triggers a bounded retry instead of disappearing during grouping', async () => {
  const ids = [randomUUID(), randomUUID()], items = ids.map((id, index) => ({ id, revision: 1, category: 'experience' as const, parentId: id, snapshot: {}, text: `Role ${index} fact.` }))
  let calls = 0
  const result = await runSourceLinkedGraph({ job: {}, analysis: {}, items, identity: { id: randomUUID(), jobId: randomUUID(), revision: 1, createdAt: new Date().toISOString(), lockedFields: { fullName: 'Candidate', experience: ids.map((evidenceId, index) => ({ evidenceId, title: `Role ${index}`, organization: `Company ${index}` })), education: [], projects: [], certificates: [] } }, call: async prompt => {
    if (prompt.startsWith('Score these numbered')) return { value: { relevance: items.map((_, index) => ({ index, score: 1, rationale: 'Relevant.' })) }, attempts: 1 }
    calls++
    const valid = ids.map((_, index) => ({ text: `Built system ${index}.`, evidence: [index], rationale: 'Supported.' }))
    return { value: { education: [], projects: [], skills: [], experience: calls === 1 ? [...valid, { text: 'Cross-role claim.', evidence: [0, 1], rationale: 'Mixed parents.' }] : valid }, attempts: 1 }
  } })
  expect(calls).toBe(2)
  expect(result.draft.content.experience).toHaveLength(2)
})

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
    return JSON.stringify({ headline: 'Software Engineer', summary: { text: 'Engineer with experience building reliable services.', evidence: selected.filter((item: { category: string }) => item.category === 'experience').slice(0, 1).map((item: { index: number }) => item.index), rationale: 'Grounded in saved experience.' }, education: byCategory('education'), experience: byCategory('experience'), projects: projectOutput, skills: selected.filter((item: { category: string }) => item.category === 'skills').map((item: { index: number; text: string }) => ({ name: JSON.parse(item.text).name, evidence: [item.index], rationale: 'Profile skill matches the posting.' })), certificates: byCategory('certificates') })
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
  expect(await wb.api.approveDraft(job.value.id)).toMatchObject({ ok: false })
  const thirdJob = await wb.api.saveJob({ title: 'Platform Specialist', company: 'Another Company', description: 'Platform development with TypeScript.' })
  if (!thirdJob.ok) throw Error('third job fixture')
  const thirdConsent = await wb.api.prepareOutboundConsent(thirdJob.value.id)
  if (!thirdConsent.ok) throw Error('third consent fixture')
  await wb.api.acceptOutboundConsent(thirdConsent.token, true, true)
  expect(await wb.api.startAnalysis(thirdConsent.token)).toMatchObject({ status: 'complete' })
  crossParentProjectCitation = true
  const rejectedCrossParent = await wb.api.generateDraft(thirdConsent.token)
  expect(rejectedCrossParent.ok).toBe(false)
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
  expect(await wb.api.approveDraft(staleJob.value.id)).toMatchObject({ ok: false })
  expect(await wb.api.assertDraftExportable(staleJob.value.id)).toMatchObject({ ok: false })
  unsupportedClaim = null
  const changedRole = await wb.api.saveExperience({ id: role.value.experience[0].id, kind: 'employment', title: 'Developer', organization: 'Secret Employer', startDate: '2021', endDate: '2023', description: 'Led a global team of 500 people.' })
  expect(changedRole.ok).toBe(true)
  if (changedRole.ok) repairCitation = { evidenceId: changedRole.value.experience[0].id, revision: changedRole.value.experience[0].revision }
  wb.close(); opened.pop()
  wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  expect(await wb.api.checkDraft(staleJob.value.id)).toMatchObject({ passed: false, findings: expect.arrayContaining([expect.objectContaining({ code: 'semantic-unsupported', historical: true }), expect.objectContaining({ code: 'stale-source' })]) })
  expect(await wb.api.approveDraft(staleJob.value.id)).toMatchObject({ ok: false })
  expect(await wb.api.assertDraftExportable(staleJob.value.id)).toMatchObject({ ok: false })
  const requestCountBeforeStaleGeneration = requests.length
  expect(await wb.api.generateDraft(staleConsent.token)).toMatchObject({ ok: false, message: expect.stringMatching(/changed|scope|review/i) })
  expect((await wb.api.checkDraft(staleJob.value.id))?.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'stale-source' })]))
  expect(await wb.api.assertDraftExportable(staleJob.value.id)).toMatchObject({ ok: false })
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
  if (!reopened) throw new Error('reopened draft fixture')
  // Profile comparison is live advisory data; the frozen CV and evidence must remain unchanged.
  const frozen = (value: typeof originalDraft) => { const copy = structuredClone(value); if (copy.coverage) delete copy.coverage.assessments; return copy }
  expect(frozen(reopened)).toEqual(frozen(originalDraft))
  expect(frozen((await wb.api.getDraft(secondJob.value.id))!)).toEqual(frozen(secondDraft.draft!))
  expect(await wb.api.getAnalysis(job.value.id)).toMatchObject({ status: 'complete', progress: expect.stringContaining('Draft generated'), attempts: 4, runId: expect.any(String), generationStep: 'check-document', completedSteps: ['parse-posting', 'score-evidence', 'select-content', 'tailor-paragraphs', 'verify-claims', 'check-document'] })
  const obsoleteNarrative = await wb.api.correctDraftTailoring({ jobId: job.value.id, draftId: reopened.id, field: 'summary', text: 'Revenue grew 500 percent.' })
  expect(obsoleteNarrative).toMatchObject({ ok: false })
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
    return JSON.stringify({ headline: 'Engineer', summary: { text: 'Experienced engineer.', evidence: selected.filter((item: { category: string }) => item.category === 'experience').slice(0, 1).map((item: { index: number }) => item.index), rationale: 'Based on saved role evidence.' }, education: [], experience: selected.filter((item: { category: string }) => item.category === 'experience').map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Relevant.' })), projects: [], skills: [], certificates: [] })
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
