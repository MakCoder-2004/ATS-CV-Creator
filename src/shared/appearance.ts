import { z } from 'zod'
import type { ContactInput, EvidenceRevision, ProfileMutationResult, ProfileSnapshot, SkillInput } from './profile'
import { geminiSettingsSchema, geminiModelSchema, type GeminiModel } from './gemini-settings'
import type { JobInput, JobRecord, JobSaveResult } from './jobs'

export const appearanceSchema = z.enum(['light', 'dark'])
export type Appearance = z.infer<typeof appearanceSchema>
export const settingsSchema = z.object({ appearance: appearanceSchema, gemini: geminiSettingsSchema }).strict()
export type Settings = z.infer<typeof settingsSchema>
export const geminiModelInputSchema = geminiModelSchema

/** Public renderer-facing application contract; no generic invoke or file access. */
export interface WorkbenchAPI {
  getSettings(): Promise<Settings>
  setAppearance(value: Appearance): Promise<Settings>
  setGeminiModel(value: GeminiModel): Promise<Settings>
  saveGeminiApiKey(value: string): Promise<Settings>
  removeGeminiApiKey(): Promise<Settings>
  getProfile(): Promise<ProfileSnapshot>
  saveContact(input: ContactInput & { id?: string }): Promise<ProfileMutationResult>
  deleteContact(id: string): Promise<ProfileMutationResult>
  saveSkill(input: SkillInput & { id?: string }): Promise<ProfileMutationResult>
  deleteSkill(id: string): Promise<ProfileMutationResult>
  getEvidenceHistory(id: string): Promise<EvidenceRevision[]>
  saveJob(input: JobInput & { id?: string }): Promise<JobSaveResult>
  listJobs(): Promise<JobRecord[]>
  openJob(id: string): Promise<JobRecord | null>
}
