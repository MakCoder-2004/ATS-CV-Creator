import { z } from 'zod'
import { profileSnapshotSchema } from './profile'
import { experienceSnapshotSchema } from './experience'

const profileExchangeBaseSchema = z.object({ format: z.literal('cv-tailor-profile'), version: z.literal(1), profile: profileSnapshotSchema, experience: experienceSnapshotSchema }).strict()
export const profileExchangeSchema = profileExchangeBaseSchema.superRefine((value, context) => {
  for (const section of ['education', 'certificates', 'summary', 'languages', 'extras'] as const) {
    if (value.profile[section].some(item => item.section !== section)) context.addIssue({ code: 'custom', path: ['profile', section], message: 'Record section does not match its collection.' })
  }
  if (value.profile.summary.length > 1) context.addIssue({ code: 'custom', path: ['profile', 'summary'], message: 'Only one summary record is allowed.' })
  const skillKeys = value.profile.skills.map(skill => `${skill.name.trim().toLowerCase()}\\0${skill.category.trim().toLowerCase()}`)
  if (new Set(skillKeys).size !== skillKeys.length) context.addIssue({ code: 'custom', path: ['profile', 'skills'], message: 'Skill names and categories must be unique.' })
  const entries = [...value.profile.education, ...value.profile.certificates, ...value.profile.summary, ...value.profile.languages, ...value.profile.extras]
  const ids = [value.profile.contact?.id, ...value.profile.skills.map(x => x.id), ...entries.map(x => x.id), ...value.experience.experience.flatMap(x => [x.id, ...x.factualItems.map(i => i.id)]), ...value.experience.projects.flatMap(x => [x.id, ...x.factualItems.map(i => i.id), ...x.technologies.map(i => i.id)])].filter(Boolean) as string[]
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: [], message: 'Profile record IDs must be unique.' })
})
export type ProfileExchange = z.infer<typeof profileExchangeSchema>
export const profileImportPreviewSchema = z.object({ ok: z.literal(true), token: z.string().uuid(), value: profileExchangeSchema, current: z.object({ records: z.number().int().nonnegative() }).strict(), replacement: z.object({ records: z.number().int().nonnegative() }).strict(), effects: z.array(z.object({ section: z.string(), action: z.enum(['add', 'remove', 'replace']), currentLabel: z.string().optional(), replacementLabel: z.string().optional() }).strict()) }).strict()
export type ProfileImportPreview = z.infer<typeof profileImportPreviewSchema>
export const profileExchangeResultSchema = z.discriminatedUnion('ok', [profileImportPreviewSchema, z.object({ ok: z.literal(false), cancelled: z.boolean(), message: z.string() }).strict()])
export type ProfileExchangeResult = z.infer<typeof profileExchangeResultSchema>
