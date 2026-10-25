import { z } from 'zod'
import { analysisResultSchema, analysisBudgetsSchema } from './posting-analysis'
import { jobRecordSchema, POSTING_TEXT_MAX_CODE_POINTS, POSTING_TEXT_MAX_UTF8_BYTES } from './jobs'
import { contactRecordSchema, profileEntrySchema, profileSnapshotSchema, skillRecordSchema, uuidSchema } from './profile'
import { experienceRecordSchema, experienceSnapshotSchema, projectRecordSchema } from './experience'
import { openRouterModelSchema } from './openrouter-settings'
import { piModelSelectionSchema, PI_THINKING_LEVELS } from './pi-model'

const legacyConsentSourceSchema = z.object({
  job: z.object({ id: uuidSchema, revision: z.union([z.string(), z.number()]), title: z.string().min(1).max(200), company: z.string().min(1).max(200), description: z.string().min(1).refine(value => Array.from(value).length <= POSTING_TEXT_MAX_CODE_POINTS && new TextEncoder().encode(value).byteLength <= POSTING_TEXT_MAX_UTF8_BYTES) }).strict(),
  profile: z.object({
    revision: z.array(z.tuple([uuidSchema, z.number().int().positive()])), contact: contactRecordSchema.nullable(),
    experience: z.array(experienceRecordSchema), projects: z.array(projectRecordSchema), skills: z.array(skillRecordSchema),
    education: z.array(profileEntrySchema), certificates: z.array(profileEntrySchema),
    summary: z.array(profileEntrySchema).optional(), languages: z.array(profileEntrySchema).optional(), extras: z.array(profileEntrySchema).optional()
  }).strict(),
  model: z.object({ name: openRouterModelSchema, temperature: z.number().finite().optional(), topP: z.number().finite().optional(), maxOutputTokens: z.number().int().positive().optional(), thinkingLevel: z.enum(['minimal','low','medium','high']).optional() }).strict()
}).strict()

const piConsentSourceSchema = legacyConsentSourceSchema.extend({
  model: z.object({ name: z.string().min(1).max(400), providerId: z.string().min(1).max(200), thinkingLevel: z.enum(PI_THINKING_LEVELS) }).strict()
})

const generationItemSchema = z.object({ id: uuidSchema, revision: z.number().int().positive(), category: z.enum(['education','experience','projects','skills','certificates']), snapshot: z.record(z.string(), z.unknown()), text: z.string(), chronology: z.string().optional(), parentId: uuidSchema.optional() }).strict()
const lockedFieldsSchema = z.object({
  fullName: z.string(), headline: z.string().optional(),
  experience: z.array(z.object({ evidenceId: uuidSchema, sourceIds: z.array(uuidSchema), title: z.string(), organization: z.string(), startDate: z.string().optional(), endDate: z.string().optional() }).strict()),
  education: z.array(z.object({ evidenceId: uuidSchema, title: z.string(), institution: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional() }).strict()),
  projects: z.array(z.object({ evidenceId: uuidSchema, sourceIds: z.array(uuidSchema), name: z.string() }).strict()),
  certificates: z.array(z.object({ evidenceId: uuidSchema, title: z.string(), issuer: z.string().optional(), year: z.number().int().optional() }).strict())
}).strict()

const legacyGenerationRecoverySnapshotSchema = z.object({
  version: z.literal(1), runId: uuidSchema, jobId: uuidSchema, consentId: uuidSchema, scopeHash: z.string().regex(/^[a-f0-9]{64}$/),
  analysis: analysisResultSchema, job: jobRecordSchema, profile: profileSnapshotSchema, experience: experienceSnapshotSchema,
  draftInputs: z.object({ items: z.array(generationItemSchema), lockedFields: lockedFieldsSchema }).strict(),
  safeItems: z.array(generationItemSchema), identity: z.object({ id: uuidSchema, jobId: uuidSchema, revision: z.number().int().positive(), targetPostingUpdatedAt: z.string().datetime().optional(), createdAt: z.string().datetime(), lockedFields: lockedFieldsSchema }).strict(),
  pageTarget: z.union([z.literal(1), z.literal(2)]), source: legacyConsentSourceSchema, faithfulnessCheck: z.boolean(), budgets: analysisBudgetsSchema
}).strict()
const piGenerationRecoverySnapshotSchema = legacyGenerationRecoverySnapshotSchema.omit({ version: true, source: true, budgets: true }).extend({
  version: z.literal(2), source: piConsentSourceSchema, model: piModelSelectionSchema
}).strict()
const paragraphGenerationRecoverySnapshotSchema = legacyGenerationRecoverySnapshotSchema.omit({ version: true, source: true, budgets: true }).extend({
  version: z.literal(3), source: z.union([legacyConsentSourceSchema, piConsentSourceSchema]), model: piModelSelectionSchema.optional()
}).strict()
const currentGenerationRecoverySnapshotSchema = paragraphGenerationRecoverySnapshotSchema.omit({ version: true, faithfulnessCheck: true }).extend({ version: z.literal(4) }).strict()
export const generationRecoverySnapshotSchema = z.discriminatedUnion('version', [legacyGenerationRecoverySnapshotSchema, piGenerationRecoverySnapshotSchema, paragraphGenerationRecoverySnapshotSchema, currentGenerationRecoverySnapshotSchema])
export type GenerationRecoverySnapshot = z.infer<typeof generationRecoverySnapshotSchema>
