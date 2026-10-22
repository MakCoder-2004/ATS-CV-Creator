import { z } from 'zod'
import { draftCitationSchema } from './draft'

export const regenerationTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('section'), section: z.enum(['education', 'experience', 'projects', 'skills', 'certificates']) }).strict(),
  z.object({ kind: z.literal('paragraph'), section: z.enum(['education', 'experience', 'projects', 'skills', 'certificates']), index: z.number().int().nonnegative() }).strict()
])
export type RegenerationTarget = z.infer<typeof regenerationTargetSchema>
export const regenerationProposalSchema = z.object({
  id: z.string().uuid(), jobId: z.string().uuid(), jobRevision: z.string(), baseDraftId: z.string().uuid(), baseDraftRevision: z.number().int().positive(),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/), target: regenerationTargetSchema,
  before: z.array(z.union([z.string(), z.object({ text: z.string(), citations: z.array(draftCitationSchema), rationale: z.string() }).strict()])).optional(),
  proposed: z.array(z.object({ text: z.string().trim().min(1).max(3000), citations: z.array(draftCitationSchema).min(1), rationale: z.string().trim().min(1).max(500) }).strict()).min(1),
  status: z.enum(['pending', 'accepted', 'rejected', 'stale']), attempts: z.number().int().nonnegative(), progress: z.string(), postingScopeNote: z.string().max(500).optional(), createdAt: z.string().datetime()
}).strict()
export type RegenerationProposal = z.infer<typeof regenerationProposalSchema>
export const regenerationResultSchema = z.object({ ok: z.boolean(), message: z.string(), proposal: regenerationProposalSchema.optional() }).strict()
