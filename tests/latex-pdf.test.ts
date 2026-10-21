import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { expect, test } from 'vitest'
import { createLatexCompiler } from '../src/main/latex-compiler'
import { assertCompiledContent, inspectCompiledPdf } from '../src/main/pdf-document'
import type { CanonicalDocument } from '../src/shared/document'

const toolchainRoot = resolve('.tools/latex')
const available = process.platform === 'win32' && existsSync(join(toolchainRoot, 'cv-tailor-toolchain.json'))
const document: CanonicalDocument = { version: 1, draftId: '11111111-1111-4111-8111-111111111111', jobId: '22222222-2222-4222-8222-222222222222', revision: 1, targetPages: 1, identity: { name: 'Zoë Candidate', phone: '+1 555-0100', email: 'zoe@example.test', contact: ['+1 555-0100', 'zoe@example.test'], links: [{ label: 'Portfolio', url: 'https://example.test/~portfolio?q=1&view=2#work' }] }, sections: [
  { name: 'Education', entries: [{ id: 'education-0', organization: 'Example University', heading: 'BSc Computer Science', dates: '2020 – 2024', text: 'Studied algorithms and databases.', links: [] }] },
  { name: 'Experience', entries: [{ id: 'experience-0', heading: 'Software Engineer', organization: 'Example & Co', dates: 'Jan 2025 – Present', text: 'Built C# APIs with 20% lower latency.\nMaintained safe $100 budget reports with values < 5 | > 1.', links: [] }] },
  { name: 'Projects', entries: [{ id: 'projects-0', heading: 'CV Tools', text: 'Built résumé tools using saved career facts.', technologies: ['TypeScript', 'React'], links: [{ label: 'Project source', url: 'https://github.com/example/cv_tools' }] }] },
  { name: 'Skills', entries: [{ id: 'skills-0', heading: 'C#', skillGroup: 'Languages', text: '', links: [] }, { id: 'skills-1', heading: 'React', skillGroup: 'Technologies', text: '', links: [] }] }
], style: { fontFamily: 'Lato', bodyPt: 11, pageSize: 'Letter', background: '#ffffff' } }

test.skipIf(!available)('real bundled pdfLaTeX compiles escaped content into selectable Letter PDF with live links', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'cv-pdf integration '))
  try {
    const compiler = createLatexCompiler({ toolchainRoot, templateRoot: resolve('resources/cv-template'), tempRoot })
    const compiled = await compiler.compile(document)
    const inspected = await inspectCompiledPdf(compiled.pdf)
    expect(inspected.actualPages).toBe(1)
    expect(() => assertCompiledContent(document, inspected)).not.toThrow()
    const text = inspected.extractedText.join(' ')
    expect(text).not.toMatch(/Professional summary|Certificates/)
    expect(text.match(/Software Engineer/g)).toHaveLength(1)
    expect(text).toContain('20%')
    expect(text).toContain('Zoë Candidate')
    expect(text).toContain('résumé')
    expect(await readdir(tempRoot)).toEqual([])
  } finally { await rm(tempRoot, { recursive: true, force: true }) }
}, 60_000)
