import { z } from 'zod'
import type { AnalysisTransport } from './posting-analysis'

const endpoint = 'https://openrouter.ai/api/v1/chat/completions'
export const MAX_PROFILE_AI_REQUEST_BODY_BYTES = 64 * 1024
export const MAX_MODEL_REQUEST_BODY_BYTES = 8 * 1024 * 1024
export const MAX_OPENROUTER_RESPONSE_BYTES = 4 * 1024 * 1024

export function serializeOpenRouterRequestBody(input: { model: string; prompt: string; responseSchema: import('zod').ZodTypeAny; maxTokens?: number; providerOnly?: string[] }) {
  return JSON.stringify({ model: input.model, stream: false, ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}), ...(input.providerOnly?.length ? { provider: { only: input.providerOnly, allow_fallbacks: false } } : {}), messages: [{ role: 'user', content: `${input.prompt}\nReturn only a JSON object conforming to this schema. Do not include markdown or explanations.\n${JSON.stringify(z.toJSONSchema(input.responseSchema))}` }] })
}

const modelCatalogEndpoint = 'https://openrouter.ai/api/v1/models'
type Capacity = { contextLength: number; maxCompletionTokens: number; providers: string[] }
const catalogSchema = z.object({ data: z.array(z.object({ id: z.string(), context_length: z.number().int().positive(), architecture: z.object({ tokenizer: z.string().nullable() }).passthrough(), top_provider: z.object({ context_length: z.number().int().positive(), max_completion_tokens: z.number().int().positive() }).passthrough() }).passthrough()) }).passthrough()
const endpointCatalogSchema = z.object({ data: z.object({ id: z.string(), endpoints: z.array(z.object({ context_length: z.number().int().positive(), max_completion_tokens: z.number().int().positive(), tag: z.string().min(1) }).passthrough()) }).passthrough() }).passthrough()
const capacityCache = new Map<string, Map<string, Capacity | null>>()
async function fetchCapacity(model: string, runId: string, signal: AbortSignal, fetcher: typeof fetch): Promise<Capacity | null> {
  let runCache = capacityCache.get(runId)
  if (!runCache) { runCache = new Map(); capacityCache.set(runId, runCache); if (capacityCache.size > 100) capacityCache.delete(capacityCache.keys().next().value!) }
  if (runCache.has(model)) return runCache.get(model) ?? null
  try {
    const catalogSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)])
    const response = await fetcher(`${modelCatalogEndpoint}?q=${encodeURIComponent(model)}&limit=1000`, { method: 'GET', signal: catalogSignal, headers: { Accept: 'application/json' } })
    if (!response.ok) { runCache.set(model, null); return null }
    const body = await boundedBody(response, 2 * 1024 * 1024)
    const parsed = catalogSchema.safeParse(JSON.parse(body))
    const entry = parsed.success ? parsed.data.data.find(item => item.id === model) : undefined
    if (!entry) { runCache.set(model, null); return null }
    const [author, ...slugParts] = model.split('/')
    if (!author || !slugParts.length) { runCache.set(model, null); return null }
    const endpointUrl = `${modelCatalogEndpoint}/${encodeURIComponent(author)}/${encodeURIComponent(slugParts.join('/'))}/endpoints`
    const endpointResponse = await fetcher(endpointUrl, { method: 'GET', signal: catalogSignal, headers: { Accept: 'application/json' } })
    if (!endpointResponse.ok) { runCache.set(model, null); return null }
    const endpointBody = await boundedBody(endpointResponse, 2 * 1024 * 1024)
    const endpointParsed = endpointCatalogSchema.safeParse(JSON.parse(endpointBody))
    const endpoints = endpointParsed.success && endpointParsed.data.data.id === model ? endpointParsed.data.data.endpoints : []
    if (!endpoints.length) { runCache.set(model, null); return null }
    const capacity = {
      contextLength: Math.min(entry.context_length, entry.top_provider.context_length, ...endpoints.map(item => item.context_length)),
      maxCompletionTokens: Math.min(entry.top_provider.max_completion_tokens, ...endpoints.map(item => item.max_completion_tokens)),
      providers: [...new Set(endpoints.map(item => item.tag))].sort()
    }
    runCache.set(model, capacity)
    return capacity
  } catch { runCache.set(model, null); return null }
}
function fitsCapacity(input: { model: string; prompt: string; responseSchema: import('zod').ZodTypeAny; maxTokens: number }, capacity: Capacity): boolean {
  const completeBody = serializeOpenRouterRequestBody({ ...input, providerOnly: capacity.providers })
  // Every tokenizer token represents at least one UTF-8 byte; this deliberately overestimates tokens.
  const inputUpperBound = new TextEncoder().encode(completeBody).byteLength
  const outputReservation = Math.max(input.maxTokens, 1)
  const safetyMargin = Math.max(512, Math.ceil(capacity.contextLength * 0.05))
  return outputReservation <= capacity.maxCompletionTokens && inputUpperBound + outputReservation + safetyMargin <= capacity.contextLength
}

