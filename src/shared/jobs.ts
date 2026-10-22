import { z } from 'zod'

const requiredText = (max: number) => z.string().max(max).refine(value => value.trim().length > 0, 'Must not be blank')
export const postingOptionalFieldNames = ['location', 'workArrangement', 'employmentType', 'compensation', 'language', 'postedDate', 'deadline', 'applicationUrl'] as const
const optionalPostingFieldSchema = z.object({ value: z.string().max(20_000).nullable(), origin: z.enum(['source', 'user-correction', 'unknown']), source: z.string().max(200).nullable(), uncertainty: z.enum(['none', 'relative-date']).default('none') }).strict()
const unknownPostingField = { value: null, origin: 'unknown', source: null, uncertainty: 'none' } as const
const optionalPostingDetailsInputSchema = z.object(Object.fromEntries(postingOptionalFieldNames.map(name => [name, optionalPostingFieldSchema.optional()])) as Record<typeof postingOptionalFieldNames[number], ReturnType<typeof optionalPostingFieldSchema.optional>>).strict().default({})
export const postingOptionalDetailsSchema = optionalPostingDetailsInputSchema.transform(details => Object.fromEntries(postingOptionalFieldNames.map(name => [name, details[name] ?? unknownPostingField])) as Record<typeof postingOptionalFieldNames[number], z.infer<typeof optionalPostingFieldSchema>>)
const postingOptionalFieldOriginSchema = z.enum(['source', 'user-correction', 'unknown'])
const postingOptionalOriginsSchema = z.object(Object.fromEntries(postingOptionalFieldNames.map(name => [name, postingOptionalFieldOriginSchema.optional()])) as Record<typeof postingOptionalFieldNames[number], ReturnType<typeof postingOptionalFieldOriginSchema.optional>>).strict().default({})
export type PostingOptionalDetails = z.infer<typeof postingOptionalDetailsSchema>
export const emptyPostingOptionalDetails = (): PostingOptionalDetails => postingOptionalDetailsSchema.parse({})
export const jobInputSchema = z.object({
  title: requiredText(200),
  company: requiredText(200),
  description: requiredText(30000),
  optionalDetails: postingOptionalDetailsSchema.optional()
}).strict()
export const jobSaveInputSchema = jobInputSchema.extend({ id: z.string().uuid().optional() }).strict()
export const postingRevisionSchema = jobInputSchema.extend({
  optionalDetails: postingOptionalDetailsSchema,
  revision: z.number().int().positive(),
  acceptedAt: z.string().datetime(),
  provenance: z.enum(['manual', 'legacy-unknown', 'imported']),
}).strict()
export const postingSourceSnapshotSchema = z.object({
  title: z.string().max(200), company: requiredText(200).nullable(), description: z.string().max(30000),
  submittedUrl: z.string().url(), finalUrl: z.string().url(), sourceIdentity: z.string().min(1).max(500), capturedAt: z.string().datetime(),
  extractionMethod: z.literal('lever-json-v1'), extractionVersion: z.literal(1),
  optionalDetails: postingOptionalDetailsSchema,
  hashes: z.object({ title: z.string().length(64), company: z.string().length(64).nullable(), description: z.string().length(64) }).strict(),
  fieldOrigins: z.object({ title: z.enum(['source', 'user-correction']), company: z.enum(['source', 'user-correction']), description: z.enum(['source', 'user-correction']), optionalDetails: postingOptionalOriginsSchema }).strict()
}).strict()
export const jobRecordSchema = jobInputSchema.extend({
  optionalDetails: postingOptionalDetailsSchema,
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  provenance: z.enum(['manual', 'legacy-unknown', 'imported']).default('legacy-unknown'),
  sourceSnapshot: postingSourceSnapshotSchema.nullable().default(null),
  revisions: z.array(postingRevisionSchema).default([]),
}).strict()
export const jobSaveResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: jobRecordSchema }).strict(),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string(), fieldErrors: z.record(z.string(), z.string()).optional() }).strict() }).strict()
])
export type JobInput = z.infer<typeof jobInputSchema>
export type JobRecord = z.infer<typeof jobRecordSchema>

// Exact released v2 shapes used only while upgrading old workspace backups to v3.
const releasedV2JobInputSchema = z.object({ title: requiredText(200), company: requiredText(200), description: requiredText(30000) }).strict()
const releasedV2RevisionSchema = releasedV2JobInputSchema.extend({ revision: z.number().int().positive(), acceptedAt: z.string().datetime(), provenance: z.enum(['manual', 'legacy-unknown', 'imported']) }).strict()
const releasedV2SourceSnapshotSchema = z.object({
  title: requiredText(200), company: requiredText(200).nullable(), description: requiredText(30000), submittedUrl: z.string().url(), finalUrl: z.string().url(), sourceIdentity: z.string().min(1).max(500), capturedAt: z.string().datetime(), extractionMethod: z.literal('lever-json-v1'), extractionVersion: z.literal(1),
  hashes: z.object({ title: z.string().length(64), company: z.string().length(64).nullable(), description: z.string().length(64) }).strict(),
  fieldOrigins: z.object({ title: z.enum(['source', 'user-correction']), company: z.enum(['source', 'user-correction']), description: z.enum(['source', 'user-correction']) }).strict()
}).strict()
export const releasedV2JobRecordSchema = releasedV2JobInputSchema.extend({ id: z.string().uuid(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), provenance: z.enum(['manual', 'legacy-unknown', 'imported']), sourceSnapshot: releasedV2SourceSnapshotSchema.nullable(), revisions: z.array(releasedV2RevisionSchema) }).strict()
/** Keep an unbound historical draft at the oldest accepted target we can prove; use current only when history has no baseline. */
export function legacyDraftTargetBaseline(job: Pick<JobRecord, 'createdAt' | 'updatedAt' | 'revisions'>): string | undefined {
  if (job.revisions.length) return job.revisions[0].acceptedAt
  return job.createdAt === job.updatedAt ? job.updatedAt : undefined
}
export type JobSaveResult = z.infer<typeof jobSaveResultSchema>
