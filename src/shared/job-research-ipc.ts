import { z } from 'zod'
import { jobResearchRunSchema, reviewedJobResearchSchema } from './job-research'

export const researchTokenSchema = z.string().uuid()
export const researchStartSchema = z.object({ token: researchTokenSchema }).strict()
export const researchStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('loading') }).strict(),
  z.object({ status: z.literal('ready'), run: jobResearchRunSchema }).strict(),
  z.object({ status: z.literal('unavailable'), message: z.string().max(500), settingsAction: z.boolean() }).strict(),
])
export type ResearchState = z.infer<typeof researchStateSchema>
export const researchReviewInputSchema = z.object({ acceptedFindingIds: z.array(z.string().uuid()).min(1).max(48), acknowledgedPartial: z.boolean() }).strict()
export const researchReviewStateSchema = z.object({ reviewed: reviewedJobResearchSchema }).strict()
export const researchCancelSchema = z.object({ ok: z.boolean() }).strict()
