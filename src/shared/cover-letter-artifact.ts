import { z } from 'zod'
import { uuidSchema } from './profile'
import { canonicalCoverLetterSchema } from './cover-letter-document'
import { coverLetterGenerationStatusSchema, coverLetterRevisionSchema } from './cover-letter'

export const coverLetterArtifactActionSchema = z.object({ jobId: uuidSchema, letterId: uuidSchema }).strict()
export type CoverLetterArtifactAction = z.infer<typeof coverLetterArtifactActionSchema>
export const coverLetterExportInputSchema = coverLetterArtifactActionSchema.extend({ format: z.enum(['pdf', 'docx']) }).strict()
export type CoverLetterExportInput = z.infer<typeof coverLetterExportInputSchema>
export const coverLetterFitSchema = z.object({ documentHash: z.string().regex(/^[a-f0-9]{64}$/), actualPages: z.literal(1), overflow: z.literal(false), measuredAt: z.string().datetime() }).strict()
export const coverLetterReadinessSchema = z.object({
  bindingProblem: z.string().nullable(), canonicalProblem: z.string().nullable(),
  findings: z.array(z.object({ code: z.string(), paragraphId: uuidSchema.optional(), message: z.string() }).strict()).max(100),
  paragraphAcknowledgments: z.record(uuidSchema, z.boolean()), currentFit: coverLetterFitSchema.nullable(),
  approved: z.boolean(), canMeasure: z.boolean(), canApprove: z.boolean(), canExport: z.boolean(),
}).strict()
export const coverLetterReadModelSchema = z.object({
  jobId: uuidSchema, letter: coverLetterRevisionSchema.nullable(), canonical: canonicalCoverLetterSchema.nullable(),
  generation: coverLetterGenerationStatusSchema, experienceKinds: z.record(uuidSchema, z.enum(['employment', 'training'])),
  readiness: coverLetterReadinessSchema,
}).strict()
export type CoverLetterReadModel = z.infer<typeof coverLetterReadModelSchema>
export const coverLetterPreviewResultSchema = z.object({ ok: z.boolean(), message: z.string(), documentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), pdfBase64: z.string().min(1).max(28_000_000).optional() }).strict()
export const coverLetterExportResultSchema = z.object({ ok: z.boolean(), cancelled: z.boolean(), message: z.string() }).strict()
export type CoverLetterPreviewResult = z.infer<typeof coverLetterPreviewResultSchema>
export type CoverLetterExportResult = z.infer<typeof coverLetterExportResultSchema>
