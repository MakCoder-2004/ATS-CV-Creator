import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listDraftRecords, mutateDraftRecordInputSchema } from '../src/shared/draft-records'
import type { DraftRevision } from '../src/shared/draft'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'

const uuid = '00000000-0000-4000-8000-000000000001'
const dirs: string[] = [], opened: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const wb of opened.splice(0)) wb.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) })

test('record mutation contract requires a revision and target for update/remove', () => {
  const base = { jobId: uuid, draftId: uuid, sourceRevision: 1, section: 'skills', scope: 'cv-only' }
  expect(mutateDraftRecordInputSchema.safeParse({ ...base, operation: 'update', value: { name: 'TypeScript', category: 'Technologies' } }).success).toBe(false)
  expect(mutateDraftRecordInputSchema.safeParse({ ...base, operation: 'remove', index: 0 }).success).toBe(true)
  expect(mutateDraftRecordInputSchema.safeParse({ ...base, operation: 'add', value: { name: 'TypeScript', category: 'Technologies' } }).success).toBe(true)
})

test('record list resolves editable values from frozen evidence snapshots', () => {
  const draft = { id: uuid, jobId: uuid, revision: 1, evidence: [{ evidenceId: uuid, revision: 1, provenance: 'manual', snapshot: { name: 'Prototype', description: 'Built a thing', technologies: [{ id: uuid, revision: 1, text: 'TypeScript' }], factualItems: [], links: [] } }], content: { education: [], experience: [], projects: [{ text: 'Built a thing', citations: [{ evidenceId: uuid, revision: 1 }], rationale: 'manual' }], skills: [], certificates: [] } } as unknown as DraftRevision
  expect(listDraftRecords(draft)).toEqual([{ section: 'projects', index: 0, sourceId: uuid, sourceRevision: 1, value: { name: 'Prototype', description: 'Built a thing', factualItems: [], technologies: [{ id: uuid, text: 'TypeScript' }], links: [] } }])
})

async function generatedWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'draft-record-scope-')); dirs.push(dir)
  const transport: AnalysisTransport = { async generate({ prompt }) {
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) { const { items } = JSON.parse(prompt.slice(prompt.indexOf('{'))); return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 0.9, rationale: 'Relevant.' })) }) }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const byCategory = (category: string) => selected.filter((item: { category: string }) => item.category === category).map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'User source.' }))
    return JSON.stringify({ headline: 'Engineer', summary: { text: 'Engineer.', evidence: [0], rationale: 'Profile.' }, education: byCategory('education'), experience: byCategory('experience'), projects: byCategory('projects'), skills: selected.filter((item: { category: string }) => item.category === 'skills').map((item: { index: number; text: string }) => ({ name: JSON.parse(item.text).name, evidence: [item.index], rationale: 'Profile.' })), certificates: [] })
  } }
  const wb = createWorkbench(dir, undefined, transport); opened.push(wb)
  await wb.api.saveContact({ fullName: 'Candidate' })
  await wb.api.saveProfileEntry({ section: 'education', title: 'Degree', institution: 'School', description: 'Studied systems.' })
  await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Org', description: 'Built services.' })
  await wb.api.saveProject({ name: 'Tool', description: 'Built a tool.' })
  await wb.api.saveSkill({ name: 'TypeScript', category: 'Languages' })
  const job = await wb.api.saveJob({ title: 'Engineer', company: 'Org', description: 'Build services.' })
  if (!job.ok) throw Error('job setup')
  const consent = await wb.api.prepareOutboundConsent(job.value.id)
  if (!consent.ok) throw Error('consent setup')
  await wb.api.acceptOutboundConsent(consent.token, true, true)
  await wb.api.startAnalysis(consent.token)
  const generated = await wb.api.generateDraft(consent.token)
  if (!generated.draft) throw Error(`draft setup: ${generated.message}`)
  return { wb, dir, jobId: job.value.id, draft: generated.draft }
}

test('CV-only CRUD covers every record section without changing profile; stale CAS rejects writes', async () => {
  const { wb, jobId } = await generatedWorkspace()
  const before = { profile: await wb.api.getProfile(), experience: await wb.api.getExperience() }
  const values = {
    education: { section: 'education', title: 'Additional degree', institution: 'New School', description: 'Studied systems.' },
    experience: { kind: 'employment', title: 'Consultant', organization: 'New Org', description: 'Built services.' },
    projects: { name: 'New Project', description: 'Built a tool.', technologies: [{ text: 'TypeScript' }], links: [{ label: 'Repo', url: 'https://example.test/repo' }] },
    skills: { name: 'TypeScript', category: 'Languages' }
  } as const
  let draft = (await wb.api.getDraft(jobId))!
  for (const section of ['education', 'experience', 'projects', 'skills'] as const) {
    const result = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section, operation: 'add', scope: 'cv-only', value: values[section] })
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining('CV only'), draft: { approved: false } })
    draft = result.draft!
  }
  for (const section of ['education', 'experience', 'projects', 'skills'] as const) {
    const index = draft.content[section].length - 1
    const changed = { ...values[section], ...(section === 'education' ? { description: 'Updated manual education.' } : section === 'experience' ? { description: 'Updated manual experience.' } : section === 'projects' ? { description: 'Updated manual project.' } : { proficiency: 'advanced' as const }) }
    const updated = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section, operation: 'update', index, scope: 'cv-only', value: changed })
    expect(updated.ok, `${section} update: ${updated.message}`).toBe(true); draft = updated.draft!
    const removed = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section, operation: 'remove', index: draft.content[section].length - 1, scope: 'cv-only' })
    expect(removed.ok, `${section} remove: ${removed.message}`).toBe(true); draft = removed.draft!
  }
  expect(await wb.api.getProfile()).toEqual(before.profile)
  expect(await wb.api.getExperience()).toEqual(before.experience)
  const stale = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision - 1, section: 'skills', operation: 'add', scope: 'cv-only', value: values.skills })
  expect(stale).toMatchObject({ ok: false, message: expect.stringContaining('changed') })
  expect(draft.content.education).toHaveLength(1)
  expect(draft.content.experience).toHaveLength(1)
  expect(draft.content.projects).toHaveLength(1)
  expect(draft.content.skills).toHaveLength(1)
}, 30000)

