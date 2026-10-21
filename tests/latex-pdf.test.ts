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
  { name: 'Education', entries: [{ id: 'education-0', organization: 'Example University', heading: 'BSc Computer Science', dates: '2020 – 2024', grade: 'CGPA: 3.3', text: 'Studied algorithms and databases.', links: [] }] },
  { name: 'Experience', entries: [{ id: 'experience-0', heading: 'Software Engineer', organization: 'Example & Co', dates: 'Jan 2025 – Present', text: 'Built C# APIs with 20% lower latency.\nMaintained safe $100 budget reports with values < 5 | > 1.', links: [] }] },
  { name: 'Projects', entries: [{ id: 'projects-0', heading: 'Training And Predicting Real Time Captures on Web', text: 'Built résumé tools using saved career facts.', technologies: ['TensorFlow.js', 'MobileNet', 'JavaScript'], links: [{ label: 'Project source', url: 'https://github.com/example/cv_tools' }] }] },
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
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const loading = getDocument({ data: new Uint8Array(compiled.pdf) })
    try {
      const pdf = await loading.promise
      const page = await pdf.getPage(1)
      const items = (await page.getTextContent()).items.filter((item): item is typeof item & { str: string; transform: number[]; width: number } => 'str' in item)
      const grade = items.find(item => item.str.includes('CGPA'))!
      const dates = items.find(item => item.str.includes('2020'))!
      const degree = items.find(item => item.str.includes('BSc Computer Science'))!
      expect(grade.transform[5]).toBeCloseTo(degree.transform[5], 0)
      expect(grade.transform[5]).toBeLessThan(dates.transform[5])
      expect(grade.transform[4] + grade.width).toBeCloseTo(dates.transform[4] + dates.width, 0)
      const project = items.find(item => item.str.includes('Training And Predicting'))!
      const sourceLink = items.find(item => item.str.includes('Project source'))!
      const bullet = items.find(item => item.str.includes('Built résumé tools'))!
      expect(sourceLink.transform[5]).toBeCloseTo(project.transform[5], 0)
      expect(sourceLink.transform[5]).toBeGreaterThan(bullet.transform[5])
    } finally { await loading.destroy() }
    expect(await readdir(tempRoot)).toEqual([])
  } finally { await rm(tempRoot, { recursive: true, force: true }) }
}, 60_000)
