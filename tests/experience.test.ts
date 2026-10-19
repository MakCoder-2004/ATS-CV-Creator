import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function open() {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-experience-'))
  directories.push(directory)
  return { directory, workbench: createWorkbench(directory) }
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
  const changed = await workbench.api.saveExperience({ id: record.id, kind: 'training', title: record.title, organization: record.organization, startDate: record.startDate, endDate: record.endDate, description: 'Corrected original description.', factualItems: [record.factualItems[1], { ...record.factualItems[0], text: 'Recorded verified observations.' }] })
  expect(changed).toMatchObject({ ok: true, value: { experience: [{ id: record.id, revision: 2, factualItems: [{ id: itemIds[1] }, { id: itemIds[0], revision: 2 }] }] } })
  const editedProject = await workbench.api.saveProject({ id: projectRecord.id, name: 'Prototype', description: projectRecord.description, factualItems: projectRecord.factualItems, technologies: projectRecord.technologies, links: projectRecord.links })
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
  const reopened = createWorkbench(directory)
  expect(await reopened.api.getExperience()).toMatchObject({ experience: [{ id: record.id, revision: 2, kind: 'training' }], projects: [{ id: ids[0], revision: 2 }] })
  expect(await reopened.api.getEvidenceHistory(ids[0])).toHaveLength(2)
  reopened.close()
})

test('nested IDs must belong to the edited parent and invalid updates are atomic', async () => {
  const { workbench } = open()
  const one = await workbench.api.saveProject({ name: 'One', description: 'First', technologies: [{ text: 'TS' }] })
  const two = await workbench.api.saveProject({ name: 'Two', description: 'Second' })
  if (!one.ok || !two.ok) throw Error('Failed to create projects')
  const before = await workbench.api.getExperience()
  const conflict = await workbench.api.saveProject({ id: two.value.projects[0].id, name: 'Two', description: 'Second', technologies: [{ ...one.value.projects[0].technologies[0], text: 'Borrowed ID' }] })
  expect(conflict).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  expect(await workbench.api.getExperience()).toEqual(before)
  const invalid = await workbench.api.saveExperience({ kind: 'employment', title: ' ', organization: 'Org', description: 'Text' })
  expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { title: expect.any(String) } } })
  const role = await workbench.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Org', description: 'Original text' })
  if (!role.ok) throw Error(role.error.message)
  expect(await workbench.api.deleteExperience(role.value.experience[0].id)).toMatchObject({ ok: true, value: { experience: [] } })
  expect(await workbench.api.getEvidenceHistory(role.value.experience[0].id)).toMatchObject([{ action: 'created' }, { action: 'deleted' }])
  expect(await workbench.api.deleteProject(two.value.projects[0].id)).toMatchObject({ ok: true, value: { projects: [] } })
  expect(await workbench.api.getEvidenceHistory(two.value.projects[0].id)).toMatchObject([{ action: 'created' }, { action: 'deleted' }])
  workbench.close()
})
