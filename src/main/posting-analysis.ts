import { z } from 'zod'
import type { GeminiModel } from '../shared/gemini-settings'

const words = z.array(z.string().trim().min(1).max(300)).max(100)
export const postingAnalysisSchema = z.object({
  required: words, preferred: words, tools: words, responsibilities: words, keywords: words
}).strict()
export type PostingAnalysis = z.infer<typeof postingAnalysisSchema>
export interface AnalysisTransport {
  generate(input: { model: GeminiModel; prompt: string; signal: AbortSignal; responseSchema: typeof postingAnalysisSchema }): Promise<string>
}
export interface AnalysisInput { runId: string; jobId: string; prompt: string; model: GeminiModel }
export interface AnalysisUsage { runId: string; jobId: string; attempts: number; status: 'complete' | 'failed' | 'cancelled'; startedAt: number; finishedAt: number }
export class AnalysisError extends Error {
  constructor(readonly code: 'BUDGET' | 'TIMEOUT' | 'CANCELLED' | 'INVALID_KEY' | 'OFFLINE' | 'MALFORMED' | 'PROVIDER', message: string) { super(message); this.name = 'AnalysisError' }
}
type Options = { transport: AnalysisTransport; now?: () => number; sleep?: (ms: number, signal: AbortSignal) => Promise<void>; minimumSpacingMs?: number; maxAttempts?: number; maxElapsedMs?: number; maxDailyAttempts?: number; random?: () => number; onAttempt?: (timestamp: number) => void }
const cancellableSleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(new AnalysisError('CANCELLED', 'Analysis cancelled.'))
  const timer = setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(new AnalysisError('CANCELLED', 'Analysis cancelled.')) }, { once: true })
})
function providerError(error: unknown): { retry: boolean; delay?: number; kind: AnalysisError['code'] } {
  const status = Number((error as { status?: number })?.status)
  const code = String((error as { code?: string })?.code ?? '')
  if (status === 401 || status === 403 || /API_KEY|INVALID_ARGUMENT/i.test(code)) return { retry: false, kind: 'INVALID_KEY' }
  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(code)) {
    const raw = (error as { retryAfter?: number | string })?.retryAfter
    const delay = typeof raw === 'number' ? raw * 1000 : typeof raw === 'string' ? Math.max(0, Date.parse(raw) - Date.now()) : undefined
    return { retry: true, delay, kind: 'PROVIDER' }
  }
  if (status >= 500 || ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'].includes(code)) return { retry: true, kind: code ? 'OFFLINE' : 'PROVIDER' }
  return { retry: false, kind: 'PROVIDER' }
}
export function createAnalysisDispatcher(options: Options) {
  const now = options.now ?? Date.now, sleep = options.sleep ?? cancellableSleep
  const minSpacing = options.minimumSpacingMs ?? 5000, maxAttempts = options.maxAttempts ?? 12, maxElapsed = options.maxElapsedMs ?? 300000
  const maxDaily = options.maxDailyAttempts ?? 1500, random = options.random ?? Math.random
  const authorized = new Set<string>(), cancelled = new Set<string>(), active = new Map<string, AbortController>(), attemptCounts = new Map<string, number>()
  const dispatched: number[] = []; let queue = Promise.resolve()
  const authorize = (runId: string) => { authorized.add(runId) }
  const cancel = (runId: string) => { cancelled.add(runId); active.get(runId)?.abort() }
  const getUsage = () => dispatched.filter(t => new Date(t).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' }) === new Date(now()).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' })).length
  async function analyze(input: AnalysisInput): Promise<{ analysis: PostingAnalysis; usage: AnalysisUsage }> {
    if (!authorized.has(input.runId)) throw new AnalysisError('PROVIDER', 'Analysis requires accepted outgoing-data consent.')
    if (!input.runId || !input.jobId || !input.prompt.trim()) throw new AnalysisError('PROVIDER', 'Analysis inputs are invalid.')
    if (cancelled.has(input.runId)) throw new AnalysisError('CANCELLED', 'Analysis cancelled.')
    const startedAt = now(), controller = new AbortController(); active.set(input.runId, controller)
    const usage: AnalysisUsage = { runId: input.runId, jobId: input.jobId, attempts: 0, status: 'failed', startedAt, finishedAt: startedAt }
    const dispatch = async (prompt: string): Promise<string> => {
      const work: Promise<string> = queue.then(async (): Promise<string> => {
        if (cancelled.has(input.runId)) throw new AnalysisError('CANCELLED', 'Analysis cancelled.')
        const elapsed = now() - startedAt
        if (elapsed >= maxElapsed || (attemptCounts.get(input.runId) ?? 0) >= maxAttempts || getUsage() >= maxDaily) throw new AnalysisError('BUDGET', 'Analysis request or time budget is exhausted.')
        const previous = dispatched.at(-1), wait = previous === undefined ? 0 : Math.max(0, minSpacing - (now() - previous))
        if (wait) await sleep(wait, controller.signal)
        if (cancelled.has(input.runId)) throw new AnalysisError('CANCELLED', 'Analysis cancelled.')
        const timestamp = now(); dispatched.push(timestamp); usage.attempts++; attemptCounts.set(input.runId, (attemptCounts.get(input.runId) ?? 0) + 1); options.onAttempt?.(timestamp)
        try { return await options.transport.generate({ model: input.model, prompt, signal: controller.signal, responseSchema: postingAnalysisSchema }) }
        catch (error) {
          const result = providerError(error)
          if (!result.retry) throw new AnalysisError(result.kind, result.kind === 'INVALID_KEY' ? 'Gemini rejected the API key. Check the saved key in Settings.' : 'Gemini could not complete the analysis. Check the connection and retry.')
          if ((attemptCounts.get(input.runId) ?? 0) >= maxAttempts) throw new AnalysisError('BUDGET', 'Analysis request budget is exhausted.')
          const backoff = result.delay ?? Math.min(30000, 1000 * (2 ** Math.max(0, usage.attempts - 1))) * (0.75 + random() * 0.5)
          await sleep(backoff, controller.signal)
          return dispatch(prompt)
        }
      })
      queue = work.then(() => undefined, () => undefined)
      return work
    }
    try {
      let output = await dispatch(input.prompt)
      let parsed = (() => { try { return postingAnalysisSchema.safeParse(JSON.parse(output)) } catch { return null } })()
      if (!parsed || !parsed.success) {
        output = await dispatch(`${input.prompt}\nReturn only valid JSON matching the required posting-analysis schema. Do not infer absent qualifications.`)
        try { parsed = postingAnalysisSchema.safeParse(JSON.parse(output)) } catch { parsed = null }
      }
      if (!parsed || !parsed.success) throw new AnalysisError('MALFORMED', 'Gemini returned malformed analysis twice. Review the posting and try again.')
      if (cancelled.has(input.runId)) throw new AnalysisError('CANCELLED', 'Analysis cancelled.')
      usage.status = 'complete'; return { analysis: parsed.data, usage }
    } catch (error) { usage.status = error instanceof AnalysisError && error.code === 'CANCELLED' ? 'cancelled' : 'failed'; throw error }
    finally { usage.finishedAt = now(); active.delete(input.runId) }
  }
  return { authorize, cancel, analyze, getUsage }
}
