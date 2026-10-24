import type { ZodTypeAny } from "zod"
import { completePiTask, type PiModelRuntime } from "./pi-model"
import type { PiModelSelection } from "../shared/pi-model"

export interface PiDispatchInput {
  readonly runId: string
  readonly consentId: string
  readonly jobId: string
  readonly selection: PiModelSelection
  readonly prompt: string
  readonly responseSchema: ZodTypeAny
  readonly maxOutputTokens: number
  readonly maxResponseBytes: number
  readonly signal?: AbortSignal
}

export interface PiDispatchHooks {
  onAttempt?: (timestamp: number, runId: string) => void
  onAttemptComplete?: (runId: string, succeeded: boolean) => void
}

export class PiDispatchError extends Error {
  constructor(message: string, readonly attempts: number) { super(message); this.name = "PiDispatchError" }
}

export function createPiDispatcher(runtime: PiModelRuntime, hooks: PiDispatchHooks = {}) {
  const authorizations = new Map<string, string>()
  const active = new Set<string>()
  const controllers = new Map<string, AbortController>()
  const cancelled = new Set<string>()
  let queue: Promise<void> = Promise.resolve()

  const authorize = (runId: string, consentId: string) => {
    if (!runId || !consentId) throw new Error("Run and consent identifiers are required.")
    authorizations.set(runId, consentId)
  }
  const cancel = (runId: string) => { cancelled.add(runId); controllers.get(runId)?.abort() }

  async function dispatch(input: PiDispatchInput): Promise<{ response: unknown; attempts: number }> {
    const { runId, consentId } = input
    if (!runId || !consentId || authorizations.get(runId) !== consentId) throw new PiDispatchError("This request requires current accepted outgoing-data consent.", 0)
    if (active.has(runId)) throw new PiDispatchError("A request with this run identity is already active.", 0)
    if (cancelled.has(runId) || input.signal?.aborted) throw new PiDispatchError("The request was cancelled.", 0)
    if (!input.jobId || !input.prompt.trim()) throw new PiDispatchError("The authorized request is invalid.", 0)
    if (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || !Number.isSafeInteger(input.maxResponseBytes) || input.maxResponseBytes < 1) throw new PiDispatchError("The request output limits are invalid.", 0)
    active.add(runId)
    let attempts = 0
    let responseReceived = false
    let removeAbort = () => {}
    const abortController = new AbortController()
    controllers.set(runId, abortController)
    const abort = () => abortController.abort()
    if (input.signal) {
      input.signal.addEventListener("abort", abort, { once: true })
      removeAbort = () => input.signal?.removeEventListener("abort", abort)
    }
    const checkCancelled = () => {
      if (cancelled.has(runId) || abortController.signal.aborted) throw new PiDispatchError("The request was cancelled.", attempts)
    }
    const work = queue.then(async () => {
      checkCancelled()
      if (authorizations.get(runId) !== consentId) throw new PiDispatchError("This request requires current accepted outgoing-data consent.", attempts)
      checkCancelled()
      try {
        const text = await completePiTask(runtime, {
          selection: input.selection, prompt: input.prompt, signal: abortController.signal,
          maxOutputTokens: input.maxOutputTokens, responseSchema: input.responseSchema,
          onDispatch: () => { hooks.onAttempt?.(Date.now(), runId); attempts = 1 },
          onResponse: () => { responseReceived = true; hooks.onAttemptComplete?.(runId, true) },
        })
        checkCancelled()
        if (new TextEncoder().encode(text).byteLength > input.maxResponseBytes) throw new Error("Response exceeded the task byte limit.")
        let decoded: unknown
        try { decoded = JSON.parse(text) } catch { throw new Error("Response was not valid structured data.") }
        const parsed = input.responseSchema.safeParse(decoded)
        if (!parsed.success) throw new Error("Response did not match the required task format.")
        checkCancelled()
        return { response: parsed.data, attempts }
      } catch (error) {
        if (attempts && !responseReceived) hooks.onAttemptComplete?.(runId, false)
        if (error instanceof PiDispatchError) throw error
        if (cancelled.has(runId) || abortController.signal.aborted) throw new PiDispatchError("The request was cancelled.", attempts)
        if (!attempts) throw new PiDispatchError("The selected Pi model or authentication is unavailable. Sign in with Pi outside CV Tailor and check Settings.", 0)
        throw new PiDispatchError(error instanceof Error && /byte limit/.test(error.message) ? "The response exceeded the task output limit." : error instanceof Error && /output limit/.test(error.message) ? "The response exceeded the task output limit." : error instanceof Error && /structured data|required task format/.test(error.message) ? "The provider returned an invalid response. Start a new authorized run to retry." : "Pi could not complete the request. Start a new authorized run to retry.", attempts)
      }
    })
    queue = work.then(() => undefined, () => undefined)
    try { return await work }
    catch (error) { if (error instanceof PiDispatchError) throw error; throw new PiDispatchError("Pi could not complete the request. Start a new authorized run to retry.", attempts) }
    finally { removeAbort(); active.delete(runId); if (controllers.get(runId) === abortController) controllers.delete(runId) }
  }

  return { authorize, cancel, dispatch }
}
