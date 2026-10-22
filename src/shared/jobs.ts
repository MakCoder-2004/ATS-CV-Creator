import { z } from 'zod'

export const POSTING_TEXT_MAX_CODE_POINTS = 200_000
export const POSTING_TEXT_MAX_UTF8_BYTES = 1_048_576
const postingText = z.string()
  .refine(value => Array.from(value).length <= POSTING_TEXT_MAX_CODE_POINTS, 'Posting text exceeds the 200,000-character safety limit.')
  .refine(value => new TextEncoder().encode(value).byteLength <= POSTING_TEXT_MAX_UTF8_BYTES, 'Posting text exceeds the 1 MiB UTF-8 safety limit.')
  .refine(value => value.trim().length > 0, 'Must not be blank')
const requiredText = (max: number) => z.string().max(max).refine(value => value.trim().length > 0, 'Must not be blank')
export const jobInputSchema = z.object({
  title: requiredText(200),
  company: requiredText(200),
  description: postingText
}).strict()
export const jobSaveInputSchema = jobInputSchema.extend({ id: z.string().uuid().optional() }).strict()
export const postingRevisionSchema = jobInputSchema.extend({
  revision: z.number().int().positive(),
  acceptedAt: z.string().datetime(),
  provenance: z.enum(['manual', 'legacy-unknown']),
}).strict()
export const jobRecordSchema = jobInputSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  provenance: z.enum(['manual', 'legacy-unknown']).default('legacy-unknown'),
  sourceSnapshot: jobInputSchema.nullable().default(null),
  revisions: z.array(postingRevisionSchema).default([]),
}).strict()
export const jobSaveResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: jobRecordSchema }).strict(),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string(), fieldErrors: z.record(z.string(), z.string()).optional() }).strict() }).strict()
])
export type JobInput = z.infer<typeof jobInputSchema>
export type JobRecord = z.infer<typeof jobRecordSchema>
export type JobSaveResult = z.infer<typeof jobSaveResultSchema>
