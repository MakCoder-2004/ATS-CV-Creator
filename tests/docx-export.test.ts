import { expect, test } from 'vitest'
import JSZip from 'jszip'
import { canonicalDocumentSchema } from '../src/shared/document'
import { extractCanonicalDocx, renderCanonicalDocx } from '../src/main/docx-export'

const canonical = canonicalDocumentSchema.parse({ version: 1, draftId: '11111111-1111-4111-8111-111111111111', jobId: '22222222-2222-4222-8222-222222222222', revision: 7, targetPages: 1, identity: { name: 'Zoë 李', headline: 'Senior Engineer', summary: 'Evidence-based summary.', contact: ['zoe@example.test'], links: [{ label: 'Portfolio', url: 'https://example.test/portfolio' }] }, sections: [
  { name: 'Education', entries: [{ id: 'edu-1', heading: 'B.Sc. Computer Science', organization: 'Université de Montréal', dates: '09/2018 – 06/2022', text: 'Graduated with honors.', bullets: ['Graduated with honors.'], links: [{ label: 'Thesis', url: 'https://example.test/thesis' }] }] },
  { name: 'Experience', entries: [{ id: 'exp-1', heading: 'Engineer', organization: 'Example Co.', dates: '2022 – Present', text: 'Built tools for résumé review with Unicode support.', bullets: ['Built tools for résumé review with Unicode support.'], links: [] }] },
  { name: 'Projects', entries: [{ id: 'project-1', heading: 'CV Tool', text: '', technologies: ['TypeScript', 'React'], links: [] }] },
  { name: 'Skills', entries: [{ id: 'skill-1', heading: 'TypeScript', text: '', links: [] }] }, { name: 'Certificates', entries: [{ id: 'cert-1', heading: 'Cloud certification', organization: 'Example Institute · 2024', text: '', links: [] }] }
], style: { fontFamily: 'Arial', bodyPt: 11, pageSize: 'A4', background: '#ffffff' } })

test('legacy version-1 DOCX documents accept and omit empty sections', async () => {
  const legacy = canonicalDocumentSchema.parse({ ...canonical, sections: [{ name: 'Education', entries: [] }] })
  const parsed = await extractCanonicalDocx(await renderCanonicalDocx(legacy))
  expect(parsed.text).not.toContain('Education')
})

test('writes an editable single-column DOCX with ordered text, Unicode and live hyperlinks', async () => {
  const zip = await JSZip.loadAsync(await renderCanonicalDocx(canonical))
  const xml = await zip.file('word/document.xml')!.async('string')
  const relationships = await zip.file('word/_rels/document.xml.rels')!.async('string')
  const text = [...xml.matchAll(/<w:t(?: [^>]*)?>(.*?)<\/w:t>/g)].map(match => match[1].replaceAll('&amp;', '&')).join(' ')
  expect(text).toContain('Zoë 李')
  expect(text).toContain('Evidence-based summary.')
  expect(text).toContain('Technologies: ')
  expect(text).toContain('React')
  expect(xml).toContain('<w:numPr>')
  expect(xml).not.toContain('<w:tbl')
  expect(text).toContain('Université de Montréal')
  expect(text).toContain('Built tools for résumé review with Unicode support.')
  expect(text.indexOf('Professional summary')).toBeLessThan(text.indexOf('Evidence-based summary.'))
  expect(text.indexOf('Evidence-based summary.')).toBeLessThan(text.indexOf('Education'))
  expect(text.indexOf('Education')).toBeLessThan(text.indexOf('Experience'))
  expect(text.indexOf('Experience')).toBeLessThan(text.indexOf('Projects'))
  expect(text.indexOf('Projects')).toBeLessThan(text.indexOf('Technical skills'))
  expect(text.indexOf('Technical skills')).toBeLessThan(text.indexOf('Certificates'))
  expect(text.indexOf('Technologies:')).toBeLessThan(text.indexOf('TypeScript, React'))
  expect(relationships).toContain('https://example.test/portfolio')
  expect(relationships).toContain('https://example.test/thesis')
  const parsed = await extractCanonicalDocx(await renderCanonicalDocx(canonical))
  expect(parsed.links).toEqual([{ label: 'Portfolio', url: 'https://example.test/portfolio' }, { label: 'Thesis', url: 'https://example.test/thesis' }])
  expect(xml).not.toMatch(/<w:tbl\b/)
  expect(xml).toContain('<w:hyperlink')
  expect(xml).toContain('<w:sectPr')
})
