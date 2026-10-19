import { z } from 'zod'
import { experienceRecordSchema, factualItemSchema, projectRecordSchema } from './experience'

const text = (max: number) => z.string().max(max).refine((value) => value.trim().length > 0, 'Must not be blank')
const httpUrl = z.string().url().max(2048).refine((value) => /^https?:\/\//i.test(value), 'Must be an HTTP(S) URL')
// A migrated URL may be used as its editable label, so names must accept the longest valid legacy URL.
export const namedLinkSchema = z.object({ label: text(2048), url: httpUrl }).strict()
export const contactInputSchema = z.object({
  fullName: text(160), headline: text(240).optional(), email: z.string().email().max(254).optional(),
  phone: text(64).optional(), location: text(160).optional(),
  links: z.array(namedLinkSchema).max(20).optional()
}).strict()
export const skillInputSchema = z.object({
  name: text(160), category: text(100), proficiency: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
  years: z.number().finite().min(0).max(80).optional()
}).strict()
export const uuidSchema = z.string().uuid()
export const contactSaveInputSchema = contactInputSchema.extend({ id: uuidSchema.optional() }).strict()
export const skillSaveInputSchema = skillInputSchema.extend({ id: uuidSchema.optional() }).strict()
export const contactRecordSchema = contactInputSchema.extend({ id: uuidSchema, revision: z.number().int().positive() }).strict()
export const skillRecordSchema = skillInputSchema.extend({ id: uuidSchema, revision: z.number().int().positive() }).strict()
export const profileSnapshotSchema = z.object({ contact: contactRecordSchema.nullable(), skills: z.array(skillRecordSchema) }).strict()
const legacyContactRecordSchema = z.object({
  fullName: text(160), headline: text(240).optional(), email: z.string().email().max(254).optional(),
  phone: text(64).optional(), location: text(160).optional(),
  links: z.array(httpUrl).max(20).optional(), id: uuidSchema, revision: z.number().int().positive()
}).strict()
export const evidenceRevisionSchema = z.object({
  id: uuidSchema, revision: z.number().int().positive(), action: z.enum(['created', 'updated', 'deleted']),
  snapshot: z.union([contactRecordSchema, legacyContactRecordSchema, skillRecordSchema, factualItemSchema, experienceRecordSchema, projectRecordSchema]), createdAt: z.string().datetime()
}).strict()
export const profileMutationResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: profileSnapshotSchema }).strict(),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string(), fieldErrors: z.record(z.string(), z.string()).optional() }).strict() }).strict()
])
export type ContactInput = z.infer<typeof contactInputSchema>
export type SkillInput = z.infer<typeof skillInputSchema>
export type ContactRecord = z.infer<typeof contactRecordSchema>
export type SkillRecord = z.infer<typeof skillRecordSchema>
export type ProfileSnapshot = z.infer<typeof profileSnapshotSchema>
export type EvidenceRevision = z.infer<typeof evidenceRevisionSchema>
export type ProfileMutationResult = z.infer<typeof profileMutationResultSchema>
