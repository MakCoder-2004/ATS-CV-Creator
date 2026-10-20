import type { GeminiModel } from '../shared/gemini-settings'
import { postingAnalysisSchema, type PostingAnalysis } from '../shared/posting-analysis'
export { postingAnalysisSchema }
export type { PostingAnalysis }
export interface AnalysisTransport {
  generate(input: { model: GeminiModel; prompt: string; signal: AbortSignal; responseSchema: typeof postingAnalysisSchema }): Promise<string>
}
export interface AnalysisInput { runId: string; jobId: string; prompt: string; model: GeminiModel }
export interface AnalysisUsage { runId: string; jobId: string; attempts: number; status: 'complete' | 'failed' | 'cancelled'; startedAt: number; finishedAt: number }
export class AnalysisError extends Error {
  constructor(readonly code: 'BUDGET' | 'TIMEOUT' | 'CANCELLED' | 'INVALID_KEY' | 'OFFLINE' | 'MALFORMED' | 'PROVIDER', message: string) { super(message); this.name = 'AnalysisError' }
}
type Options = { transport: AnalysisTransport; now?: () => number; sleep?: (ms: number, signal: AbortSignal) => Promise<void>; minimumSpacingMs?: number; maxAttempts?: number; maxElapsedMs?: number; maxDailyAttempts?: number; observedAttempts?: number[]; random?: () => number; onAttempt?: (timestamp: number) => void }
const cancelledError = () => new AnalysisError('CANCELLED', 'Analysis cancelled.')
const cancellableSleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(cancelledError())
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
  const abort = () => { clearTimeout(timer); reject(cancelledError()) }
  signal.addEventListener('abort', abort, { once: true })
})
function providerError(error: unknown, now: () => number): { retry: boolean; delay?: number; kind: AnalysisError['code'] } {
  const status = Number((error as { status?: number })?.status)
  const code = String((error as { code?: string })?.code ?? '')
  if (status === 401 || status === 403 || /API_KEY|INVALID_ARGUMENT/i.test(code)) return { retry: false, kind: 'INVALID_KEY' }
  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(code)) {
    const raw = (error as { retryAfter?: number | string })?.retryAfter
    const delay = typeof raw === 'number' ? raw * 1000 : typeof raw === 'string' ? (/^\\d+(?:\\.\\d+)?$/.test(raw) ? Number(raw) * 1000 : Math.max(0, Date.parse(raw) - now())) : undefined
    return { retry: true, delay, kind: 'PROVIDER' }
  }
  if (status >= 500 || ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'].includes(code)) return { retry: true, kind: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'].includes(code) ? 'OFFLINE' : 'PROVIDER' }
  return { retry: false, kind: 'PROVIDER' }
}
function isPacificDay(timestamp: number, today: number): boolean {
  const day = (value: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
  return day(timestamp) === day(today)
}
export function createAnalysisDispatcher(options: Options) {
  const now = options.now ?? Date.now, sleep = options.sleep ?? cancellableSleep
  const minSpacing = options.minimumSpacingMs ?? 5000, maxAttempts = options.maxAttempts ?? 12, maxElapsed = options.maxElapsedMs ?? 300000
  const maxDaily = options.maxDailyAttempts ?? 50, random = options.random ?? Math.random
  const authorizations = new Map<string, string>(), cancelled = new Set<string>(), active = new Map<string, AbortController>(), attemptCounts = new Map<string, number>()
  const dispatched: number[] = [...(options.observedAttempts ?? [])]; let queue = Promise.resolve()
  // The caller binds this capability to a persisted, accepted consent record; a run ID alone is not authority.
  const authorize = (runId: string, consentId: string) => { if (runId && consentId) authorizations.set(runId, consentId) }
  const cancel = (runId: string) => { cancelled.add(runId); active.get(runId)?.abort() }
  const getUsage = () => dispatched.filter(t => isPacificDay(t, now())).length
  function checkBudget(runId: string, startedAt: number) {
    if (cancelled.has(runId)) throw cancelledError()
    const elapsed = now() - startedAt
    if (elapsed >= maxElapsed) throw new AnalysisError('TIMEOUT', 'Analysis time budget is exhausted.')
    if ((attemptCounts.get(runId) ?? 0) >= maxAttempts || getUsage() >= maxDaily) throw new AnalysisError('BUDGET', 'Analysis request budget is exhausted.')
  }
  async function analyze(input: AnalysisInput & { consentId: string }): Promise<{ analysis: PostingAnalysis; usage: AnalysisUsage }> {
    if (!input.runId || !input.jobId || !input.prompt.trim()) throw new AnalysisError('PROVIDER', 'Analysis inputs are invalid.')
    if (!input.consentId || authorizations.get(input.runId) !== input.consentId) throw new AnalysisError('PROVIDER', 'Analysis requires accepted outgoing-data consent.')
    if (cancelled.has(input.runId)) throw cancelledError()
    const startedAt = now(), controller = new AbortController(); active.set(input.runId, controller)
    const usage: AnalysisUsage = { runId: input.runId, jobId: input.jobId, attempts: 0, status: 'failed', startedAt, finishedAt: startedAt }
    // Queue only a single physical attempt. Retry/backoff happens outside the queued promise, preventing self-deadlock.
    const dispatch = async (prompt: string): Promise<string> => {
      const work = queue.then(async () => {
        checkBudget(input.runId, startedAt)
        const previous = dispatched.at(-1), wait = previous === undefined ? 0 : Math.max(0, minSpacing - (now() - previous))
        if (wait) await sleep(wait, controller.signal)
        checkBudget(input.runId, startedAt)
        const timestamp = now()
        dispatched.push(timestamp); usage.attempts++; attemptCounts.set(input.runId, (attemptCounts.get(input.runId) ?? 0) + 1); options.onAttempt?.(timestamp)
        return options.transport.generate({ model: input.model, prompt, signal: controller.signal, responseSchema: postingAnalysisSchema })
      })
      queue = work.then(() => undefined, () => undefined)
      return work
    }
    const request = async (prompt: string): Promise<string> => {
      for (;;) {
        checkBudget(input.runId, startedAt)
        try { return await dispatch(prompt) }
        catch (error) {
          if (controller.signal.aborted || cancelled.has(input.runId)) throw cancelledError()
          if (error instanceof AnalysisError) throw error
          const result = providerError(error, now)
          if (!result.retry) throw new AnalysisError(result.kind, result.kind === 'INVALID_KEY' ? 'Gemini rejected the API key. Check the saved key in Settings.' : 'Gemini could not complete the analysis. Check the connection and retry.')
          checkBudget(input.runId, startedAt)
          const backoff = result.delay ?? Math.min(30000, 1000 * (2 ** Math.max(0, usage.attempts - 1))) * (0.75 + random() * 0.5)
          await sleep(backoff, controller.signal)
          checkBudget(input.runId, startedAt)
        }
      }
    }
    try {
      let output = await request(input.prompt)
      let parsed = (() => { try { return postingAnalysisSchema.safeParse(JSON.parse(output)) } catch { return null } })()
      if (!parsed || !parsed.success) {
        output = await request(`${input.prompt}\nReturn only valid JSON matching the required posting-analysis schema. Do not infer absent qualifications.`)
        try { parsed = postingAnalysisSchema.safeParse(JSON.parse(output)) } catch { parsed = null }
      }
      if (!parsed || !parsed.success) throw new AnalysisError('MALFORMED', 'Gemini returned malformed analysis twice. Review the posting and try again.')
      if (cancelled.has(input.runId)) throw cancelledError()
      usage.status = 'complete'; return { analysis: parsed.data, usage }
    } catch (error) { usage.status = error instanceof AnalysisError && error.code === 'CANCELLED' ? 'cancelled' : 'failed'; throw error }
    finally { usage.finishedAt = now(); active.delete(input.runId) }
  }
  return { authorize, cancel, analyze, getUsage }
}
