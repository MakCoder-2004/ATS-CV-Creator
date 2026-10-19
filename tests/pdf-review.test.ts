import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import { syntheticPdf } from './helpers/synthetic-pdf'

const workspaces: Array<ReturnType<typeof createWorkbench>> = []
const folders: string[] = []
afterEach(() => { for (const wb of workspaces.splice(0)) wb.close(); for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function open() { const dir = mkdtempSync(join(tmpdir(), 'cv-tailor-pdf-review-')); folders.push(dir); const wb = createWorkbench(dir); workspaces.push(wb); return wb }

async function fixture() {
  return syntheticPdf(doc => {
    doc.text('Example Person', 70, 70)
    doc.text('Example Academy', 70, 110)
    doc.text('Certificate of Practice', 70, 150)
    doc.text('https://example.test/certificate', 70, 190, { link: 'https://example.test/certificate' })
  })
}

test('synthetic PDF facts remain proposals until corrected, reviewed, and atomically applied', async () => {
  const wb = open()
  const existing = await wb.api.saveSkill({ name: 'Existing fact', category: 'Technical' })
  if (!existing.ok) throw new Error('fixture failed')
  const before = await wb.api.getProfile()
  const pdf = await fixture(), original = Buffer.from(pdf)
  const stage = await wb.api.stagePdfImport(pdf)
  if (!stage.ok) throw new Error(stage.message)
  expect(stage.preview.fields.every(field => !field.confirmed)).toBe(true)
  expect(await wb.api.getProfile()).toEqual(before)
  const fields = stage.preview.fields.map(field => {
    const text = field.value
    if (text.includes('Example Person')) return { ...field, category: 'contact' as const, field: 'name' as const, value: 'Corrected Person', confirmed: true }
    if (text.includes('Example Academy')) return { ...field, category: 'certificate' as const, field: 'organization' as const, confirmed: true }
    if (text.includes('Certificate of Practice')) return { ...field, category: 'certificate' as const, field: 'title' as const, confirmed: true }
    if (text === 'https://example.test/certificate' && field.field === 'link') return { ...field, category: 'certificate' as const, confirmed: true }
    return { ...field, confirmed: true }
  })
  const invalid = await wb.api.previewPdfImport(stage.token, { fields: fields.map((field, index) => index === 0 ? { ...field, confirmed: false } : field), confirmed: true })
  expect(invalid).toMatchObject({ ok: false })
  const proposal = await wb.api.previewPdfImport(stage.token, { fields, confirmed: true })
  expect(proposal).toMatchObject({ ok: true, effects: expect.arrayContaining([expect.objectContaining({ action: 'add', category: 'contact' })]) })
  expect(await wb.api.getProfile()).toEqual(before)
  expect(await wb.api.applyPdfImport(stage.token)).toMatchObject({ ok: true })
  expect(await wb.api.getProfile()).toMatchObject({ contact: { fullName: 'Corrected Person' }, skills: [{ name: 'Existing fact' }], certificates: [{ title: 'Certificate of Practice', issuer: 'Example Academy', link: 'https://example.test/certificate' }] })
  expect(pdf).toEqual(original)
  const imported = (await wb.api.getProfile()).certificates[0]
  expect(await wb.api.getEvidenceHistory(imported.id)).toMatchObject([{ action: 'created', snapshot: { title: 'Certificate of Practice' } }])
})

test('reviewed training, education and project technologies retain categories without guessed defaults', async () => {
  const wb = open()
  const pdf = await syntheticPdf(doc => {
    for (const [index, line] of ['Training Engineer', 'Example Institute', 'Supervised practice', 'BSc Data', 'Example University', 'Project Delta', 'Built service', 'TypeScript', 'Project repo'].entries()) doc.text(line, 70, 65 + index * 28, index === 8 ? { link: 'https://example.test/repo' } : {})
  })
  const selection = await wb.api.stagePdfImport(pdf)
  if (!selection.ok) throw new Error(selection.message)
  const change = (row: (typeof selection.preview.fields)[number]) => {
    const fields: Record<string, { category: typeof row.category; field: typeof row.field; experienceKind?: 'training' }> = {
      'Training Engineer': { category: 'experience', field: 'title', experienceKind: 'training' },
      'Example Institute': { category: 'experience', field: 'organization' },
      'Supervised practice': { category: 'experience', field: 'description' },
      'BSc Data': { category: 'education', field: 'title' },
      'Example University': { category: 'education', field: 'organization' },
      'Project Delta': { category: 'project', field: 'name' },
      'Built service': { category: 'project', field: 'description' },
      TypeScript: { category: 'project', field: 'technology' }
    }
    if (row.field === 'link') return { ...row, category: 'project' as const, label: 'Repository', confirmed: true }
    return { ...row, ...(fields[row.value] ?? {}), confirmed: true }
  }
  const rows = selection.preview.fields.map(change)
  const valid = await wb.api.previewPdfImport(selection.token, { fields: rows, confirmed: true })
  expect(valid).toMatchObject({ ok: true })
  expect(await wb.api.applyPdfImport(selection.token)).toMatchObject({ ok: true })
  expect(await wb.api.getProfile()).toMatchObject({ education: [{ title: 'BSc Data', institution: 'Example University' }] })
  expect(await wb.api.getExperience()).toMatchObject({ experience: [{ kind: 'training', title: 'Training Engineer' }], projects: [{ name: 'Project Delta', technologies: [{ text: 'TypeScript' }], links: [{ url: 'https://example.test/repo', label: 'Repository' }] }] })
})

test('cancel, invalid corrections and changed source leave profile and original bytes untouched', async () => {
  const wb = open()
  const before = await wb.api.getProfile(), pdf = await fixture()
  const selection = await wb.api.stagePdfImport(pdf)
  if (!selection.ok) throw new Error(selection.message)
  expect(await wb.api.cancelPdfImport(selection.token)).toMatchObject({ ok: true })
  expect(await wb.api.applyPdfImport(selection.token)).toMatchObject({ ok: false })
  const second = await wb.api.stagePdfImport(pdf)
  if (!second.ok) throw new Error(second.message)
  const invalid = second.preview.fields.map(field => ({ ...field, confirmed: true, category: 'education' as const, field: 'startDate' as const, value: 'invented date' }))
  expect(await wb.api.previewPdfImport(second.token, { fields: invalid, confirmed: true })).toMatchObject({ ok: false })
  expect(await wb.api.getProfile()).toEqual(before)
  const proposed = second.preview.fields.map((field, index) => ({ ...field, confirmed: true, category: index === 0 ? 'contact' as const : 'unmapped' as const, field: index === 0 ? 'name' as const : 'text' as const }))
  expect(await wb.api.previewPdfImport(second.token, { fields: proposed, confirmed: true })).toMatchObject({ ok: true })
  await wb.api.saveSkill({ name: 'Edited during review', category: 'Tools' })
  expect(await wb.api.applyPdfImport(second.token)).toMatchObject({ ok: false, message: expect.stringMatching(/changed|review/i) })
  expect((await wb.api.getProfile()).contact).toBeNull()
})
