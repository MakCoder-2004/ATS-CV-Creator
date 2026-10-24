import { z } from "zod"
import type { ModelThinkingLevel } from "@earendil-works/pi-ai"

export interface PiModelSelection {
  readonly providerId: string
  readonly modelId: string
  readonly thinkingLevel: ModelThinkingLevel
}

export interface PiModelReference {
  readonly providerId: string
  readonly modelId: string
}

export const PI_THINKING_LEVELS = Object.freeze(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const)

export const piModelSelectionSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  thinkingLevel: z.enum(PI_THINKING_LEVELS),
}).strict()
export const piModelPreferenceInputSchema = z.object({
  reference: z.string().trim().min(3).max(400),
  thinkingLevel: z.enum(PI_THINKING_LEVELS),
}).strict()
export type PiModelPreferenceInput = z.infer<typeof piModelPreferenceInputSchema>

export function parsePiModelReference(reference: string, candidates: readonly PiModelReference[]): PiModelReference {
  const matches = candidates.filter(candidate => `${candidate.providerId}/${candidate.modelId}` === reference)
  if (matches.length === 0) throw new Error("Choose a model listed in Pi Settings.")
  if (matches.length > 1) throw new Error("This model reference is ambiguous. Choose its provider and model explicitly.")
  return Object.freeze({ providerId: matches[0].providerId, modelId: matches[0].modelId })
}

export function freezePiModelSelection(providerId: string, modelId: string, thinkingLevel: ModelThinkingLevel): PiModelSelection {
  if (!PI_THINKING_LEVELS.includes(thinkingLevel as typeof PI_THINKING_LEVELS[number])) {
    throw new Error("Choose a supported Pi thinking level.")
  }
  return Object.freeze({ providerId, modelId, thinkingLevel })
}
