import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { draftRevisionSchema } from '../src/shared/draft'
import { createCanonicalDocument, renderDocumentHtml } from '../src/shared/document'

type Case = { id: string; record: { kind: string; title?: string; name?: string; organization?: string; description: string }; otherRecord?: { description: string }; posting: string; requiredSupportedConcepts: string[]; forbiddenClaims: string[]; locked: string[] }
const fixture = (file: string) => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'tailored-paragraphs', file), 'utf8'))

const sourcePhrases: Record<string, string[]> = {
  'backend-api': ['third-party APIs', 'backend workflows', 'deployment pipelines'],
  'frontend-paired': ['full-stack applications', 'maintainability'],
  'data-ml': ['model evaluation runs', 'monitoring dashboard'],
  'sparse-evidence': ['dashboard'],
  'long-generic': ['software delivery', 'documentation'],
  'other-role-tool': ['internal services'],
  'ownership-metric-trap': ['Helped migrate'],
  'malicious-posting': ['API integration']
}

test('frozen evaluation cases contain grounded required concepts, adversarial prompts and distinct same-source emphases', () => {
  const cases = fixture('cases.json') as Case[]
  expect(cases.map(item => item.id)).toEqual(Object.keys(sourcePhrases))
  expect(cases.find(item => item.id === 'backend-api')?.record).toEqual(cases.find(item => item.id === 'frontend-paired')?.record)
  for (const item of cases) {
    expect(item.record.description.length, item.id).toBeGreaterThan(0)
    expect(item.posting.length, item.id).toBeGreaterThan(0)
    expect(item.locked.length, item.id).toBeGreaterThan(0)
    expect(item.requiredSupportedConcepts, item.id).toHaveLength(sourcePhrases[item.id].length)
    expect(item.forbiddenClaims.length, item.id).toBeGreaterThan(0)
    for (const phrase of sourcePhrases[item.id]) expect(item.record.description.toLowerCase(), `${item.id}: ${phrase}`).toContain(phrase.toLowerCase())
  }
  expect(cases.find(item => item.id === 'other-role-tool')?.record.description).not.toMatch(/python/i)
  expect(cases.find(item => item.id === 'other-role-tool')?.otherRecord?.description).toMatch(/python/i)
  expect(cases.find(item => item.id === 'malicious-posting')?.record.description).not.toMatch(/kubernetes/i)
  expect(cases.find(item => item.id === 'malicious-posting')?.posting).toMatch(/kubernetes/i)
})

test('non-empty legacy fixture is schema-valid and renders old grouped role and project text as bullets', () => {
  const draft = draftRevisionSchema.parse(fixture('legacy-draft.json'))
  expect(draft.content.experience).toHaveLength(2)
  expect(draft.content.projects).toHaveLength(2)
  expect([...draft.content.experience, ...draft.content.projects].every(item => item.descriptionFormat === undefined)).toBe(true)
  const profile = { contact: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', revision: 1, fullName: 'Synthetic Candidate' }, skills: [], education: [], certificates: [], summary: [], languages: [], extras: [] }
  const document = createCanonicalDocument(draft, profile as never, { experience: [], projects: [] } as never)
  const html = renderDocumentHtml(document)
  for (const phrase of ['Built reliable services.', 'Supported deployment.', 'Built an evaluation dashboard.', 'Documented model checks.']) expect(html).toContain(`<li>${phrase}</li>`)
  expect(html).not.toContain('paper-paragraph')
  expect(document.sections.find(section => section.name === 'Experience')?.entries).toHaveLength(1)
  expect(document.sections.find(section => section.name === 'Projects')?.entries).toHaveLength(1)
})
