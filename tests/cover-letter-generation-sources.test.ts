import { expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prepareCoverLetterSources, validateCoverLetterResponse } from '../src/main/cover-letter-generation'
import { prepareOutboundBundle, type ConsentSource } from '../src/shared/outbound-consent'
import { defaultOpenRouterModel } from '../src/shared/openrouter-settings'

function fixture() {
  const id = () => randomUUID()
  const roleId = id(), factId = id(), projectId = id(), technologyId = id(), skillId = id(), educationId = id()
  const source: ConsentSource = {
    job: { id: id(), revision: new Date().toISOString(), title: 'Engineer', company: 'PRIVATE_JOB_COMPANY', description: 'Build systems using Rust.' },
    model: { name: defaultOpenRouterModel },
    profile: { revision: [[roleId, 2], [factId, 3], [projectId, 1], [technologyId, 1], [skillId, 1], [educationId, 1]],
      contact: { fullName: 'PRIVATE_PERSON', email: 'private@example.test', phone: '+12025551234', location: 'PRIVATE_LOCATION' },
      education: [{ id: educationId, revision: 1, title: 'BSc Computing', institution: 'PRIVATE_UNIVERSITY', description: 'Studied algorithms.' }],
      experience: [{ id: roleId, revision: 2, title: 'Platform Engineer', organization: 'PRIVATE_EMPLOYER', description: 'Built reliable internal deployment platforms.', factualItems: [{ id: factId, revision: 3, text: 'Reduced latency by 20% using TypeScript.' }] }],
      projects: [{ id: projectId, revision: 1, name: 'PRIVATE_PROJECT', description: 'Implemented automated payment processing tools.', technologies: [{ id: technologyId, revision: 1, text: 'Python' }] }],
      skills: [{ id: skillId, revision: 1, name: 'TypeScript', category: 'Programming' }],
      certificates: [{ id: id(), revision: 1, title: 'CERTIFICATE_NOT_AUTHORIZED_FOR_LETTER' }], summary: ['CV_PROSE_MUST_NOT_LEAK'],
    },
  }
  const bundle = prepareOutboundBundle(source), sources = prepareCoverLetterSources(source, bundle)
  const response = (text: string, ordinals: number[]) => ({ paragraphs: [{ text, citations: ordinals.map(ordinal => ({ ordinal })) }] })
  return { source, sources, bundle, response, roleId, factId, projectId }
}

test('ordinal payload contains only bounded minimized authorized facts; local passages derive from actual parents and facts', () => {
  const f = fixture()
  const prompt = JSON.stringify({ posting: f.bundle.outgoing.job, sources: f.sources.outgoing })
  for (const raw of ['PRIVATE_PERSON', 'private@example.test', '+12025551234', 'PRIVATE_LOCATION', 'PRIVATE_EMPLOYER', 'PRIVATE_UNIVERSITY', 'PRIVATE_PROJECT', 'CV_PROSE_MUST_NOT_LEAK', 'CERTIFICATE_NOT_AUTHORIZED_FOR_LETTER', f.roleId, f.factId]) expect(prompt).not.toContain(raw)
  expect(f.sources.local.find(s => s.evidenceId === f.factId)).toMatchObject({ revision: 3, parentId: f.roleId, category: 'experience', heading: 'Platform Engineer — PRIVATE_EMPLOYER', passage: 'Reduced latency by 20% using TypeScript.' })
  expect(f.sources.local.map(s => s.ordinal)).toEqual([1, 2, 3, 4, 5, 6])
  expect(f.sources.local[0].passage).toBe(JSON.stringify({ title: 'BSc Computing', institution: 'PRIVATE_UNIVERSITY', description: 'Studied algorithms.' }))
  expect(f.sources.outgoing[0].passage).toContain('Studied algorithms.')
  expect(f.sources.outgoing[0].passage).not.toMatch(/[{}]/)
  expect(f.sources.outgoing[5].passage).toBe('TypeScript\nCategory: Programming')
  const letter = f.response('I reduced latency by 20% using TypeScript.', [3])
  expect(validateCoverLetterResponse(letter, f.sources, f.bundle, ['Rust'])).toEqual(letter)
})

test('declared training and employment kinds reach the model and review context without changing source bindings', () => {
  const f = fixture()
  expect(f.sources.outgoing.filter(source => source.category === 'experience').every(source => !('kind' in source))).toBe(true)
  for (const kind of ['training', 'employment'] as const) {
    f.source.profile.experience[0].kind = kind
    const prepared = prepareCoverLetterSources(f.source, prepareOutboundBundle(f.source))
    expect(prepared.outgoing.filter(source => source.category === 'experience').map(source => source.kind)).toEqual([kind, kind])
    expect(prepared.experienceKinds).toMatchObject({ [f.roleId]: kind, [f.factId]: kind })
    expect(prepared.local).toEqual(f.sources.local)
  }
})

test('numeric units, qualifiers, foreign identifiers and unsupported posting skills fail closed', () => {
  const f = fixture()
  for (const text of ['I reduced latency by 20 years.', 'I reduced latency by over 20%.', 'I use Rust.', `My source is ${f.roleId}.`, 'PRIVATE_PERSON built systems.']) {
    expect(() => validateCoverLetterResponse(f.response(text, [3]), f.sources, f.bundle, ['Rust'])).toThrow()
  }
  expect(() => validateCoverLetterResponse(f.response('I use TypeScript.', [999]), f.sources, f.bundle, [])).toThrow(/citation/)
})

test('genuine multiple-source comparison is allowed; named-role quantities and skills cannot be borrowed from another parent', () => {
  const f = fixture()
  const project = f.sources.outgoing[3].heading
  expect(() => validateCoverLetterResponse(f.response('I reduced latency by 20% using TypeScript and also work with Python.', [3, 5]), f.sources, f.bundle, [])).not.toThrow()
  expect(() => validateCoverLetterResponse(f.response(`At ${project}, I reduced latency by 20% using TypeScript.`, [3, 4, 5]), f.sources, f.bundle, [])).toThrow(/unsupported/)
  expect(() => validateCoverLetterResponse(f.response(`At ${project}, I built reliable internal deployment platforms.`, [2, 4]), f.sources, f.bundle, [])).toThrow(/attribut/)
  expect(() => validateCoverLetterResponse(f.response(`At ${project}, I built reliable internal deployment platforms.`, [4]), f.sources, f.bundle, [])).toThrow(/attribut/)
})
