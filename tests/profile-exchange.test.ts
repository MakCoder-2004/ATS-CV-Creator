import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function open() { const dir = mkdtempSync(join(tmpdir(), 'cv-tailor-exchange-')); dirs.push(dir); return createWorkbench(dir) }

test('valid profile exchange replaces profile and experience while preserving evidence history', async () => {
  const wb = open()
  const old = await wb.api.saveSkill({ name: 'Old skill', category: 'Technical' })
  if (!old.ok) throw Error('fixture failed')
  const id = old.value.skills[0].id
  await wb.api.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Example Org', description: 'Original experience', factualItems: [{ text: 'Built a system' }] })
  await wb.api.saveProject({ name: 'Portfolio', description: 'Project summary', factualItems: [{ text: 'Shipped a project' }], technologies: [{ text: 'TypeScript' }], links: [{ label: 'Source', url: 'https://example.test/repo' }] })
  const profile = await wb.api.getProfile(), experience = await wb.api.getExperience()
  const replacement = { format: 'cv-tailor-profile', version: 1, profile, experience }
  const applied = await wb.api.replaceProfile(JSON.stringify(replacement))
  wb.close()
  expect(applied).toMatchObject({ ok: true, profile: { skills: [{ id, name: 'Old skill' }] } })
  const reopened = createWorkbench(dirs[0])
  expect(await reopened.api.getExperience()).toEqual(experience)
  expect(await reopened.api.getEvidenceHistory(id)).toMatchObject([{ action: 'created', snapshot: { name: 'Old skill' } }])
  reopened.close()
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
