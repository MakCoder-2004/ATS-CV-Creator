import { expect, test } from 'vitest'
import { draftRevisionSchema } from '../src/shared/draft'
import { profileSnapshotSchema } from '../src/shared/profile'
import { canonicalDocumentSchema, canonicalDocumentTextParts, createCanonicalDocument, renderDocumentHtml, splitDocumentBullets, type CanonicalDocument } from '../src/shared/document'

const document = canonicalDocumentSchema.parse({ version: 1, draftId: '11111111-1111-4111-8111-111111111111', jobId: '22222222-2222-4222-8222-222222222222', revision: 3, targetPages: 1, identity: { name: 'Zoë <Candidate>', headline: 'Engineer', contact: ['zoe@example.test'], links: [{ label: 'Portfolio', url: 'https://example.test/portfolio' }] }, sections: [{ name: 'Experience', entries: [{ id: 'experience-0', heading: 'Engineer', organization: 'Example', dates: '2020 – Present', text: 'Built Unicode résumé tools.', bullets: ['Built Unicode résumé tools.'], links: [] }] }], style: { fontFamily: 'Arial', bodyPt: 11, pageSize: 'A4', background: '#ffffff' } })

test('canonical preview uses the fixed five-section order and isolated escaped A4 Arial markup', () => {
  const html = renderDocumentHtml(document)
  expect(document.sections.map(section => section.name)).toEqual(['Experience'])
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
    tailoring: { headline: 'Target role', summary: { text: 'Evidence-based short summary.', citations: [citation], rationale: 'Relevant' } },
    suggestedSkills: [
      { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Confirmed skill', postingTerm: 'Confirmed skill', sourceJobRevision: 1, status: 'confirmed' },
      { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Pending skill', postingTerm: 'Pending skill', sourceJobRevision: 1, status: 'pending' },
      { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'Removed skill', postingTerm: 'Removed skill', sourceJobRevision: 1, status: 'removed' }
    ],
    content: { education: [citation, { evidenceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', revision: 1 }, { evidenceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', revision: 1 }].map((source, index) => ({ text: `Education ${index}`, citations: [source], rationale: 'Relevant' })), experience: [citation, { evidenceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', revision: 1 }, { evidenceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', revision: 1 }].map((source, index) => ({ text: `Experience ${index}`, citations: [source], rationale: 'Relevant' })), projects: [], skills: [], certificates: [] }
  } as never
  const result = createCanonicalDocument(draft, { contact: { fullName: 'Candidate', headline: 'Saved generic headline', links: [] }, education: [], certificates: [], skills: [], summary: [], languages: [], extras: [] } as never, { experience: [], projects: [] } as never)
  expect(result.sections[0].entries.map(entry => entry.heading)).toEqual(['Newer degree', 'Tied degree', 'Older degree'])
  expect(result.sections.find(section => section.name === 'Experience')?.entries.map(entry => entry.heading)).toEqual(['Newer role', 'Tied role', 'Older role'])
  expect(result.identity.headline).toBe('Target role')
  expect(result.identity.summary).toBe('Evidence-based short summary.')
  expect(result.sections.map(section => section.name)).toEqual(['Education', 'Experience', 'Skills'])
  expect(result.sections.find(section => section.name === 'Skills')?.entries.map(entry => entry.id)).toEqual(['suggested-skills-dddddddd-dddd-4ddd-8ddd-dddddddddddd'])
  expect(renderDocumentHtml(result)).toContain('Evidence-based short summary.')
})

test('canonical text parts reflect export reading order, visible headings and stripped bullets', () => {
  const parityDocument = canonicalDocumentSchema.parse({ ...document, identity: { ...document.identity, summary: 'Summary text.' }, sections: [
    { name: 'Education' as const, entries: [] },
    { name: 'Projects' as const, entries: [{ id: 'p1', heading: 'Project', dates: '2024', organization: 'Studio', text: '• Original marker text', technologies: ['TypeScript', 'React'], links: [{ label: 'Project site', url: 'https://example.test/project' }] }] },
    { name: 'Skills' as const, entries: [{ id: 's1', heading: 'TypeScript', text: '', links: [] }] }
  ] }) as CanonicalDocument
  expect(canonicalDocumentTextParts(parityDocument)).toEqual([
    'Zoë <Candidate>', 'Engineer', 'zoe@example.test', 'Portfolio', 'Professional summary', 'Summary text.',
    'Projects', 'Project', '2024', 'Studio', 'Technologies:', 'TypeScript, React', 'Original marker text', 'Project site',
    'Technical skills', 'TypeScript'
  ])
  const html = renderDocumentHtml(parityDocument)
  expect(html.indexOf('<h2>Professional summary</h2>')).toBeLessThan(html.indexOf('<h2>Projects</h2>'))
  expect(html).toContain('<h2>Technical skills</h2>')
})

test('description segmentation preserves wording and the HTML renderer safely escapes user content', () => {
  expect(splitDocumentBullets('• First item\n2. Second <item>')).toEqual(['First item', 'Second <item>'])
  const html = renderDocumentHtml({ ...document, identity: { ...document.identity, summary: '<script>alert("x")</script>' } })
  expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
  expect(html).not.toContain('<script>')
})

test('echoed source objects never become serialized document prose', () => {
  const citation = { evidenceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 1 }
  const draft = draftRevisionSchema.parse({ id: document.draftId, jobId: document.jobId, revision: 1, pageTarget: 1, status: 'unverified', approved: false, createdAt: new Date(0).toISOString(), progress: 'Ready', attempts: 0,
    lockedFields: { fullName: 'Candidate', education: [{ evidenceId: citation.evidenceId, title: 'BSc Computer Science', institution: 'Example University' }], experience: [], projects: [], certificates: [] },
    content: { education: [{ text: JSON.stringify({ title: 'BSc Computer Science', institution: 'Example University', id: 'INTERNAL_DO_NOT_PRINT' }), citations: [citation], rationale: 'Saved education' }], experience: [], projects: [], skills: [], certificates: [] },
    tailoring: { headline: 'Engineer', summary: { text: JSON.stringify({ description: 'Builds Python APIs.' }), citations: [citation], rationale: 'Profile introduction' } },
    evidence: [{ ...citation, snapshot: {} }]
  })
  const profile = profileSnapshotSchema.parse({ contact: null, skills: [], education: [], certificates: [], summary: [], languages: [], extras: [] })
  const canonical = createCanonicalDocument(draft, profile, { experience: [], projects: [] })
  expect(canonical.identity.summary).toBe('Builds Python APIs.')
  expect(canonical.sections[0].entries[0].text).toBe('')
  const html = renderDocumentHtml(canonical)
  expect(html).toContain('BSc Computer Science')
  expect(html).not.toContain('INTERNAL_DO_NOT_PRINT')
  expect(html).not.toContain('&quot;title&quot;')
})

test('canonical preview rejects any added or reordered output section', () => {
  const reordered = { ...document, sections: [{ name: 'Projects', entries: [{ id: 'project-1', heading: 'Project', text: '', links: [] }] }, ...document.sections] }
  const legacy = { ...document, sections: [{ name: 'Education', entries: [] }, ...document.sections] }
  expect(canonicalDocumentSchema.safeParse(reordered).success).toBe(false)
  expect(canonicalDocumentSchema.safeParse(legacy).success).toBe(true)
  expect(renderDocumentHtml(legacy as CanonicalDocument)).not.toContain('<h2>Education</h2>')
})
