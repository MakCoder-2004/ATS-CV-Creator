import { z } from 'zod'
import type { AnalysisTransport } from './posting-analysis'

const endpoint = 'https://openrouter.ai/api/v1/chat/completions'

/** Single physical HTTP attempt; the shared dispatcher owns retries, pacing and cancellation. */
export function createOpenRouterAnalysisTransport(apiKey: string, fetcher: typeof fetch = fetch): AnalysisTransport {
  return {
    async generate({ model, prompt, signal, responseSchema }) {
      let response: Response
      try {
        response = await fetcher(endpoint, {
          method: 'POST', signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, stream: false, messages: [{ role: 'user', content: `${prompt}\nReturn only a JSON object conforming to this schema. Do not include markdown or explanations.\n${JSON.stringify(z.toJSONSchema(responseSchema))}` }] })
        })
      } catch (error) {
        // Preserve network codes for the dispatcher's offline/cancellation handling; never surface request headers.
        const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code ?? (error as { code?: string })?.code
        throw Object.assign(new Error('OpenRouter connection failed.'), { code })
      }
      if (!response.ok) throw Object.assign(new Error('OpenRouter request failed.'), { status: response.status, retryAfter: response.headers.get('retry-after') ?? undefined })
      try {
        const payload: unknown = await response.json()
        const result = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1) }).safeParse(payload)
        const content = result.success ? result.data.choices[0].message.content : null
        if (!content?.trim()) throw new Error('Empty completion')
        // Some providers wrap otherwise valid JSON in markdown. Zod validation is still performed by the caller.
        return content.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim()
      } catch { throw new Error('OpenRouter returned no usable JSON response.') }
    }
  }
}
