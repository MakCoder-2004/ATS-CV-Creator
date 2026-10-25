import { z } from 'zod'
import { volatileAnalysisPreviewSchema, volatileAnalysisProgressSchema } from './research-volatile-analysis'

export const researchAnalysisTokenSchema = z.string().uuid()
export const researchAnalysisConsentSchema = z.boolean()
export const researchAnalysisPreviewReplySchema = volatileAnalysisPreviewSchema
export const researchAnalysisProgressReplySchema = volatileAnalysisProgressSchema
export const researchAnalysisDiscardReplySchema = z.object({ ok: z.literal(true) }).strict()
