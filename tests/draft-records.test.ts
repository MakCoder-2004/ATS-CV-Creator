import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
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
  const draft = { id: uuid, jobId: uuid, revision: 1, lockedFields: { fullName: 'Candidate', experience: [], education: [], projects: [], certificates: [] }, evidence: [{ evidenceId: uuid, revision: 1, provenance: 'manual', snapshot: { name: 'Prototype', description: 'Built a thing', technologies: [{ id: uuid, revision: 1, text: 'TypeScript' }], factualItems: [], links: [] } }], content: { education: [], experience: [], projects: [{ text: 'Built a thing', citations: [{ evidenceId: uuid, revision: 1 }], rationale: 'manual' }], skills: [], certificates: [] } } as unknown as DraftRevision
  expect(listDraftRecords(draft)).toEqual([{ section: 'projects', index: 0, sourceId: uuid, sourceRevision: 1, value: { name: 'Prototype', description: 'Built a thing', factualItems: [], technologies: [{ id: uuid, text: 'TypeScript' }], links: [] } }])
})

test('record list maps grouped legacy child citations to one editable parent', () => {
  const parentId = '00000000-0000-4000-8000-000000000002', childA = '00000000-0000-4000-8000-000000000003', childB = '00000000-0000-4000-8000-000000000004'
  const draft = { id: uuid, jobId: uuid, revision: 1, evidence: [
    { evidenceId: parentId, revision: 1, snapshot: { id: parentId, revision: 1, kind: 'employment', title: 'Engineer', organization: 'Org', description: 'Saved prose.', factualItems: [{ id: childA, revision: 1, text: 'Built systems.' }, { id: childB, revision: 1, text: 'Improved reliability.' }] } },
    { evidenceId: childA, revision: 1, snapshot: { id: childA, revision: 1, text: 'Built systems.' } },
    { evidenceId: childB, revision: 1, snapshot: { id: childB, revision: 1, text: 'Improved reliability.' } }
  ], lockedFields: { fullName: 'Candidate', experience: [{ evidenceId: parentId, sourceIds: [parentId, childA, childB], title: 'Engineer', organization: 'Org' }], education: [], projects: [], certificates: [] }, content: { education: [], experience: [
    { text: 'Built systems.', citations: [{ evidenceId: childA, revision: 1 }], rationale: 'Generated.' },
    { text: 'Improved reliability.', citations: [{ evidenceId: childB, revision: 1 }], rationale: 'Generated.' }
  ], projects: [], skills: [], certificates: [] } } as unknown as DraftRevision
  const listed = listDraftRecords(draft).filter(record => record.section === 'experience')
  expect(listed).toHaveLength(2)
  expect(listed.map(record => [record.index, record.sourceId, record.value])).toEqual([
    [0, parentId, { kind: 'employment', title: 'Engineer', organization: 'Org', description: 'Built systems.\nImproved reliability.', factualItems: [{ id: childA, text: 'Built systems.' }, { id: childB, text: 'Improved reliability.' }] }],
    [1, parentId, { kind: 'employment', title: 'Engineer', organization: 'Org', description: 'Built systems.\nImproved reliability.', factualItems: [{ id: childA, text: 'Built systems.' }, { id: childB, text: 'Improved reliability.' }] }]
  ])
})

