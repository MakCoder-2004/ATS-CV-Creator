import { z } from 'zod'

const words = z.array(z.string().trim().min(1).max(300)).max(100)
export const postingAnalysisSchema = z.object({ required: words, preferred: words, tools: words, responsibilities: words, keywords: words }).strict()
export const analysisStatusSchema = z.enum(['queued', 'running', 'complete', 'failed', 'cancelled'])
export const analysisResultSchema = z.object({ jobId: z.string().uuid(), status: analysisStatusSchema, analysis: postingAnalysisSchema.nullable(), progress: z.string(), attempts: z.number().int().nonnegative(), error: z.string().optional(), cacheHit: z.boolean() }).strict()
export const analysisUsageSchema = z.object({ pacificDay: z.string(), attempts: z.number().int().nonnegative(), configuredDailyLimit: z.number().int().positive(), runLimit: z.number().int().positive(), minimumSpacingMs: z.number().int().nonnegative(), warning: z.string() }).strict()
export const analysisStartInputSchema = z.object({ consentToken: z.string().uuid() }).strict()
export const analysisIdSchema = z.string().uuid()
export type PostingAnalysis = z.infer<typeof postingAnalysisSchema>
export type AnalysisResult = z.infer<typeof analysisResultSchema>
export type AnalysisUsage = z.infer<typeof analysisUsageSchema>
