import { afterAll, beforeAll, expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import JSZip from 'jszip'
import { projectCoverLetter } from '../src/shared/cover-letter-document'
import { createCoverLetterCompiler, hashCoverLetterDocument } from '../src/main/cover-letter-compiler'
import { assertCoverLetterPdfContent, inspectCoverLetterPdf } from '../src/main/cover-letter-pdf'
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
  toolchainRoot = resolve(process.env.CV_TAILOR_LATEX_ROOT ?? '.tools/latex')
  compiler = createCoverLetterCompiler({ toolchainRoot, templateRoot, tempRoot: join(root, 'temp') })
  identity = await compiler.getTemplateIdentity()
}, 30_000)
afterAll(async () => { await rm(root, { recursive: true, force: true }) }, 60_000)
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
}, 60_000)

test('ordinary English apostrophes and typographic punctuation survive actual letter compilation', async () => {
  const straight = canonical({ paragraphs: [{ ...baseRevision.paragraphs[0], text: "It's dependable work." }] })
  const straightPdf = await compiler.compile(straight)
  const straightText = await inspectCoverLetterPdf(straightPdf.pdf)
  expect(straightText.extractedText.join(' ')).toContain('It’s dependable work.')
  const typographic = canonical({ paragraphs: [{ ...baseRevision.paragraphs[0], text: '“Reliable” work – colleagues’ tools… — careful delivery.' }] })
  const compiled = await compiler.compile(typographic)
  const inspected = await inspectCoverLetterPdf(compiled.pdf)
  expect(inspected.extractedText.join(' ')).toContain('“Reliable” work – colleagues’ tools')
  expect(() => assertCoverLetterPdfContent(typographic, { ...inspected, extractedText: inspected.extractedText.map(text => text.replace('careful', 'careless')) })).toThrow(/text|reading order/)
}, 60_000)

test('PDF comparison checks the whole canonical letter, including word boundaries and extra text', async () => {
  const letter = canonical({ paragraphs: [{ ...baseRevision.paragraphs[0], text: 'I can' }] })
  const compiled = await compiler.compile(letter)
  const inspected = await inspectCoverLetterPdf(compiled.pdf)
  expect(inspected.extractedText.some(text => text.includes('I can'))).toBe(true)
  for (const replacement of ['I can’t', 'I can not', 'I can 9', 'I can do more']) {
    expect(() => assertCoverLetterPdfContent(letter, { ...inspected, extractedText: inspected.extractedText.map(text => text.replace('I can', replacement)) })).toThrow(/text|reading order/)
  }
  expect(() => assertCoverLetterPdfContent(letter, { ...inspected, extractedText: ['Unreviewed additional sentence.', ...inspected.extractedText] })).toThrow(/text|reading order/)
}, 60_000)

