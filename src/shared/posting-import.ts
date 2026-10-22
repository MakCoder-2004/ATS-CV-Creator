import { z } from 'zod'

export const postingPreviewSchema = z.object({ title: z.string(), company: z.string().nullable(), description: z.string(), submittedUrl: z.string().url(), finalUrl: z.string().url(), notices: z.array(z.string()) }).strict()
export type PostingPreview = z.infer<typeof postingPreviewSchema>
