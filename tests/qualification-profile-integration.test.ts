import { test, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import { analysisBudgetValues } from '../src/shared/posting-analysis'
import type { AnalysisTransport } from '../src/main/posting-analysis'

const degreeRequirement = 'Bachelor’s degree in Computer Science, Engineering, Artificial Intelligence, Data Science, or a related field'
test('public coverage checks unselected profile facts and refreshes after profile/local edits and offline reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cv-qualification-full-profile-'))
  let workspace: ReturnType<typeof createWorkbench> | undefined
  let calls = 0
  const transport: AnalysisTransport = { async generate({ prompt }) {
    calls++
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: [degreeRequirement, 'Solid understanding of machine learning algorithms, model training, evaluation, and optimization', 'Experience building and deploying machine learning models in production environments', '3–6 years of experience in software engineering'], preferred: [], tools: [], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) { const { items } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ relevance: items.map((item: { index: number; text: string }) => ({ index: item.index, score: item.text.includes('Built services') ? 1 : 0, rationale: 'Only service experience goes into the CV.' })) }) }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const role = selected.find((item: { category: string }) => item.category === 'experience')
    return JSON.stringify({ education: [], projects: [], skills: [], certificates: [], experience: [{ text: 'Built services.', evidence: [role.index], rationale: 'Supported.' }] })
  } }
  try {
    workspace = createWorkbench(dir, undefined, transport)
    const api = workspace.api
    await api.setAnalysisBudgets({ ...analysisBudgetValues(await api.getAnalysisUsage()), minimumSpacingMs: 0 })
    await api.saveContact({ fullName: 'Candidate' })
    const education = await api.saveProfileEntry({ section: 'education', title: 'B.Sc. in Computer Science (Data Science)', institution: 'Example University', endDate: '2024' })
    if (!education.ok) throw Error('education fixture')
    const degreeId = education.value.education[0].id
    await api.saveProject({ name: 'Image classifier', description: 'Trained and evaluated machine learning models.' })
    await api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Example', description: 'Built services.' })
    const job = await api.saveJob({ title: 'AI Engineer', company: 'Example', description: 'Bachelor’s degree in Computer Science or Data Science; ML knowledge; production deployment and 3–6 years experience.' })
    if (!job.ok) throw Error('job fixture')
    const consent = await api.prepareOutboundConsent(job.value.id)
    if (!consent.ok) throw Error('consent fixture')
    await api.acceptOutboundConsent(consent.token, true, true)
    await api.startAnalysis(consent.token)
    const result = await api.generateDraft(consent.token)
    expect(result.ok, result.message).toBe(true)
    expect(result.draft).toMatchObject({ content: { education: [], projects: [] }, coverage: { assessments: expect.arrayContaining([
      expect.objectContaining({ qualification: degreeRequirement, status: 'supported', inDraft: false }),
      expect.objectContaining({ qualification: 'Solid understanding of machine learning algorithms, model training, evaluation, and optimization', status: 'partial', inDraft: false }),
      expect.objectContaining({ qualification: 'Experience building and deploying machine learning models in production environments', status: 'partial' })
    ]) } })
    const priorCalls = calls
    await api.saveProfileEntry({ id: degreeId, section: 'education', title: 'Bachelor of Biology', institution: 'Example University', endDate: '2024' })
    expect(await api.getDraft(job.value.id)).toMatchObject({ coverage: { assessments: expect.arrayContaining([expect.objectContaining({ qualification: degreeRequirement, status: 'not-evidenced' })]) } })
    const draft = (await api.getDraft(job.value.id))!
    const added = await api.mutateDraftRecord({ jobId: job.value.id, draftId: draft.id, sourceRevision: draft.revision, section: 'education', operation: 'add', scope: 'cv-only', value: { section: 'education', title: 'B.Sc. in Data Science', endDate: '2024' } })
    expect(added.ok, added.message).toBe(true)
    workspace.close(); workspace = createWorkbench(dir)
    expect(await workspace.api.getDraft(job.value.id)).toMatchObject({ coverage: { assessments: expect.arrayContaining([expect.objectContaining({ qualification: degreeRequirement, status: 'supported', inDraft: true })]) } })
    expect(calls).toBe(priorCalls)
    expect((await workspace.api.getProfile()).education).toHaveLength(1)
    expect((await workspace.api.getProfile()).education[0].title).toBe('Bachelor of Biology')
  } finally { workspace?.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})