async function generatedWorkspace(withGroupedExperience = false) {
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
  await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Org', description: 'Built services.', factualItems: withGroupedExperience ? [{ text: 'Documented APIs.' }, { text: 'Reviewed tests.' }] : [] })
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
  const exportProject = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section: 'projects', operation: 'add', scope: 'cv-only', value: { name: 'Export project', description: 'Built a review tool.', factualItems: [{ text: 'Reviewed tests.' }], technologies: [{ text: 'TypeScript' }], links: [{ label: 'Repository', url: 'https://example.test/export' }] } })
  expect(exportProject.ok).toBe(true); draft = exportProject.draft!
  const projectIndex = draft.content.projects.length - 1
  const descriptor = listDraftRecords(draft).find(record => record.section === 'projects' && record.index === projectIndex)!
  const projectId = descriptor.sourceId!, factId = (descriptor.value as { factualItems: Array<{ id?: string }> }).factualItems[0]!.id
  const editedProject = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section: 'projects', operation: 'update', index: projectIndex, scope: 'cv-only', value: { ...descriptor.value, description: 'Built a review tool with tests.' } })
  expect(editedProject.ok).toBe(true); draft = editedProject.draft!
  expect(draft.evidence.filter(entry => entry.evidenceId === projectId)).toHaveLength(1)
  expect(draft.evidence.find(entry => entry.evidenceId === projectId)).toMatchObject({ revision: 2, snapshot: { factualItems: [{ id: factId, revision: 1 }] } })
  const manualRole = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section: 'experience', operation: 'add', scope: 'cv-only', value: { kind: 'employment', title: 'Manual role', organization: 'Manual org', description: 'Built a service.' } })
  expect(manualRole.ok).toBe(true); draft = manualRole.draft!
  expect(await wb.api.getProfile()).toEqual(before.profile)
  expect(await wb.api.getExperience()).toEqual(before.experience)
  expect(await wb.api.checkDraft(jobId)).toMatchObject({ passed: true, findings: [] })
  const canonical = (await wb.api.getCanonicalDocument(jobId))!
  expect(canonical.sections.find(section => section.name === 'Projects')?.entries.find(entry => entry.heading === 'Export project')).toMatchObject({ technologies: ['TypeScript'], links: [{ url: 'https://example.test/export' }] })
  const hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  await wb.api.saveDocumentFitReport(jobId, { documentHash: hash, targetPages: canonical.targetPages, actualPages: 1, extractedText: [], linkTargets: [], links: [], overflow: false, proposedCuts: [], measuredAt: new Date().toISOString() })
  expect(await wb.api.approveDraft(jobId)).toMatchObject({ ok: true, draft: { approved: true } })
  expect(await wb.api.assertDraftExportable(jobId)).toMatchObject({ ok: true })
  const roleIndex = draft.content.experience.length - 1
  expect(await wb.api.correctDraft({ jobId, section: 'experience', index: roleIndex, text: 'Created dependable services.' })).toMatchObject({ status: 'unverified', approved: false, checkReport: { passed: true } })
  expect(await wb.api.getDocumentFitReport(jobId)).toBeNull()
  expect(await wb.api.correctDraft({ jobId, section: 'experience', index: roleIndex, text: 'Created 9 dependable services.' })).toMatchObject({ status: 'blocked', checkReport: { passed: false, findings: [expect.objectContaining({ code: 'unsupported-number' })] } })
  const stale = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision - 1, section: 'skills', operation: 'add', scope: 'cv-only', value: values.skills })
  expect(stale).toMatchObject({ ok: false, message: expect.stringContaining('changed') })
  expect(draft.content.education).toHaveLength(1)
  expect(draft.content.experience).toHaveLength(2)
  expect(draft.content.projects).toHaveLength(2)
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
  const localPromotions = [
    { section: 'experience' as const, value: { kind: 'employment' as const, title: 'Local engineer', organization: 'Manual Org', description: 'Built systems.', factualItems: [{ text: 'Documented APIs.' }] } },
    { section: 'projects' as const, value: { name: 'Local project', description: 'Built a tool.', factualItems: [{ text: 'Published a package.' }], technologies: [{ text: 'TypeScript' }], links: [{ label: 'Repository', url: 'https://example.test/local' }] } }
  ]
  for (const local of localPromotions) {
    const createdLocal = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section: local.section, operation: 'add', scope: 'cv-only', value: local.value })
    expect(createdLocal.ok).toBe(true); draft = createdLocal.draft!
    const descriptor = listDraftRecords(draft).find(record => record.section === local.section && record.index === draft.content[local.section].length - 1)!
    const localId = descriptor.sourceId
    const promotedLocal = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section: local.section, operation: 'update', index: descriptor.index, scope: 'profile', value: descriptor.value })
    expect(promotedLocal.ok, promotedLocal.message).toBe(true); draft = promotedLocal.draft!
    const promotedId = draft.content[local.section][descriptor.index]!.citations[0]!.evidenceId
    expect(promotedId).not.toBe(localId)
    expect(await wb.api.getEvidenceHistory(promotedId)).toMatchObject([{ revision: 1, action: 'created' }])
    const deletedLocal = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section: local.section, operation: 'remove', index: descriptor.index, scope: 'profile' })
    expect(deletedLocal).toMatchObject({ ok: true, profileDeleteWarning: true }); draft = deletedLocal.draft!
    expect(await wb.api.getEvidenceHistory(promotedId)).toMatchObject([{ action: 'created' }, { action: 'deleted' }])
  }
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
  const originalSkill = (await wb.api.getProfile()).skills.find(skill => skill.name === 'TypeScript')!
  expect((await wb.api.saveSkill({ id: originalSkill.id, name: originalSkill.name, category: originalSkill.category, proficiency: 'expert' })).ok).toBe(true)
  const staleSkillIndex = draft.content.skills.findIndex(skill => skill.name === 'TypeScript')
  expect(await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section: 'skills', operation: 'update', index: staleSkillIndex, scope: 'profile', value: { name: 'TypeScript', category: 'Languages', proficiency: 'advanced' } })).toMatchObject({ ok: false, message: expect.stringContaining('changed') })
  expect(await wb.api.checkDraft(jobId)).toMatchObject({ passed: false, findings: expect.arrayContaining([expect.objectContaining({ code: 'stale-source' })]) })
  wb.close()
  const reopened = createWorkbench(dir); opened.push(reopened)
  expect((await reopened.api.getProfile()).skills.some(skill => skill.id === addedRecord.id)).toBe(false)
  expect(await reopened.api.getEvidenceHistory(addedRecord.id)).toHaveLength(3)
}, 30000)

