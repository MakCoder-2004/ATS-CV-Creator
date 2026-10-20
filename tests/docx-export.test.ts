import { expect, test } from 'vitest'
import JSZip from 'jszip'
import { canonicalDocumentSchema } from '../src/shared/document'
import { renderCanonicalDocx } from '../src/main/docx-export'

const canonical = canonicalDocumentSchema.parse({ version: 1, draftId: '11111111-1111-4111-8111-111111111111', jobId: '22222222-2222-4222-8222-222222222222', revision: 7, targetPages: 1, identity: { name: 'Zoë 李', headline: 'Senior Engineer', contact: ['zoe@example.test'], links: [{ label: 'Portfolio', url: 'https://example.test/portfolio' }] }, sections: [
  { name: 'Education', entries: [{ id: 'edu-1', heading: 'B.Sc. Computer Science', organization: 'Université de Montréal', dates: '09/2018 – 06/2022', text: 'Graduated with honors.', links: [{ label: 'Thesis', url: 'https://example.test/thesis' }] }] },
  { name: 'Experience', entries: [{ id: 'exp-1', heading: 'Engineer', organization: 'Example Co.', dates: '2022 – Present', text: 'Built tools for résumé review with Unicode support.', links: [] }] },
  { name: 'Projects', entries: [] }, { name: 'Skills', entries: [{ id: 'skill-1', heading: 'TypeScript', text: '', links: [] }] }, { name: 'Certificates', entries: [{ id: 'cert-1', heading: 'Cloud certification', organization: 'Example Institute · 2024', text: '', links: [] }] }
], style: { fontFamily: 'Arial', bodyPt: 11, pageSize: 'A4', background: '#ffffff' } })

test('writes an editable single-column DOCX with ordered text, Unicode and live hyperlinks', async () => {
  const zip = await JSZip.loadAsync(await renderCanonicalDocx(canonical))
  const xml = await zip.file('word/document.xml')!.async('string')
  const relationships = await zip.file('word/_rels/document.xml.rels')!.async('string')
  const text = [...xml.matchAll(/<w:t(?: [^>]*)?>(.*?)<\/w:t>/g)].map(match => match[1].replaceAll('&amp;', '&')).join(' ')
  expect(text).toContain('Zoë 李')
  expect(text).toContain('Université de Montréal')
  expect(text).toContain('Built tools for résumé review with Unicode support.')
  expect(text.indexOf('EDUCATION')).toBeLessThan(text.indexOf('EXPERIENCE'))
  expect(text.indexOf('EXPERIENCE')).toBeLessThan(text.indexOf('PROJECTS'))
  expect(text.indexOf('PROJECTS')).toBeLessThan(text.indexOf('SKILLS'))
  expect(text.indexOf('SKILLS')).toBeLessThan(text.indexOf('CERTIFICATES'))
  expect(relationships).toContain('https://example.test/portfolio')
  expect(relationships).toContain('https://example.test/thesis')
  expect(xml).not.toMatch(/<w:tbl\b/)
  expect(xml).toContain('<w:hyperlink')
  expect(xml).toContain('<w:sectPr')
})
