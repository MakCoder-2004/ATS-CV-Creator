import { z } from 'zod'

export const geminiModels = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'] as const
export const geminiModelSchema = z.enum(geminiModels)
export type GeminiModel = z.infer<typeof geminiModelSchema>

export const credentialStatusSchema = z.object({
  configured: z.boolean(),
  secureStorageAvailable: z.boolean()
}).strict()
export type CredentialStatus = z.infer<typeof credentialStatusSchema>

export const geminiSettingsSchema = z.object({
  model: geminiModelSchema,
  faithfulnessCheck: z.boolean(),
  credential: credentialStatusSchema
}).strict()
export type GeminiSettings = z.infer<typeof geminiSettingsSchema>

export const geminiKeyInputSchema = z.string().trim().min(1, 'Enter an API key.').max(4096, 'The API key is too long.')

/** Provider-specific configuration is centralized here; callers still own transport/secret access. */
export function createGeminiModelConfig(model: GeminiModel) {
  return { provider: 'google', model: geminiModelSchema.parse(model) } as const
}
