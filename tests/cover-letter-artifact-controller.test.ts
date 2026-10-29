import { afterEach, expect, test, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { artifactFixture } from './helpers/cover-letter-artifact'
import { createCoverLetterArtifactController, type CoverLetterNativeDialogs } from '../src/main/cover-letter-artifact-controller'
import { createCoverLetterCompiler } from '../src/main/cover-letter-compiler'
import { inspectCoverLetterPdf, assertCoverLetterPdfContent } from '../src/main/cover-letter-pdf'

const fixtures: Awaited<ReturnType<typeof artifactFixture>>[] = []
afterEach(() => fixtures.splice(0).forEach(f => f.cleanup()))
async function setup(approve = true, pi = false) {
  const f = await artifactFixture(pi); fixtures.push(f)
  const output = join(f.dir, 'output'); mkdirSync(output)
  const input = { jobId: f.jobId, letterId: f.letter.id }
  if (approve) {
    expect((await f.wb.api.measureCoverLetter(input)).ok).toBe(true)
    for (const p of f.letter.paragraphs) expect((await f.wb.api.acknowledgeCoverLetterParagraph({ ...input, paragraphId: p.id, acknowledged: true })).ok).toBe(true)
    expect((await f.wb.api.approveCoverLetter(f.jobId, f.letter.id)).ok).toBe(true)
  }
  return { f, input, output }
}
function native(path: string, hooks: Partial<CoverLetterNativeDialogs> = {}) {
  return { chooseDestination: vi.fn(async () => ({ canceled: false, filePath: path })), confirmOverwrite: vi.fn(async () => true), ...hooks }
}

test('real public native actions save actual PDF and editable DOCX from the same canonical, independently of CV approval', async () => {
  const { f, input, output } = await setup(), cv = await f.wb.api.getDraft(f.jobId), calls = f.prompts.length
  const state = await f.wb.api.getCoverLetterReadModel(f.jobId)
  for (const format of ['pdf', 'docx'] as const) {
    const path = join(output, `letter.${format}`), dialogs = native(path)
    const result = await createCoverLetterArtifactController(f.wb, dialogs).exportCoverLetter({ ...input, format })
    expect(result).toMatchObject({ ok: true, cancelled: false })
    if (format === 'pdf') assertCoverLetterPdfContent(state.canonical!, await inspectCoverLetterPdf(readFileSync(path)))
    else {
      const zip = await JSZip.loadAsync(readFileSync(path)), xml = await zip.file('word/document.xml')!.async('string')
      for (const text of [...state.canonical!.paragraphs, state.canonical!.name, state.canonical!.subject]) expect(xml).toContain(text.replace(/&/g, '&amp;').replace(/'/g, '&apos;'))
      expect(await zip.file('word/styles.xml')!.async('string')).toContain('Lato')
      expect(xml).not.toContain('Known unsupported')
    }
    expect(dialogs.chooseDestination).toHaveBeenCalledOnce()
    if (process.env.CV_TAILOR_ARTIFACT_EVIDENCE_DIR) {
      mkdirSync(process.env.CV_TAILOR_ARTIFACT_EVIDENCE_DIR, { recursive: true })
      writeFileSync(join(process.env.CV_TAILOR_ARTIFACT_EVIDENCE_DIR, `public-action.${format}`), readFileSync(path))
    }
  }
  expect(readdirSync(output).sort()).toEqual(['letter.docx', 'letter.pdf'])
  expect(f.prompts).toHaveLength(calls)
  expect(await f.wb.api.getDraft(f.jobId)).toEqual(cv)
  expect(cv?.approved).toBe(false)
}, 30_000)

test('unapproved, forged fit, unsupported, stale or malformed export requests never open a dialog or write bytes', async () => {
  const { f, input, output } = await setup(false), dialogs = native(join(output, 'refused.pdf'))
  const controller = createCoverLetterArtifactController(f.wb, dialogs)
  for (const extra of [{}, { path: join(output, 'injected.pdf') }, { fit: { actualPages: 1 } }, { format: 'exe' }]) expect((await controller.exportCoverLetter({ ...input, format: 'pdf', ...extra } as never)).ok).toBe(false)
  f.mutate(letter => { letter.fit = { actualPages: 1, overflow: false, documentHash: 'a'.repeat(64), measuredAt: new Date().toISOString() }; letter.acknowledgments = { [letter.paragraphs[0].id]: 'f'.repeat(64) }; letter.approved = true; letter.approvedAt = new Date().toISOString() })
  expect((await controller.exportCoverLetter({ ...input, format: 'docx' })).ok).toBe(false)
  f.mutate(letter => { letter.paragraphs[0].text = 'مرحبا' })
  expect((await controller.exportCoverLetter({ ...input, format: 'pdf' })).ok).toBe(false)
  expect(dialogs.chooseDestination).not.toHaveBeenCalled()
  expect(readdirSync(output)).toEqual([])
})

test('native cancel, explicit overwrite decline and approved replacement report accurate outcomes and clean owned temps', async () => {
  const { f, input, output } = await setup(), path = join(output, 'existing.pdf')
  const before = Buffer.from('KEEP ORIGINAL'); writeFileSync(path, before)
  const cancelled = native(path, { chooseDestination: async () => ({ canceled: true }) })
  expect(await createCoverLetterArtifactController(f.wb, cancelled).exportCoverLetter({ ...input, format: 'pdf' })).toMatchObject({ ok: false, cancelled: true })
  const declined = native(path, { confirmOverwrite: async () => false })
  expect(await createCoverLetterArtifactController(f.wb, declined).exportCoverLetter({ ...input, format: 'pdf' })).toMatchObject({ ok: false, cancelled: true })
  expect(readFileSync(path)).toEqual(before)
  const accepted = native(path)
  expect((await createCoverLetterArtifactController(f.wb, accepted).exportCoverLetter({ ...input, format: 'pdf' })).ok).toBe(true)
  expect(accepted.confirmOverwrite).toHaveBeenCalledOnce()
  expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-')
  expect(readdirSync(output)).toEqual(['existing.pdf'])
}, 30_000)

for (const change of ['header', 'source', 'recipient', 'body'] as const) test(`public ${change} edit during native dialog refuses export without any output`, async () => {
  const { f, input, output } = await setup(), path = join(output, 'refused.pdf')
  const dialogs = native(path, { chooseDestination: async () => {
    if (change === 'header') { const c = (await f.wb.api.getProfile()).contact!; await f.wb.api.saveContact({ id: c.id, fullName: 'Changed Header' }) }
    if (change === 'source') { const s = (await f.wb.api.getProfile()).skills[0]; await f.wb.api.saveSkill({ id: s.id, name: s.name, category: 'Changed' }) }
    if (change === 'recipient') await f.wb.api.setCoverLetterRecipient({ ...input, recipient: 'Local Recruiter' })
    if (change === 'body') await f.wb.api.editCoverLetter({ ...input, recipient: null, paragraphs: [{ ...f.letter.paragraphs[0], text: 'Practiced TypeScript exercises.' }] })
    return { canceled: false, filePath: path }
  } })
  const result = await createCoverLetterArtifactController(f.wb, dialogs).exportCoverLetter({ ...input, format: 'pdf' })
  expect(result).toMatchObject({ ok: false, cancelled: false })
  expect(result.message).not.toContain(f.dir)
  expect(existsSync(path)).toBe(false)
  expect(readdirSync(output)).toEqual([])
}, 30_000)

for (const change of ['created', 'modified', 'replaced'] as const) test(`destination ${change} during real compilation refuses while preserving destination bytes`, async () => {
  const { f, input, output } = await setup(), path = join(output, 'changed.pdf')
  if (change !== 'created') writeFileSync(path, 'ORIGINAL')
  const real = createCoverLetterCompiler(f.roots)
  f.reopen({ ...real, compile: async canonical => {
    const result = await real.compile(canonical)
    if (change === 'replaced') renameSync(path, join(output, 'original-moved.pdf'))
    writeFileSync(path, 'EXTERNAL CHANGE')
    return result
  } })
  const result = await createCoverLetterArtifactController(f.wb, native(path)).exportCoverLetter({ ...input, format: 'pdf' })
  expect(result).toMatchObject({ ok: false, cancelled: false, message: expect.stringMatching(/destination changed/i) })
  expect(readFileSync(path).toString()).toBe('EXTERNAL CHANGE')
  expect(readdirSync(output).some(name => name.endsWith('.tmp'))).toBe(false)
}, 30_000)

test('public posting edits are refused while native export owns the job; unchanged canonical can still export', async () => {
  const { f, input, output } = await setup(), path = join(output, 'unchanged.pdf')
  const dialogs = native(path, { chooseDestination: async () => {
    expect((await f.wb.api.saveJob({ id: f.jobId, title: 'Changed', company: 'Example', description: 'Changed posting.' })).ok).toBe(false)
    return { canceled: false, filePath: path }
  } })
  expect((await createCoverLetterArtifactController(f.wb, dialogs).exportCoverLetter({ ...input, format: 'pdf' })).ok).toBe(true)
}, 30_000)

for (const stage of ['before-dialog', 'during-dialog', 'during-compile'] as const) test(`exact public Pi thinking selection change ${stage} blocks export without a model request`, async () => {
  const { f, input, output } = await setup(true, true), path = join(output, 'model.pdf'), calls = f.prompts.length
  const change = () => f.wb.api.setPiModel({ reference: 'sample/synthetic', thinkingLevel: 'high' })
  const dialogs = native(path, stage === 'during-dialog' ? { chooseDestination: async () => { await change(); return { canceled: false, filePath: path } } } : {})
  if (stage === 'before-dialog') await change()
  if (stage === 'during-compile') {
    const real = createCoverLetterCompiler(f.roots)
    f.reopen({ ...real, compile: async canonical => { const compiled = await real.compile(canonical); await change(); return compiled } })
  }
  expect((await createCoverLetterArtifactController(f.wb, dialogs).exportCoverLetter({ ...input, format: 'pdf' })).ok).toBe(false)
  if (stage === 'before-dialog') expect(dialogs.chooseDestination).not.toHaveBeenCalled()
  expect(f.prompts).toHaveLength(calls)
  expect(readdirSync(output)).toEqual([])
}, 30_000)

test('changed destination during native overwrite confirmation is never overwritten', async () => {
  const { f, input, output } = await setup(), path = join(output, 'existing.docx')
  writeFileSync(path, 'ORIGINAL')
  const dialogs = native(path, { confirmOverwrite: async () => { writeFileSync(path, 'EXTERNAL UPDATE'); return true } })
  expect(await createCoverLetterArtifactController(f.wb, dialogs).exportCoverLetter({ ...input, format: 'docx' })).toMatchObject({ ok: false, cancelled: false, message: expect.stringMatching(/destination changed/i) })
  expect(readFileSync(path).toString()).toBe('EXTERNAL UPDATE')
  expect(readdirSync(output)).toEqual(['existing.docx'])
}, 30_000)

test('actual DOCX generation is followed by the same current-document guard', async () => {
  const { f, input, output } = await setup(), path = join(output, 'refused.docx')
  const workspace = { beginJobOperation: f.wb.beginJobOperation, captureCoverLetterExport: async (action: typeof input) => {
    const real = await f.wb.captureCoverLetterExport(action)
    return { ...real, createBytes: async (format: 'pdf' | 'docx') => { const bytes = await real.createBytes(format); expect(bytes.subarray(0, 2).toString()).toBe('PK'); await f.wb.api.setCoverLetterRecipient({ ...input, recipient: 'Changed after DOCX' }); return bytes } }
  } }
  expect((await createCoverLetterArtifactController(workspace, native(path)).exportCoverLetter({ ...input, format: 'docx' })).ok).toBe(false)
  expect(readdirSync(output)).toEqual([])
}, 30_000)

test('final synchronous private-DB assertion is used at commit, after the post-generation guard', async () => {
  const { f, input, output } = await setup(), path = join(output, 'final.pdf')
  const workspace = { beginJobOperation: f.wb.beginJobOperation, captureCoverLetterExport: async (action: typeof input) => {
    const real = await f.wb.captureCoverLetterExport(action)
    let generated = false, checksAfterGeneration = 0
    return { ...real, createBytes: async (format: 'pdf' | 'docx') => { const bytes = await real.createBytes(format); generated = true; return bytes }, assertCurrent: (): undefined => {
      if (generated && ++checksAfterGeneration === 2) f.mutate(letter => { letter.recipient = 'Changed at final synchronous boundary' })
      return real.assertCurrent()
    } }
  } }
  expect((await createCoverLetterArtifactController(workspace, native(path)).exportCoverLetter({ ...input, format: 'pdf' })).ok).toBe(false)
  expect(readdirSync(output)).toEqual([])
}, 30_000)

for (const change of ['header', 'source', 'recipient', 'body'] as const) test(`current ${change} change after actual compile refuses all writes`, async () => {
  const { f, input, output } = await setup(), path = join(output, 'refused.pdf'), real = createCoverLetterCompiler(f.roots)
  f.reopen({ ...real, compile: async canonical => {
    const result = await real.compile(canonical)
    if (change === 'header') { const c = (await f.wb.api.getProfile()).contact!; await f.wb.api.saveContact({ id: c.id, fullName: 'Changed during compile' }) }
    if (change === 'source') { const s = (await f.wb.api.getProfile()).skills[0]; await f.wb.api.saveSkill({ id: s.id, name: s.name, category: 'Changed during compile' }) }
    if (change === 'recipient') await f.wb.api.setCoverLetterRecipient({ ...input, recipient: 'Changed during compile' })
    if (change === 'body') await f.wb.api.editCoverLetter({ ...input, recipient: null, paragraphs: [{ ...f.letter.paragraphs[0], text: 'Practiced TypeScript exercises.' }] })
    return result
  } })
  expect((await createCoverLetterArtifactController(f.wb, native(path)).exportCoverLetter({ ...input, format: 'pdf' })).ok).toBe(false)
  expect(readdirSync(output)).toEqual([])
}, 30_000)
