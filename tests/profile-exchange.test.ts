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
  const current = await wb.api.getProfile()
  const experience = await wb.api.getExperience()
  const replacement = { format: 'cv-tailor-profile', version: 1, profile: { ...current, skills: [{ ...old.value.skills[0], name: 'Imported skill' }] }, experience }
  const applied = await wb.api.applyProfileImport(JSON.stringify(replacement))
  wb.close()
  expect(applied).toMatchObject({ ok: true, profile: { skills: [{ id, name: 'Imported skill' }] } })
  const reopened = createWorkbench(dirs[0])
  expect(await reopened.api.getEvidenceHistory(id)).toMatchObject([{ action: 'created', snapshot: { name: 'Old skill' } }])
  reopened.close()
})

test('invalid, incompatible, and duplicate-ID imports leave the complete profile unchanged', async () => {
  const wb = open()
  const saved = await wb.api.saveSkill({ name: 'Keep me', category: 'Technical' })
  if (!saved.ok) throw Error('fixture failed')
  const before = await wb.api.getProfile()
  const experience = await wb.api.getExperience()
  expect(await wb.api.applyProfileImport('{')).toMatchObject({ ok: false })
  expect(await wb.api.applyProfileImport(JSON.stringify({ format: 'cv-tailor-profile', version: 99 }))).toMatchObject({ ok: false })
  const dup = saved.value.skills[0]
  const invalid = { format: 'cv-tailor-profile', version: 1, profile: { ...before, education: [{ id: dup.id, revision: 1, section: 'education', title: 'Degree' }] }, experience }
  expect(await wb.api.applyProfileImport(JSON.stringify(invalid))).toMatchObject({ ok: false, message: expect.stringContaining('duplicate') })
  expect(await wb.api.getProfile()).toEqual(before)
  wb.close()
})
