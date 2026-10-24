import { expect, test, vi } from 'vitest'
import { createAnalysisDispatcher, postingAnalysisSchema, type AnalysisTransport } from '../src/main/posting-analysis'

const response = { required: ['TypeScript'], preferred: ['SQLite'], tools: ['TypeScript'], responsibilities: ['Build applications'], keywords: ['TypeScript', 'SQLite'] }
const input = (runId: string, consentId: string) => ({ runId, consentId, jobId: 'j1', prompt: 'posting', model: 'minimax/minimax-m3.1-flash:free' as const })
test('parses structured analysis through one dispatcher and records local usage', async () => {
  const transport: AnalysisTransport = { generate: vi.fn(async () => JSON.stringify(response)) }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => 1000, sleep: async () => {}, minimumSpacingMs: 0 })
  dispatcher.authorize('r1', 'consent-1')
  const result = await dispatcher.analyze(input('r1', 'consent-1'))
  expect(result.analysis).toEqual(postingAnalysisSchema.parse(response))
  expect(result.usage).toMatchObject({ attempts: 1, status: 'complete' })
})
test('repairs malformed output with one additional provider dispatch', async () => {
  const transport: AnalysisTransport = {
    generate: vi.fn().mockResolvedValueOnce('{bad').mockResolvedValueOnce(JSON.stringify(response))
  }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => 1000, sleep: async () => {}, minimumSpacingMs: 0 })
  dispatcher.authorize('r-repair', 'consent-repair')
  const result = await dispatcher.analyze(input('r-repair', 'consent-repair'))
  expect(result.usage.attempts).toBe(2)
  expect(transport.generate).toHaveBeenCalledTimes(2)
})
test('dispatches generation without application-side model capacity metadata', async () => {
  const transport: AnalysisTransport = { generate: vi.fn(async () => JSON.stringify(response)) }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => 1000, sleep: async () => {}, minimumSpacingMs: 0 })
  dispatcher.authorize('generation', 'consent-generation')
  await expect(dispatcher.generate({ ...input('generation', 'consent-generation'), responseSchema: postingAnalysisSchema })).resolves.toMatchObject({ text: JSON.stringify(response), attempts: 1 })
  expect(transport.generate).toHaveBeenCalledOnce()
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
test('concurrent generation runs cannot dispatch past the shared daily attempt limit', async () => {
  const transport: AnalysisTransport = { generate: vi.fn(async () => JSON.stringify(response)) }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => 1000, sleep: async () => {}, minimumSpacingMs: 0, maxDailyAttempts: 1 })
  dispatcher.authorize('first-run', 'first-consent')
  dispatcher.authorize('second-run', 'second-consent')
  const result = await Promise.allSettled([
    dispatcher.generate({ ...input('first-run', 'first-consent'), responseSchema: postingAnalysisSchema }),
    dispatcher.generate({ ...input('second-run', 'second-consent'), responseSchema: postingAnalysisSchema })
  ])
  expect(result.map(item => item.status)).toEqual(['fulfilled', 'rejected'])
  expect(transport.generate).toHaveBeenCalledTimes(1)
  expect(dispatcher.getUsage()).toBe(1)
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
  await expect(dispatcher.analyze({ ...input('r', 'consent-r'), prompt: 'secret prompt' })).rejects.toThrow(/invalid JSON/i)
})
test('does not dispatch a retry when backoff exhausts the shared time limit', async () => {
  let now = 1000
  const transport: AnalysisTransport = { generate: vi.fn().mockRejectedValue({ status: 503 }) }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => now, sleep: async ms => { now += ms }, minimumSpacingMs: 0, maxElapsedMs: 500, random: () => 0.5 })
  dispatcher.authorize('paced', 'consent-paced')
  await expect(dispatcher.analyze(input('paced', 'consent-paced'))).rejects.toThrow(/time budget/i)
  expect(transport.generate).toHaveBeenCalledTimes(1)
})
test('duplicate active run identities are rejected without replacing the original cancellation handle', async () => {
  let finish!: (value: string) => void
  let started!: () => void
  const firstStarted = new Promise<void>(resolve => { started = resolve })
  const transport: AnalysisTransport = { generate: vi.fn(() => { started(); return new Promise<string>(resolve => { finish = resolve }) }) }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => 1000, sleep: async () => {}, minimumSpacingMs: 0 })
  dispatcher.authorize('same-run', 'consent')
  const first = dispatcher.analyze(input('same-run', 'consent'))
  await firstStarted
  await expect(dispatcher.analyze(input('same-run', 'consent'))).rejects.toThrow(/already active/i)
  dispatcher.cancel('same-run')
  finish(JSON.stringify(response))
  await expect(first).rejects.toThrow(/cancelled/i)
  expect(transport.generate).toHaveBeenCalledTimes(1)
})

test('cancellation interrupts an active Retry-After pause before another dispatch', async () => {
  let startedPause!: () => void
  const pauseStarted = new Promise<void>(resolve => { startedPause = resolve })
  const transport: AnalysisTransport = { generate: vi.fn().mockRejectedValue({ status: 429, retryAfter: 30 }) }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => 1000, minimumSpacingMs: 0, sleep: (_ms, signal) => new Promise<void>((_resolve, reject) => { startedPause(); signal.addEventListener('abort', () => reject(new Error('sleep aborted')), { once: true }) }) })
  dispatcher.authorize('pause-run', 'consent-pause')
  const pending = dispatcher.analyze(input('pause-run', 'consent-pause'))
  await pauseStarted
  dispatcher.cancel('pause-run')
  await expect(pending).rejects.toThrow(/cancelled/i)
  expect(transport.generate).toHaveBeenCalledTimes(1)
})

test('enforces shared rolling-window pacing and honors Retry-After before dispatch', async () => {
  let now = 1000
  const waits: number[] = []
  const transport: AnalysisTransport = { generate: vi.fn().mockRejectedValueOnce({ status: 429, retryAfter: 2 }).mockResolvedValueOnce(JSON.stringify(response)) }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => now, sleep: async ms => { waits.push(ms); now += ms }, minimumSpacingMs: 0, rateLimitAttempts: 1, rateLimitWindowMs: 10000, random: () => 0 })
  dispatcher.authorize('rate-run', 'consent-rate')
  const result = await dispatcher.analyze(input('rate-run', 'consent-rate'))
  expect(result.usage.attempts).toBe(2)
  expect(waits).toContain(2000)
  expect(waits).toContain(8000)
})

test('run ID without the matching accepted-consent capability cannot authorize analysis', async () => {
  const transport: AnalysisTransport = { generate: vi.fn(async () => JSON.stringify(response)) }
  const dispatcher = createAnalysisDispatcher({ transport, now: () => 1000, sleep: async () => {}, minimumSpacingMs: 0 })
  dispatcher.authorize('r', 'real-consent')
  await expect(dispatcher.analyze(input('r', 'guessed-consent'))).rejects.toThrow(/consent/i)
  expect(transport.generate).not.toHaveBeenCalled()
})
