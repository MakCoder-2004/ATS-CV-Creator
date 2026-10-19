import { z } from 'zod'
import type { ContactInput, EvidenceRevision, ProfileMutationResult, ProfileSnapshot, SkillInput } from './profile'

export const appearanceSchema = z.enum(['light', 'dark'])
export type Appearance = z.infer<typeof appearanceSchema>
export const settingsSchema = z.object({ appearance: appearanceSchema }).strict()
export type Settings = z.infer<typeof settingsSchema>

/** Public renderer-facing application contract; no generic invoke or file access. */
export interface WorkbenchAPI {
  getSettings(): Promise<Settings>
  setAppearance(value: Appearance): Promise<Settings>
  getProfile(): Promise<ProfileSnapshot>
  saveContact(input: ContactInput & { id?: string }): Promise<ProfileMutationResult>
  deleteContact(id: string): Promise<ProfileMutationResult>
  saveSkill(input: SkillInput & { id?: string }): Promise<ProfileMutationResult>
  deleteSkill(id: string): Promise<ProfileMutationResult>
  getEvidenceHistory(id: string): Promise<EvidenceRevision[]>
}
