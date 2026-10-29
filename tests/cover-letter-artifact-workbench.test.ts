import { afterEach, expect, test } from 'vitest'
import { inspectCoverLetterPdf, assertCoverLetterPdfContent } from '../src/main/cover-letter-pdf'
import { artifactFixture } from './helpers/cover-letter-artifact'

async function acknowledge(f: Awaited<ReturnType<typeof artifactFixture>>) {
  const letter = (await f.wb.api.getCoverLetter(f.jobId))!
  for (const p of letter.paragraphs) expect((await f.wb.api.acknowledgeCoverLetterParagraph({ jobId: f.jobId, letterId: letter.id, paragraphId: p.id, acknowledged: true })).ok).toBe(true)
}

const fixtures: Awaited<ReturnType<typeof artifactFixture>>[] = []
afterEach(() => fixtures.splice(0).forEach(f => f.cleanup()))
async function setup() { const f = await artifactFixture(); fixtures.push(f); return f }

test('actual local PDF measurement enables independent explicit approval, preview and safe offline reopen', async () => {
  const f = await setup(), cv = await f.wb.api.getDraft(f.jobId), count = f.prompts.length
  const input = { jobId: f.jobId, letterId: f.letter.id }
  expect((await f.wb.api.approveCoverLetter(f.jobId, f.letter.id)).ok).toBe(false)
  const measured = await f.wb.api.measureCoverLetter(input)
  expect(measured).toMatchObject({ ok: true, letter: { fit: { actualPages: 1, overflow: false }, approved: false } })
  expect((await f.wb.api.approveCoverLetter(f.jobId, f.letter.id)).ok).toBe(false)
  const preview = await f.wb.api.getCoverLetterPdf(input)
  expect(preview.ok).toBe(true)
  const inspected = await inspectCoverLetterPdf(Buffer.from(preview.pdfBase64!, 'base64'))
  const state = await f.wb.api.getCoverLetterReadModel(f.jobId)
  assertCoverLetterPdfContent(state.canonical!, inspected)
  await acknowledge(f)
  expect((await f.wb.api.approveCoverLetter(f.jobId, f.letter.id)).ok).toBe(true)
  expect((await f.wb.api.checkCoverLetter(f.jobId)).ok).toBe(true)
  expect((await f.wb.api.getCoverLetterReadModel(f.jobId)).readiness).toMatchObject({ approved: true, canExport: true })
  expect(await f.wb.api.getDraft(f.jobId)).toEqual(cv)
  expect(f.prompts).toHaveLength(count)
  f.reopen()
  expect((await f.wb.api.getCoverLetterReadModel(f.jobId)).readiness).toMatchObject({ approved: true, canExport: true })
  const restore = f.wb.backup.previewRestore(f.wb.backup.createBackup())
  f.wb.backup.applyRestore(restore.token, text => text)
  expect((await f.wb.api.getCoverLetterReadModel(f.jobId)).readiness).toMatchObject({ currentFit: null, approved: false, canExport: false })
}, 30_000)

test('fit-shaped database data, approval flags, stale IDs and forged acknowledgments never authorize artifacts', async () => {
  const f = await setup(), input = { jobId: f.jobId, letterId: f.letter.id }
  await acknowledge(f)
  f.mutate(letter => { letter.fit = { documentHash: 'c'.repeat(64), actualPages: 1, overflow: false, measuredAt: new Date().toISOString() }; letter.approved = true; letter.approvedAt = new Date().toISOString() })
  expect((await f.wb.api.getCoverLetterReadModel(f.jobId)).readiness).toMatchObject({ currentFit: null, approved: false, canExport: false })
  expect((await f.wb.api.approveCoverLetter(f.jobId, f.letter.id)).ok).toBe(false)
  expect((await f.wb.api.measureCoverLetter({ ...input, fit: { actualPages: 1 } } as never)).ok).toBe(false)
  expect((await f.wb.api.measureCoverLetter(input)).ok).toBe(true)
  f.mutate(letter => { letter.acknowledgments[letter.paragraphs[0].id] = 'f'.repeat(64) })
  expect((await f.wb.api.approveCoverLetter(f.jobId, f.letter.id)).ok).toBe(false)
  await acknowledge(f)
  expect((await f.wb.api.approveCoverLetter(f.jobId, f.letter.id)).ok).toBe(true)
  const edited = await f.wb.api.setCoverLetterRecipient({ ...input, recipient: 'Local Recruiter' })
  expect(edited.ok).toBe(true)
  expect((await f.wb.api.approveCoverLetter(f.jobId, f.letter.id)).ok).toBe(false)
  expect((await f.wb.api.getCoverLetterPdf(input)).ok).toBe(false)
  expect((await f.wb.api.getCoverLetterReadModel(f.jobId)).readiness).toMatchObject({ currentFit: null, approved: false, canExport: false })
}, 30_000)

