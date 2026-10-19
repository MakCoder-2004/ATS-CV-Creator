import { z } from 'zod'
import { profileSnapshotSchema } from './profile'
import { experienceSnapshotSchema } from './experience'

export const profileExchangeSchema = z.object({ format: z.literal('cv-tailor-profile'), version: z.literal(1), profile: profileSnapshotSchema, experience: experienceSnapshotSchema }).strict()
export type ProfileExchange = z.infer<typeof profileExchangeSchema>
export const profileImportPreviewSchema = z.object({ ok: z.literal(true), token: z.string().uuid(), value: profileExchangeSchema, current: z.object({ records: z.number().int().nonnegative() }).strict(), replacement: z.object({ records: z.number().int().nonnegative() }).strict() }).strict()
export type ProfileImportPreview = z.infer<typeof profileImportPreviewSchema>
export const profileExchangeResultSchema = z.discriminatedUnion('ok', [profileImportPreviewSchema, z.object({ ok: z.literal(false), cancelled: z.boolean(), message: z.string() }).strict()])
export type ProfileExchangeResult = z.infer<typeof profileExchangeResultSchema>