test('grouped legacy role paragraphs edit and delete as one profile record', async () => {
  const { wb, jobId } = await generatedWorkspace(true)
  let draft = (await wb.api.getDraft(jobId))!
  const role = (await wb.api.getExperience()).experience[0]!
  for (const fact of role.factualItems) expect(await wb.api.addDraftItem({ jobId, section: 'experience', text: fact.text, citation: { evidenceId: fact.id, revision: fact.revision } })).not.toBeNull()
  draft = (await wb.api.getDraft(jobId))!
  expect(draft.content.experience.length).toBeGreaterThan(1)
  const sourceIds = draft.content.experience.flatMap(item => item.citations.map(citation => citation.evidenceId))
  expect(sourceIds.every(id => draft.lockedFields.experience[0]!.sourceIds!.includes(id))).toBe(true)
  const edited = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section: 'experience', operation: 'update', index: 1, scope: 'profile', value: { kind: role.kind, title: role.title, organization: role.organization, description: 'Built dependable services.', factualItems: role.factualItems.map(({ id, text }) => ({ id, text })) } })
  expect(edited.ok).toBe(true); draft = edited.draft!
  expect(draft.content.experience).toHaveLength(1)
  expect(draft.evidence.filter(entry => entry.evidenceId === role.id)).toHaveLength(1)
  expect(draft.evidence.find(entry => entry.evidenceId === role.id)).toMatchObject({ revision: 2 })
  expect((await wb.api.checkDraft(jobId))?.passed).toBe(true)
  const removed = await wb.api.mutateDraftRecord({ jobId, draftId: draft.id, sourceRevision: draft.revision, section: 'experience', operation: 'remove', index: 0, scope: 'profile' })
  expect(removed).toMatchObject({ ok: true, profileDeleteWarning: true, draft: { content: { experience: [] } } })
  expect(await wb.api.getEvidenceHistory(role.id)).toMatchObject([{ revision: 1, action: 'created' }, { revision: 2, action: 'updated' }, { revision: 3, action: 'deleted' }])
}, 30000)
