import { z } from 'zod'
import type { AnalysisTransport } from './posting-analysis'

const endpoint = 'https://openrouter.ai/api/v1/chat/completions'
export const MAX_OPENROUTER_REQUEST_BODY_BYTES = 64 * 1024

export function serializeOpenRouterRequestBody(input: { model: string; prompt: string; responseSchema: import('zod').ZodTypeAny; maxTokens?: number }) {
  return JSON.stringify({ model: input.model, stream: false, ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}), messages: [{ role: 'user', content: `${input.prompt}\nReturn only a JSON object conforming to this schema. Do not include markdown or explanations.\n${JSON.stringify(z.toJSONSchema(input.responseSchema))}` }] })
}

const modelCatalogEndpoint = 'https://openrouter.ai/api/v1/models'
type Capacity = { contextLength: number; maxCompletionTokens: number }
type CatalogPayload = { data: Array<{ id: string; context_length: number; top_provider: { context_length: number; max_completion_tokens: number } }> }
const catalogSchema = z.object({ data: z.array(z.object({ id: z.string(), context_length: z.number().int().positive(), top_provider: z.object({ context_length: z.number().int().positive(), max_completion_tokens: z.number().int().positive() }).passthrough() }).passthrough()) }).passthrough()
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
    const capacity = entry ? { contextLength: Math.min(entry.context_length, entry.top_provider.context_length), maxCompletionTokens: entry.top_provider.max_completion_tokens } : null
    runCache.set(model, capacity)
    return capacity
  } catch { runCache.set(model, null); return null }
}
function fitsCapacity(input: { model: string; prompt: string; responseSchema: import('zod').ZodTypeAny; maxTokens: number }, capacity: Capacity): boolean {
  const completeBody = serializeOpenRouterRequestBody(input)
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
      try { return capacity !== null && fitsCapacity({ model, prompt, responseSchema, maxTokens }, capacity) }
      catch { return false }
    },
    async generate({ model, prompt, signal, responseSchema, maxTokens = 2048, maxResponseChars }) {
      let response: Response
      try {
        response = await fetcher(endpoint, {
          method: 'POST', signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: serializeOpenRouterRequestBody({ model, prompt, responseSchema, maxTokens })
        })
      } catch (error) {
        // Preserve network codes for the dispatcher's offline/cancellation handling; never surface request headers.
        const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code ?? (error as { code?: string })?.code
        throw Object.assign(new Error('OpenRouter connection failed.'), { code })
      }
      if (!response.ok) throw Object.assign(new Error('OpenRouter request failed.'), { status: response.status, retryAfter: response.headers.get('retry-after') ?? undefined })
      try {
        const responseText = await boundedBody(response, maxResponseChars === undefined ? undefined : maxResponseChars + 20_000)
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