test('same-document concurrent compilation returns independent bytes and metadata', async () => {
  const letter = canonical({ subject: 'Concurrent copy test' })
  const [a, b] = await Promise.all([compiler.compile(letter), compiler.compile(letter)])
  expect(a.documentHash).toBe(b.documentHash)
  expect(a.pdf).toEqual(b.pdf)
  a.pdf.fill(0)
  a.templateIdentity.manifestSha256 = '0'.repeat(64)
  expect(b.pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(b.templateIdentity).toEqual(identity)
  const warm = await compiler.compile(letter)
  expect(warm.pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(warm.templateIdentity).toEqual(identity)
  warm.templateIdentity.revision = 'poisoned'
  const nextWarm = await compiler.compile(letter)
  expect(nextWarm.templateIdentity).toEqual(identity)
  expect(await (await import('node:fs/promises')).readdir(join(root, 'temp'))).toEqual([])
}, 60_000)

test('ambient TeX font and format lookup overrides cannot replace pinned fonts', async () => {
  const letter = canonical({ subject: 'Ambient lookup isolation' })
  const overrideFonts = join(root, 'ambient-font-override')
  await mkdir(overrideFonts, { recursive: true })
  await cp(join(toolchainRoot, 'texmf-dist/fonts/type1/typoland/lato/Lato-Bold.pfb'), join(overrideFonts, 'Lato-Regular.pfb'))
  const keys = ['T1FONTS', 'TFMFONTS', 'VFFONTS', 'ENCFONTS', 'TEXINPUTS', 'TEXFORMATS']
  const previous = new Map(keys.map(key => [key, process.env[key]]))
  const clean = await createCoverLetterCompiler({ toolchainRoot, templateRoot, tempRoot: join(root, 'clean-font-temp') }).compile(letter)
  try {
    process.env.T1FONTS = `${overrideFonts};`
    process.env.TFMFONTS = `${overrideFonts};`
    process.env.VFFONTS = `${overrideFonts};`
    process.env.ENCFONTS = `${overrideFonts};`
    process.env.TEXINPUTS = `${overrideFonts};`
    process.env.TEXFORMATS = overrideFonts
    const isolated = await createCoverLetterCompiler({ toolchainRoot, templateRoot, tempRoot: join(root, 'override-font-temp') }).compile(letter)
    const fingerprints = async (pdfBytes: Buffer) => {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const task = getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: false, fontExtraProperties: true })
      try {
        const pdf = await task.promise
        const page = await pdf.getPage(1)
        await page.getOperatorList()
        const content = await page.getTextContent()
        return [...new Set(content.items.filter((item): item is typeof item & { fontName: string } => 'fontName' in item && typeof item.fontName === 'string').map(item => item.fontName))].map(name => page.commonObjs.get(name)).map((font: { name?: string; data?: Uint8Array }) => ({ name: font.name, hash: font.data ? createHash('sha256').update(font.data).digest('hex') : undefined })).sort((a, b) => String(a.name).localeCompare(String(b.name)))
      } finally { await task.destroy() }
    }
    const cleanFonts = await fingerprints(clean.pdf)
    const isolatedFonts = await fingerprints(isolated.pdf)
    expect(isolatedFonts).toEqual(cleanFonts)
    expect(isolatedFonts.map(font => font.name?.replace(/^[A-Z]{6}\+/, '')).sort()).toEqual(['Lato-Bold', 'Lato-Regular'])
  } finally {
    for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value
  }
}, 60_000)

test('actual compiler refuses unsupported Arabic and multipage body output', async () => {
  await expect(compiler.compile({ ...canonical(), paragraphs: ['مرحبا بالعالم'] })).rejects.toThrow(/unsupported|characters/i)
  await expect(compiler.compile({ ...canonical(), paragraphs: ['Reliable work 🚀'] })).rejects.toThrow(/unsupported|characters/i)
  const longRecipient = canonical({ recipient: 'W'.repeat(200) })
  await expect(compiler.compile(longRecipient)).rejects.toThrow(/overflow|one-page|prepared|PDF/i)
  const longBody = Array.from({ length: 8 }, (_, i) => ({ ...baseRevision.paragraphs[0], id: uid((i + 1).toString(16)), text: `Paragraph ${i + 1}. ${'Detailed application content '.repeat(60)}` }))
  await expect(compiler.compile(canonical({ paragraphs: longBody }))).rejects.toThrow(/one-page|exactly one|prepared|PDF/i)
}, 60_000)

test('asset verification runs before a warm-cache return and rejects changed template and font bytes', async () => {
  const copy = join(root, 'corrupt copy with spaces'), copiedToolchain = join(copy, 'toolchain'), copiedApp = join(copy, 'application')
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

test('manifest tampering with a traversal path is refused by the pinned-manifest digest gate', async () => {
  const app = join(root, 'invalid-manifest-app')
  await cp(templateRoot, app, { recursive: true })
  const manifestPath = join(app, 'assets.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { assets: { root: string; path: string; sha256: string }[] }
  manifest.assets[0].path = '../cover-letter.tex'
  await writeFile(manifestPath, JSON.stringify(manifest))
  const invalid = createCoverLetterCompiler({ toolchainRoot, templateRoot: app, tempRoot: join(root, 'invalid-temp') })
  await expect(invalid.getTemplateIdentity()).rejects.toThrow(/missing or damaged/i)
})
