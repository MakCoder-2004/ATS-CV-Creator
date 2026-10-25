import { z } from 'zod'

/** Only the encrypted device store holds the key. Never include it in a status or settings snapshot. */
export const researchSearchKeyInputSchema = z.string().min(12).max(512).regex(/^[\x21-\x7e]+$/, 'Enter a valid search key.').refine(value => !/[\r\n]/.test(value), 'Enter a valid search key.')
export const researchSearchKeyStatusSchema = z.object({
  configured: z.boolean(),
  storageAvailable: z.boolean(),
  message: z.enum([
    'Search is available only after a key is stored on this device.',
    'Device encryption is unavailable. No search key was saved.',
    'Search key storage failed. The existing key was not replaced.',
    'The local search key was removed. This does not revoke the provider key.'
  ])
}).strict()
export type ResearchSearchKeyStatus = z.infer<typeof researchSearchKeyStatusSchema>
