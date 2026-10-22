import { z } from 'zod'

export const postingPreviewSchema = z.object({ title: z.string(), company: z.string().nullable(), description: z.string(), submittedUrl: z.string().url(), finalUrl: z.string().url(), notices: z.array(z.string()) }).strict()
export type PostingPreview = z.infer<typeof postingPreviewSchema>
export const postingFetchStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('fetching') }).strict(),
  z.object({ status: z.literal('ready'), preview: postingPreviewSchema }).strict(),
  z.object({ status: z.literal('incomplete'), preview: postingPreviewSchema }).strict(),
  z.object({ status: z.literal('failed'), message: z.string() }).strict(),
  z.object({ status: z.literal('cancelled') }).strict()
])
export type PostingFetchState = z.infer<typeof postingFetchStateSchema>
