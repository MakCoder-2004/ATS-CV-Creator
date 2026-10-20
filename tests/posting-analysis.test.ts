import { expect, test, vi } from 'vitest'
import { createAnalysisDispatcher, postingAnalysisSchema, type AnalysisTransport } from '../src/main/posting-analysis'

const response = { required: ['TypeScript'], preferred: ['SQLite'], tools: ['TypeScript'], responsibilities: ['Build applications'], keywords: ['TypeScript', 'SQLite'] }
test('parses structured analysis through one dispatcher and records local usage', async () => {
  const transport: AnalysisTransport = { generate: vi.fn(async () => JSON.stringify(response)) }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => 1000, sleep: async () => {}, minimumSpacingMs: 0 })
  dispatcher.authorize('r1')
  const result = await dispatcher.analyze({ runId: 'r1', jobId: 'j1', prompt: 'posting', model: 'gemini-3.6-flash' })
  expect(result.analysis).toEqual(postingAnalysisSchema.parse(response))
  expect(result.usage).toMatchObject({ attempts: 1, status: 'complete' })
})
test('repairs malformed structured output once and counts the repair attempt', async () => {
  const transport: AnalysisTransport = { generate: vi.fn().mockResolvedValueOnce('{bad').mockResolvedValueOnce(JSON.stringify(response)) }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => 1000, sleep: async () => {}, minimumSpacingMs: 0 })
  dispatcher.authorize('r1')
  const result = await dispatcher.analyze({ runId: 'r1', jobId: 'j1', prompt: 'posting', model: 'gemini-3.6-flash' })
  expect(result.usage.attempts).toBe(2)
  expect(transport.generate).toHaveBeenCalledTimes(2)
})
test('rejects pre-consent, stops cancelled work, and enforces shared attempt ceiling', async () => {
  const transport: AnalysisTransport = { generate: vi.fn(async () => JSON.stringify(response)) }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => 1000, sleep: async () => {}, minimumSpacingMs: 0, maxAttempts: 1 })
  await expect(dispatcher.analyze({ runId: 'r1', jobId: 'j1', prompt: 'posting', model: 'gemini-3.6-flash' })).rejects.toThrow(/consent/i)
  dispatcher.authorize('r1')
  await dispatcher.analyze({ runId: 'r1', jobId: 'j1', prompt: 'posting', model: 'gemini-3.6-flash' })
  await expect(dispatcher.analyze({ runId: 'r1', jobId: 'j1', prompt: 'posting', model: 'gemini-3.6-flash' })).rejects.toThrow(/budget/i)
  expect(transport.generate).toHaveBeenCalledTimes(1)
})
test('validates model output categories and sanitizes provider errors', async () => {
  const transport: AnalysisTransport = { generate: vi.fn(async () => '{"required":[" "]}') }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => 1000, sleep: async () => {}, minimumSpacingMs: 0 })
  dispatcher.authorize('r')
  await expect(dispatcher.analyze({ runId: 'r', jobId: 'j', prompt: 'secret prompt', model: 'gemini-3.6-flash' })).rejects.toThrow(/malformed/i)
})
