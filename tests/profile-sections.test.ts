import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'

const dirs: string[] = []
const closers: Array<() => void> = []
afterEach(() => { closers.splice(0).forEach(close => { try { close() } catch { /* already closed */ } }); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })) })
function open() { const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-sections-')); dirs.push(directory); const workspace = createWorkbench(directory); closers.push(() => workspace.close()); return { directory, workspace } }

test('education, certificates, and non-exported profile categories validate, revise, delete, and reopen', async () => {
  const { directory, workspace } = open()
  const education = await workspace.api.saveProfileEntry({ section: 'education', title: 'BSc', institution: 'Example University', field: 'Computer Science', startDate: '2020-09', endDate: '2024' })
  expect(education.ok).toBe(true)
  if (!education.ok) throw new Error(education.error.message)
  expect(await workspace.api.saveProfileEntry({ section: 'education', title: 'Invalid date', startDate: '2024-13' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { startDate: expect.any(String) } } })
  const id = education.value.education[0].id
  expect(await workspace.api.saveProfileEntry({ section: 'education', title: 'BSc', institution: 'Example University', startDate: '2025', endDate: '2020' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { endDate: expect.any(String) } } })
  const updated = await workspace.api.saveProfileEntry({ id, section: 'education', title: 'MSc', institution: 'Example University', field: 'AI', startDate: '2024', endDate: '2026' })
  expect(updated).toMatchObject({ ok: true, value: { education: [{ id, revision: 2, title: 'MSc' }] } })
  expect(await workspace.api.saveProfileEntry({ id, section: 'certificates', title: 'MSc', issuer: 'Example' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  const certificate = await workspace.api.saveProfileEntry({ section: 'certificates', title: 'Cloud credential', issuer: 'Example', year: 2025, link: 'https://example.test/cert' })
  expect(certificate).toMatchObject({ ok: true, value: { certificates: [{ issuer: 'Example', year: 2025 }] } })
  const summary = await workspace.api.saveProfileEntry({ section: 'summary', title: 'Local summary', description: 'Private career note' })
  expect(summary).toMatchObject({ ok: true, value: { summary: [{ description: 'Private career note' }] } })
  const secondSummary = await workspace.api.saveProfileEntry({ section: 'summary', title: 'Another', description: 'Should not replace' })
  expect(secondSummary).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  const language = await workspace.api.saveProfileEntry({ section: 'languages', title: 'English', description: 'Fluent' })
  expect(language).toMatchObject({ ok: true, value: { languages: [{ title: 'English', description: 'Fluent' }] } })
  const badId = await workspace.api.saveProfileEntry({ id: 'bad', section: 'extras', title: 'Note' } as never)
  expect(badId).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
  expect(await workspace.api.getEvidenceHistory(id)).toMatchObject([{ revision: 1, action: 'created' }, { revision: 2, action: 'updated' }])
  expect(await workspace.api.deleteProfileEntry(id)).toMatchObject({ ok: true, value: { education: [] } })
  expect(await workspace.api.getEvidenceHistory(id)).toMatchObject([{ revision: 1 }, { revision: 2 }, { revision: 3, action: 'deleted' }])
  workspace.close()
  const reopened = createWorkbench(directory)
  expect(await reopened.api.getProfile()).toMatchObject({ education: [], certificates: [{ title: 'Cloud credential' }], summary: [{ description: 'Private career note' }], languages: [{ title: 'English' }] })
  expect(await reopened.api.getEvidenceHistory(id)).toHaveLength(3)
  reopened.close()
})
