import { z } from 'zod'
import { uuidSchema } from './profile'
import { draftGenerationSchema } from './draft'

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const coverLetterPurposeSchema = z.enum(['cv', 'cv+cover-letter', 'cover-letter-only'])
export type CoverLetterPurpose = z.infer<typeof coverLetterPurposeSchema>

export const coverLetterCitationSchema = z.object({ ordinal: z.number().int().positive() }).strict()
export const coverLetterSourceSchema = z.object({
  ordinal: z.number().int().positive(),
  evidenceId: uuidSchema,
  revision: z.number().int().positive(),
  parentId: uuidSchema.optional(),
  category: z.enum(['education', 'experience', 'project', 'skill']),
  heading: z.string().trim().min(1).max(300),
  passage: z.string().trim().min(1).max(5000),
}).strict()
export type CoverLetterSource = z.infer<typeof coverLetterSourceSchema>

export const coverLetterParagraphSchema = z.object({
  id: uuidSchema,
  text: z.string().trim().min(1).max(3000),
  citations: z.array(coverLetterCitationSchema).min(1).max(20),
}).strict()
export type CoverLetterParagraph = z.infer<typeof coverLetterParagraphSchema>

export const coverLetterRevisionSchema = z.object({
  id: uuidSchema,
  jobId: uuidSchema,
  parentRunId: uuidSchema,
  operationId: uuidSchema,
  cvRevisionId: uuidSchema,
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  bindings: z.object({
    postingUpdatedAt: z.string().datetime(),
    scopeHash: digestSchema,
    modelHash: digestSchema,
    sources: z.array(coverLetterSourceSchema).min(1).max(500),
  }).strict(),
  date: z.string().trim().min(1).max(80),
  subject: z.string().trim().min(1).max(300),
  recipient: z.string().trim().min(1).max(200).optional(),
  paragraphs: z.array(coverLetterParagraphSchema).min(1).max(8),
  findings: z.array(z.object({ code: z.string().min(1).max(80), paragraphId: uuidSchema.optional(), message: z.string().min(1).max(500) }).strict()).max(100),
  acknowledgments: z.record(uuidSchema, digestSchema),
  fit: z.object({ documentHash: digestSchema, actualPages: z.literal(1), overflow: z.literal(false), measuredAt: z.string().datetime() }).strict().optional(),
  approved: z.boolean(),
  approvedAt: z.string().datetime().optional(),
}).strict().superRefine((letter, ctx) => {
  const ids = new Set<string>()
  for (const source of letter.bindings.sources) {
    if (ids.has(String(source.ordinal))) ctx.addIssue({ code: 'custom', path: ['bindings', 'sources'], message: 'Source ordinals must be unique.' })
    ids.add(String(source.ordinal))
  }
  const paragraphs = new Set<string>()
  for (const paragraph of letter.paragraphs) {
    if (paragraphs.has(paragraph.id)) ctx.addIssue({ code: 'custom', path: ['paragraphs'], message: 'Paragraph IDs must be unique.' })
    paragraphs.add(paragraph.id)
    for (const citation of paragraph.citations) if (!ids.has(String(citation.ordinal))) ctx.addIssue({ code: 'custom', path: ['paragraphs'], message: 'Every citation must resolve to a bound source ordinal.' })
  }
  for (const id of Object.keys(letter.acknowledgments)) if (!paragraphs.has(id)) ctx.addIssue({ code: 'custom', path: ['acknowledgments', id], message: 'Acknowledgment references a paragraph that is not present.' })
  if (letter.approved && (!letter.approvedAt || !letter.fit || letter.findings.length || letter.paragraphs.some(p => !letter.acknowledgments[p.id]))) ctx.addIssue({ code: 'custom', path: ['approved'], message: 'Approval requires measured fit, no findings, and acknowledgment of every paragraph.' })
})
export type CoverLetterRevision = z.infer<typeof coverLetterRevisionSchema>

