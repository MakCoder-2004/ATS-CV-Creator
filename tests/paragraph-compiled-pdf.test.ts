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
const document = (targetPages: 1 | 2, count: number): CanonicalDocument => ({ version: 1, draftId: '11111111-1111-4111-8111-111111111111', jobId: '22222222-2222-4222-8222-222222222222', revision: 1, targetPages, identity: { name: 'Synthetic Candidate', contact: ['candidate@example.test'], links: [] }, sections: [{ name: 'Education', entries: [{ id: 'education-0', heading: 'Computer Science', organization: 'Synthetic University', dates: '2020 – 2024', text: '', links: [] }] }, { name: 'Experience', entries: Array.from({ length: count }, (_, index) => index === 0 ? { ...record(index), descriptionFormat: undefined, reviewItems: [{ id: 'experience-legacy', text: 'Maintained legacy operations and documented existing workflows.', bullets: ['Maintained legacy operations and documented existing workflows.'] }, { id: 'experience-0', text, bullets: [text], descriptionFormat: 'paragraph' as const }] } : record(index)) }, { name: 'Projects', entries: [{ id: 'projects-0', heading: 'Monitor', text: 'Added evaluation runs for model reports.', bullets: ['Maintained existing evaluation tests.', 'Added evaluation runs for model reports.'], reviewItems: [{ id: 'projects-0-legacy', text: 'Maintained existing evaluation tests.', bullets: ['Maintained existing evaluation tests.'] }, { id: 'projects-0-paragraph', text: 'Added evaluation runs for model reports.', bullets: ['Added evaluation runs for model reports.'], descriptionFormat: 'paragraph' }], technologies: ['TypeScript', 'PDF.js', 'Accessible reporting', 'Distributed systems', 'Observability', 'Performance analytics', 'Workflow automation', 'Data visualization'], links: [{ label: `github/${'x'.repeat(70)}`, url: 'https://github.com/example/very-long-project-repository-name' }] }, { id: 'projects-1', heading: 'Telemetry Dashboard', dates: '2023', text: 'Maintained service telemetry.', bullets: ['Maintained service telemetry.'], links: [{ label: 'github/dashboard', url: 'https://github.com/example/dashboard' }, { label: 'Docs', url: 'https://example.test/dashboard-docs' }] }] }], style: { fontFamily: 'Lato', bodyPt: 11, pageSize: 'Letter', background: '#ffffff' } })

test.skipIf(!available)('synthetic paragraph PDFs retain selectable wording within one- and two-page targets', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'paragraph-pdf-'))
  try {
    const compiler = createLatexCompiler({ toolchainRoot, templateRoot: resolve('resources/cv-template'), tempRoot })
    for (const [target, count] of [[1, 2], [2, 18]] as const) {
      const canonical = document(target, count)
      const compiled = await compiler.compile(canonical)
      const inspected = await inspectCompiledPdf(compiled.pdf)
      expect(inspected.actualPages, `${target}-page target`).toBe(target)
      expect(() => assertCompiledContent(canonical, inspected)).not.toThrow()
      const extracted = inspected.extractedText.join(' ')
      expect(extracted).toContain('Contributed to reliable services')
      expect(extracted).toContain('Added evaluation runs')
      expect(extracted.replace(/\s+/g, '')).toContain(`github/${'x'.repeat(70)}`)
      expect(extracted).toContain('Maintained existing evaluation tests')
      expect(extracted).toContain('Telemetry Dashboard')
      expect(extracted).toContain('Maintained legacy operations')
      expect(extracted.indexOf('Maintained legacy operations')).toBeLessThan(extracted.indexOf('Contributed to reliable services'))
      expect(extracted.indexOf('Maintained existing evaluation tests')).toBeLessThan(extracted.indexOf('Added evaluation runs'))
      expect(extracted).not.toMatch(/Professional summary|Certificates/)
      if (target === 1) {
        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
        const loading = getDocument({ data: new Uint8Array(compiled.pdf) })
        try {
          const pdf = await loading.promise
          const page = await pdf.getPage(1)
          const items = (await page.getTextContent()).items.filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number } => 'str' in item)
          const role = items.find(item => item.str.includes('Engineer 0'))!
          const prose = items.find(item => item.str.includes('Contributed to reliable'))!
          expect(role.transform[5] - prose.transform[5] - prose.height).toBeGreaterThanOrEqual(2)
          const projectRow = items.filter(item => /Monitor|TypeScript|PDF\.js|Accessible reporting|Distributed systems|Observability|Performance analytics|Workflow automation|Data visualization|github\/x+|^x{8,}/.test(item.str))
          const title = projectRow.find(item => item.str.includes('Monitor'))!
          const technologyLines = new Set(projectRow.filter(item => /TypeScript|PDF\.js|Accessible reporting|Distributed systems|Observability|Performance analytics|Workflow automation|Data visualization/.test(item.str)).map(item => item.transform[5].toFixed(1)))
          expect(technologyLines.size).toBeGreaterThan(1)
          const longLink = projectRow.filter(item => /github\/x+|^x{8,}/.test(item.str))
          const projectDescription = items.find(item => item.str.includes('Added evaluation runs'))!
          expect(longLink.length).toBeGreaterThan(0)
          expect(new Set(longLink.map(item => item.transform[5].toFixed(1))).size).toBeGreaterThan(1)
          expect(Math.max(...longLink.map(item => item.transform[5]))).toBeCloseTo(title.transform[5], 0)
          expect(Math.min(...longLink.map(item => item.transform[4]))).toBeGreaterThan(title.transform[4] + title.width)
          for (const left of projectRow.filter(item => /Monitor|TypeScript|PDF\.js|Accessible reporting|Distributed systems|Observability|Performance analytics|Workflow automation|Data visualization/.test(item.str))) for (const right of longLink) {
            if (Math.abs(left.transform[5] - right.transform[5]) < 0.5) expect(left.transform[4] + left.width).toBeLessThanOrEqual(right.transform[4])
          }
          expect(Math.min(...projectRow.map(item => item.transform[5])) - projectDescription.transform[5] - projectDescription.height).toBeGreaterThanOrEqual(2)
          const annotations = await page.getAnnotations()
          expect(annotations.some(annotation => annotation.url === 'https://github.com/example/very-long-project-repository-name')).toBe(true)
          expect(annotations.some(annotation => annotation.url === 'https://github.com/example/dashboard')).toBe(true)
          expect(annotations.some(annotation => annotation.url === 'https://example.test/dashboard-docs')).toBe(true)
          const shortLink = items.find(item => item.str.includes('github/dashboard'))!
          const adjacentTitle = items.find(item => item.str.includes('Telemetry Dashboard'))!
          const adjacentDate = items.find(item => item.str.includes('2023'))!
          expect(shortLink.transform[5]).toBeCloseTo(adjacentTitle.transform[5], 0)
          expect(adjacentDate.transform[5]).toBeCloseTo(adjacentTitle.transform[5], 0)
        } finally { await loading.destroy() }
      }
    }
  } finally { await rm(tempRoot, { recursive: true, force: true, maxRetries: 5 }) }
}, 60000)
