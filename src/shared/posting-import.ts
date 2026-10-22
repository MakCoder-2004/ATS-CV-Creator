import { z } from 'zod'
import { postingOptionalDetailsSchema } from './jobs'

export const postingFieldConflictSchema = z.object({ id: z.string(), field: z.enum(['title', 'company', 'location', 'workArrangement', 'employmentType', 'compensation', 'language', 'postedDate', 'deadline', 'applicationUrl']), values: z.array(z.object({ value: z.string(), source: z.string() }).strict()).min(2) }).strict()
export type PostingFieldConflict = z.infer<typeof postingFieldConflictSchema>
export const postingPreviewEditSchema = z.object({ title: z.string().max(200), company: z.string().max(200), description: z.string().max(200_000), optionalDetails: postingOptionalDetailsSchema }).strict()
export type PostingPreviewEdit = z.infer<typeof postingPreviewEditSchema>
export const postingReviewSchema = z.object({ completenessConfirmed: z.boolean(), conflictResolutions: z.record(z.string(), z.string()) }).strict()
export type PostingReview = z.infer<typeof postingReviewSchema>
export const postingPreviewSchema = z.object({ title: z.string(), company: z.string().nullable(), description: z.string(), optionalDetails: postingOptionalDetailsSchema, submittedUrl: z.string().url(), finalUrl: z.string().url(), notices: z.array(z.string()), conflicts: z.array(postingFieldConflictSchema).default([]) }).strict()
export type PostingPreview = z.infer<typeof postingPreviewSchema>
export const postingFetchStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('fetching') }).strict(),
  z.object({ status: z.literal('ready'), preview: postingPreviewSchema }).strict(),
  z.object({ status: z.literal('incomplete'), preview: postingPreviewSchema }).strict(),
  z.object({ status: z.literal('failed'), message: z.string() }).strict(),
  z.object({ status: z.literal('cancelled') }).strict()
])
export type PostingFetchState = z.infer<typeof postingFetchStateSchema>