async function boundedBody(response: Response, maxBytes?: number): Promise<string> {
  if (maxBytes === undefined) return response.text()
  if (!response.body) {
    const body = await response.text()
    if (new TextEncoder().encode(body).byteLength > maxBytes) throw new Error('Provider response exceeded its configured size limit.')
    return body
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) { await reader.cancel(); throw new Error('Provider response exceeded its configured size limit.') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(combined)
}

/** Single physical HTTP attempt; the shared dispatcher owns retries, pacing and cancellation. */
export function createOpenRouterAnalysisTransport(apiKey: string, fetcher: typeof fetch = fetch): AnalysisTransport {
  return {
    async validateCapacity({ runId, model, prompt, responseSchema, maxTokens, signal }) {
      const capacity = await fetchCapacity(model, runId, signal, fetcher)
      try {
        if (!capacity) return { fits: false, providers: [] }
        const requestBytes = new TextEncoder().encode(serializeOpenRouterRequestBody({ model, prompt, responseSchema, maxTokens, providerOnly: capacity.providers })).byteLength
        if (requestBytes > MAX_MODEL_REQUEST_BODY_BYTES) return { fits: false, providers: [], message: 'The complete authorized model request exceeds the 8 MiB transport safety limit. No model request was sent; keep the saved posting intact and consciously shorten the working posting or choose another supported path.' }
        return fitsCapacity({ model, prompt, responseSchema, maxTokens }, capacity) ? { fits: true, providers: capacity.providers } : { fits: false, providers: [] }
      } catch { return { fits: false, providers: [] } }
    },
    async generate({ model, prompt, signal, responseSchema, maxTokens = 2048, maxResponseChars, providerOnly }) {
      const requestBody = serializeOpenRouterRequestBody({ model, prompt, responseSchema, maxTokens, providerOnly })
      if (new TextEncoder().encode(requestBody).byteLength > MAX_MODEL_REQUEST_BODY_BYTES) throw new Error('The complete model request exceeds the 8 MiB transport safety limit; no provider request was sent.')
      let response: Response
      try {
        response = await fetcher(endpoint, {
          method: 'POST', signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: requestBody
        })
      } catch (error) {
        // Preserve network codes for the dispatcher's offline/cancellation handling; never surface request headers.
        const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code ?? (error as { code?: string })?.code
        throw Object.assign(new Error('OpenRouter connection failed.'), { code })
      }
      if (!response.ok) throw Object.assign(new Error('OpenRouter request failed.'), { status: response.status, retryAfter: response.headers.get('retry-after') ?? undefined })
      try {
        const responseLimit = maxResponseChars === undefined ? MAX_OPENROUTER_RESPONSE_BYTES : Math.min(MAX_OPENROUTER_RESPONSE_BYTES, maxResponseChars + 20_000)
        const responseText = await boundedBody(response, responseLimit)
        const payload: unknown = JSON.parse(responseText)
        const result = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1) }).safeParse(payload)
        const content = result.success ? result.data.choices[0].message.content : null
        if (!content?.trim()) throw new Error('Empty completion')
        if (maxResponseChars !== undefined && content.length > maxResponseChars) throw new Error('Completion exceeded the configured response-size limit.')
        // Some providers wrap otherwise valid JSON in markdown. Zod validation is still performed by the caller.
        return content.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim()
      } catch { throw new Error('OpenRouter returned no usable JSON response.') }
    }
  }
}
