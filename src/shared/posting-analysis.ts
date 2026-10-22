import { z } from 'zod'

const words = z.array(z.string().trim().min(1).max(300)).max(100)
export const postingAnalysisSchema = z.object({ required: words, preferred: words, tools: words, responsibilities: words, keywords: words }).strict()
// Local identifier restoration can expand provider-limited terms; it must not invalidate a successful analysis.
const displayWords = z.array(z.string().trim().min(1).max(10000)).max(100)
export const displayPostingAnalysisSchema = postingAnalysisSchema.extend({ required: displayWords, preferred: displayWords, tools: displayWords, responsibilities: displayWords, keywords: displayWords })
export const analysisStatusSchema = z.enum(['queued', 'running', 'complete', 'stale', 'failed', 'cancelled'])
export const generationRecoverySchema = z.object({ jobId: z.string().uuid(), runId: z.string().uuid(), status: z.enum(['interrupted', 'uncertain', 'paused']), attempts: z.number().int().nonnegative(), uncertainAttempts: z.number().int().nonnegative(), progress: z.string(), canResume: z.boolean() }).strict()
export const recoveryChoiceSchema = z.enum(['resume', 'retry-uncertain'])
export type GenerationRecovery = z.infer<typeof generationRecoverySchema>
export type RecoveryChoice = z.infer<typeof recoveryChoiceSchema>
export const generationStepSchema = z.enum(['parse-posting', 'score-evidence', 'select-content', 'tailor-paragraphs', 'verify-claims', 'check-document'])
export type GenerationStep = z.infer<typeof generationStepSchema>
export const analysisResultSchema = z.object({ generationStep: generationStepSchema.optional(), completedSteps: z.array(generationStepSchema).optional(), jobId: z.string().uuid(), runId: z.string().uuid().optional(), targetPostingUpdatedAt: z.string().datetime().optional(), status: analysisStatusSchema, analysis: postingAnalysisSchema.nullable(), displayAnalysis: displayPostingAnalysisSchema.optional(), progress: z.string(), attempts: z.number().int().nonnegative(), error: z.string().optional(), cacheHit: z.boolean() }).strict()
export const analysisBudgetsSchema = z.object({
  minimumSpacingMs: z.number().int().min(0).max(60000),
  rateLimitAttempts: z.number().int().min(1).max(100),
  rateLimitWindowMs: z.number().int().min(1000).max(86400000),
  configuredDailyLimit: z.number().int().min(1).max(10000),
  runLimit: z.number().int().min(1).max(12),
  runTimeLimitMs: z.number().int().min(1000).max(300000)
}).strict()
export type AnalysisBudgets = z.infer<typeof analysisBudgetsSchema>
export const defaultAnalysisBudgets: AnalysisBudgets = { minimumSpacingMs: 5000, rateLimitAttempts: 12, rateLimitWindowMs: 300000, configuredDailyLimit: 50, runLimit: 12, runTimeLimitMs: 300000 }
export function analysisBudgetValues(value: AnalysisBudgets): AnalysisBudgets {
  return analysisBudgetsSchema.parse({ minimumSpacingMs: value.minimumSpacingMs, rateLimitAttempts: value.rateLimitAttempts, rateLimitWindowMs: value.rateLimitWindowMs, configuredDailyLimit: value.configuredDailyLimit, runLimit: value.runLimit, runTimeLimitMs: value.runTimeLimitMs })
}
export const analysisUsageSchema = analysisBudgetsSchema.extend({ pacificDay: z.string(), attempts: z.number().int().nonnegative(), warning: z.string() }).strict()
export const analysisStartInputSchema = z.object({ consentToken: z.string().uuid() }).strict()
export const analysisIdSchema = z.string().uuid()
export type PostingAnalysis = z.infer<typeof postingAnalysisSchema>
export type AnalysisResult = z.infer<typeof analysisResultSchema>
export type AnalysisUsage = z.infer<typeof analysisUsageSchema>
