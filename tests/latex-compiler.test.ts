import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CanonicalDocument } from '../src/shared/document'

const runner = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile: runner }))
import { createLatexCompiler } from '../src/main/latex-compiler'
let root: string
let config: { toolchainRoot: string; templateRoot: string; tempRoot: string }
const document: CanonicalDocument = { version: 1, draftId: '11111111-1111-4111-8111-111111111111', jobId: '22222222-2222-4222-8222-222222222222', revision: 1, targetPages: 1, identity: { name: 'Candidate', contact: [], links: [] }, sections: [], style: { fontFamily: 'Lato', bodyPt: 11, pageSize: 'Letter', background: '#ffffff' } }
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cv-latex-test-'))
  config = { toolchainRoot: join(root, 'toolchain'), templateRoot: join(root, 'template'), tempRoot: join(root, 'jobs') }
  await mkdir(join(config.toolchainRoot, 'bin', 'windows'), { recursive: true })
  await mkdir(config.templateRoot)
  await writeFile(join(config.toolchainRoot, 'bin', 'windows', 'pdflatex.exe'), 'compiler-fixture')
  await writeFile(join(config.toolchainRoot, 'cv-tailor-toolchain.json'), JSON.stringify({ schemaVersion: 1, engine: 'pdfTeX', version: 'fixture', executableSha256: createHash('sha256').update('compiler-fixture').digest('hex') }))
  for (const name of ['resume.tex', 'custom-commands.tex']) await writeFile(join(config.templateRoot, name), await readFile(join('resources', 'cv-template', name)))
  runner.mockReset().mockImplementation((_exe, _args, options, callback) => {
    Promise.all([writeFile(join(options.cwd, 'resume.pdf'), '%PDF-1.7\nfixture'), writeFile(join(options.cwd, 'resume.log'), 'Clean compilation')]).then(() => callback(null, '', '')).catch(callback)
    return { kill: vi.fn() }
  })
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
test('offline compiler uses fixed binary, argument arrays, restricted environment, deadlines and cleanup', async () => {
  const compiler = createLatexCompiler(config)
  const result = await compiler.compile(document)
  expect(result.pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(result.documentHash).toMatch(/^[a-f0-9]{64}$/)
  expect(runner).toHaveBeenCalledTimes(2)
  const [executable, args, options] = runner.mock.calls[0]
  expect(executable).toBe(join(config.toolchainRoot, 'bin', 'windows', 'pdflatex.exe'))
  expect(args).toEqual(['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', 'resume.tex'])
  expect(options).toMatchObject({ timeout: 20_000, maxBuffer: 1024 * 1024, windowsHide: true, env: { openin_any: 'p', openout_any: 'p', shell_escape: 'f' } })
  expect(options).not.toHaveProperty('shell')
  expect(await readdir(config.tempRoot)).toEqual([])
})
test('measurement, preview and export reuse identical bytes without leaking mutable cache buffers', async () => {
  const compiler = createLatexCompiler(config)
  const [first, second] = await Promise.all([compiler.compile(document), compiler.compile(document)])
  expect(first.pdf).toEqual(second.pdf)
  expect(runner).toHaveBeenCalledTimes(2)
  first.pdf.fill(0)
  expect((await compiler.compile(document)).pdf.subarray(0, 5).toString()).toBe('%PDF-')
  await compiler.compile({ ...document, revision: 2 })
  expect(runner).toHaveBeenCalledTimes(4)
})
test('missing/damaged bundled compiler fails closed without using PATH or a global TeX install', async () => {
  await writeFile(join(config.toolchainRoot, 'bin', 'windows', 'pdflatex.exe'), 'modified')
  await expect(createLatexCompiler(config).compile(document)).rejects.toThrow(/missing or damaged/)
  expect(runner).not.toHaveBeenCalled()
})
test('compiler errors never expose source wording or temp paths and always remove sources', async () => {
  runner.mockImplementation((_exe, _args, _options, callback) => { callback(new Error(`SECRET SOURCE ${root}`)); return {} })
  await expect(createLatexCompiler(config).compile(document)).rejects.toThrow('The CV could not be compiled locally.')
  expect(await readdir(config.tempRoot)).toEqual([])
})
test('unsupported glyphs and margin overflow cannot silently produce broken PDFs', async () => {
  for (const log of ['Missing character: There is no character', 'Overfull \\hbox (12.6pt too wide)']) {
    runner.mockImplementation((_exe, _args, options, callback) => {
      Promise.all([writeFile(join(options.cwd, 'resume.pdf'), '%PDF-1.7\nfixture'), writeFile(join(options.cwd, 'resume.log'), log)]).then(() => callback(null, '', '')).catch(callback)
      return {}
    })
    await expect(createLatexCompiler(config).compile(document)).rejects.toThrow(/font|margins/)
    expect(await readdir(config.tempRoot)).toEqual([])
  }
})
