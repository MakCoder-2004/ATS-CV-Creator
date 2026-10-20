import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import type { GeminiModel } from '../shared/gemini-settings'
import type { AnalysisTransport } from './posting-analysis'

/** Adapter for Google's official Gemini Developer API SDK. SDK retries are disabled so the dispatcher owns every attempt. */
export function createGeminiAnalysisTransport(apiKey: string): AnalysisTransport {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } })
  return {
    async generate({ model, prompt, signal, responseSchema }) {
      try {
        const response = await ai.models.generateContent({
          model: model as GeminiModel,
          contents: prompt,
          config: {
            abortSignal: signal,
            responseMimeType: 'application/json',
            responseJsonSchema: (await import('zod')).z.toJSONSchema(responseSchema),
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            httpOptions: { retryOptions: { attempts: 1 } }
          }
        })
        if (typeof response.text !== 'string') throw new Error('Gemini returned no structured response.')
        return response.text
      } catch (error) {
        const candidate = error as { status?: number; code?: string; message?: string; response?: { headers?: { get(name: string): string | null } } }
        const retryAfter = candidate.response?.headers?.get('retry-after') ?? undefined
        throw Object.assign(new Error('Gemini request failed.'), {
          status: candidate.status,
          code: candidate.code ?? (candidate.message?.match(/RESOURCE_EXHAUSTED|API_KEY|INVALID_ARGUMENT/)?.[0]),
          retryAfter
        })
      }
    }
  }
}
