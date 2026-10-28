import { expect, test } from 'vitest'
import { projectCoverLetter, renderCoverLetterTex } from '../src/shared/cover-letter-document'

const uid = (n: string) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`
const revision = {
  id: uid('1'), jobId: uid('2'), parentRunId: uid('3'), operationId: uid('4'), cvRevisionId: uid('5'), revision: 2, createdAt: '2026-10-28T00:00:00.000Z',
  bindings: { postingUpdatedAt: '2026-10-27T00:00:00.000Z', scopeHash: 'a'.repeat(64), modelHash: 'b'.repeat(64), sources: [{ ordinal: 1, evidenceId: uid('6'), revision: 1, category: 'experience', heading: 'Engineer', passage: 'Built systems.' }] },
  date: 'October 28, 2026', subject: 'Senior Engineer', paragraphs: [{ id: uid('7'), text: 'Built tools for Montréal teams.', citations: [{ ordinal: 1 }] }], findings: [], acknowledgments: {}, approved: false,
}
const template = { revision: 'application-letter-v1', manifestSha256: 'c'.repeat(64) }
test('projects only canonical printed fields and defaults to generic salutation', () => {
  const canonical = projectCoverLetter(revision, { fullName: 'Zoë Candidate', email: 'zoe@example.test', phone: '+1 555 123 4567', location: 'Montréal' }, template)
  expect(canonical.greeting).toBe('Dear Hiring Manager,')
  expect(canonical.signature).toBe('Zoë Candidate')
  expect(canonical.contact).toEqual({ email: 'zoe@example.test', phone: '+1 555 123 4567', location: 'Montréal' })
  expect(JSON.stringify(canonical)).not.toContain('Built systems.')
  expect(JSON.stringify(canonical)).not.toContain('ordinal')
  expect(projectCoverLetter(revision, { fullName: 'Zoe\u0308 Candidate', email: 'zoe@example.test', phone: '+1 555 123 4567', location: 'Montre\u0301al' }, template)).toEqual(canonical)
})
test('named recipient and all rendered field changes are canonical', () => {
  const contact = { fullName: 'Zoë Candidate', email: 'zoe@example.test' }
  const generic = projectCoverLetter(revision, contact, template)
  const named = projectCoverLetter({ ...revision, recipient: 'Ada Lovelace' }, contact, template)
  expect(named.greeting).toBe('Dear Ada Lovelace,')
  expect(named).not.toEqual(generic)
  expect(projectCoverLetter({ ...revision, date: 'October 29, 2026' }, contact, template)).not.toEqual(generic)
  expect(projectCoverLetter({ ...revision, subject: 'Staff Engineer' }, contact, template)).not.toEqual(generic)
  expect(projectCoverLetter(revision, { ...contact, fullName: 'Ari Example' }, template)).not.toEqual(generic)
})
test('TeX-looking text remains literal and body paragraph delimiters are application-owned', () => {
  const text = String.raw`Literal \input{sentinel.txt} & 50% #_ {braces}`
  const canonical = projectCoverLetter({ ...revision, paragraphs: [{ ...revision.paragraphs[0], text }] }, { fullName: 'Ari Example' }, template)
  const tex = renderCoverLetterTex(canonical)
  expect(tex).toContain(String.raw`\textbackslash{}input\{sentinel.txt\}`)
  expect(tex).toContain(String.raw`\& 50\% \#\_ \{braces\}`)
  expect(tex).not.toContain('\\par')
  const two = projectCoverLetter({ ...revision, paragraphs: [revision.paragraphs[0], { ...revision.paragraphs[0], id: uid('8'), text: 'Second paragraph.' }] }, { fullName: 'Ari Example' }, template)
  expect(renderCoverLetterTex(two)).toContain('Built tools for Montréal teams.\\par\nSecond paragraph.')
})
test('projection does not mutate revision, current contact, or verified template inputs', () => {
  const source = structuredClone(revision), sender = { fullName: 'Ari Example', email: 'ari@example.test' }, manifest = { ...template }
  projectCoverLetter(source, sender, manifest)
  expect(source).toEqual(revision)
  expect(sender).toEqual({ fullName: 'Ari Example', email: 'ari@example.test' })
  expect(manifest).toEqual(template)
})

test('revision and template identities are strict and recipient text cannot forge greeting', () => {
  expect(() => projectCoverLetter({ ...revision, arbitrary: true }, { fullName: 'Ari' }, template)).toThrow()
  expect(() => projectCoverLetter(revision, { fullName: 'Ari' }, { ...template, path: 'user.tex' })).toThrow()
  expect(() => projectCoverLetter({ ...revision, revision: 0 }, { fullName: 'Ari' }, template)).toThrow()
  expect(() => projectCoverLetter({ ...revision, recipient: 'Ada', paragraphs: [{ ...revision.paragraphs[0], text: 'a'.repeat(3001) }] }, { fullName: 'Ari' }, template)).toThrow()
})
