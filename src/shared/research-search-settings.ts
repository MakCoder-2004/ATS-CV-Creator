import { z } from 'zod'

/** Only the encrypted device store holds the key. Never include it in a status or settings snapshot. */
export const researchSearchKeyInputSchema = z.string().min(12).max(512).regex(/^[\x21-\x7e]+$/, 'Enter a valid search key.').refine(value => !/[\r\n]/.test(value), 'Enter a valid search key.')
export const researchSearchKeyStatusSchema = z.object({
  configured: z.boolean(),
  storageAvailable: z.boolean(),
  message: z.enum([
    'Search is available only after a key is stored on this device.',
    'Device encryption is unavailable. No search key was saved.',
    'A search key is stored but device encryption is unavailable; it cannot be used until encryption returns. You can remove it locally.',
    'Search key storage failed. The existing key was not replaced.',
    'The local search key was removed. This does not revoke the provider key.'
  ])
}).strict()
export type ResearchSearchKeyStatus = z.infer<typeof researchSearchKeyStatusSchema>

/** These shapes are for explicit trusted actions only, never Settings status or backups. */
export const researchSearchKeyRevealSchema = z.object({ key: researchSearchKeyInputSchema }).strict()
export const researchSearchKeyCopySchema = z.object({
  ok: z.literal(true),
  message: z.literal('Search key copied. Clipboard contents remain outside CV Tailor until replaced.')
}).strict()
export type ResearchSearchKeyReveal = z.infer<typeof researchSearchKeyRevealSchema>
export type ResearchSearchKeyCopy = z.infer<typeof researchSearchKeyCopySchema>
