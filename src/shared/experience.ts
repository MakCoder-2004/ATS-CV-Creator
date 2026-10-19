import { z } from 'zod'
const uuidSchema = z.string().uuid()

const text = (max: number) => z.string().max(max).refine((value) => value.trim().length > 0, 'Must not be blank')
const date = z.string().max(80).optional()
const factualItemInputSchema = z.object({ id: uuidSchema.optional(), text: text(10000) }).strict()
export const factualItemSchema = z.object({ id: uuidSchema, revision: z.number().int().positive(), text: text(10000) }).strict()
export const experienceInputSchema = z.object({
  kind: z.enum(['employment', 'training']), title: text(240), organization: text(240),
  startDate: date, endDate: date, description: text(20000), factualItems: z.array(factualItemInputSchema).max(100).default([])
}).strict()
export const experienceSaveInputSchema = experienceInputSchema.extend({ id: uuidSchema.optional() }).strict()
export const experienceRecordSchema = experienceInputSchema.extend({
  id: uuidSchema, revision: z.number().int().positive(),
  factualItems: z.array(factualItemSchema).max(100)
}).strict()
export const projectInputSchema = z.object({
  name: text(240), description: text(20000), factualItems: z.array(factualItemInputSchema).max(100).default([]),
  technologies: z.array(factualItemInputSchema).max(100).default([]),
  links: z.array(z.object({ label: text(2048), url: z.string().url().max(2048).refine((value) => value.startsWith('http://') || value.startsWith('https://'), 'Must be an HTTP(S) URL') }).strict()).max(20).default([])
}).strict()
export const projectSaveInputSchema = projectInputSchema.extend({ id: uuidSchema.optional() }).strict()
export const projectRecordSchema = projectInputSchema.extend({
  id: uuidSchema, revision: z.number().int().positive(),
  factualItems: z.array(factualItemSchema).max(100), technologies: z.array(factualItemSchema).max(100)
}).strict()
export const experienceSnapshotSchema = z.object({ experience: z.array(experienceRecordSchema), projects: z.array(projectRecordSchema) }).strict()
export const experienceHistorySchema = z.object({
  id: uuidSchema, revision: z.number().int().positive(), action: z.enum(['created', 'updated', 'deleted']),
  snapshot: z.union([experienceRecordSchema, projectRecordSchema]), createdAt: z.string().datetime()
}).strict()
export const experienceMutationResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: experienceSnapshotSchema }).strict(),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string(), fieldErrors: z.record(z.string(), z.string()).optional() }).strict() }).strict()
])
export type FactualItemRecord = z.infer<typeof factualItemSchema>
export type ExperienceRecord = z.infer<typeof experienceRecordSchema>
export type ExperienceInput = z.input<typeof experienceInputSchema>
export type ProjectRecord = z.infer<typeof projectRecordSchema>
export type ProjectInput = z.input<typeof projectInputSchema>
export type ExperienceSnapshot = z.infer<typeof experienceSnapshotSchema>
export type ExperienceHistory = z.infer<typeof experienceHistorySchema>
export type ExperienceMutationResult = z.infer<typeof experienceMutationResultSchema>
