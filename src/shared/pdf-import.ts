import { z } from 'zod'

export const pdfImportSourceSchema = z.object({ page: z.number().int().positive(), text: z.string().max(20000), x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative() }).strict()
export const pdfImportLinkSchema = z.object({ page: z.number().int().positive(), target: z.string().max(2048), x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative(), label: z.string().max(2048).optional(), mapped: z.boolean() }).strict()
export const pdfImportIssueSchema = z.object({ code: z.enum(['reading-order', 'glyph-replacement', 'unmapped-link', 'encrypted', 'unsupported', 'size-limit', 'page-limit']), message: z.string().max(300) }).strict()
export const pdfImportExtractionSchema = z.object({ source: z.array(pdfImportSourceSchema), links: z.array(pdfImportLinkSchema), issues: z.array(pdfImportIssueSchema), pageCount: z.number().int().nonnegative() }).strict()
export const pdfImportFieldSchema = z.object({ category: z.enum(['contact', 'education', 'experience', 'project', 'certificate', 'skill', 'unmapped']), field: z.enum(['name', 'headline', 'email', 'phone', 'location', 'description', 'startDate', 'endDate', 'title', 'organization', 'link', 'text']), value: z.string().max(20000), sourceIndexes: z.array(z.number().int().nonnegative()), confidence: z.enum(['suggested', 'uncertain', 'unmapped']), confirmed: z.boolean() }).strict()
export const pdfImportReviewSchema = z.object({ fields: z.array(pdfImportFieldSchema).max(500), confirmed: z.literal(true) }).strict()
export const pdfImportPreviewSchema = z.object({ extraction: pdfImportExtractionSchema, fields: z.array(pdfImportFieldSchema).max(500), accepted: z.literal(false) }).strict()
export type PdfImportExtraction = z.infer<typeof pdfImportExtractionSchema>
export type PdfImportField = z.infer<typeof pdfImportFieldSchema>
export type PdfImportReview = z.infer<typeof pdfImportReviewSchema>
export type PdfImportPreview = z.infer<typeof pdfImportPreviewSchema>

/** No category or value is trusted until a user explicitly confirms every proposed field. */
export function confirmPdfImport(review: unknown): PdfImportReview {
  const result = pdfImportReviewSchema.parse(review)
  if (result.fields.some(field => !field.confirmed)) throw new Error('Review and confirm every extracted field before accepting the import.')
  return result
}
