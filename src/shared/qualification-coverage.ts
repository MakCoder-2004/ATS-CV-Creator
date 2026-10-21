import { z } from 'zod'

export const qualificationAssessmentEvidenceSchema = z.object({ evidenceId: z.string().uuid(), revision: z.number().int().positive() }).strict()
export const qualificationAssessmentSchema = z.object({
  qualification: z.string(),
  kind: z.enum(['required', 'preferred']),
  status: z.enum(['supported', 'partial', 'unknown', 'not-evidenced']),
  matchedConcepts: z.array(z.string()),
  remainingConcepts: z.array(z.string()),
  evidence: z.array(qualificationAssessmentEvidenceSchema),
  inDraft: z.boolean(),
}).strict()
export type QualificationAssessmentEvidence = { evidenceId: string; revision: number; snapshot: unknown }
export type QualificationAssessment = z.infer<typeof qualificationAssessmentSchema>