test('profile-scope add/update/delete records immutable history transactionally and survives reopen', async () => {
  const { wb, dir, jobId } = await generatedWorkspace()
  let draft = (await wb.api.getDraft(jobId))!
  const added = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section: 'skills', operation: 'add', scope: 'profile', value: { name: 'Go', category: 'Languages', proficiency: 'intermediate', years: 3 } })
  expect(added).toMatchObject({ ok: true, message: expect.stringContaining('profile') })
  draft = added.draft!
  const addedRecord = (await wb.api.getProfile()).skills.find(skill => skill.name === 'Go')!
  const profileBeforeFailures = await wb.api.getProfile()
  expect(await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision - 1, section: 'skills', operation: 'add', scope: 'profile', value: { name: 'Stale', category: 'Languages' } })).toMatchObject({ ok: false })
  expect(await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section: 'skills', operation: 'add', scope: 'profile', value: { name: ' ', category: 'Languages' } })).toMatchObject({ ok: false })
  expect(await wb.api.getProfile()).toEqual(profileBeforeFailures)
  const duplicate = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section: 'skills', operation: 'add', scope: 'profile', value: { name: 'TypeScript', category: 'Languages' } })
  expect(duplicate).toMatchObject({ ok: false })
  expect(await wb.api.getDraft(jobId)).toEqual(draft)
  expect(await wb.api.getProfile()).toEqual(profileBeforeFailures)
  expect(await wb.api.getEvidenceHistory(addedRecord.id)).toMatchObject([{ revision: 1, action: 'created', snapshot: { category: 'Languages', years: 3 } }])
  const addedIndex = draft.content.skills.findIndex(skill => skill.name === 'Go')
  const updated = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section: 'skills', operation: 'update', index: addedIndex, scope: 'profile', value: { name: 'Go', category: 'Languages', proficiency: 'advanced', years: 4 } })
  expect(updated.ok).toBe(true); draft = updated.draft!
  expect(await wb.api.getEvidenceHistory(addedRecord.id)).toMatchObject([{ revision: 1, action: 'created' }, { revision: 2, action: 'updated', snapshot: { proficiency: 'advanced', years: 4 } }])
  const updatedIndex = draft.content.skills.findIndex(skill => skill.name === 'Go')
  const removed = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section: 'skills', operation: 'remove', index: updatedIndex, scope: 'profile' })
  expect(removed).toMatchObject({ ok: true, profileDeleteWarning: true }); draft = removed.draft!
  expect((await wb.api.getProfile()).skills.some(skill => skill.id === addedRecord.id)).toBe(false)
  expect(await wb.api.getEvidenceHistory(addedRecord.id)).toMatchObject([{ revision: 1, action: 'created' }, { revision: 2, action: 'updated' }, { revision: 3, action: 'deleted' }])
  const otherRecords = [
    { section: 'education' as const, value: { section: 'education', title: 'New degree', institution: 'School', description: 'Studied data.' }, changed: { section: 'education', title: 'New degree', institution: 'School', description: 'Studied systems.' } },
    { section: 'experience' as const, value: { kind: 'employment' as const, title: 'Consultant', organization: 'Org', description: 'Built systems.', factualItems: [{ text: 'Used TypeScript.' }] }, changed: { kind: 'employment' as const, title: 'Consultant', organization: 'Org', description: 'Built services.', factualItems: [{ text: 'Used TypeScript.' }] } },
    { section: 'projects' as const, value: { name: 'New tool', description: 'Built tooling.', technologies: [{ text: 'TypeScript' }], links: [{ label: 'Repo', url: 'https://example.test/project' }] }, changed: { name: 'New tool', description: 'Built useful tooling.', technologies: [{ text: 'TypeScript' }], links: [{ label: 'Repo', url: 'https://example.test/project' }] } }
  ]
  for (const operation of otherRecords) {
    const created = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section: operation.section, operation: 'add', scope: 'profile', value: operation.value })
    expect(created.ok, `${operation.section}: ${created.message}`).toBe(true); draft = created.draft!
    const index = draft.content[operation.section].length - 1
    const citationId = draft.content[operation.section][index]!.citations[0]!.evidenceId
    const updatedOther = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section: operation.section, operation: 'update', index, scope: 'profile', value: operation.changed })
    expect(updatedOther.ok).toBe(true); draft = updatedOther.draft!
    expect((await wb.api.getEvidenceHistory(citationId)).map(entry => entry.action)).toEqual(['created', 'updated'])
    const removeIndex = draft.content[operation.section].findIndex(item => item.citations.some(citation => citation.evidenceId === citationId))
    const deleted = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section: operation.section, operation: 'remove', index: removeIndex, scope: 'profile' })
    expect(deleted).toMatchObject({ ok: true, profileDeleteWarning: true }); draft = deleted.draft!
    expect((await wb.api.getEvidenceHistory(citationId)).map(entry => entry.action)).toEqual(['created', 'updated', 'deleted'])
  }
  wb.close()
  const reopened = createWorkbench(dir); opened.push(reopened)
  expect((await reopened.api.getProfile()).skills.some(skill => skill.id === addedRecord.id)).toBe(false)
  expect(await reopened.api.getEvidenceHistory(addedRecord.id)).toHaveLength(3)
}, 30000)
