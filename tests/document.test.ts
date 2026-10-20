import { expect, test } from 'vitest'
import { canonicalDocumentSchema, createCanonicalDocument, renderDocumentHtml } from '../src/shared/document'

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

test('canonical education and experience follow authoritative reverse chronology with stable date ties', () => {
  const citation = { evidenceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 1 }
  const draft = {
    id: document.draftId, jobId: document.jobId, revision: 1, pageTarget: 1, status: 'unverified', approved: false,
    lockedFields: { fullName: 'Candidate', experience: [
      { evidenceId: citation.evidenceId, title: 'Older role', organization: 'A', startDate: '2018-01', endDate: '2019-01' },
      { evidenceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Newer role', organization: 'B', startDate: '2022-01' },
      { evidenceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: 'Tied role', organization: 'C', startDate: '2022-01' }
    ], education: [
      { evidenceId: citation.evidenceId, title: 'Older degree', institution: 'A University', startDate: '2015-01' },
      { evidenceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Newer degree', institution: 'B University', startDate: '2020-01' },
      { evidenceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: 'Tied degree', institution: 'C University', startDate: '2020-01' }
    ], projects: [], certificates: [] },
    content: { education: [citation, { evidenceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', revision: 1 }, { evidenceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', revision: 1 }].map((source, index) => ({ text: `Education ${index}`, citations: [source], rationale: 'Relevant' })), experience: [citation, { evidenceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', revision: 1 }, { evidenceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', revision: 1 }].map((source, index) => ({ text: `Experience ${index}`, citations: [source], rationale: 'Relevant' })), projects: [], skills: [], certificates: [] }
  } as never
  const result = createCanonicalDocument(draft, { contact: null, education: [], certificates: [], skills: [], summary: [], languages: [], extras: [] } as never, { experience: [], projects: [] } as never)
  expect(result.sections[0].entries.map(entry => entry.heading)).toEqual(['Newer degree', 'Tied degree', 'Older degree'])
  expect(result.sections[1].entries.map(entry => entry.heading)).toEqual(['Newer role', 'Tied role', 'Older role'])
})

test('canonical preview rejects any added or reordered output section', () => {
  const altered = { ...document, sections: [...document.sections].reverse() }
  expect(canonicalDocumentSchema.safeParse(altered).success).toBe(false)
})
