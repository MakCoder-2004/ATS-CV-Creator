import { expect, test, vi } from 'vitest'
import { z } from 'zod'
import { createOpenRouterAnalysisTransport } from '../src/main/openrouter-analysis-transport'

const input = { model: 'minimax/minimax-m3.1-flash:free', prompt: 'Analyze authorized minimized posting.', signal: new AbortController().signal, responseSchema: z.object({ required: z.array(z.string()) }) }

test('sends one authenticated JSON request to OpenRouter with the chosen model', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"required":["TypeScript"]}' } }] }), { status: 200 })) as unknown as typeof fetch
  const result = await createOpenRouterAnalysisTransport('private-canary', fetcher).generate(input)
  expect(result).toBe('{"required":["TypeScript"]}')
  expect(fetcher).toHaveBeenCalledTimes(1)
  const [url, options] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0]
  expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
  expect(options.headers.Authorization).toBe('Bearer private-canary')
  expect(options.signal).toBe(input.signal)
  const body = JSON.parse(options.body)
  expect(body.model).toBe(input.model)
  expect(body.stream).toBe(false)
  expect(body.messages[0].content).toContain('Analyze authorized minimized posting.')
  expect(JSON.stringify(body)).not.toContain('private-canary')
})

test('never exposes provider error body or key, and passes status and retry-after to dispatcher', async () => {
  const fetcher = vi.fn(async () => new Response('{"error":{"message":"private-provider-canary"}}', { status: 429, headers: { 'retry-after': '3' } })) as unknown as typeof fetch
  await expect(createOpenRouterAnalysisTransport('private-key-canary', fetcher).generate(input)).rejects.toMatchObject({ message: 'OpenRouter request failed.', status: 429, retryAfter: '3' })
  await expect(createOpenRouterAnalysisTransport('private-key-canary', fetcher).generate(input)).rejects.not.toThrow(/private-provider-canary|private-key-canary/)
})

test('rejects missing or unusable completion without returning raw provider data', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: null } }] }), { status: 200 })) as unknown as typeof fetch
  await expect(createOpenRouterAnalysisTransport('private-key', fetcher).generate(input)).rejects.toThrow('OpenRouter returned no usable JSON response.')
})