for (const change of ['header', 'source', 'posting', 'recipient', 'body'] as const) test(`measured approval is never current after a public ${change} edit`, async () => {
  const f = await setup(), input = { jobId: f.jobId, letterId: f.letter.id }
  expect((await f.wb.api.measureCoverLetter(input)).ok).toBe(true)
  await acknowledge(f)
  expect((await f.wb.api.approveCoverLetter(f.jobId, f.letter.id)).ok).toBe(true)
  if (change === 'header') { const contact = (await f.wb.api.getProfile()).contact!; expect((await f.wb.api.saveContact({ id: contact.id, fullName: 'Changed Header', email: contact.email })).ok).toBe(true) }
  if (change === 'source') { const skill = (await f.wb.api.getProfile()).skills[0]; expect((await f.wb.api.saveSkill({ id: skill.id, name: 'TypeScript', category: 'Updated Programming' })).ok).toBe(true) }
  if (change === 'posting') expect((await f.wb.api.saveJob({ id: f.jobId, title: 'Changed title', company: 'Example', description: 'Different posting.' })).ok).toBe(true)
  if (change === 'recipient') expect((await f.wb.api.setCoverLetterRecipient({ ...input, recipient: 'New local recipient' })).ok).toBe(true)
  if (change === 'body') expect((await f.wb.api.editCoverLetter({ ...input, recipient: null, paragraphs: [{ ...f.letter.paragraphs[0], text: 'I practiced TypeScript exercises.' }] })).ok).toBe(true)
  const state = await f.wb.api.getCoverLetterReadModel(f.jobId)
  expect(state.readiness).toMatchObject({ currentFit: null, approved: false, canExport: false })
  expect(state.letter).toMatchObject({ approved: false })
  expect(state.letter?.fit).toBeUndefined()
}, 30_000)

test('CV-only review edits do not invalidate the immutable letter origin or approval', async () => {
  const f = await setup(), input = { jobId: f.jobId, letterId: f.letter.id }, cv = (await f.wb.api.getDraft(f.jobId))!
  expect((await f.wb.api.measureCoverLetter(input)).ok).toBe(true)
  await acknowledge(f)
  expect((await f.wb.api.approveCoverLetter(f.jobId, f.letter.id)).ok).toBe(true)
  expect((await f.wb.api.changeCvTitle({ jobId: f.jobId, draftId: cv.id, title: null })).ok).toBe(true)
  expect((await f.wb.api.getDraft(f.jobId))?.id).not.toBe(cv.id)
  expect((await f.wb.api.getCoverLetterReadModel(f.jobId)).readiness.canExport).toBe(true)
  expect((await f.wb.api.getCoverLetter(f.jobId))?.cvRevisionId).toBe(cv.id)
}, 30_000)

test('actual local preview/measurement fail closed on unsupported text, bidi, significant overflow and multipage output', async () => {
  const f = await setup(), input = { jobId: f.jobId, letterId: f.letter.id }, original = f.letter.paragraphs[0]
  for (const text of ['مرحبا', `Hidden${String.fromCharCode(0x202e)} wording`, 'W'.repeat(200)]) {
    f.mutate(letter => { letter.paragraphs = [{ ...original, text }] })
    expect((await f.wb.api.measureCoverLetter(input)).ok).toBe(false)
    expect((await f.wb.api.getCoverLetterPdf(input)).ok).toBe(false)
    expect((await f.wb.api.approveCoverLetter(f.jobId, f.letter.id)).ok).toBe(false)
  }
  f.mutate(letter => { letter.paragraphs = Array.from({ length: 8 }, (_, at) => ({ ...original, id: `00000000-0000-4000-8000-${String(at).padStart(12, '0')}`, text: 'Practiced TypeScript exercises and built reliable tools. '.repeat(45) })) })
  expect((await f.wb.api.measureCoverLetter(input)).ok).toBe(false)
  expect((await f.wb.api.getCoverLetterReadModel(f.jobId)).readiness.currentFit).toBeNull()
}, 30_000)

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

