import type { ZodTypeAny } from "zod"
import { AnalysisError, type AnalysisInput, type AnalysisUsage } from "./posting-analysis"
import { completePiTask, type PiModelRuntime } from "./pi-model"
import type { PiModelSelection } from "../shared/pi-model"
import { postingAnalysisSchema, type PostingAnalysis } from "../shared/posting-analysis"

const ANALYSIS_MAX_TOKENS = 4096
const ANALYSIS_MAX_BYTES = 500_000
const GENERATION_MAX_TOKENS = 8192
const GENERATION_TOKEN_CEILING = 16384
const GENERATION_MAX_BYTES = 500_000

export interface PiWorkbenchDispatcherHooks {
  onAttempt?: (timestamp: number, runId: string) => void
  onAttemptComplete?: (runId: string, succeeded: boolean) => void
  onProgress?: (runId: string, jobId: string, progress: string, attempts: number) => void
}

export interface PiWorkbenchDispatcherOptions extends PiWorkbenchDispatcherHooks {
  runtime: PiModelRuntime | Promise<PiModelRuntime | null>
  selectionForRun: (runId: string) => PiModelSelection | null
}

type PiWorkbenchBaseInput = Omit<AnalysisInput, "model"> & { consentId: string; model?: unknown }
export type PiWorkbenchAnalysisInput = PiWorkbenchBaseInput
export type PiWorkbenchGenerationInput = PiWorkbenchBaseInput & {
  responseSchema: ZodTypeAny
  model?: unknown
  retryProviderFailures?: boolean
  maxTokens?: number
  maxResponseChars?: number
  runBudgetOverride?: unknown
}

