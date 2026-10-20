import { expect, test } from 'vitest'
import { canonicalDocumentSchema, renderDocumentHtml } from '../src/shared/document'

const document = canonicalDocumentSchema.parse({ version: 1, draftId: '11111111-1111-4111-8111-111111111111', jobId: '22222222-2222-4222-8222-222222222222', revision: 3, targetPages: 1, identity: { name: 'Zoë <Candidate>', headline: 'Engineer', contact: ['zoe@example.test'], links: [{ label: 'Portfolio', url: 'https://example.test/portfolio' }] }, sections: [{ name: 'Education', entries: [] }, { name: 'Experience', entries: [{ id: 'experience-0', heading: 'Engineer', organization: 'Example', dates: '2020 – Present', text: 'Built Unicode résumé tools.', links: [] }] }, { name: 'Projects', entries: [] }, { name: 'Skills', entries: [] }, { name: 'Certificates', entries: [] }], style: { fontFamily: 'Arial', bodyPt: 11, pageSize: 'A4', background: '#ffffff' } })

test('canonical preview uses the fixed five-section order and isolated escaped A4 Arial markup', () => {
  const html = renderDocumentHtml(document)
  expect(document.sections.map(section => section.name)).toEqual(['Education', 'Experience', 'Projects', 'Skills', 'Certificates'])
  expect(html).toContain('Zoë &lt;Candidate&gt;')
  expect(html).toContain('2020 – Present')
  expect(html).toContain('href="https://example.test/portfolio"')
  expect(html).toContain('font-family:Arial')
  expect(html).toContain('@page{size:A4')
  expect(html).toContain("default-src 'none'")
  expect(html).not.toContain('<script')
  expect(html).not.toContain('src="http')
})

test('canonical preview rejects any added or reordered output section', () => {
  const altered = { ...document, sections: [...document.sections].reverse() }
  expect(canonicalDocumentSchema.safeParse(altered).success).toBe(false)
})