test('local review keeps the 400-word body budget correctable without introducing a model-request quota', async () => {
  const f = await setup(), count = f.prompts.length
  let letter = f.letter
  for (const words of [401, 400]) {
    const edited = await f.wb.api.editCoverLetter({ jobId: f.jobId, letterId: letter.id, recipient: null, paragraphs: [{ ...letter.paragraphs[0], text: Array(words).fill('Work').join(' ') }] })
    expect(edited.ok).toBe(true)
    letter = edited.letter!
    expect((await f.wb.api.checkCoverLetter(f.jobId)).ok).toBe(words <= 400)
    expect((await f.wb.api.getCoverLetterReadModel(f.jobId)).readiness.findings.some(finding => finding.code === 'local-word-budget')).toBe(words > 400)
  }
  expect(f.prompts).toHaveLength(count)
})

test('restored employer anchors reject cross-role borrowing through real local edit/check/approval actions', async () => {
  const f = await artifactFixture(false, true); fixtures.push(f)
  const paragraphs = [{ ...f.letter.paragraphs[0], text: 'At Alpha, I reduced latency by 20% using Rust.', citations: f.letter.bindings.sources.filter(source => source.category === 'experience' && !source.parentId).map(source => ({ ordinal: source.ordinal })) }]
  const edited = await f.wb.api.editCoverLetter({ jobId: f.jobId, letterId: f.letter.id, recipient: null, paragraphs })
  expect(edited.ok).toBe(true)
  expect(await f.wb.api.checkCoverLetter(f.jobId)).toMatchObject({ ok: false })
  const input = { jobId: f.jobId, letterId: edited.letter!.id }
  expect((await f.wb.api.measureCoverLetter(input)).ok).toBe(true)
  await acknowledge(f)
  expect((await f.wb.api.approveCoverLetter(f.jobId, input.letterId)).ok).toBe(false)
  const fixed = await f.wb.api.editCoverLetter({ ...input, recipient: null, paragraphs: [{ ...paragraphs[0], text: 'At Beta, I reduced latency by 20% using Rust.' }] })
  expect(fixed.ok).toBe(true)
  expect((await f.wb.api.checkCoverLetter(f.jobId)).ok).toBe(true)
}, 30_000)

test('known warning claims cannot be waived by punctuation, whitespace, case or appending innocuous wording', async () => {
  const f = await setup(), original = f.letter.paragraphs[0]
  f.mutate(letter => { letter.paragraphs[0].text = 'I led the team.'; letter.findings = [{ code: 'unsupported-claim', paragraphId: original.id, message: 'Leadership is not supported.' }] })
  let id = f.letter.id
  for (const text of ['I  led the team.', 'I led the team!', 'I LED the team.', 'I led the team. I practiced TypeScript.', 'I have led the team.', 'I led the experienced team.']) {
    const edited = await f.wb.api.editCoverLetter({ jobId: f.jobId, letterId: id, recipient: null, paragraphs: [{ ...original, text }] })
    expect(edited.ok).toBe(true)
    id = edited.letter!.id
    expect((await f.wb.api.checkCoverLetter(f.jobId)).ok).toBe(false)
  }
})

test('inherited warnings keep immutable original claim attribution through append then remove correction', async () => {
  const f = await setup(), original = f.letter.paragraphs[0]
  f.mutate(letter => { letter.paragraphs[0].text = 'I led the team.'; letter.findings = [{ code: 'unsupported-claim', paragraphId: original.id, message: 'Leadership is not supported.' }] })
  const appended = await f.wb.api.editCoverLetter({ jobId: f.jobId, letterId: f.letter.id, recipient: null, paragraphs: [{ ...original, text: 'I led the team. I practiced TypeScript.' }] })
  expect(appended.ok).toBe(true)
  expect((await f.wb.api.checkCoverLetter(f.jobId)).ok).toBe(false)
  let id = appended.letter!.id
  for (const text of ['I practiced TypeScript.', 'I practiced TypeScript. I use TypeScript.']) {
    const corrected = await f.wb.api.editCoverLetter({ jobId: f.jobId, letterId: id, recipient: null, paragraphs: [{ ...original, text }] })
    expect(corrected.ok).toBe(true)
    id = corrected.letter!.id
    expect((await f.wb.api.checkCoverLetter(f.jobId)).ok).toBe(true)
    expect((await f.wb.api.getCoverLetterReadModel(f.jobId)).readiness.findings).toEqual([])
  }
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
