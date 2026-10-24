import type { OpenRouterModel } from '../shared/openrouter-settings'
import { defaultAnalysisBudgets, postingAnalysisSchema, type AnalysisBudgets, type PostingAnalysis } from '../shared/posting-analysis'
import { pacificDay } from '../shared/pacific-day'
import type { ZodTypeAny } from 'zod'
export { postingAnalysisSchema }
export type { PostingAnalysis }
export interface AnalysisTransport {
  generate(input: { model: OpenRouterModel; prompt: string; signal: AbortSignal; responseSchema: ZodTypeAny; maxTokens?: number; maxResponseChars?: number; providerOnly?: string[] }): Promise<string>
  validateCapacity?(input: { runId: string; model: OpenRouterModel; prompt: string; responseSchema: ZodTypeAny; maxTokens: number; signal: AbortSignal }): Promise<boolean | { fits: boolean; providers: string[]; message?: string }>
}
export interface AnalysisInput { runId: string; jobId: string; prompt: string; model: OpenRouterModel }
export interface AnalysisUsage { runId: string; jobId: string; attempts: number; status: 'complete' | 'failed' | 'cancelled'; startedAt: number; finishedAt: number }
export class AnalysisError extends Error {
  usage?: AnalysisUsage
  constructor(readonly code: 'BUDGET' | 'TIMEOUT' | 'CANCELLED' | 'INVALID_KEY' | 'OFFLINE' | 'MALFORMED' | 'PROVIDER', message: string) { super(message); this.name = 'AnalysisError' }
}
type Options = { transport: AnalysisTransport; now?: () => number; sleep?: (ms: number, signal: AbortSignal) => Promise<void>; minimumSpacingMs?: number; rateLimitAttempts?: number; rateLimitWindowMs?: number; maxAttempts?: number; maxElapsedMs?: number; maxDailyAttempts?: number; observedAttempts?: number[]; observedRunAttempts?: Record<string, number>; observedRunStartedAt?: Record<string, number>; random?: () => number; onAttempt?: (timestamp: number, runId: string) => void; onAttemptComplete?: (runId: string, succeeded: boolean) => void; onProgress?: (runId: string, jobId: string, progress: string, attempts: number) => void }
const cancelledError = () => new AnalysisError('CANCELLED', 'Analysis cancelled.')
const capacityFailure = (message?: string) => new AnalysisError('BUDGET', message ?? 'The selected model capacity could not be confirmed for the complete request, or the authorized request exceeds its conservative context budget. Choose a model with verified capacity or consciously shorten the working posting, then review and authorize again.')
const cancellableSleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(cancelledError())
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
  const abort = () => { clearTimeout(timer); reject(cancelledError()) }
  signal.addEventListener('abort', abort, { once: true })
})
function providerError(error: unknown, now: () => number): { retry: boolean; delay?: number; kind: AnalysisError['code'] } {
  const status = Number((error as { status?: number })?.status)
  const code = String((error as { code?: string })?.code ?? '')
  if (status === 401 || status === 403 || /API_KEY/i.test(code)) return { retry: false, kind: 'INVALID_KEY' }
  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(code)) {
    const raw = (error as { retryAfter?: number | string })?.retryAfter
    const delay = typeof raw === 'number' ? raw * 1000 : typeof raw === 'string' ? (/^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Math.max(0, Date.parse(raw) - now())) : undefined
    return { retry: true, delay, kind: 'PROVIDER' }
  }
  if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'].includes(code)) return { retry: false, kind: 'OFFLINE' }
  if (status >= 500) return { retry: true, kind: 'PROVIDER' }
  return { retry: false, kind: 'PROVIDER' }
}
function isPacificDay(timestamp: number, today: number): boolean { return pacificDay(timestamp) === pacificDay(today) }
export function createAnalysisDispatcher(options: Options) {
  const now = options.now ?? Date.now, sleep = options.sleep ?? cancellableSleep
  let budgets: AnalysisBudgets = { ...defaultAnalysisBudgets, minimumSpacingMs: options.minimumSpacingMs ?? defaultAnalysisBudgets.minimumSpacingMs, rateLimitAttempts: options.rateLimitAttempts ?? defaultAnalysisBudgets.rateLimitAttempts, rateLimitWindowMs: options.rateLimitWindowMs ?? defaultAnalysisBudgets.rateLimitWindowMs, runLimit: options.maxAttempts ?? defaultAnalysisBudgets.runLimit, runTimeLimitMs: options.maxElapsedMs ?? defaultAnalysisBudgets.runTimeLimitMs, configuredDailyLimit: options.maxDailyAttempts ?? defaultAnalysisBudgets.configuredDailyLimit }
  const random = options.random ?? Math.random
  const authorizations = new Map<string, string>(), cancelled = new Set<string>(), active = new Map<string, AbortController>(), attemptCounts = new Map(Object.entries(options.observedRunAttempts ?? {}).map(([runId, count]) => [runId, count])), runStartedAt = new Map(Object.entries(options.observedRunStartedAt ?? {}).map(([runId, timestamp]) => [runId, timestamp]))
  const dispatched: number[] = [...(options.observedAttempts ?? [])]; let queue = Promise.resolve()
  // The caller binds this capability to a persisted, accepted consent record; a run ID alone is not authority.
  const authorize = (runId: string, consentId: string) => { if (runId && consentId) authorizations.set(runId, consentId) }
  const cancel = (runId: string) => { cancelled.add(runId); active.get(runId)?.abort() }
  const getUsage = () => dispatched.filter(t => isPacificDay(t, now())).length
  const setBudgets = (value: AnalysisBudgets) => { budgets = value }
  async function analyze(input: AnalysisInput & { consentId: string }): Promise<{ analysis: PostingAnalysis; usage: AnalysisUsage }> {
    if (!input.runId || !input.jobId || !input.prompt.trim()) throw new AnalysisError('PROVIDER', 'Analysis inputs are invalid.')
    if (!input.consentId || authorizations.get(input.runId) !== input.consentId) throw new AnalysisError('PROVIDER', 'Analysis requires accepted outgoing-data consent.')
    if (cancelled.has(input.runId)) throw cancelledError()
    if (active.has(input.runId)) throw new AnalysisError('PROVIDER', 'An analysis with this run identity is already active.')
    const startedAt = runStartedAt.get(input.runId) ?? now(); runStartedAt.set(input.runId, startedAt)
    const runBudgets = { ...budgets }, controller = new AbortController(); active.set(input.runId, controller)
    let timedOut = false
    const deadlineTimer = setTimeout(() => { timedOut = true; controller.abort() }, Math.max(0, runBudgets.runTimeLimitMs - (now() - startedAt)))
    const checkBudget = () => {
      if (cancelled.has(input.runId)) throw cancelledError()
      if (now() - startedAt >= runBudgets.runTimeLimitMs) throw new AnalysisError('TIMEOUT', 'Analysis time budget is exhausted.')
      if ((attemptCounts.get(input.runId) ?? 0) >= runBudgets.runLimit || getUsage() >= runBudgets.configuredDailyLimit) throw new AnalysisError('BUDGET', 'Configured local analysis budget is exhausted.')
    }
    const usage: AnalysisUsage = { runId: input.runId, jobId: input.jobId, attempts: 0, status: 'failed', startedAt, finishedAt: startedAt }
    // Queue only a single physical attempt. Retry/backoff happens outside the queued promise, preventing self-deadlock.
    const dispatch = async (prompt: string): Promise<string> => {
      const work = queue.then(async () => {
        checkBudget()
        const previous = dispatched.at(-1), spacingWait = previous === undefined ? 0 : Math.max(0, runBudgets.minimumSpacingMs - (now() - previous))
        const recent = dispatched.filter(timestamp => now() - timestamp < runBudgets.rateLimitWindowMs)
        const rateWait = recent.length >= runBudgets.rateLimitAttempts ? Math.max(0, recent[0] + runBudgets.rateLimitWindowMs - now()) : 0
        const wait = Math.max(spacingWait, rateWait)
        if (wait) { const boundedWait = Math.min(wait, Math.max(0, runBudgets.runTimeLimitMs - (now() - startedAt))); options.onProgress?.(input.runId, input.jobId, 'Waiting for shared request pacing before the next attempt.', usage.attempts); await sleep(boundedWait, controller.signal) }
        checkBudget()
        const capacity = options.transport.validateCapacity && await options.transport.validateCapacity({ runId: input.runId, model: input.model, prompt, responseSchema: postingAnalysisSchema, maxTokens: 2048, signal: controller.signal })
        if (!capacity || (typeof capacity === 'object' && !capacity.fits)) throw capacityFailure(typeof capacity === 'object' ? capacity.message : undefined)
        options.onProgress?.(input.runId, input.jobId, `Preparing posting-analysis request ${usage.attempts + 1}; local backup and accounting checks must finish before dispatch.`, usage.attempts)
        const timestamp = now()
        options.onAttempt?.(timestamp, input.runId)
        dispatched.push(timestamp); usage.attempts++; attemptCounts.set(input.runId, (attemptCounts.get(input.runId) ?? 0) + 1)
        try {
          const response = await options.transport.generate({ model: input.model, prompt, signal: controller.signal, responseSchema: postingAnalysisSchema, maxTokens: 2048, ...(typeof capacity === 'object' ? { providerOnly: capacity.providers } : {}) })
          options.onAttemptComplete?.(input.runId, true)
          return response
        } catch (error) { options.onAttemptComplete?.(input.runId, false); throw error }
      })
      queue = work.then(() => undefined, () => undefined)
      return work
    }
    const request = async (prompt: string): Promise<string> => {
      for (;;) {
        checkBudget()
        try { return await dispatch(prompt) }
        catch (error) {
          if (timedOut) throw new AnalysisError('TIMEOUT', 'Analysis time budget is exhausted.')
          if (controller.signal.aborted || cancelled.has(input.runId)) throw cancelledError()
          if (error instanceof Error && error.name === 'WorkspaceBackupCapacityError') throw new AnalysisError('BUDGET', error.message)
          if (error instanceof AnalysisError) throw error
          const result = providerError(error, now)
          if (!result.retry) throw new AnalysisError(result.kind, result.kind === 'INVALID_KEY' ? 'OpenRouter rejected the API key. Check the saved key in Settings.' : result.kind === 'OFFLINE' ? 'The network is unavailable. Check the connection, then start a new authorized run.' : 'OpenRouter could not complete the analysis. Check the model ID, model availability or credits in Settings, then try again.')
          checkBudget()
          const backoff = result.delay ?? Math.min(30000, 1000 * (2 ** Math.max(0, usage.attempts - 1))) * (0.75 + random() * 0.5)
          const boundedBackoff = Math.min(backoff, Math.max(0, runBudgets.runTimeLimitMs - (now() - startedAt)))
          options.onProgress?.(input.runId, input.jobId, `Temporary provider failure. Retrying after a bounded ${Math.ceil(boundedBackoff / 1000)} second pause.`, usage.attempts)
          try { await sleep(boundedBackoff, controller.signal) }
          catch (error) {
            if (timedOut) throw new AnalysisError('TIMEOUT', 'Analysis time budget is exhausted.')
            if (controller.signal.aborted || cancelled.has(input.runId)) throw cancelledError()
            throw error
          }
          checkBudget()
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
      if (!parsed || !parsed.success) throw new AnalysisError('MALFORMED', 'The selected OpenRouter model returned invalid JSON twice. Choose a model that follows structured prompts, then try again.')
      if (cancelled.has(input.runId)) throw cancelledError()
      usage.status = 'complete'; return { analysis: parsed.data, usage }
    } catch (error) {
      const failure = timedOut ? new AnalysisError('TIMEOUT', 'Analysis time budget is exhausted.') : error
      usage.status = failure instanceof AnalysisError && failure.code === 'CANCELLED' ? 'cancelled' : 'failed'
      if (failure instanceof AnalysisError) failure.usage = usage
      throw failure
    } finally { clearTimeout(deadlineTimer); usage.finishedAt = now(); if (active.get(input.runId) === controller) active.delete(input.runId) }
  }
  async function generate(input: AnalysisInput & { consentId: string; responseSchema: ZodTypeAny; retryProviderFailures?: boolean; maxTokens?: number; maxResponseChars?: number; runBudgetOverride?: Pick<AnalysisBudgets, 'runLimit' | 'runTimeLimitMs'> }): Promise<{ text: string; attempts: number }> {
    if (!authorizations.has(input.runId) || authorizations.get(input.runId) !== input.consentId) throw new AnalysisError('PROVIDER', 'Generation requires accepted outgoing-data consent.')
    if (cancelled.has(input.runId)) throw cancelledError()
    const startedAt = runStartedAt.get(input.runId) ?? now(); runStartedAt.set(input.runId, startedAt)
    const runBudgets = { ...budgets, ...input.runBudgetOverride }, controller = new AbortController()
    active.set(input.runId, controller)
    let attempts = 0, timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, Math.max(0, runBudgets.runTimeLimitMs - (now() - startedAt)))
    try {
      for (;;) {
        if (controller.signal.aborted || cancelled.has(input.runId)) throw cancelledError()
        if (now() - startedAt >= runBudgets.runTimeLimitMs) throw new AnalysisError('TIMEOUT', 'Analysis time budget is exhausted.')
        if ((attemptCounts.get(input.runId) ?? 0) >= runBudgets.runLimit || getUsage() >= runBudgets.configuredDailyLimit) throw new AnalysisError('BUDGET', 'Configured local analysis budget is exhausted.')
        const work = queue.then(async () => {
          const previous = dispatched.at(-1), spacingWait = previous === undefined ? 0 : Math.max(0, runBudgets.minimumSpacingMs - (now() - previous))
          const recent = dispatched.filter(timestamp => now() - timestamp < runBudgets.rateLimitWindowMs)
          const rateWait = recent.length >= runBudgets.rateLimitAttempts ? Math.max(0, recent[0] + runBudgets.rateLimitWindowMs - now()) : 0
          const wait = Math.max(spacingWait, rateWait)
          if (wait) { options.onProgress?.(input.runId, input.jobId, 'Waiting for shared request pacing before the next attempt.', attempts); await sleep(Math.min(wait, Math.max(0, runBudgets.runTimeLimitMs - (now() - startedAt))), controller.signal) }
          if (controller.signal.aborted) throw cancelledError()
          const capacity = options.transport.validateCapacity && await options.transport.validateCapacity({ runId: input.runId, model: input.model, prompt: input.prompt, responseSchema: input.responseSchema, maxTokens: input.maxTokens ?? 2048, signal: controller.signal })
          if (!capacity || (typeof capacity === 'object' && !capacity.fits)) throw capacityFailure(typeof capacity === 'object' ? capacity.message : undefined)
          options.onProgress?.(input.runId, input.jobId, `Preparing source-linked generation request ${attempts + 1}; local backup and accounting checks must finish before dispatch.`, attempts)
          const timestamp = now(); options.onAttempt?.(timestamp, input.runId); dispatched.push(timestamp); attempts++; attemptCounts.set(input.runId, (attemptCounts.get(input.runId) ?? 0) + 1)
          try {
            const response = await options.transport.generate({ model: input.model, prompt: input.prompt, signal: controller.signal, responseSchema: input.responseSchema, ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}), ...(input.maxResponseChars !== undefined ? { maxResponseChars: input.maxResponseChars } : {}), ...(typeof capacity === 'object' ? { providerOnly: capacity.providers } : {}) })
            options.onAttemptComplete?.(input.runId, true)
            return response
          } catch (error) { options.onAttemptComplete?.(input.runId, false); throw error }
        })
        queue = work.then(() => undefined, () => undefined)
        try { const text = await work; if (cancelled.has(input.runId)) throw cancelledError(); return { text, attempts } }
        catch (error) {
          if (timedOut) throw new AnalysisError('TIMEOUT', 'Analysis time budget is exhausted.')
          if (controller.signal.aborted || cancelled.has(input.runId)) throw cancelledError()
          if (error instanceof Error && error.name === 'WorkspaceBackupCapacityError') throw new AnalysisError('BUDGET', error.message)
          if (error instanceof AnalysisError) throw error
          const failure = providerError(error, now)
          if (!failure.retry || input.retryProviderFailures === false) throw new AnalysisError(failure.kind, failure.kind === 'INVALID_KEY' ? 'OpenRouter rejected the API key. Check the saved key in Settings.' : failure.kind === 'OFFLINE' ? 'The network is unavailable. Check the connection, then start a new authorized run.' : input.retryProviderFailures === false ? 'OpenRouter did not confirm whether the request completed. No automatic retry was sent; a retry could incur another charge.' : 'OpenRouter could not complete generation. Check the model ID, model availability or credits in Settings.')
          const delay = failure.delay ?? Math.min(30000, 1000 * (2 ** Math.max(0, attempts - 1))) * (0.75 + random() * 0.5)
          await sleep(Math.min(delay, Math.max(0, runBudgets.runTimeLimitMs - (now() - startedAt))), controller.signal)
        }
      }
    } finally { clearTimeout(timer); if (active.get(input.runId) === controller) active.delete(input.runId) }
  }
  const isCancelled = (runId: string) => cancelled.has(runId)
  return { authorize, cancel, analyze, generate, getUsage, setBudgets, isCancelled }
}
