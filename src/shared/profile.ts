import { z } from 'zod'
import { experienceRecordSchema, factualItemSchema, projectRecordSchema } from './experience'

const text = (max: number) => z.string().max(max).refine((value) => value.trim().length > 0, 'Must not be blank')
const httpUrl = z.string().url().max(2048).refine((value) => /^https?:\/\//i.test(value), 'Must be an HTTP(S) URL')
export const namedLinkSchema = z.object({ label: text(2048), url: httpUrl }).strict()
export const contactInputSchema = z.object({ fullName: text(160), headline: text(240).optional(), email: z.string().email().max(254).optional(), phone: text(64).optional(), location: text(160).optional(), links: z.array(namedLinkSchema).max(20).optional() }).strict()
export const skillInputSchema = z.object({ name: text(160), category: text(100), proficiency: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(), years: z.number().finite().min(0).max(80).optional() }).strict()
export const uuidSchema = z.string().uuid()
export const contactSaveInputSchema = contactInputSchema.extend({ id: uuidSchema.optional() }).strict()
export const skillSaveInputSchema = skillInputSchema.extend({ id: uuidSchema.optional() }).strict()
export const contactRecordSchema = contactInputSchema.extend({ id: uuidSchema, revision: z.number().int().positive() }).strict()
export const skillRecordSchema = skillInputSchema.extend({ id: uuidSchema, revision: z.number().int().positive() }).strict()
export const profileSectionSchema = z.enum(['education', 'certificates', 'summary', 'languages', 'extras'])
export const profileEntryInputSchema = z.object({ section: profileSectionSchema, title: text(200), institution: text(200).optional(), field: text(200).optional(), startDate: z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, 'Use YYYY or a valid YYYY-MM date').optional(), endDate: z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, 'Use YYYY or a valid YYYY-MM date').optional(), issuer: text(200).optional(), year: z.number().int().min(1900).max(2200).optional(), description: text(4000).optional(), link: httpUrl.optional() }).strict().refine(v => !v.startDate || !v.endDate || v.startDate <= v.endDate, { path: ['endDate'], message: 'End date must not precede start date' }).refine(v => v.section !== 'certificates' || v.issuer || v.year || v.description, { path: ['issuer'], message: 'Add an issuer, year, or description' }).refine(v => v.section !== 'summary' || !!v.description, { path: ['description'], message: 'Summary text is required' })
export const profileEntrySaveSchema = profileEntryInputSchema.extend({ id: uuidSchema.optional() }).strict()
export const profileEntrySchema = profileEntryInputSchema.extend({ id: uuidSchema, revision: z.number().int().positive() }).strict()
export const profileSnapshotSchema = z.object({ contact: contactRecordSchema.nullable(), skills: z.array(skillRecordSchema), education: z.array(profileEntrySchema), certificates: z.array(profileEntrySchema), summary: z.array(profileEntrySchema), languages: z.array(profileEntrySchema), extras: z.array(profileEntrySchema) }).strict()
const legacyContactRecordSchema = z.object({ fullName: text(160), headline: text(240).optional(), email: z.string().email().max(254).optional(), phone: text(64).optional(), location: text(160).optional(), links: z.array(httpUrl).max(20).optional(), id: uuidSchema, revision: z.number().int().positive() }).strict()
export const evidenceRevisionSchema = z.object({ id: uuidSchema, revision: z.number().int().positive(), action: z.enum(['created', 'updated', 'deleted']), snapshot: z.union([contactRecordSchema, legacyContactRecordSchema, skillRecordSchema, profileEntrySchema, factualItemSchema, experienceRecordSchema, projectRecordSchema]), createdAt: z.string().datetime() }).strict()
export const profileMutationResultSchema = z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), value: profileSnapshotSchema }).strict(), z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string(), fieldErrors: z.record(z.string(), z.string()).optional() }).strict() }).strict()])
export type ContactInput = z.infer<typeof contactInputSchema>
export type SkillInput = z.infer<typeof skillInputSchema>
export type ContactRecord = z.infer<typeof contactRecordSchema>
export type SkillRecord = z.infer<typeof skillRecordSchema>
export type ProfileEntryInput = z.infer<typeof profileEntryInputSchema>
export type ProfileEntry = z.infer<typeof profileEntrySchema>
export type ProfileSnapshot = z.infer<typeof profileSnapshotSchema>
export type EvidenceRevision = z.infer<typeof evidenceRevisionSchema>
export type ProfileMutationResult = z.infer<typeof profileMutationResultSchema>
