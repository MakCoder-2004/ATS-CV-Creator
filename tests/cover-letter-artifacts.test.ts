import { afterAll, beforeAll, expect, test } from 'vitest'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import JSZip from 'jszip'
import { projectCoverLetter } from '../src/shared/cover-letter-document'
import { createCoverLetterCompiler, hashCoverLetterDocument } from '../src/main/cover-letter-compiler'
import { inspectCoverLetterPdf } from '../src/main/cover-letter-pdf'
import { renderCoverLetterDocx } from '../src/main/cover-letter-docx'

const uid = (n: string) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`
const baseRevision = {
  id: uid('1'), jobId: uid('2'), parentRunId: uid('3'), operationId: uid('4'), cvRevisionId: uid('5'), revision: 1, createdAt: '2026-10-28T00:00:00.000Z',
  bindings: { postingUpdatedAt: '2026-10-27T00:00:00.000Z', scopeHash: 'a'.repeat(64), modelHash: 'b'.repeat(64), sources: [{ ordinal: 1, evidenceId: uid('6'), revision: 1, category: 'experience', heading: 'Engineer', passage: 'Built systems.' }] },
  date: 'October 28, 2026', subject: 'Senior Engineer', paragraphs: [{ id: uid('7'), text: 'Built reliable tools for Montréal teams with Zoë.' , citations: [{ ordinal: 1 }] }], findings: [], acknowledgments: {}, approved: false,
}
const contact = { fullName: 'Zoë Candidate', email: 'zoe@example.test', phone: '+1 555 123 4567', location: 'Montréal' }
let root: string
let toolchainRoot: string
const templateRoot = resolve('resources/cover-letter-template/application')
let compiler: ReturnType<typeof createCoverLetterCompiler>
let identity: Awaited<ReturnType<ReturnType<typeof createCoverLetterCompiler>['getTemplateIdentity']>>
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'letter-artifacts-'))
  toolchainRoot = resolve('E:/cv-tailor-main/.tools/latex')
  compiler = createCoverLetterCompiler({ toolchainRoot, templateRoot, tempRoot: join(root, 'temp') })
  identity = await compiler.getTemplateIdentity()
}, 30_000)
afterAll(async () => { await rm(root, { recursive: true, force: true }) })
const canonical = (overrides: Record<string, unknown> = {}) => projectCoverLetter({ ...baseRevision, ...overrides }, contact, identity)

test('recipient, date, sender header and subject each change canonical document identity', () => {
  const letter = canonical()
  const base = hashCoverLetterDocument(letter)
  expect(hashCoverLetterDocument({ ...letter, recipient: 'Ada Lovelace', greeting: 'Dear Ada Lovelace,' })).not.toBe(base)
  expect(hashCoverLetterDocument({ ...letter, date: 'October 29, 2026' })).not.toBe(base)
  expect(hashCoverLetterDocument({ ...letter, name: 'Ari Example', signature: 'Ari Example' })).not.toBe(base)
  expect(hashCoverLetterDocument({ ...letter, contact: { ...letter.contact, email: 'ari@example.test' } })).not.toBe(base)
  expect(hashCoverLetterDocument({ ...letter, subject: 'Staff Engineer' })).not.toBe(base)
})

test('wrong canonical template identity is refused before compilation', async () => {
  await expect(compiler.compile({ ...canonical(), template: { ...identity, manifestSha256: 'd'.repeat(64) } })).rejects.toThrow(/different template identity/i)
})

test('actual Lato PDF is one selectable US Letter page and DOCX uses same canonical wording', async () => {
  const letter = canonical()
  const [compiled, docxBytes] = await Promise.all([compiler.compile(letter), renderCoverLetterDocx(letter)])
  const inspected = await inspectCoverLetterPdf(compiled.pdf)
  expect(inspected.actualPages).toBe(1)
  expect(inspected.pageWidth).toBeCloseTo(612, 0)
  expect(inspected.pageHeight).toBeCloseTo(792, 0)
  expect(inspected.extractedText.join(' ')).toContain('Zoë Candidate')
  expect(inspected.extractedText.join(' ')).toContain('Montréal')
  expect(inspected.extractedText.join(' ')).toContain('Built reliable tools for Montréal teams with Zoë.')
  const zip = await JSZip.loadAsync(docxBytes)
  const xml = await zip.file('word/document.xml')!.async('string')
  const plain = xml.replace(/<[^>]+>/g, ' ')
  expect(plain).toContain('Senior Engineer')
  expect(plain).toContain('Dear Hiring Manager,')
  expect(plain).toContain('Sincerely,')
  expect(plain).toContain('Built reliable tools for Montréal teams with Zoë.')
  expect(await zip.file('word/styles.xml')!.async('string')).toContain('Lato')
  expect(xml).not.toContain('Built systems.')
})

test('same-document concurrent compilation returns independent byte buffers and cleans owned workspaces', async () => {
  const letter = canonical({ subject: 'Concurrent copy test' })
  const [a, b] = await Promise.all([compiler.compile(letter), compiler.compile(letter)])
  expect(a.documentHash).toBe(b.documentHash)
  expect(a.pdf).toEqual(b.pdf)
  a.pdf.fill(0)
  expect(b.pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect((await compiler.compile(letter)).pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(await (await import('node:fs/promises')).readdir(join(root, 'temp'))).toEqual([])
})

test('actual compiler refuses unsupported Arabic and multipage body output', async () => {
  await expect(compiler.compile({ ...canonical(), paragraphs: ['مرحبا بالعالم'] })).rejects.toThrow(/unsupported|characters/i)
  await expect(compiler.compile({ ...canonical(), paragraphs: ['Reliable work 🚀'] })).rejects.toThrow(/unsupported|characters/i)
  const longRecipient = canonical({ recipient: 'W'.repeat(200) })
  await expect(compiler.compile(longRecipient)).rejects.toThrow(/overflow|one-page|prepared|PDF/i)
  const longBody = Array.from({ length: 8 }, (_, i) => ({ ...baseRevision.paragraphs[0], id: uid((i + 1).toString(16)), text: `Paragraph ${i + 1}. ${'Detailed application content '.repeat(60)}` }))
  await expect(compiler.compile(canonical({ paragraphs: longBody }))).rejects.toThrow(/one-page|exactly one|prepared|PDF/i)
})

test('asset verification runs before a warm-cache return and rejects changed template and font bytes', async () => {
  const copy = join(root, 'corrupt-copy'), copiedToolchain = join(copy, 'toolchain'), copiedApp = join(copy, 'application')
  await mkdir(copy, { recursive: true })
  await cp(toolchainRoot, copiedToolchain, { recursive: true })
  await cp(templateRoot, copiedApp, { recursive: true })
  const local = createCoverLetterCompiler({ toolchainRoot: copiedToolchain, templateRoot: copiedApp, tempRoot: join(root, 'corrupt-temp') })
  const id = await local.getTemplateIdentity()
  const letter = projectCoverLetter(baseRevision, contact, id)
  const warmed = await local.compile(letter)
  expect(warmed.pdf.subarray(0, 5).toString()).toBe('%PDF-')
  const fontPath = join(copiedToolchain, 'texmf-dist/fonts/type1/typoland/lato/Lato-Regular.pfb')
  const originalFont = await readFile(fontPath)
  await writeFile(fontPath, Buffer.concat([originalFont, Buffer.from('changed')]))
  const cold = createCoverLetterCompiler({ toolchainRoot: copiedToolchain, templateRoot: copiedApp, tempRoot: join(root, 'cold-temp') })
  await expect(cold.compile(letter)).rejects.toThrow(/missing or damaged/i)
  await expect(local.compile(letter)).rejects.toThrow(/missing or damaged/i)
  await writeFile(fontPath, originalFont)
  const engine = join(copiedToolchain, 'bin/windows/pdftex.dll')
  const originalEngine = await readFile(engine)
  await writeFile(engine, Buffer.concat([originalEngine, Buffer.from('changed')]))
  await expect(cold.compile(letter)).rejects.toThrow(/missing or damaged/i)
  await expect(local.compile(letter)).rejects.toThrow(/missing or damaged/i)
  await writeFile(engine, originalEngine)
  await rm(engine)
  await expect(cold.compile(letter)).rejects.toThrow(/missing or damaged/i)
  await expect(local.compile(letter)).rejects.toThrow(/missing or damaged/i)
  await writeFile(engine, originalEngine)
  await rm(fontPath)
  await expect(cold.compile(letter)).rejects.toThrow(/missing or damaged/i)
  await expect(local.compile(letter)).rejects.toThrow(/missing or damaged/i)
  await writeFile(fontPath, originalFont)
  await writeFile(join(copiedApp, 'cover-letter.tex'), 'changed template')
  await expect(cold.compile(letter)).rejects.toThrow(/missing or damaged/i)
  await expect(local.compile(letter)).rejects.toThrow(/missing or damaged/i)
  await writeFile(join(copiedApp, 'cover-letter.tex'), await readFile(join(templateRoot, 'cover-letter.tex')))
  await rm(join(copiedApp, 'cover-letter.tex'))
  await expect(cold.compile(letter)).rejects.toThrow(/missing or damaged/i)
  await expect(local.compile(letter)).rejects.toThrow(/missing or damaged/i)
}, 120_000)

test('manifest traversal paths are rejected before compilation', async () => {
  const app = join(root, 'invalid-manifest-app')
  await cp(templateRoot, app, { recursive: true })
  const manifestPath = join(app, 'assets.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { assets: { root: string; path: string; sha256: string }[] }
  manifest.assets[0].path = '../cover-letter.tex'
  await writeFile(manifestPath, JSON.stringify(manifest))
  const invalid = createCoverLetterCompiler({ toolchainRoot, templateRoot: app, tempRoot: join(root, 'invalid-temp') })
  await expect(invalid.getTemplateIdentity()).rejects.toThrow(/missing or damaged/i)
})
