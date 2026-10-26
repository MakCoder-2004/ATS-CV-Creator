import { describe, expect, it } from 'vitest'
import { Worker } from 'node:worker_threads'
import { resolve } from 'node:path'

type ExtractionResult = { value: Record<string, unknown> } | { error: string }
type WorkerInput = { text: string; expectedId: string; mode: 'api' | 'html' }

const workerPath = resolve('src/main/posting-extraction-worker.cjs')
const description = 'Build reliable software for customers. Collaborate with a thoughtful team, document decisions, review changes, and improve services through measured outcomes and careful operational support.'
const runWorker = (workerData: WorkerInput) => new Promise<ExtractionResult>((resolveResult, reject) => {
  const worker = new Worker(workerPath, { workerData })
  worker.once('message', resolveResult)
  worker.once('error', reject)
})
const apiInput = (overrides: Record<string, unknown> = {}): WorkerInput => ({
  mode: 'api', expectedId: 'role-123',
  text: JSON.stringify({ id: 'role-123', text: 'Platform Engineer', descriptionPlain: description, ...overrides })
})

describe('inert posting extraction worker', () => {
  it('extracts a named JSON detail and reports the missing employer', async () => {
    const result = await runWorker(apiInput())
    expect(result).toMatchObject({ value: {
      title: 'Platform Engineer', company: null, description,
      notices: expect.arrayContaining(['Employer name was not provided by this source; this preview is incomplete.']),
      extractionMethod: 'lever-json-v1'
    } })
  }, 5_000)

  it.each([
    ['mismatched named ID', apiInput({ id: 'another-role' })],
    ['listing payload', apiInput({ jobs: [{ id: 'role-123' }] })]
  ])('refuses %s', async (_label, input) => {
    const result = await runWorker(input)
    expect(result).toHaveProperty('error')
  }, 5_000)

  it('refuses HTML whose nesting exceeds the review bound', async () => {
    const nested = '<div>'.repeat(270) + '<article class="posting">' + description + '</article>' + '</div>'.repeat(270)
    const result = await runWorker({ mode: 'html', expectedId: 'unused', text: nested })
    expect(result).toHaveProperty('error', expect.stringMatching(/nested too deeply/i))
  }, 5_000)

  it('returns a bounded failure for malformed structured data', async () => {
    const result = await runWorker({
      mode: 'html', expectedId: 'unused',
      text: '<script type="application/ld+json">{"@type":"JobPosting", broken}</script>'
    })
    expect(result).toHaveProperty('error', expect.stringMatching(/malformed structured posting data/i))
  }, 5_000)
})
