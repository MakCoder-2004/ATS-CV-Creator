import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { createWorkbench } from '../src/main/workbench'

const dirs: string[] = []
const opened: Array<{ close(): void }> = []
afterEach(() => {
  for (const item of opened.splice(0)) item.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function open() {
  const dir = mkdtempSync(join(tmpdir(), 'cv-tailor-exchange-')); dirs.push(dir)
  const instance = createWorkbench(dir)
  let closed = false
  const workbench = { ...instance, close() { if (!closed) { closed = true; instance.close() } } }
  opened.push(workbench)
  return workbench
}

test('valid profile exchange replaces profile and experience while preserving evidence history', async () => {
  const wb = open()
  const old = await wb.api.saveSkill({ name: 'Old skill', category: 'Technical' })
  if (!old.ok) throw Error('fixture failed')
  const id = old.value.skills[0].id
  await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Example Org', description: 'Original experience', factualItems: [{ text: 'Built a system' }] })
  await wb.api.saveProject({ name: 'Portfolio', description: 'Project summary', factualItems: [{ text: 'Shipped a project' }], technologies: [{ text: 'TypeScript' }], links: [{ label: 'Source', url: 'https://example.test/repo' }] })
  const profile = await wb.api.getProfile(), experience = await wb.api.getExperience()
  const importedExperience = { id: '2f40bb03-1594-4cab-bfc7-5dce74f47bee', revision: 1, kind: 'training' as const, title: 'Imported role', organization: 'Imported org', description: 'New imported experience.', factualItems: [{ id: '8eb55999-48b8-4e2d-9757-c3a763cd5135', revision: 1, text: 'Imported factual evidence.' }] }
  const fullExperience = { ...experience, experience: [...experience.experience, importedExperience], projects: [...experience.projects, { id: '7be4623d-3de4-401f-aeb4-ab5e77b1483a', revision: 1, name: 'Imported project', description: 'New imported project.', factualItems: [{ id: 'c42237cd-b99b-48bc-9bb1-4bdb8ec82ce4', revision: 1, text: 'Imported project evidence.' }], technologies: [{ id: 'b01dbf42-105d-475a-9032-12b5b84fadf6', revision: 1, text: 'Imported technology' }], links: [] }] }
  const replacement = { format: 'cv-tailor-profile', version: 1, profile: { ...profile, skills: [{ id: '0a54bc1b-8491-4e32-89e5-efc86bb02c6a', revision: 1, name: 'Imported skill', category: 'Tools' }] }, experience: fullExperience }
  const applied = await wb.api.replaceProfile(JSON.stringify(replacement))
  wb.close()
  expect(applied).toMatchObject({ ok: true, profile: { skills: [{ name: 'Imported skill' }] } })
  const reopened = createWorkbench(dirs[0])
  expect(await reopened.api.getExperience()).toEqual(fullExperience)
  expect(await reopened.api.getEvidenceHistory(importedExperience.id)).toMatchObject([{ revision: 1, action: 'created', snapshot: { title: 'Imported role' } }])
  expect(await reopened.api.getEvidenceHistory(importedExperience.factualItems[0].id)).toMatchObject([{ revision: 1, action: 'created', snapshot: { text: 'Imported factual evidence.' } }])
  expect(await reopened.api.getEvidenceHistory('7be4623d-3de4-401f-aeb4-ab5e77b1483a')).toMatchObject([{ revision: 1, action: 'created', snapshot: { name: 'Imported project' } }])
  expect(await reopened.api.getEvidenceHistory('c42237cd-b99b-48bc-9bb1-4bdb8ec82ce4')).toMatchObject([{ revision: 1, action: 'created', snapshot: { text: 'Imported project evidence.' } }])
  expect(await reopened.api.getEvidenceHistory('b01dbf42-105d-475a-9032-12b5b84fadf6')).toMatchObject([{ revision: 1, action: 'created', snapshot: { text: 'Imported technology' } }])
  expect(await reopened.api.getEvidenceHistory(id)).toMatchObject([
    { revision: 1, action: 'created', snapshot: { name: 'Old skill' } },
    { revision: 2, action: 'deleted', snapshot: { name: 'Old skill' } }
  ])
  const imported = applied.ok ? applied.profile!.skills.find(item => item.name === 'Imported skill') : undefined
  if (!imported) throw Error('import did not return profile')
  const historyBeforeEdit = await reopened.api.getEvidenceHistory(imported.id)
  expect(historyBeforeEdit).toMatchObject([{ revision: imported.revision, action: 'created', snapshot: { name: 'Imported skill' } }])
  await reopened.api.saveSkill({ id: imported.id, name: 'Edited imported skill', category: 'Technical' })
  expect(await reopened.api.getEvidenceHistory(imported.id)).toMatchObject([
    { revision: imported.revision, action: 'created', snapshot: { name: 'Imported skill' } },
    { revision: imported.revision + 1, action: 'updated', snapshot: { name: 'Edited imported skill' } }
  ])
  reopened.close()
})

test('replacement rolls back all active rows when a mid-transaction write fails', async () => {
  const wb = open()
  const oldContact = await wb.api.saveContact({ fullName: 'Keep current' })
  const oldSkill = await wb.api.saveSkill({ name: 'Existing', category: 'Technical' })
  if (!oldContact.ok || !oldSkill.ok) throw Error('fixture failed')
  const before = await wb.api.getProfile()
  const incoming = { format: 'cv-tailor-profile', version: 1, profile: { contact: { id: '45d4c602-85af-4e4c-aec5-cf94b806f196', revision: 1, fullName: 'Imported contact' }, skills: [{ id: '9730fdac-d43e-4df3-b5e3-2e9b14dc9fcb', revision: 1, name: 'Imported skill', category: 'Tools' }], education: [], certificates: [], summary: [], languages: [], extras: [] }, experience: { experience: [], projects: [] } }
  const sqlite = new Database(join(dirs[0], 'workbench.sqlite'))
  sqlite.exec("CREATE TRIGGER fail_import_skill BEFORE INSERT ON profile_skills BEGIN SELECT RAISE(ABORT, 'test mid-transaction failure'); END;")
  sqlite.close()
  expect(await wb.api.replaceProfile(JSON.stringify(incoming))).toMatchObject({ ok: false })
  expect(await wb.api.getProfile()).toEqual(before)
  expect(await wb.api.getEvidenceHistory(incoming.profile.contact.id)).toEqual([])
  wb.close()
})

test('invalid, incompatible, and duplicate-ID imports leave the complete profile unchanged', async () => {
  const wb = open()
  const saved = await wb.api.saveSkill({ name: 'Keep me', category: 'Technical' })
  if (!saved.ok) throw Error('fixture failed')
  const before = await wb.api.getProfile()
  const experience = await wb.api.getExperience()
  expect(await wb.api.replaceProfile('{')).toMatchObject({ ok: false })
  expect(await wb.api.replaceProfile(JSON.stringify({ format: 'cv-tailor-profile', version: 99 }))).toMatchObject({ ok: false })
  const dup = saved.value.skills[0]
  const invalid = { format: 'cv-tailor-profile', version: 1, profile: { ...before, education: [{ id: dup.id, revision: 1, section: 'education', title: 'Degree' }] }, experience }
  expect(await wb.api.replaceProfile(JSON.stringify(invalid))).toMatchObject({ ok: false })
  const collision = { format: 'cv-tailor-profile', version: 1, profile: { ...before, skills: [{ ...dup, name: 'Different fact, same evidence ID/revision' }] }, experience }
  expect(await wb.api.validateProfileImport(JSON.stringify(collision))).toMatchObject({ ok: false, message: expect.stringContaining('evidence') })
  expect(await wb.api.replaceProfile(JSON.stringify(collision))).toMatchObject({ ok: false, message: expect.stringContaining('evidence') })
  const duplicateSkills = { format: 'cv-tailor-profile', version: 1, profile: { ...before, skills: [dup, { ...dup, id: 'f70da237-2f87-43a9-92ad-b4cacdfbfab1', name: ' keep me ' }] }, experience }
  expect(await wb.api.validateProfileImport(JSON.stringify(duplicateSkills))).toMatchObject({ ok: false })
  expect(await wb.api.getProfile()).toEqual(before)
  expect(await wb.api.getExperience()).toEqual(experience)
  wb.close()
})
