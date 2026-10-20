import { expect, test, vi } from 'vitest'
import { createAnalysisDispatcher, postingAnalysisSchema, type AnalysisTransport } from '../src/main/posting-analysis'

const response = { required: ['TypeScript'], preferred: ['SQLite'], tools: ['TypeScript'], responsibilities: ['Build applications'], keywords: ['TypeScript', 'SQLite'] }
const input = (runId: string, consentId: string) => ({ runId, consentId, jobId: 'j1', prompt: 'posting', model: 'gemini-3.6-flash' as const })
test('parses structured analysis through one dispatcher and records local usage', async () => {
  const transport: AnalysisTransport = { generate: vi.fn(async () => JSON.stringify(response)) }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => 1000, sleep: async () => {}, minimumSpacingMs: 0 })
  dispatcher.authorize('r1', 'consent-1')
  const result = await dispatcher.analyze(input('r1', 'consent-1'))
  expect(result.analysis).toEqual(postingAnalysisSchema.parse(response))
  expect(result.usage).toMatchObject({ attempts: 1, status: 'complete' })
})
test('repairs malformed structured output once and counts the repair attempt', async () => {
  const transport: AnalysisTransport = { generate: vi.fn().mockResolvedValueOnce('{bad').mockResolvedValueOnce(JSON.stringify(response)) }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => 1000, sleep: async () => {}, minimumSpacingMs: 0 })
  dispatcher.authorize('r1', 'consent-1')
  const result = await dispatcher.analyze(input('r1', 'consent-1'))
  expect(result.usage.attempts).toBe(2)
  expect(transport.generate).toHaveBeenCalledTimes(2)
})
test('rejects pre-consent, stops cancelled work, and enforces shared attempt ceiling', async () => {
  const transport: AnalysisTransport = { generate: vi.fn(async () => JSON.stringify(response)) }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => 1000, sleep: async () => {}, minimumSpacingMs: 0, maxAttempts: 1 })
  await expect(dispatcher.analyze(input('r1', 'consent-1'))).rejects.toThrow(/consent/i)
  dispatcher.authorize('r1', 'consent-1')
  await dispatcher.analyze(input('r1', 'consent-1'))
  await expect(dispatcher.analyze(input('r1', 'consent-1'))).rejects.toThrow(/budget/i)
  expect(transport.generate).toHaveBeenCalledTimes(1)
})
test('retries a transient provider failure without deadlocking the dispatcher queue', async () => {
  let now = 1000
  const transport: AnalysisTransport = { generate: vi.fn().mockRejectedValueOnce({ status: 503 }).mockResolvedValueOnce(JSON.stringify(response)) }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => now, sleep: async ms => { now += ms }, minimumSpacingMs: 0, random: () => 0 })
  dispatcher.authorize('retry-run', 'consent-retry')
  await expect(dispatcher.analyze(input('retry-run', 'consent-retry'))).resolves.toMatchObject({ analysis: response, usage: { attempts: 2, status: 'complete' } })
})
test('validates model output categories and sanitizes provider errors', async () => {
  const transport: AnalysisTransport = { generate: vi.fn(async () => '{"required":[" "]}') }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => 1000, sleep: async () => {}, minimumSpacingMs: 0 })
  dispatcher.authorize('r', 'consent-r')
  await expect(dispatcher.analyze({ ...input('r', 'consent-r'), prompt: 'secret prompt' })).rejects.toThrow(/malformed/i)
})
test('does not dispatch a retry when backoff exhausts the shared time limit', async () => {
  let now = 1000
  const transport: AnalysisTransport = { generate: vi.fn().mockRejectedValue({ status: 503 }) }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => now, sleep: async ms => { now += ms }, minimumSpacingMs: 0, maxElapsedMs: 500, random: () => 0.5 })
  dispatcher.authorize('paced', 'consent-paced')
  await expect(dispatcher.analyze(input('paced', 'consent-paced'))).rejects.toThrow(/time budget/i)
  expect(transport.generate).toHaveBeenCalledTimes(1)
})
test('run ID without the matching accepted-consent capability cannot authorize analysis', async () => {
  const transport: AnalysisTransport = { generate: vi.fn(async () => JSON.stringify(response)) }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => 1000, sleep: async () => {}, minimumSpacingMs: 0 })
  dispatcher.authorize('r', 'real-consent')
  await expect(dispatcher.analyze(input('r', 'guessed-consent'))).rejects.toThrow(/consent/i)
  expect(transport.generate).not.toHaveBeenCalled()
})