export function createPiWorkbenchDispatcher(options: PiWorkbenchDispatcherOptions) {
  const runtimePromise = Promise.resolve(options.runtime)
  const authorizations = new Map<string, string>()
  const cancelled = new Set<string>()
  const active = new Map<string, AbortController>()
  let queue: Promise<void> = Promise.resolve()

  const authorize = (runId: string, consentId: string) => {
    if (runId && consentId) authorizations.set(runId, consentId)
  }
  const cancel = (runId: string) => {
    cancelled.add(runId)
    active.get(runId)?.abort()
  }
  const isCancelled = (runId: string) => cancelled.has(runId)

  async function execute<T>(input: PiWorkbenchAnalysisInput, schema: ZodTypeAny, maxTokens: number, maxBytes: number): Promise<{ value: T; attempts: number }> {
    const { runId, consentId, jobId, prompt } = input
    if (!runId || !jobId || !prompt.trim() || !consentId || authorizations.get(runId) !== consentId) {
      throw new AnalysisError("PROVIDER", "This request requires valid accepted outgoing-data consent.")
    }
    if (cancelled.has(runId)) throw new AnalysisError("CANCELLED", "Analysis cancelled.")
    if (active.has(runId)) throw new AnalysisError("PROVIDER", "A request with this run identity is already active.")

    const controller = new AbortController()
    active.set(runId, controller)
    let attempts = 0
    let responseReceived = false
    const check = () => {
      if (cancelled.has(runId) || controller.signal.aborted) throw new AnalysisError("CANCELLED", "Analysis cancelled.")
      if (authorizations.get(runId) !== consentId) throw new AnalysisError("PROVIDER", "This request requires current accepted outgoing-data consent.")
    }
    const work = queue.then(async () => {
      check()
      const selection = options.selectionForRun(runId)
      if (!selection) throw new AnalysisError("PROVIDER", "No Pi model selection was authorized for this run.")
      check()
      const runtime = await runtimePromise
      if (!runtime) throw new AnalysisError("PROVIDER", "Pi model access is unavailable. Check Pi setup and retry.")
      const text = await completePiTask(runtime, {
        selection,
        prompt,
        signal: controller.signal,
        maxOutputTokens: maxTokens,
        onDispatch: () => {
          options.onAttempt?.(Date.now(), runId)
          attempts = 1
        },
        onResponse: () => {
          responseReceived = true
          options.onAttemptComplete?.(runId, true)
        },
      })
      check()
      if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("Response exceeded the task byte limit.")
      let decoded: unknown
      try { decoded = JSON.parse(text) } catch { throw new Error("Response was not valid structured data.") }
      const parsed = schema.safeParse(decoded)
      if (!parsed.success) throw new Error("Response did not match the required task format.")
      check()
      return { value: parsed.data as T, attempts }
    })
    queue = work.then(() => undefined, () => undefined)
    try {
      return await work
    } catch (error) {
      if (attempts && !responseReceived) options.onAttemptComplete?.(runId, false)
      const failure = cancelled.has(runId) || controller.signal.aborted
        ? new AnalysisError("CANCELLED", "Analysis cancelled.")
        : error instanceof AnalysisError ? error : new AnalysisError("PROVIDER", error instanceof Error && /byte limit|output limit/.test(error.message)
          ? "The response exceeded the task output limit."
          : error instanceof Error && /structured data|required task format/.test(error.message)
            ? "The provider returned an invalid response. Start a new authorized run to retry."
            : attempts
              ? "Pi could not complete the request. Start a new authorized run to retry."
              : "The selected Pi model or authentication is unavailable. Sign in with Pi outside CV Tailor and check Settings.")
      failure.usage = { runId, jobId, attempts, status: failure.code === "CANCELLED" ? "cancelled" : "failed", startedAt: Date.now(), finishedAt: Date.now() }
      throw failure
    } finally {
      if (active.get(runId) === controller) active.delete(runId)
    }
  }

  async function analyze(input: PiWorkbenchAnalysisInput): Promise<{ analysis: PostingAnalysis; usage: AnalysisUsage }> {
    const startedAt = Date.now()
    let usage: AnalysisUsage = { runId: input.runId, jobId: input.jobId, attempts: 0, status: "failed", startedAt, finishedAt: startedAt }
    options.onProgress?.(input.runId, input.jobId, "Preparing the authorized posting-analysis request.", 0)
    try {
      const result = await execute<PostingAnalysis>(input, postingAnalysisSchema, ANALYSIS_MAX_TOKENS, ANALYSIS_MAX_BYTES)
      usage = { ...usage, attempts: result.attempts, status: "complete", finishedAt: Date.now() }
      return { analysis: result.value, usage }
    } catch (error) {
      const attempts = error instanceof AnalysisError ? error.usage?.attempts ?? 0 : 0
      usage = { ...usage, attempts, status: error instanceof AnalysisError && error.code === "CANCELLED" ? "cancelled" : "failed", finishedAt: Date.now() }
      if (error instanceof AnalysisError) error.usage = usage
      throw error
    }
  }

  async function generate(input: PiWorkbenchGenerationInput): Promise<{ text: string; attempts: number }> {
    const requestedTokens = input.maxTokens ?? GENERATION_MAX_TOKENS
    const requestedBytes = input.maxResponseChars ?? GENERATION_MAX_BYTES
    if (!Number.isSafeInteger(requestedTokens) || requestedTokens < 1 || !Number.isSafeInteger(requestedBytes) || requestedBytes < 1) {
      throw new AnalysisError("PROVIDER", "The request output limits are invalid.")
    }
    const maxTokens = Math.min(requestedTokens, GENERATION_TOKEN_CEILING)
    const maxBytes = Math.min(requestedBytes, GENERATION_MAX_BYTES)
    const result = await execute<unknown>(input, input.responseSchema, maxTokens, maxBytes)
    const text = JSON.stringify(result.value)
    if (typeof text !== "string") throw new AnalysisError("PROVIDER", "The provider returned a value that cannot be serialized as JSON.")
    return { text, attempts: result.attempts }
  }

  const getUsage = () => 0
  const setBudgets = () => { throw new AnalysisError("PROVIDER", "Local model-usage limits are no longer configurable.") }
  return { authorize, cancel, isCancelled, analyze, generate, getUsage, setBudgets }
}
