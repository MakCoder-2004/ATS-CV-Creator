import { expect, test } from 'vitest'
import { scriptedCoverLetterResponse } from '../src/main/cover-letter-scripted-fixture'
import { coverLetterModelResponseSchema } from '../src/shared/cover-letter'
import { prepareCoverLetterSources, validateCoverLetterResponse } from '../src/main/cover-letter-generation'
import { prepareOutboundBundle, type ConsentSource } from '../src/shared/outbound-consent'
import { randomUUID } from 'node:crypto'

const source = { job: { id: randomUUID(), revision: '2026-10-29T00:00:00.000Z', title: 'Developer', company: 'Example', description: 'Build tools.' }, profile: { contact: null, revision: [], education: [], experience: [], projects: [], skills: [{ id: randomUUID(), revision: 1, name: 'TypeScript', category: 'Programming' }], certificates: [], summary: [], languages: [], extras: [] }, model: { name: 'synthetic', providerId: 'sample', thinkingLevel: 'low' } } as ConsentSource
const bundle = prepareOutboundBundle(source), sources = prepareCoverLetterSources(source, bundle)
const prompt = `Write one cover letter grounded only in sources.\n${JSON.stringify({ posting: bundle.outgoing.job, sources: sources.outgoing })}`
const signal = new AbortController().signal

test('unpackaged successful fixture uses real bounded response schema and issued source ordinal, never authority fields', async () => {
  const response = JSON.parse((await scriptedCoverLetterResponse(false, 'cover-letter-success', prompt, signal))!)
  expect(coverLetterModelResponseSchema.parse(response)).toEqual(validateCoverLetterResponse(response, sources, bundle, []))
  expect(response).toEqual({ paragraphs: [{ text: 'I use TypeScript.', citations: [{ ordinal: 1 }] }] })
})
test('fixture modes cannot be enabled in packaged builds or intercept other tasks', async () => {
  for (const mode of ['cover-letter-success', 'cover-letter-failure', 'cover-letter-delay', 'cover-letter-invalid']) {
    expect(await scriptedCoverLetterResponse(true, mode, prompt, signal)).toBeNull()
    expect(await scriptedCoverLetterResponse(false, mode, 'Score these numbered {}', signal)).toBeNull()
  }
})
test('failure/invalid modes remain transport failures, not fabricated saved revisions or fit', async () => {
  await expect(scriptedCoverLetterResponse(false, 'cover-letter-failure', prompt, signal)).rejects.toThrow(/Synthetic/)
  expect(() => JSON.parse('{ invalid structured letter')).toThrow()
  expect(await scriptedCoverLetterResponse(false, 'cover-letter-invalid', prompt, signal)).toBe('{ invalid structured letter')
})
test('bounded delayed fixture respects cancellation and otherwise returns the same real-schema result', async () => {
  const controller = new AbortController()
  const pending = scriptedCoverLetterResponse(false, 'cover-letter-delay', prompt, controller.signal)
  controller.abort()
  await expect(pending).rejects.toThrow(/cancellation/)
  expect(await scriptedCoverLetterResponse(false, 'cover-letter-delay', prompt, signal)).toBe(await scriptedCoverLetterResponse(false, 'cover-letter-success', prompt, signal))
})
