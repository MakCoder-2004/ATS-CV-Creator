import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { cp, lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { canonicalCoverLetterSchema, renderCoverLetterTex, type CanonicalCoverLetter, type CoverLetterTemplateIdentity } from '../shared/cover-letter-document'
import { assertCoverLetterPdfContent, inspectCoverLetterPdf } from './cover-letter-pdf'

const execute = promisify(execFile)
const MAX_PDF_BYTES = 20 * 1024 * 1024
const MAX_SOURCE_BYTES = 256 * 1024
const PINNED_ASSET_MANIFEST_SHA256 = '81762948da537facb015aebeb3716c2a6f60c4c9907654793dadbc62712a63c9'
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export const hashCoverLetterDocument = (input: unknown) => digest(Buffer.from(JSON.stringify(canonicalCoverLetterSchema.parse(input))))
const safeFailure = 'The cover letter could not be prepared locally. Check its wording and try again.'
type Asset = { root: 'application' | 'toolchain'; path: string; sha256: string }

function validRelativePath(value: string): boolean {
  return value.length > 0 && !value.includes('\\') && !value.includes('\0') && !isAbsolute(value) && value.split('/').every(part => part.length > 0 && part !== '.' && part !== '..')
}

export function createCoverLetterCompiler(config: { toolchainRoot: string; templateRoot: string; tempRoot: string }) {
  const toolchainRoot = resolve(config.toolchainRoot), templateRoot = resolve(config.templateRoot), tempRoot = resolve(config.tempRoot)
  type CompileResult = { documentHash: string; pdf: Buffer; templateIdentity: CoverLetterTemplateIdentity }
  const copyResult = (result: CompileResult): CompileResult => ({ ...result, pdf: Buffer.from(result.pdf), templateIdentity: { ...result.templateIdentity } })
  let cache: CompileResult | undefined
  let queue: Promise<unknown> = Promise.resolve()
  const inFlight = new Map<string, Promise<CompileResult>>()

  async function verifyAssets(): Promise<{ identity: CoverLetterTemplateIdentity; template: Buffer }> {
    try {
      const manifestBytes = await readFile(join(templateRoot, 'assets.json'))
      if (digest(manifestBytes) !== PINNED_ASSET_MANIFEST_SHA256) throw new Error('Asset manifest hash mismatch')
      const manifest = JSON.parse(manifestBytes.toString('utf8')) as { schemaVersion?: number; entry?: string; contentFilename?: string; systemDependencies?: unknown; assets?: Asset[] }
      if (Object.keys(manifest).sort().join(',') !== 'assets,contentFilename,entry,schemaVersion,systemDependencies' || manifest.schemaVersion !== 1 || manifest.entry !== 'cover-letter.tex' || manifest.contentFilename !== 'content.tex' || !Array.isArray(manifest.assets) || manifest.assets.length !== 39 || !Array.isArray(manifest.systemDependencies)) throw new Error('Invalid asset manifest')
      const seen = new Set<string>()
      for (const item of manifest.assets) {
        if (!item || Object.keys(item).sort().join(',') !== 'path,root,sha256' || !['application', 'toolchain'].includes(item.root) || !validRelativePath(item.path) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid asset path or digest')
        const key = `${item.root}/${item.path}`
        if (seen.has(key)) throw new Error('Duplicate asset path')
        seen.add(key)
        const root = item.root === 'application' ? templateRoot : toolchainRoot
        const target = resolve(root, ...item.path.split('/'))
        const rel = relative(root, target)
        if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Asset escaped its root')
        const metadata = await lstat(target)
        if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Asset is not a regular file')
        const bytes = await readFile(target)
        if (digest(bytes) !== item.sha256) throw new Error('Asset hash mismatch')
      }
      if (!seen.has('application/cover-letter.tex') || !seen.has('toolchain/bin/windows/pdflatex.exe') || !seen.has('toolchain/bin/windows/pdftex.dll') || !seen.has('toolchain/bin/windows/msvcr100.dll')) throw new Error('Required compiler assets are missing')
      const template = await readFile(join(templateRoot, manifest.entry))
      const source = template.toString('utf8')
      const macros = ['LetterName', 'LetterContact', 'LetterDate', 'LetterSubject', 'LetterGreeting', 'LetterBody', 'LetterSignature']
      if (!source.includes('\\input{content.tex}') || macros.some(macro => !source.includes(`\\${macro}`)) || source.includes('\\usepackage{hyperref}')) throw new Error('Unexpected template contract')
      return { identity: { revision: 'application-letter-v1', manifestSha256: digest(manifestBytes) }, template }
    } catch {
      throw new Error('The cover-letter template or bundled compiler assets are missing or damaged.')
    }
  }

  async function compile(input: unknown): Promise<{ documentHash: string; pdf: Buffer; templateIdentity: CoverLetterTemplateIdentity }> {
    const letter = canonicalCoverLetterSchema.parse(input)
    const verified = await verifyAssets()
    if (JSON.stringify(letter.template) !== JSON.stringify(verified.identity)) throw new Error('The canonical letter uses a different template identity.')
    const canonicalBytes = Buffer.from(JSON.stringify(letter))
    if (canonicalBytes.byteLength > MAX_SOURCE_BYTES) throw new Error('The cover letter is too large to prepare safely.')
    const documentHash = hashCoverLetterDocument(letter)
    if (cache?.documentHash === documentHash) return copyResult(cache)
    const existing = inFlight.get(documentHash)
    if (existing) return existing.then(copyResult)
    if (inFlight.size >= 4) throw new Error('PDF preparation is busy. Wait for the current letter to finish, then try again.')

    const task = queue.catch(() => {}).then(async () => {
      const dirRoot = resolve(tempRoot)
      await mkdir(dirRoot, { recursive: true })
      const directory = await mkdtemp(join(dirRoot, 'cover-letter-'))
      try {
        await mkdir(join(directory, 'home', 'web2c', 'pdftex'), { recursive: true })
        await cp(join(toolchainRoot, 'texmf-var', 'web2c', 'pdftex', 'pdflatex.fmt'), join(directory, 'home', 'web2c', 'pdftex', 'pdflatex.fmt'))
        await writeFile(join(directory, 'cover-letter.tex'), verified.template)
        await writeFile(join(directory, 'content.tex'), renderCoverLetterTex(letter))
        const home = join(directory, 'home')
        const texmfDist = join(toolchainRoot, 'texmf-dist')
        const texmfWeb2c = join(texmfDist, 'web2c')
        const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
        const environment: NodeJS.ProcessEnv = {
          SystemRoot: systemRoot,
          WINDIR: systemRoot,
          PATH: `${join(toolchainRoot, 'bin', 'windows')};${join(systemRoot, 'System32')}`,
          HOME: home,
          USERPROFILE: home,
          TMP: directory,
          TEMP: directory,
          TEXMFCNF: `${toolchainRoot};${texmfWeb2c}`,
          TEXMFROOT: toolchainRoot,
          TEXMFDIST: texmfDist,
          TEXMFMAIN: texmfDist,
          TEXMFLOCAL: join(directory, 'texmf-local'),
          TEXMFSYSVAR: join(toolchainRoot, 'texmf-var'),
          TEXMFSYSCONFIG: join(toolchainRoot, 'texmf-config'),
          TEXMFHOME: home,
          TEXMFCONFIG: home,
          TEXMFVAR: home,
          TEXMFOUTPUT: directory,
          TEXMFCACHE: home,
          TEXMFDBS: `${join(toolchainRoot, 'texmf-var')}//;${texmfDist}//`,
          TEXINPUTS: `.;${join(texmfDist, 'tex')}//;`,
          TEXFORMATS: `${join(home, 'web2c', 'pdftex')};${texmfWeb2c}`,
          TEXPOOL: texmfWeb2c,
          T1FONTS: `${join(texmfDist, 'fonts', 'type1')}//`,
          TFMFONTS: `${join(texmfDist, 'fonts', 'tfm')}//`,
          VFFONTS: `${join(texmfDist, 'fonts', 'vf')}//`,
          ENCFONTS: `${join(texmfDist, 'fonts', 'enc')}//`,
          TEXFONTMAPS: `${join(toolchainRoot, 'texmf-var', 'fonts', 'map', 'pdftex', 'updmap')}//;${join(texmfDist, 'fonts', 'map', 'pdftex')}//;${join(texmfDist, 'fonts', 'map')}//`,
          openin_any: 'p', openout_any: 'p', shell_escape: 'f', SOURCE_DATE_EPOCH: '946684800', FORCE_SOURCE_DATE: '1',
        }
        const executable = join(toolchainRoot, 'bin', 'windows', 'pdflatex.exe')
        try {
          for (let pass = 0; pass < 2; pass++) await execute(executable, ['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', 'cover-letter.tex'], { cwd: directory, env: environment, windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024, encoding: 'utf8' })
        } catch { throw new Error(safeFailure) }
        const log = await readFile(join(directory, 'cover-letter.log'), 'utf8')
        if (/Missing character:/i.test(log)) throw new Error('The letter contains a character unsupported by the bundled font.')
        if (/Overfull \\[hv]box \((?:[1-9]\d{1,}|[5-9])(?:\.\d+)?pt too (?:wide|high)\)/.test(log)) throw new Error('The letter exceeds the supplied one-page layout. Shorten the recipient or body text.')
        const pdfPath = join(directory, 'cover-letter.pdf'), size = (await stat(pdfPath)).size
        if (!size || size > MAX_PDF_BYTES) throw new Error('The compiled letter PDF has an invalid size.')
        const pdf = await readFile(pdfPath)
        if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('The compiler did not produce valid PDF bytes.')
        let inspected
        try { inspected = await inspectCoverLetterPdf(pdf); assertCoverLetterPdfContent(letter, inspected) }
        catch (error) { throw error instanceof Error && /exactly one|Letter page|selectable text|reading order/.test(error.message) ? error : new Error(safeFailure) }
        const result = { documentHash, pdf, templateIdentity: { ...verified.identity } }
        cache = copyResult(result)
        return copyResult(result)
      } finally { await rm(directory, { recursive: true, force: true }) }
    })
    queue = task
    inFlight.set(documentHash, task)
    try { return await task } finally { inFlight.delete(documentHash) }
  }
  return { getTemplateIdentity: async () => (await verifyAssets()).identity, compile }
}
