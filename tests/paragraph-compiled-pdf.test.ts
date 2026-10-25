import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from 'vitest'
import { createLatexCompiler } from '../src/main/latex-compiler'
import { assertCompiledContent, inspectCompiledPdf } from '../src/main/pdf-document'
import type { CanonicalDocument } from '../src/shared/document'

const toolchainRoot = process.env.CV_TAILOR_LATEX_TOOLCHAIN_ROOT ?? resolve('.tools/latex')
const available = process.platform === 'win32' && existsSync(join(toolchainRoot, 'cv-tailor-toolchain.json'))
const text = 'Contributed to reliable services and supported deployment workflows using saved, role-specific facts. Documented the integration work and helped maintain production workflows with the team.'
const record = (index: number) => ({ id: `experience-${index}`, heading: `Engineer ${index}`, organization: `Example Systems ${index}`, dates: '2022 – 2024', text, descriptionFormat: 'paragraph' as const, bullets: [text], links: [] })
const document = (targetPages: 1 | 2, count: number): CanonicalDocument => ({ version: 1, draftId: '11111111-1111-4111-8111-111111111111', jobId: '22222222-2222-4222-8222-222222222222', revision: 1, targetPages, identity: { name: 'Synthetic Candidate', contact: ['candidate@example.test'], links: [] }, sections: [{ name: 'Experience', entries: Array.from({ length: count }, (_, index) => record(index)) }, { name: 'Projects', entries: [{ id: 'projects-0', heading: 'Monitor', text: 'Built an evaluation dashboard for model runs.', descriptionFormat: 'paragraph', bullets: ['Built an evaluation dashboard for model runs.'], links: [] }] }], style: { fontFamily: 'Lato', bodyPt: 11, pageSize: 'Letter', background: '#ffffff' } })

test.skipIf(!available)('synthetic paragraph PDFs retain selectable wording within one- and two-page targets', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'paragraph-pdf-'))
  try {
    const compiler = createLatexCompiler({ toolchainRoot, templateRoot: resolve('resources/cv-template'), tempRoot })
    for (const [target, count] of [[1, 2], [2, 27]] as const) {
      const canonical = document(target, count)
      const compiled = await compiler.compile(canonical)
      const inspected = await inspectCompiledPdf(compiled.pdf)
      expect(inspected.actualPages, `${target}-page target`).toBe(target)
      expect(() => assertCompiledContent(canonical, inspected)).not.toThrow()
      const extracted = inspected.extractedText.join(' ')
      expect(extracted).toContain('Contributed to reliable services')
      expect(extracted).toContain('Built an evaluation dashboard')
      expect(extracted).not.toMatch(/Professional summary|Certificates/)
    }
  } finally { await rm(tempRoot, { recursive: true, force: true, maxRetries: 5 }) }
}, 60000)
