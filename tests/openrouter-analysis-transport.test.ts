import { expect, test, vi } from 'vitest'
import { z } from 'zod'
import { createOpenRouterAnalysisTransport, MAX_OPENROUTER_RESPONSE_BYTES } from '../src/main/openrouter-analysis-transport'
import { minimizeProfileText } from '../src/shared/profile-ai-structuring'
import { profilePdfProposalDraftSchema } from '../src/shared/profile-pdf-import'

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

test('applies explicit response token and byte ceilings for CV structuring', async () => {
  const fetcher = vi.fn(async (_url: unknown, options: unknown) => {
    const body = JSON.parse((options as { body: string }).body)
    expect(body.max_tokens).toBe(2048)
    return new Response(JSON.stringify({ choices: [{ message: { content: 'x'.repeat(100) } }] }), { status: 200 })
  }) as unknown as typeof fetch
  await expect(createOpenRouterAnalysisTransport('test-key', fetcher).generate({ ...input, maxTokens: 2048, maxResponseChars: 10 })).rejects.toThrow('OpenRouter returned no usable JSON response.')
})

test('captures the exact minimized profile-intake HTTP request and excludes binary, credentials, and unrelated profile data', async () => {
  const raw = JSON.stringify({ sources: [{ page: 1, field: 'contact.email', text: 'EMAIL: ada@example.test' }], unmapped: [] })
  const outgoing = minimizeProfileText(raw, ['ada@example.test']).text
  const prompt = `Structure only these local CV passages.\n${outgoing}`
  let captured = ''
  const fetcher = vi.fn(async (_url: unknown, options: unknown) => {
    captured = (options as { body: string }).body
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ skills: [], experience: [], projects: [], entries: [], unmapped: [], sources: [] }) } }] }), { status: 200 })
  }) as unknown as typeof fetch
  await createOpenRouterAnalysisTransport('private-api-key-canary', fetcher).generate({ ...input, prompt, responseSchema: profilePdfProposalDraftSchema, maxTokens: 2048 })
  const request = JSON.parse(captured)
  expect(request.model).toBe(input.model)
  expect(request.max_tokens).toBe(2048)
  expect(request.messages[0].content).toContain(outgoing)
  expect(captured).not.toContain('ada@example.test')
  expect(captured).not.toContain('%PDF')
  expect(captured).not.toContain('PROFILE_SECRET_CANARY')
  expect(captured).not.toContain('private-api-key-canary')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test('checks complete UTF-8 request upper bound against per-provider metadata without sending private payload to the catalog', async () => {
  const model = input.model
  const metadata = { data: [{ id: model, context_length: 100_000, architecture: { tokenizer: 'GPT' }, top_provider: { context_length: 100_000, max_completion_tokens: 4096, name: 'Example' } }] }
  const endpoints = { data: { id: model, endpoints: [{ context_length: 90_000, max_completion_tokens: 3072, tag: 'minimax' }, { context_length: 80_000, max_completion_tokens: 4096, tag: 'alternate' }] } }
  const fetcher = vi.fn(async (url: unknown) => new Response(JSON.stringify(String(url).includes('/endpoints') ? endpoints : metadata), { status: 200 })) as unknown as typeof fetch
  const transport = createOpenRouterAnalysisTransport('never-used-api-key', fetcher)
  const capacity = await transport.validateCapacity!({ runId: 'run-capacity', model, prompt: 'P'.repeat(20_000), responseSchema: input.responseSchema, maxTokens: 2048, signal: input.signal })
  expect(capacity).toEqual({ fits: true, providers: ['alternate', 'minimax'] })
  expect(await transport.validateCapacity!({ runId: 'run-capacity', model, prompt: 'repair payload', responseSchema: input.responseSchema, maxTokens: 2048, signal: input.signal })).toMatchObject({ fits: true })
  expect(fetcher).toHaveBeenCalledTimes(2)
  const calls = (fetcher as ReturnType<typeof vi.fn>).mock.calls
  const [url, options] = calls[0]
  expect(String(url)).toContain('/models?q=')
  expect(String(url)).toContain(encodeURIComponent(model))
  expect(options.headers).toEqual({ Accept: 'application/json' })
  expect(options.method).toBe('GET')
  const [endpointUrl, endpointOptions] = calls[1]
  expect(String(endpointUrl)).toContain('/models/minimax/minimax-m3.1-flash%3Afree/endpoints')
  expect(endpointOptions.headers).toEqual({ Accept: 'application/json' })
  expect(JSON.stringify(calls)).not.toContain('P'.repeat(100))
  expect(JSON.stringify(calls)).not.toContain('never-used-api-key')
})

