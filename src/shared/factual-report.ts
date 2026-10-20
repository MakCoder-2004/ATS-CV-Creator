import { z } from 'zod'

export const factualFindingSchema = z.object({
  code: z.enum(['schema', 'missing-citation', 'invalid-citation', 'foreign-citation', 'wrong-parent', 'unsupported-skill', 'locked-field-mismatch', 'unsupported-number']),
  message: z.string(),
  itemPath: z.string(),
  evidenceId: z.string().optional(),
  correction: z.string()
}).strict()
export const factualCheckReportSchema = z.object({
  draftId: z.string().uuid(), draftRevision: z.number().int().positive(), evidenceRevisionHash: z.string().min(1),
  passed: z.boolean(), findings: z.array(factualFindingSchema), checkedAt: z.string().datetime(),
  limitation: z.literal('Deterministic checks catch specified structural mismatches; citations do not prove semantic truth or detect every invention.')
}).strict()
export type FactualFinding = z.infer<typeof factualFindingSchema>
export type FactualCheckReport = z.infer<typeof factualCheckReportSchema>
