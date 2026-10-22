import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function open() {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-jobs-'))
  directories.push(directory)
  return { directory, workbench: createWorkbench(directory) }
}

test('saved jobs preserve original posting text, have stable IDs, and reopen after SQLite restart', async () => {
  const { directory, workbench } = open()
  const original = '\n  Responsibilities:\n- Build reliable systems.\n  Requirements: TypeScript.  \n'
  const saved = await workbench.api.saveJob({ title: 'Engineer', company: 'Fictional Co', description: original })
  expect(saved.ok).toBe(true)
  if (!saved.ok) throw Error(saved.error.message)
  expect(saved.value).toMatchObject({ title: 'Engineer', company: 'Fictional Co', description: original, provenance: 'manual', sourceSnapshot: null, revisions: [{ title: 'Engineer', company: 'Fictional Co', description: original, revision: 1, provenance: 'manual' }] })
  const id = saved.value.id
  expect(await workbench.api.listJobs()).toEqual([saved.value])
  workbench.close()

  const reopened = createWorkbench(directory)
  expect(await reopened.api.openJob(id)).toEqual(saved.value)
  expect(await reopened.api.listJobs()).toEqual([saved.value])
  reopened.close()
})

test('job validation is actionable and invalid records do not mutate storage', async () => {
  const { workbench } = open()
  const invalid = await workbench.api.saveJob({ title: '  ', company: '', description: '\n ' })
  expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { title: expect.any(String), company: expect.any(String), description: expect.any(String) } } })
  expect(await workbench.api.listJobs()).toEqual([])
  expect(await workbench.api.openJob('not-a-uuid')).toBeNull()
  const missing = await workbench.api.saveJob({ id: 'b28b5307-07dd-4e39-bc16-849c56b4c331', title: 'Engineer', company: 'Fictional Co', description: 'Build software.' })
  expect(missing).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  workbench.close()
})

test('opening another job returns only its posting and updating one keeps its identity', async () => {
  const { directory, workbench } = open()
  const first = await workbench.api.saveJob({ title: 'Engineer', company: 'Northwind', description: 'Design compiler tools.' })
  const second = await workbench.api.saveJob({ title: 'Analyst', company: 'Contoso', description: 'Review fictional datasets.' })
  if (!first.ok || !second.ok) throw Error('Fixture save failed')
  expect(await workbench.api.openJob(first.value.id)).toMatchObject({ title: 'Engineer', company: 'Northwind', description: 'Design compiler tools.' })
  expect(await workbench.api.openJob(second.value.id)).toMatchObject({ title: 'Analyst', company: 'Contoso', description: 'Review fictional datasets.' })
  const updated = await workbench.api.saveJob({ id: first.value.id, title: 'Senior Engineer', company: 'Northwind', description: 'Design compiler tools with a fictional team.' })
  expect(updated).toMatchObject({ ok: true, value: { id: first.value.id, createdAt: first.value.createdAt, title: 'Senior Engineer', revisions: [{ title: 'Engineer', revision: 1, provenance: 'manual' }, { title: 'Senior Engineer', revision: 2, provenance: 'manual' }] } })
  expect(await workbench.api.openJob(first.value.id)).toMatchObject({ revisions: [{ description: 'Design compiler tools.' }, { description: 'Design compiler tools with a fictional team.' }] })
  expect(await workbench.api.listJobs()).toHaveLength(2)
  expect(await workbench.api.openJob(second.value.id)).toEqual(second.value)
  workbench.close()
  const reopened = createWorkbench(directory)
  expect(await reopened.api.openJob(first.value.id)).toMatchObject({ id: first.value.id, createdAt: first.value.createdAt, description: 'Design compiler tools with a fictional team.', revisions: [{ description: 'Design compiler tools.' }, { description: 'Design compiler tools with a fictional team.' }] })
  reopened.close()
})

test('complete long postings reopen exactly and text above the shared safety ceiling is refused', async () => {
  const { directory, workbench } = open()
  const complete = `Requirements:\n${'Unicode ☕ responsibilities and qualifications.\n'.repeat(1100)}`
  expect(Array.from(complete).length).toBeGreaterThan(30000)
  const saved = await workbench.api.saveJob({ title: 'Engineer', company: 'Example', description: complete })
  expect(saved.ok).toBe(true)
  if (!saved.ok) throw Error(saved.error.message)
  workbench.close()

  const reopened = createWorkbench(directory)
  expect((await reopened.api.openJob(saved.value.id))?.description).toBe(complete)
  const oversized = await reopened.api.saveJob({ title: 'Engineer', company: 'Example', description: 'x'.repeat(200001) })
  expect(oversized).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { description: expect.stringMatching(/200,000/) } } })
  expect((await reopened.api.openJob(saved.value.id))?.description).toBe(complete)
  reopened.close()
})
