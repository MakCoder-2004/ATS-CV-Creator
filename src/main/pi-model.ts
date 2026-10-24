import { getSupportedThinkingLevels, type Api, type Context, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai"
import type { ModelRuntime } from "@earendil-works/pi-coding-agent"
import type { PiModelSelection } from "../shared/pi-model"

export interface PiTaskRequest {
  readonly selection: PiModelSelection
  readonly prompt: string
  readonly signal: AbortSignal
  readonly maxOutputTokens: number
  readonly onDispatch?: () => void
}

export type PiModelRuntime = Pick<ModelRuntime, "getProviders" | "getPhysicalModel" | "getAvailable" | "getAuth" | "completeSimple">

export function listPiModelReferences(runtime: Pick<ModelRuntime, "getProviders" | "getPhysicalModel">): { providerId: string; modelId: string }[] {
  return runtime.getProviders().flatMap(provider => provider.getModels()
    .filter(model => runtime.getPhysicalModel(provider.id, model.id) !== undefined)
    .map(model => ({ providerId: provider.id, modelId: model.id })))
}

export async function resolvePiModel(runtime: Pick<ModelRuntime, "getPhysicalModel">, selection: PiModelSelection): Promise<Model<Api>> {
  const model = runtime.getPhysicalModel(selection.providerId, selection.modelId)
  if (!model) throw new Error("The selected Pi model is unavailable. Choose another model in Settings.")
  const levels = getSupportedThinkingLevels(model)
  if (!levels.includes(selection.thinkingLevel)) throw new Error("The selected model does not support that thinking level. Choose a supported level in Settings.")
  return model
}

export async function completePiTask(runtime: PiModelRuntime, request: PiTaskRequest): Promise<string> {
  const { selection, prompt, signal, maxOutputTokens, onDispatch } = request
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) throw new Error("The task output limit must be a positive, finite token count.")
  if (!prompt.trim()) throw new Error("The task prompt is empty. Provide the authorized task prompt.")
  if (signal.aborted) throw new Error("The task was cancelled before it started.")

  const model = await resolvePiModel(runtime, selection)
  const available = await runtime.getAvailable(selection.providerId)
  if (!available.some(candidate => candidate.id === selection.modelId && candidate.provider === selection.providerId)) {
    throw new Error("Pi has no currently available authentication for this provider. Sign in or choose another provider in Pi Settings.")
  }
  const auth = await runtime.getAuth(model)
  if (!auth) throw new Error("Pi has no configured authentication for this provider. Sign in through Pi Settings.")
  if (signal.aborted) throw new Error("The task was cancelled before it started.")

  const context: Context = { messages: [{ role: "user", content: prompt, timestamp: Date.now() }], tools: [] }
  onDispatch?.()
  let message
  try {
    message = await runtime.completeSimple(model, context, {
      reasoning: selection.thinkingLevel === "off" ? undefined : selection.thinkingLevel as Exclude<ModelThinkingLevel, "off">,
      signal,
      maxTokens: maxOutputTokens,
      maxRetries: 0,
    })
  } catch {
    if (signal.aborted) throw new Error("The task was cancelled. Retry it when ready.")
    throw new Error("Pi could not complete this request. Check provider access and try again.")
  }

  if (signal.aborted || message.stopReason === "aborted") throw new Error("The task was cancelled. Retry it when ready.")
  if (message.stopReason === "error") throw new Error("The provider could not complete this request. Check provider access and try again.")
  if (message.stopReason === "length" || message.usage.output > maxOutputTokens) throw new Error("The response exceeded the task output limit. Reduce the requested output and retry.")
  if (message.content.some(item => item.type === "toolCall") || message.stopReason === "toolUse") throw new Error("The provider returned a tool call instead of a text response. Choose a model that follows the task instructions.")
  if (message.stopReason !== "stop") throw new Error("The provider returned an incomplete response. Retry the task.")
  const text = message.content.filter(item => item.type === "text").map(item => item.text).join("").trim()
  if (!text) throw new Error("The provider returned no text. Retry the task.")
  if (new TextEncoder().encode(text).byteLength > maxOutputTokens * 64) throw new Error("The response was unexpectedly large. Reduce the requested output and retry.")
  return text
}
