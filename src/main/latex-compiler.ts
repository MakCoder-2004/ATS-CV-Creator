import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { canonicalDocumentSchema, type CanonicalDocument } from '../shared/document'
import { renderLatexSections } from '../shared/latex'

const execute = promisify(execFile)
const MAX_PDF_BYTES = 20 * 1024 * 1024
export type CompiledDocument = { documentHash: string; pdf: Buffer }
export const hashDocument = (document: CanonicalDocument) => createHash('sha256').update(JSON.stringify(document)).digest('hex')

/** One bounded offline compiler seam shared by measurement, preview and export. No PATH fallback. */
export function createLatexCompiler(config: { toolchainRoot: string; templateRoot: string; tempRoot: string }) {
  let cache: CompiledDocument | undefined
  let queue: Promise<unknown> = Promise.resolve()
  const inFlight = new Map<string, Promise<CompiledDocument>>()
  async function compile(document: CanonicalDocument): Promise<CompiledDocument> {
    const parsed = canonicalDocumentSchema.parse(document)
    const documentHash = hashDocument(parsed)
    if (cache?.documentHash === documentHash) return { documentHash, pdf: Buffer.from(cache.pdf) }
    const existing = inFlight.get(documentHash)
    if (existing) return existing.then(result => ({ ...result, pdf: Buffer.from(result.pdf) }))
    if (inFlight.size >= 4) throw new Error('PDF preparation is busy. Wait for the current CV to finish, then try again.')
    const task = queue.catch(() => {}).then(async () => {
      const executable = join(config.toolchainRoot, 'bin', 'windows', 'pdflatex.exe')
      try {
        const manifest = JSON.parse(await readFile(join(config.toolchainRoot, 'cv-tailor-toolchain.json'), 'utf8'))
        if (manifest.schemaVersion !== 1 || manifest.engine !== 'pdfTeX' || typeof manifest.version !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.executableSha256)) throw new Error('Invalid compiler manifest')
        const digest = createHash('sha256').update(await readFile(executable)).digest('hex')
        if (digest !== manifest.executableSha256) throw new Error('Compiler integrity check failed')
      } catch {
        throw new Error('The bundled LaTeX compiler is missing or damaged. Reinstall CV Tailor; a separate LaTeX installation is not required.')
      }
      const template = await readFile(join(config.templateRoot, 'resume.tex'), 'utf8')
      const commands = await readFile(join(config.templateRoot, 'custom-commands.tex'), 'utf8')
      const sections = renderLatexSections(parsed)
      // OT1 composes accented letters from separate glyphs with incorrect extraction order.
      // Keep the supplied ASCII template byte-for-byte; select its existing Lato T1 glyphs
      // only when extended Latin text needs them. No layout/margin/size commands change.
      const extendedLatin = Object.values(sections).some(source => /[\u0080-\u024f]/u.test(source))
      const main = extendedLatin ? template.replace('\\usepackage[default]{lato}', '\\usepackage[T1]{fontenc}\n\\usepackage[default]{lato}') : template
      if (Buffer.byteLength(main + commands + Object.values(sections).join('')) > 1024 * 1024) throw new Error('This CV is too large to prepare safely. Shorten its wording before exporting.')
      await mkdir(config.tempRoot, { recursive: true })
      const directory = await mkdtemp(join(config.tempRoot, 'cv-pdf-'))
      try {
        await mkdir(join(directory, 'src'))
        await mkdir(join(directory, 'home'))
        await writeFile(join(directory, 'resume.tex'), main)
        await writeFile(join(directory, 'custom-commands.tex'), commands)
        for (const [name, source] of Object.entries(sections)) await writeFile(join(directory, 'src', name), source)
        const environment: NodeJS.ProcessEnv = {}
        for (const [key, value] of Object.entries(process.env)) if (!/^(?:TEX|MIKTEX|BIB|LUA|OSFONTDIR|FONTCONFIG|GS_|HOME$)/i.test(key)) environment[key] = value
        Object.assign(environment, {
          PATH: `${join(config.toolchainRoot, 'bin', 'windows')};${join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')}`,
          HOME: join(directory, 'home'), TEXMFHOME: join(directory, 'home'),
          TEXMFCONFIG: join(directory, 'home'), TEXMFVAR: join(directory, 'home'),
          TEXMFOUTPUT: directory, openin_any: 'p', openout_any: 'p', shell_escape: 'f',
          SOURCE_DATE_EPOCH: '946684800', FORCE_SOURCE_DATE: '1'
        })
        try {
          for (let pass = 0; pass < 2; pass++) await execute(executable, ['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', 'resume.tex'], { cwd: directory, env: environment, windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024, encoding: 'utf8' })
        } catch {
          // Never expose temp paths, source wording, or compiler logs (which contain personal data).
          throw new Error('The CV could not be compiled locally. Check for unsupported characters or overly long headings. No PDF was saved.')
        }
        const log = await readFile(join(directory, 'resume.log'), 'utf8')
        if (/Missing character:/i.test(log)) throw new Error('The template font cannot display a character in this CV. Replace unsupported symbols before exporting.')
        if (/Overfull \\[hv]box \((?:[1-9]\d{1,}|[5-9])(?:\.\d+)?pt too (?:wide|high)\)/.test(log)) throw new Error('Some CV content extends beyond the template margins. Shorten long headings, links or bullets before exporting.')
        const pdfPath = join(directory, 'resume.pdf')
        const size = (await stat(pdfPath)).size
        if (!size || size > MAX_PDF_BYTES) throw new Error('The compiled PDF has an invalid size. No file was saved.')
        const pdf = await readFile(pdfPath)
        if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('The compiler did not produce a valid PDF. No file was saved.')
        cache = { documentHash, pdf }
        return { documentHash, pdf: Buffer.from(pdf) }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
    queue = task
    inFlight.set(documentHash, task)
    try { return await task } finally { inFlight.delete(documentHash) }
  }
  return { compile }
}
