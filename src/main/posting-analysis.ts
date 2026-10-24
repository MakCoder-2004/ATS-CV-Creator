import type { OpenRouterModel } from '../shared/openrouter-settings'
import { defaultAnalysisBudgets, postingAnalysisSchema, type AnalysisBudgets, type PostingAnalysis } from '../shared/posting-analysis'
import type { ZodTypeAny } from 'zod'
export { postingAnalysisSchema }
export type { PostingAnalysis }

const MAX_RESPONSE_CHARS = 500_000

export interface AnalysisTransport {
  generate(input: { model: OpenRouterModel; prompt: string; signal: AbortSignal; responseSchema: ZodTypeAny; maxTokens?: number; maxResponseChars?: number }): Promise<string>
}
export interface AnalysisInput { runId: string; jobId: string; prompt: string; model: OpenRouterModel }
export interface AnalysisUsage { runId: string; jobId: string; attempts: number; status: 'complete' | 'failed' | 'cancelled'; startedAt: number; finishedAt: number }
export class AnalysisError extends Error {
  usage?: AnalysisUsage
  constructor(readonly code: 'BUDGET' | 'TIMEOUT' | 'CANCELLED' | 'INVALID_KEY' | 'OFFLINE' | 'MALFORMED' | 'PROVIDER', message: string) { super(message); this.name = 'AnalysisError' }
}
type Options = {
  transport: AnalysisTransport
  now?: () => number
  observedAttempts?: number[]
  onAttempt?: (timestamp: number, runId: string) => void
  onAttemptComplete?: (runId: string, succeeded: boolean) => void
  onProgress?: (runId: string, jobId: string, progress: string, attempts: number) => void
  [legacyOption: string]: unknown
}
type Request = AnalysisInput & { consentId: string }

const cancelledError = () => new AnalysisError('CANCELLED', 'Analysis cancelled.')
const safeFailure = (error: unknown): AnalysisError => {
  if (error instanceof AnalysisError) return error
  const status = Number((error as { status?: number } | null)?.status)
  const code = String((error as { code?: string } | null)?.code ?? '')
  if (status === 401 || status === 403 || /API_KEY/i.test(code)) return new AnalysisError('INVALID_KEY', 'The provider rejected authentication. Check model access in Settings.')
  if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'].includes(code)) return new AnalysisError('OFFLINE', 'The network is unavailable. Start a new authorized request after checking the connection.')
  return new AnalysisError('PROVIDER', 'The provider could not complete the request. Start a new authorized request if you choose to retry.')
}

