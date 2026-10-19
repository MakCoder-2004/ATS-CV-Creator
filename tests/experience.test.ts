import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'

const directories: string[] = []
const closeWorkbenches: Array<() => void> = []
afterEach(() => {
  for (const close of closeWorkbenches.splice(0)) { try { close() } catch { /* already closed by the test */ } }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})
function track(directory: string) {
  const workbench = createWorkbench(directory)
  closeWorkbenches.push(() => workbench.close())
  return workbench
}
function open() {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-experience-'))
  directories.push(directory)
  return { directory, workbench: track(directory) }
}

test('experience and project evidence keeps stable nested IDs, exact text and immutable history across restart', async () => {
  const { directory, workbench } = open()
  const role = await workbench.api.saveExperience({ kind: 'training', title: 'Data trainee', organization: 'Lab', startDate: '2020-01 (as entered)', endDate: 'present', description: 'Original role description.', factualItems: [{ text: 'Observed testing process.' }, { text: 'Documented results.' }] })
  expect(role.ok).toBe(true)
  if (!role.ok) throw Error(role.error.message)
  const record = role.value.experience[0]
  expect(record).toMatchObject({ kind: 'training', title: 'Data trainee', startDate: '2020-01 (as entered)', revision: 1 })
  const itemIds = record.factualItems.map(item => item.id)
  const project = await workbench.api.saveProject({ name: 'Prototype', description: 'Project source text.', factualItems: [{ text: 'Built a small prototype.' }], technologies: [{ text: 'TypeScript' }], links: [{ label: 'Repository', url: 'https://example.test/repo' }] })
  expect(project.ok).toBe(true)
  if (!project.ok) throw Error(project.error.message)
  const projectRecord = project.value.projects[0]
  const ids = [projectRecord.id, projectRecord.factualItems[0].id, projectRecord.technologies[0].id]
  const changed = await workbench.api.saveExperience({ id: record.id, kind: 'training', title: record.title, organization: record.organization, startDate: record.startDate, endDate: record.endDate, description: 'Corrected original description.', factualItems: [{ id: record.factualItems[1].id, text: record.factualItems[1].text }, { id: record.factualItems[0].id, text: 'Recorded verified observations.' }] })
  expect(changed).toMatchObject({ ok: true, value: { experience: [{ id: record.id, revision: 2, factualItems: [{ id: itemIds[1] }, { id: itemIds[0], revision: 2 }] }] } })
  const editedProject = await workbench.api.saveProject({ id: projectRecord.id, name: 'Prototype', description: projectRecord.description, factualItems: projectRecord.factualItems.map(({ id, text }) => ({ id, text })), technologies: projectRecord.technologies.map(({ id, text }) => ({ id, text })), links: projectRecord.links })
  expect(editedProject).toMatchObject({ ok: true, value: { projects: [{ id: ids[0], revision: 2, factualItems: [{ id: ids[1] }], technologies: [{ id: ids[2] }] }] } })
  expect(await workbench.api.getEvidenceHistory(record.id)).toMatchObject([
    { revision: 1, action: 'created', snapshot: { description: 'Original role description.' } },
    { revision: 2, action: 'updated', snapshot: { description: 'Corrected original description.', factualItems: [{ id: itemIds[1] }, { id: itemIds[0] }] } }
  ])
  expect(await workbench.api.getEvidenceHistory(itemIds[0])).toMatchObject([
    { revision: 1, action: 'created', snapshot: { text: 'Observed testing process.' } },
    { revision: 2, action: 'updated', snapshot: { text: 'Recorded verified observations.' } }
  ])
  workbench.close()
  const reopened = track(directory)
  expect(await reopened.api.getExperience()).toMatchObject({ experience: [{ id: record.id, revision: 2, kind: 'training' }], projects: [{ id: ids[0], revision: 2 }] })
  expect(await reopened.api.getEvidenceHistory(ids[0])).toHaveLength(2)
  reopened.close()
})

test('nested IDs must belong to the edited parent and invalid updates are atomic', async () => {
  const { workbench } = open()
  const one = await workbench.api.saveProject({ name: 'One', description: 'First', technologies: [{ text: 'TS' }] })
  const two = await workbench.api.saveProject({ name: 'Two', description: 'Second' })
  if (!one.ok || !two.ok) throw Error('Failed to create projects')
  const firstProject = one.value.projects.find(item => item.name === 'One')!
  const secondProject = two.value.projects.find(item => item.name === 'Two')!
  const before = await workbench.api.getExperience()
  const conflict = await workbench.api.saveProject({ id: secondProject.id, name: 'Two', description: 'Second', technologies: [{ id: firstProject.technologies[0].id, text: 'Borrowed ID' }] })
  expect(conflict).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  expect(await workbench.api.getExperience()).toEqual(before)
  const invalid = await workbench.api.saveExperience({ kind: 'employment', title: ' ', organization: 'Org', description: 'Text' })
  expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { title: expect.any(String) } } })
  const role = await workbench.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Org', description: 'Original text' })
  if (!role.ok) throw Error(role.error.message)
  expect(await workbench.api.deleteExperience(role.value.experience[0].id)).toMatchObject({ ok: true, value: { experience: [] } })
  expect(await workbench.api.getEvidenceHistory(role.value.experience[0].id)).toMatchObject([{ action: 'created' }, { action: 'deleted' }])
  expect(await workbench.api.deleteProject(secondProject.id)).toMatchObject({ ok: true, value: { projects: [{ id: firstProject.id }] } })
  expect(await workbench.api.getEvidenceHistory(secondProject.id)).toMatchObject([{ action: 'created' }, { action: 'deleted' }])
  workbench.close()
})
