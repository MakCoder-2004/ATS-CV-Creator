import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function open() {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-profile-'))
  directories.push(directory)
  return { directory, workbench: createWorkbench(directory) }
}

test('contact and skills persist with stable IDs and immutable revisions', async () => {
  const { directory, workbench: first } = open()
  const contactResult = await first.api.saveContact({ fullName: ' Ada Lovelace ', headline: 'Engineer', links: ['https://example.com'] })
  expect(contactResult.ok).toBe(true)
  if (!contactResult.ok) throw Error(contactResult.error.message)
  const contactId = contactResult.value.contact!.id
  expect(contactResult.value.contact).toMatchObject({ id: contactId, revision: 1, fullName: ' Ada Lovelace ' })
  const skillResult = await first.api.saveSkill({ name: 'TypeScript', category: 'Languages', proficiency: 'advanced', years: 4 })
  expect(skillResult.ok).toBe(true)
  if (!skillResult.ok) throw Error(skillResult.error.message)
  const skillId = skillResult.value.skills[0].id
  expect(skillResult.value.skills[0]).toMatchObject({ id: skillId, revision: 1, name: 'TypeScript' })
  await first.api.saveSkill({ id: skillId, name: ' TypeScript ', category: 'Languages', proficiency: 'expert' })
  expect(await first.api.getEvidenceHistory(skillId)).toMatchObject([
    { revision: 1, action: 'created', snapshot: { name: 'TypeScript', proficiency: 'advanced' } },
    { revision: 2, action: 'updated', snapshot: { name: ' TypeScript ', proficiency: 'expert' } }
  ])
  first.close()
  const reopened = createWorkbench(directory)
  expect(await reopened.api.getProfile()).toMatchObject({ contact: { id: contactId, revision: 1 }, skills: [{ id: skillId, revision: 2 }] })
  reopened.close()
})

test('invalid inputs are actionable and leave SQLite state unchanged', async () => {
  const { workbench } = open()
  const before = await workbench.api.getProfile()
  const result = await workbench.api.saveSkill({ name: ' ', category: 'Languages', years: -1 })
  expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { name: expect.any(String), years: expect.any(String) } } })
  expect(await workbench.api.getProfile()).toEqual(before)
  workbench.close()
})

test('deletions are recorded as revisions and stale IDs conflict', async () => {
  const { workbench } = open()
  const saved = await workbench.api.saveSkill({ name: 'Evidence', category: 'Other' })
  if (!saved.ok) throw Error(saved.error.message)
  const id = saved.value.skills[0].id
  expect(await workbench.api.deleteSkill(id)).toMatchObject({ ok: true, value: { skills: [] } })
  expect(await workbench.api.getEvidenceHistory(id)).toMatchObject([{ revision: 1, action: 'created' }, { revision: 2, action: 'deleted' }])
  expect(await workbench.api.deleteSkill(id)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  workbench.close()
})

test('duplicate skills differ only in case or surrounding spaces are rejected atomically', async () => {
  const { workbench } = open()
  const first = await workbench.api.saveSkill({ name: 'TypeScript', category: 'Languages' })
  expect(first.ok).toBe(true)
  const duplicate = await workbench.api.saveSkill({ name: ' typescript ', category: ' languages ' })
  expect(duplicate).toMatchObject({ ok: false, error: { code: 'CONFLICT', fieldErrors: { name: expect.any(String) } } })
  expect(await workbench.api.getProfile()).toEqual(first.ok ? first.value : null)
  workbench.close()
})

test('contact deletion preserves original revisions and its old ID is not reused', async () => {
  const { directory, workbench } = open()
  const saved = await workbench.api.saveContact({ fullName: 'Ada Lovelace' })
  if (!saved.ok) throw Error(saved.error.message)
  const oldId = saved.value.contact!.id
  expect(await workbench.api.deleteContact(oldId)).toMatchObject({ ok: true, value: { contact: null } })
  expect(await workbench.api.saveContact({ id: oldId, fullName: 'Unwanted' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  const newContact = await workbench.api.saveContact({ fullName: 'Grace Hopper' })
  expect(newContact.ok).toBe(true)
  if (newContact.ok) expect(newContact.value.contact!.id).not.toBe(oldId)
  workbench.close()
  const reopened = createWorkbench(directory)
  expect(await reopened.api.getEvidenceHistory(oldId)).toMatchObject([
    { action: 'created', snapshot: { fullName: 'Ada Lovelace' } },
    { action: 'deleted', snapshot: { fullName: 'Ada Lovelace' } }
  ])
  reopened.close()
})
