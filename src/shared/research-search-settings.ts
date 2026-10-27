import { z } from 'zod'

/** Legacy encrypted-key status never includes plaintext and grants no search capability. */
export const researchSearchKeyStatusSchema = z.object({
  configured: z.boolean(),
  storageAvailable: z.boolean(),
  message: z.enum([
    'Legacy encrypted search key found on this device.',
    'No legacy encrypted search key is saved on this device.',
    'A legacy encrypted key is stored but device encryption is unavailable. You can still remove it locally.',
    'Legacy search-key storage could not be checked. Any existing key was left unchanged.'
  ])
}).strict()
export type ResearchSearchKeyStatus = z.infer<typeof researchSearchKeyStatusSchema>
