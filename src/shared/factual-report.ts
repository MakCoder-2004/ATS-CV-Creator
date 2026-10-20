import { z } from 'zod'

export const factualFindingSchema = z.object({
  code: z.enum(['schema', 'generation-failure', 'missing-citation', 'invalid-citation', 'foreign-citation', 'wrong-parent', 'unsupported-skill', 'locked-field-mismatch', 'unsupported-number', 'semantic-unsupported']),
  message: z.string(),
  itemPath: z.string(),
  evidenceId: z.string().optional(),
  originDraftId: z.string().uuid().optional(),
  originDraftRevision: z.number().int().positive().optional(),
  originEvidenceRevisionHash: z.string().min(1).optional(),
  historical: z.boolean().optional(),
  correction: z.string()
}).strict()
export const factualCheckReportSchema = z.object({
  draftId: z.string().uuid(), draftRevision: z.number().int().positive(), evidenceRevisionHash: z.string().min(1),
  passed: z.boolean(), findings: z.array(factualFindingSchema), checkedAt: z.string().datetime(),
  limitation: z.literal('Automated checks and optional LLM comparison are second opinions, not proof of semantic truth; human review remains required.')
}).strict()
export type FactualFinding = z.infer<typeof factualFindingSchema>
export type FactualCheckReport = z.infer<typeof factualCheckReportSchema>