test('pins model dispatches to the verified endpoint set used for conservative capacity calculation', async () => {
  const model = input.model
  const responses = [
    { data: [{ id: model, context_length: 100_000, architecture: { tokenizer: 'GPT' }, top_provider: { context_length: 90_000, max_completion_tokens: 4096 } }] },
    { data: { id: model, endpoints: [{ context_length: 80_000, max_completion_tokens: 3072, tag: 'provider-a' }, { context_length: 70_000, max_completion_tokens: 2048, tag: 'provider-b' }] } },
    { choices: [{ message: { content: '{"required":[]}' } }] }
  ]
  const fetcher = vi.fn(async () => new Response(JSON.stringify(responses.shift()), { status: 200 })) as unknown as typeof fetch
  const transport = createOpenRouterAnalysisTransport('secret-key', fetcher)
  const decision = await transport.validateCapacity!({ runId: 'route-pinned-run', model, prompt: 'Authorized complete prompt', responseSchema: input.responseSchema, maxTokens: 2048, signal: input.signal })
  expect(decision).toEqual({ fits: true, providers: ['provider-a', 'provider-b'] })
  await transport.generate({ ...input, maxTokens: 2048, providerOnly: decision && typeof decision === 'object' ? decision.providers : [] })
  expect(fetcher).toHaveBeenCalledTimes(3)
  const request = JSON.parse((fetcher as ReturnType<typeof vi.fn>).mock.calls[2][1].body)
  expect(request.provider).toEqual({ only: ['provider-a', 'provider-b'], allow_fallbacks: false })
  expect(request.max_tokens).toBe(2048)
})

test('fails closed for unknown capacity and requests that exceed metadata output/context budgets', async () => {
  const model = input.model
  const response = (context: number, output = 2048) => JSON.stringify({ data: [{ id: model, context_length: context, architecture: { tokenizer: 'GPT' }, top_provider: { context_length: context, max_completion_tokens: output } }] })
  const endpoints = (context: number, output: number) => JSON.stringify({ data: { id: model, endpoints: [{ context_length: context, max_completion_tokens: output, tag: 'provider-a' }] } })
  const unknown = createOpenRouterAnalysisTransport('unused', vi.fn(async () => new Response('{"data":[]}', { status: 200 })) as unknown as typeof fetch)
  expect(await unknown.validateCapacity!({ runId: 'run-unknown', model, prompt: 'short', responseSchema: input.responseSchema, maxTokens: 2048, signal: input.signal })).toMatchObject({ fits: false })
  const limited = createOpenRouterAnalysisTransport('unused', vi.fn(async (url: unknown) => new Response(String(url).includes('/endpoints') ? endpoints(3000, 1024) : response(3000, 4096), { status: 200 })) as unknown as typeof fetch)
  expect(await limited.validateCapacity!({ runId: 'run-limited', model, prompt: 'short', responseSchema: input.responseSchema, maxTokens: 2048, signal: input.signal })).toMatchObject({ fits: false })
  const oversized = createOpenRouterAnalysisTransport('unused', vi.fn(async (url: unknown) => new Response(String(url).includes('/endpoints') ? endpoints(5000, 4096) : response(5000, 4096), { status: 200 })) as unknown as typeof fetch)
  expect(await oversized.validateCapacity!({ runId: 'run-oversized', model, prompt: 'X'.repeat(6000), responseSchema: input.responseSchema, maxTokens: 2048, signal: input.signal })).toMatchObject({ fits: false })
})

test('bounds streamed provider output when no character limit was supplied', async () => {
  const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(MAX_OPENROUTER_RESPONSE_BYTES + 1))); controller.close() } }), { status: 200 })) as unknown as typeof fetch
  await expect(createOpenRouterAnalysisTransport('private-key', fetcher).generate(input)).rejects.toThrow('OpenRouter returned no usable JSON response.')
})

test('rejects missing or unusable completion without returning raw provider data', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: null } }] }), { status: 200 })) as unknown as typeof fetch
  await expect(createOpenRouterAnalysisTransport('private-key', fetcher).generate(input)).rejects.toThrow('OpenRouter returned no usable JSON response.')
})
