import { z } from 'zod'
import { postingFieldConflictSchema, postingOptionalDetailsSchema, type PostingFieldConflict } from './jobs'

export { postingFieldConflictSchema }
export type { PostingFieldConflict }
export const postingPreviewEditSchema = z.object({ title: z.string().max(200), company: z.string().max(200), description: z.string().max(200_000), optionalDetails: postingOptionalDetailsSchema }).strict()
export type PostingPreviewEdit = z.infer<typeof postingPreviewEditSchema>
export const postingReviewSchema = z.object({ completenessConfirmed: z.boolean(), conflictResolutions: z.record(z.string(), z.string()) }).strict()
export type PostingReview = z.infer<typeof postingReviewSchema>
export const postingPreviewSchema = z.object({ title: z.string(), company: z.string().nullable(), description: z.string(), optionalDetails: postingOptionalDetailsSchema, submittedUrl: z.string().url(), finalUrl: z.string().url(), notices: z.array(z.string()), conflicts: z.array(postingFieldConflictSchema).default([]), extractionMethod: z.enum(['lever-json-v1', 'lever-html-jsonld-v1', 'lever-html-static-v1']) }).strict()
export type PostingPreview = z.infer<typeof postingPreviewSchema>
export const postingFetchStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('fetching') }).strict(),
  z.object({ status: z.literal('ready'), preview: postingPreviewSchema }).strict(),
  z.object({ status: z.literal('incomplete'), preview: postingPreviewSchema }).strict(),
  z.object({ status: z.literal('failed'), message: z.string() }).strict(),
  z.object({ status: z.literal('cancelled') }).strict()
])
export type PostingFetchState = z.infer<typeof postingFetchStateSchema>