export function createAnalysisDispatcher(options: Options) {
  const now = options.now ?? Date.now
  const authorizations = new Map<string, string>()
  const cancelled = new Set<string>()
  const active = new Map<string, AbortController>()
  const dispatched = [...(options.observedAttempts ?? [])]
  let queue: Promise<void> = Promise.resolve()

  const authorize = (runId: string, consentId: string) => { if (runId && consentId) authorizations.set(runId, consentId) }
  const cancel = (runId: string) => { cancelled.add(runId); active.get(runId)?.abort() }
  const isCancelled = (runId: string) => cancelled.has(runId)
  const getUsage = () => dispatched.length
  const setBudgets = (_value: AnalysisBudgets) => {}

  async function execute(input: Request, schema: ZodTypeAny, prompt: string, maxTokens?: number, maxResponseChars = MAX_RESPONSE_CHARS): Promise<{ text: string; attempts: number }> {
    if (!input.runId || !input.jobId || !input.prompt.trim() || !input.consentId || authorizations.get(input.runId) !== input.consentId) {
      throw new AnalysisError('PROVIDER', 'This request requires valid accepted outgoing-data consent.')
    }
    if (!Number.isSafeInteger(maxResponseChars) || maxResponseChars < 1) throw new AnalysisError('PROVIDER', 'The request output limit is invalid.')
    if (cancelled.has(input.runId)) throw cancelledError()
    if (active.has(input.runId)) throw new AnalysisError('PROVIDER', 'A request with this run identity is already active.')

    const controller = new AbortController()
    active.set(input.runId, controller)
    let attempts = 0
    const check = () => {
      if (cancelled.has(input.runId) || controller.signal.aborted) throw cancelledError()
      if (authorizations.get(input.runId) !== input.consentId) throw new AnalysisError('PROVIDER', 'This request requires current accepted outgoing-data consent.')
    }
    const work = queue.then(async () => {
      check()
      options.onProgress?.(input.runId, input.jobId, 'Preparing the authorized provider request.', attempts)
      const timestamp = now()
      options.onAttempt?.(timestamp, input.runId)
      dispatched.push(timestamp)
      attempts++
      try {
        const text = await options.transport.generate({ model: input.model, prompt, signal: controller.signal, responseSchema: schema, ...(maxTokens ? { maxTokens } : {}), maxResponseChars })
        options.onAttemptComplete?.(input.runId, true)
        check()
        if (text.length > maxResponseChars) throw new AnalysisError('PROVIDER', 'The provider response exceeded the task output limit.')
        let decoded: unknown
        try { decoded = JSON.parse(text) } catch { throw new AnalysisError('MALFORMED', 'The provider returned invalid structured data.') }
        const parsed = schema.safeParse(decoded)
        if (!parsed.success) throw new AnalysisError('MALFORMED', 'The provider response did not match the required format.')
        return JSON.stringify(parsed.data)
      } catch (error) {
        if (!(error instanceof AnalysisError)) options.onAttemptComplete?.(input.runId, false)
        throw error
      }
    })
    queue = work.then(() => undefined, () => undefined)
    try { return { text: await work, attempts } }
    catch (error) {
      const failure = cancelled.has(input.runId) || controller.signal.aborted ? cancelledError() : safeFailure(error)
      failure.usage = { runId: input.runId, jobId: input.jobId, attempts, status: failure.code === 'CANCELLED' ? 'cancelled' : 'failed', startedAt: now(), finishedAt: now() }
      throw failure
    } finally { if (active.get(input.runId) === controller) active.delete(input.runId) }
  }

  async function analyze(input: Request): Promise<{ analysis: PostingAnalysis; usage: AnalysisUsage }> {
    const startedAt = now()
    const run = async (prompt: string) => execute(input, postingAnalysisSchema, prompt, 2048)
    let attempts = 0
    try {
      let result: { text: string; attempts: number }
      try { result = await run(input.prompt); attempts += result.attempts }
      catch (error) {
        if (!(error instanceof AnalysisError) || error.code !== 'MALFORMED' || error.usage?.attempts !== 1) throw error
        attempts++
        result = await run(`${input.prompt}\nReturn only valid JSON matching the required posting-analysis schema. Do not infer absent qualifications.`)
        attempts += result.attempts
      }
      const analysis = postingAnalysisSchema.parse(JSON.parse(result.text))
      return { analysis, usage: { runId: input.runId, jobId: input.jobId, attempts, status: 'complete', startedAt, finishedAt: now() } }
    } catch (error) {
      if (error instanceof AnalysisError) {
        error.usage = { runId: input.runId, jobId: input.jobId, attempts: attempts + (error.usage?.attempts ?? 0), status: error.code === 'CANCELLED' ? 'cancelled' : 'failed', startedAt, finishedAt: now() }
      }
      throw error
    }
  }

  async function generate(input: Request & { responseSchema: ZodTypeAny; retryProviderFailures?: boolean; maxTokens?: number; maxResponseChars?: number; runBudgetOverride?: Pick<AnalysisBudgets, 'runLimit' | 'runTimeLimitMs'> }): Promise<{ text: string; attempts: number }> {
    return execute(input, input.responseSchema, input.prompt, input.maxTokens, input.maxResponseChars)
  }
  return { authorize, cancel, isCancelled, analyze, generate, getUsage, setBudgets }
}
