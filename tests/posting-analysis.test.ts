import { expect, test, vi } from 'vitest'
import { createAnalysisDispatcher, postingAnalysisSchema, type AnalysisTransport } from '../src/main/posting-analysis'

const response = { required: ['TypeScript'], preferred: ['SQLite'], tools: ['TypeScript'], responsibilities: ['Build applications'], keywords: ['TypeScript', 'SQLite'] }
const input = (runId: string, consentId: string) => ({ runId, consentId, jobId: 'j1', prompt: 'posting', model: 'minimax/minimax-m3.1-flash:free' as const })
const dispatcherFor = (transport: AnalysisTransport) => {
  const dispatcher = createAnalysisDispatcher({ transport, now: () => 1000 })
  return dispatcher
}

test('parses structured analysis and records physical attempts', async () => {
  const transport: AnalysisTransport = { generate: vi.fn(async () => JSON.stringify(response)) }
  const dispatcher = dispatcherFor(transport)
  dispatcher.authorize('r1', 'consent-1')
  const result = await dispatcher.analyze(input('r1', 'consent-1'))
  expect(result.analysis).toEqual(postingAnalysisSchema.parse(response))
  expect(result.usage).toMatchObject({ attempts: 1, status: 'complete' })
  expect(dispatcher.getUsage()).toBe(1)
})

test('requires the exact consent capability before dispatch', async () => {
  const transport: AnalysisTransport = { generate: vi.fn(async () => JSON.stringify(response)) }
  const dispatcher = dispatcherFor(transport)
  dispatcher.authorize('r', 'accepted-consent')
  await expect(dispatcher.analyze(input('r', 'other-consent'))).rejects.toThrow(/consent/i)
  expect(transport.generate).not.toHaveBeenCalled()
})

test('permits repeated independent authorized requests without local quotas', async () => {
  const transport: AnalysisTransport = { generate: vi.fn(async () => JSON.stringify(response)) }
  const dispatcher = dispatcherFor(transport)
  dispatcher.authorize('r1', 'c1')
  dispatcher.authorize('r2', 'c2')
  await dispatcher.analyze(input('r1', 'c1'))
  await dispatcher.generate({ ...input('r2', 'c2'), responseSchema: postingAnalysisSchema })
  await dispatcher.analyze(input('r1', 'c1'))
  expect(transport.generate).toHaveBeenCalledTimes(3)
  expect(dispatcher.getUsage()).toBe(3)
})

test('repairs one complete malformed posting response and accounts for both dispatches', async () => {
  const transport: AnalysisTransport = { generate: vi.fn().mockResolvedValueOnce('{bad').mockResolvedValueOnce(JSON.stringify(response)) }
  const dispatcher = dispatcherFor(transport)
  dispatcher.authorize('repair', 'consent')
  const result = await dispatcher.analyze(input('repair', 'consent'))
  expect(result.usage.attempts).toBe(2)
  expect(transport.generate).toHaveBeenCalledTimes(2)
})

test('does not retry provider failures and sanitizes their details', async () => {
  const transport: AnalysisTransport = { generate: vi.fn().mockRejectedValue(new Error('secret prompt and provider payload')) }
  const dispatcher = dispatcherFor(transport)
  dispatcher.authorize('failure', 'consent')
  await expect(dispatcher.analyze(input('failure', 'consent'))).rejects.toThrow('The provider could not complete the request.')
  expect(transport.generate).toHaveBeenCalledOnce()
  expect(dispatcher.getUsage()).toBe(1)
})

test('serializes physical calls and cancels a request while queued', async () => {
  let finish!: (value: string) => void
  let firstStarted!: () => void
  const started = new Promise<void>(resolve => { firstStarted = resolve })
  const transport: AnalysisTransport = { generate: vi.fn(() => {
    if (vi.mocked(transport.generate).mock.calls.length === 1) { firstStarted(); return new Promise<string>(resolve => { finish = resolve }) }
    return Promise.resolve(JSON.stringify(response))
  }) }
  const dispatcher = dispatcherFor(transport)
  dispatcher.authorize('first', 'c1')
  dispatcher.authorize('queued', 'c2')
  const first = dispatcher.generate({ ...input('first', 'c1'), responseSchema: postingAnalysisSchema })
  await started
  const queued = dispatcher.generate({ ...input('queued', 'c2'), responseSchema: postingAnalysisSchema })
  dispatcher.cancel('queued')
  finish(JSON.stringify(response))
  await first
  await expect(queued).rejects.toThrow(/cancelled/i)
  expect(transport.generate).toHaveBeenCalledOnce()
})

test('discards late in-flight results after cancellation', async () => {
  let finish!: (value: string) => void
  let started!: () => void
  const running = new Promise<void>(resolve => { started = resolve })
  const transport: AnalysisTransport = { generate: vi.fn(() => { started(); return new Promise<string>(resolve => { finish = resolve }) }) }
  const dispatcher = dispatcherFor(transport)
  dispatcher.authorize('active', 'consent')
  const pending = dispatcher.analyze(input('active', 'consent'))
  await running
  dispatcher.cancel('active')
  finish(JSON.stringify(response))
  await expect(pending).rejects.toThrow(/cancelled/i)
  expect(transport.generate).toHaveBeenCalledOnce()
})