export const coverLetterOperationSchema = z.object({
  id: uuidSchema,
  jobId: uuidSchema,
  parentRunId: uuidSchema,
  consentId: uuidSchema,
  purposeHash: digestSchema,
  initialBinding: z.object({ cvRevisionId: uuidSchema, scopeHash: digestSchema, modelHash: digestSchema, postingUpdatedAt: z.string().datetime() }).strict().optional(),
  retryOrigin: z.object({ parentRunId: uuidSchema, consentId: uuidSchema }).strict().optional(),
  status: z.enum(['prepared', 'dispatched', 'saved', 'failed', 'cancelled', 'uncertain']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict()
export type CoverLetterOperation = z.infer<typeof coverLetterOperationSchema>

export const coverLetterOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not-requested') }).strict(),
  z.object({ status: z.literal('not-started'), reason: z.string().min(1).max(500) }).strict(),
  z.object({ status: z.literal('saved'), letter: coverLetterRevisionSchema }).strict(),
  z.object({ status: z.enum(['failed', 'cancelled', 'uncertain']), message: z.string().min(1).max(500) }).strict(),
])
export const coverLetterGenerationStatusSchema = z.object({
  jobId: uuidSchema,
  status: z.enum(['not-requested', 'not-started', 'generating', 'saved', 'failed', 'cancelled', 'uncertain']),
  originCvRevisionId: uuidSchema.nullable(),
  parentRunId: uuidSchema.nullable(),
  operationId: uuidSchema.nullable(),
  letterId: uuidSchema.nullable(),
  retryAvailable: z.boolean(),
  reason: z.string().min(1).max(500),
  warning: z.string().min(1).max(500).nullable(),
  experienceKinds: z.record(uuidSchema, z.enum(['employment', 'training'])),
}).strict()
export type CoverLetterGenerationStatus = z.infer<typeof coverLetterGenerationStatusSchema>
export type CoverLetterOutcome = z.infer<typeof coverLetterOutcomeSchema>
export const requestedDocumentsResultSchema = z.object({ cv: draftGenerationSchema, letter: coverLetterOutcomeSchema }).strict()
export type RequestedDocumentsResult = z.infer<typeof requestedDocumentsResultSchema>

export const coverLetterAcknowledgmentSchema = z.object({ jobId: uuidSchema, letterId: uuidSchema, paragraphId: uuidSchema, acknowledged: z.literal(true) }).strict()
export type CoverLetterAcknowledgment = z.infer<typeof coverLetterAcknowledgmentSchema>
export const coverLetterRecipientSchema = z.object({ jobId: uuidSchema, letterId: uuidSchema, recipient: z.string().trim().min(1).max(200).nullable() }).strict()
export type CoverLetterRecipient = z.infer<typeof coverLetterRecipientSchema>
export const coverLetterEditSchema = z.object({ jobId: uuidSchema, letterId: uuidSchema, paragraphs: z.array(coverLetterParagraphSchema).min(1).max(8), recipient: z.string().trim().min(1).max(200).nullable() }).strict()
export type CoverLetterEdit = z.infer<typeof coverLetterEditSchema>
export const coverLetterActionResultSchema = z.object({ ok: z.boolean(), message: z.string(), letter: coverLetterRevisionSchema.optional() }).strict()
export type CoverLetterActionResult = z.infer<typeof coverLetterActionResultSchema>

/** A model-facing payload contains only approved posting text and bounded source passages. */
export const coverLetterModelResponseSchema = z.object({ paragraphs: z.array(z.object({ text: z.string().trim().min(1).max(3000), citations: z.array(coverLetterCitationSchema).min(1).max(20) }).strict()).min(1).max(8) }).strict()

export function coverLetterAcknowledgmentMaterial(paragraph: CoverLetterParagraph, sources: CoverLetterSource[]): string {
  const bound = new Map(sources.map(source => [source.ordinal, source]))
  const used = paragraph.citations.map(citation => bound.get(citation.ordinal))
  if (used.some(source => !source)) throw new Error('A cover-letter citation is outside the authorized source set.')
  // Main hashes this deterministic material with node:crypto and compares its own stored decision.
  return JSON.stringify({ text: paragraph.text, citations: used })
}
