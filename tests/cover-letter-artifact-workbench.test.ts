import { afterEach, expect, test } from 'vitest'
import { artifactFixture } from './helpers/cover-letter-artifact'

const fixtures: Awaited<ReturnType<typeof artifactFixture>>[] = []
afterEach(() => fixtures.splice(0).forEach(f => f.cleanup()))
async function setup() { const f = await artifactFixture(); fixtures.push(f); return f }

test('current read model projects exact local contact, frozen kinds, checks and separate CV authority', async () => {
  const f = await setup(), beforeCv = await f.wb.api.getDraft(f.jobId)
  const state = await f.wb.api.getCoverLetterReadModel(f.jobId)
  expect(state.canonical).toMatchObject({ name: 'Zoë Candidate', contact: { email: 'zoe@example.test' } })
  expect(JSON.stringify(state.canonical)).not.toMatch(/Never print headline|Private link|private/)
  const role = (await f.wb.api.getExperience()).experience[0]
  expect(state.experienceKinds[role.id]).toBe('training')
  expect(state.readiness).toMatchObject({ bindingProblem: null, canonicalProblem: null, findings: [], currentFit: null, approved: false, canMeasure: true, canApprove: false, canExport: false })
  expect(await f.wb.api.checkCoverLetter(f.jobId)).toMatchObject({ ok: true })
  expect(await f.wb.api.getDraft(f.jobId)).toEqual(beforeCv)
  const { revision: _revision, ...roleInput } = role
  expect((await f.wb.api.saveExperience({ ...roleInput, factualItems: role.factualItems.map(({ id, text }) => ({ id, text })), kind: 'employment' })).ok).toBe(true)
  const changed = await f.wb.api.getCoverLetterReadModel(f.jobId)
  expect(changed.experienceKinds[role.id]).toBe('training')
  expect(changed.readiness.bindingProblem).not.toBeNull()
})

test('local wording/recipient revisions recheck actual facts and refuse unprintable edits without trapping correction', async () => {
  const f = await setup(), before = await f.wb.api.getProfile(), cv = await f.wb.api.getDraft(f.jobId)
  const action = { jobId: f.jobId, letterId: f.letter.id, paragraphs: f.letter.paragraphs, recipient: null }
  expect(await f.wb.api.editCoverLetter({ ...action, paragraphs: [{ ...f.letter.paragraphs[0], text: 'مرحبا' }] })).toMatchObject({ ok: false })
  expect((await f.wb.api.getCoverLetter(f.jobId))?.id).toBe(f.letter.id)
  const edited = await f.wb.api.editCoverLetter({ ...action, paragraphs: [{ ...f.letter.paragraphs[0], text: 'I built 900 Rust tools.' }], recipient: 'Local Recruiter' })
  expect(edited).toMatchObject({ ok: true, letter: { revision: 2, acknowledgments: {}, approved: false } })
  expect(await f.wb.api.checkCoverLetter(f.jobId)).toMatchObject({ ok: false })
  expect((await f.wb.api.getCoverLetterReadModel(f.jobId)).readiness.findings.length).toBeGreaterThan(0)
  const fixed = await f.wb.api.editCoverLetter({ ...action, letterId: edited.letter!.id, recipient: null })
  expect(fixed.ok).toBe(true)
  expect(await f.wb.api.checkCoverLetter(f.jobId)).toMatchObject({ ok: true })
  expect(await f.wb.api.setCoverLetterRecipient({ jobId: f.jobId, letterId: f.letter.id, recipient: 'Stale' })).toMatchObject({ ok: false })
  expect(await f.wb.api.getProfile()).toEqual(before)
  expect(await f.wb.api.getDraft(f.jobId)).toEqual(cv)
  expect(f.prompts.some(p => p.includes('Local Recruiter'))).toBe(false)
})

test('known warnings survive unrelated recipient edits until flagged wording is replaced', async () => {
  const f = await setup()
  f.mutate(letter => { letter.findings = [{ code: 'unsupported-claim', paragraphId: letter.paragraphs[0].id, message: 'Known unsupported wording.' }] })
  const edited = await f.wb.api.setCoverLetterRecipient({ jobId: f.jobId, letterId: f.letter.id, recipient: 'Local Person' })
  expect(edited.ok).toBe(true)
  expect(await f.wb.api.checkCoverLetter(f.jobId)).toMatchObject({ ok: false })
  const fixed = await f.wb.api.editCoverLetter({ jobId: f.jobId, letterId: edited.letter!.id, recipient: 'Local Person', paragraphs: [{ ...f.letter.paragraphs[0], text: 'I practiced TypeScript exercises.' }] })
  expect(fixed.ok).toBe(true)
  expect(await f.wb.api.checkCoverLetter(f.jobId)).toMatchObject({ ok: true })
})
