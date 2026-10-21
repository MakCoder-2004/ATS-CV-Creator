import { expect, test } from 'vitest'
import { draftRevisionSchema } from '../src/shared/draft'
import { profileSnapshotSchema } from '../src/shared/profile'
import { canonicalDocumentSchema, canonicalDocumentTextParts, createCanonicalDocument, renderDocumentHtml, splitDocumentBullets, type CanonicalDocument } from '../src/shared/document'

const document = canonicalDocumentSchema.parse({ version: 1, draftId: '11111111-1111-4111-8111-111111111111', jobId: '22222222-2222-4222-8222-222222222222', revision: 3, targetPages: 1, identity: { name: 'Zoë <Candidate>', headline: 'Engineer', contact: ['zoe@example.test'], links: [{ label: 'Portfolio', url: 'https://example.test/portfolio' }] }, sections: [{ name: 'Experience', entries: [{ id: 'experience-0', heading: 'Engineer', organization: 'Example', dates: '2020 – Present', text: 'Built Unicode résumé tools.', bullets: ['Built Unicode résumé tools.'], links: [] }] }], style: { fontFamily: 'Arial', bodyPt: 11, pageSize: 'A4', background: '#ffffff' } })

test('review markup uses the template section order and isolated escaped Letter Lato markup', () => {
  const html = renderDocumentHtml(document)
  expect(document.sections.map(section => section.name)).toEqual(['Experience'])
  expect(html).toContain('Zoë &lt;Candidate&gt;')
  expect(html).toContain('2020 – Present')
  expect(html).toContain('href="https://example.test/portfolio"')
  expect(html).toContain('font-family:Lato')
  expect(html).toContain('@page{size:Letter')
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
  expect(result.identity.headline).toBeUndefined()
  expect(result.identity.summary).toBeUndefined()
  expect(result.sections.map(section => section.name)).toEqual(['Education', 'Experience', 'Skills'])
  expect(result.sections.find(section => section.name === 'Skills')?.entries.map(entry => entry.id)).toEqual(['suggested-skills-dddddddd-dddd-4ddd-8ddd-dddddddddddd'])
  expect(renderDocumentHtml(result)).not.toContain('Evidence-based short summary.')
})

test('legacy experience and project items sharing a locked parent render once and retain each source review item', () => {
  const roleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const factId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const projectId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const projectFactId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const original = draftRevisionSchema.parse({
    id: document.draftId, jobId: document.jobId, revision: 1, pageTarget: 1, status: 'unverified', approved: false, createdAt: new Date(0).toISOString(), progress: 'Ready', attempts: 0,
    lockedFields: { fullName: 'Candidate', education: [], experience: [{ evidenceId: roleId, sourceIds: [roleId, factId], title: 'Engineer', organization: 'Example Co' }], projects: [{ evidenceId: projectId, sourceIds: [projectId, projectFactId], name: 'Compiler' }], certificates: [] },
    content: { education: [], experience: [{ text: 'Engineer — Example Co | Built parser.', citations: [{ evidenceId: roleId, revision: 1 }], rationale: 'Role source' }, { text: 'Engineer — Example Co | Reduced errors.', citations: [{ evidenceId: factId, revision: 1 }], rationale: 'Fact source' }], projects: [{ text: 'Compiler — Faster builds.', citations: [{ evidenceId: projectId, revision: 1 }], rationale: 'Project source' }, { text: 'Compiler — Added diagnostics.', citations: [{ evidenceId: projectFactId, revision: 1 }], rationale: 'Project fact' }], skills: [], certificates: [] },
    evidence: [{ evidenceId: roleId, revision: 1, snapshot: {} }, { evidenceId: factId, revision: 1, snapshot: {} }, { evidenceId: projectId, revision: 1, snapshot: {} }, { evidenceId: projectFactId, revision: 1, snapshot: {} }]
  })
  const profile = { contact: null, skills: [], education: [], certificates: [], summary: [], languages: [], extras: [] }
  const before = JSON.stringify({ original, profile })
  const canonical = createCanonicalDocument(original, profile as never, { experience: [], projects: [] } as never)
  const role = canonical.sections.find(section => section.name === 'Experience')!.entries[0]
  const project = canonical.sections.find(section => section.name === 'Projects')!.entries[0]
  expect(canonical.sections.find(section => section.name === 'Experience')!.entries).toHaveLength(1)
  expect(role.text).toBe('Built parser.\nReduced errors.')
  expect(role.reviewItems?.map(item => [item.id, item.text])).toEqual([['experience-0', 'Built parser.'], ['experience-1', 'Reduced errors.']])
  expect(canonical.sections.find(section => section.name === 'Projects')!.entries).toHaveLength(1)
  expect(project.text).toBe('Faster builds.\nAdded diagnostics.')
  expect(project.reviewItems?.map(item => [item.id, item.text])).toEqual([['projects-0', 'Faster builds.'], ['projects-1', 'Added diagnostics.']])
  expect(JSON.stringify({ original, profile })).toBe(before)
  const single = createCanonicalDocument({ ...original, content: { ...original.content, experience: [original.content.experience[0]], projects: [original.content.projects[0]] } }, { contact: null, skills: [], education: [], certificates: [], summary: [], languages: [], extras: [] } as never, { experience: [], projects: [] } as never)
  expect(single.sections.find(section => section.name === 'Experience')!.entries[0]).not.toHaveProperty('reviewItems')
})

test('canonical text parts reflect export reading order, visible headings and stripped bullets', () => {
  const parityDocument = canonicalDocumentSchema.parse({ ...document, identity: { ...document.identity, summary: 'Summary text.' }, sections: [
    { name: 'Education' as const, entries: [] },
    { name: 'Projects' as const, entries: [{ id: 'p1', heading: 'Project', dates: '2024', organization: 'Studio', text: '• Original marker text', technologies: ['TypeScript', 'React'], links: [{ label: 'Project site', url: 'https://example.test/project' }] }] },
    { name: 'Skills' as const, entries: [{ id: 's1', heading: 'TypeScript', text: '', links: [] }] }
  ] }) as CanonicalDocument
  expect(canonicalDocumentTextParts(parityDocument)).toEqual([
    'Zoë <Candidate>', 'zoe@example.test', 'Portfolio',
    'Projects', 'Project', '|', 'TypeScript, React', '2024', 'Project site', 'Original marker text',
    'Technical Skills', 'Languages:', 'TypeScript'
  ])
  const html = renderDocumentHtml(parityDocument)
  expect(html).not.toContain('Professional summary')
  expect(html).toContain('<h2>Technical Skills</h2>')
})

test('description segmentation preserves wording and the HTML renderer safely escapes user content', () => {
  expect(splitDocumentBullets('• First item\n2. Second <item>')).toEqual(['First item', 'Second <item>'])
  const html = renderDocumentHtml({ ...document, identity: { ...document.identity, name: '<script>alert("x")</script>' } })
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
  expect(canonical.identity.summary).toBeUndefined()
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
