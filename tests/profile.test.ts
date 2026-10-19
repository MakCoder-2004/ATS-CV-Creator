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
  return createWorkbench(directory)
}

test('contact and skills persist with stable IDs and immutable revisions', async () => {
  const first = open()
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
  expect(await first.api.getEvidenceHistory(skillId)).toHaveLength(2)
  first.close()
  const reopened = open()
  expect(await reopened.api.getProfile()).toMatchObject({ contact: { id: contactId, revision: 1 }, skills: [{ id: skillId, revision: 2 }] })
  reopened.close()
})

test('invalid inputs are actionable and leave SQLite state unchanged', async () => {
  const workbench = open()
  const before = await workbench.api.getProfile()
  const result = await workbench.api.saveSkill({ name: ' ', category: 'Languages', years: -1 })
  expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { name: expect.any(String), years: expect.any(String) } } })
  expect(await workbench.api.getProfile()).toEqual(before)
  workbench.close()
})

test('deletions are recorded as revisions and stale IDs conflict', async () => {
  const workbench = open()
  const saved = await workbench.api.saveSkill({ name: 'Evidence', category: 'Other' })
  if (!saved.ok) throw Error(saved.error.message)
  const id = saved.value.skills[0].id
  expect(await workbench.api.deleteSkill(id)).toMatchObject({ ok: true, value: { skills: [] } })
  expect(await workbench.api.getEvidenceHistory(id)).toMatchObject([{ revision: 1, action: 'created' }, { revision: 2, action: 'deleted' }])
  expect(await workbench.api.deleteSkill(id)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  workbench.close()
})
