import { z } from 'zod'
import type { ContactInput, EvidenceRevision, ProfileEntryInput, ProfileMutationResult, ProfileSnapshot, SkillInput } from './profile'
import type { ExperienceInput, ExperienceMutationResult, ExperienceSnapshot, ProjectInput } from './experience'
import { geminiSettingsSchema, geminiModelSchema, type GeminiModel } from './gemini-settings'
import type { JobInput, JobRecord, JobSaveResult } from './jobs'
import type { ProfileExchangeResult } from './profile-exchange'
import type { OutboundConsentAction, OutboundConsentPreview } from './outbound-consent-contract'
import type { AnalysisResult, AnalysisUsage } from './posting-analysis'

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
  exportProfile(): Promise<{ ok: boolean; cancelled: boolean; message: string }>
  previewProfileImport(): Promise<ProfileExchangeResult>
  applyProfileImport(token: string): Promise<{ ok: boolean; message: string; profile?: ProfileSnapshot }>
  cancelProfileImport(token: string): Promise<{ ok: boolean; message: string }>
  saveContact(input: ContactInput & { id?: string }): Promise<ProfileMutationResult>
  deleteContact(id: string): Promise<ProfileMutationResult>
  saveSkill(input: SkillInput & { id?: string }): Promise<ProfileMutationResult>
  deleteSkill(id: string): Promise<ProfileMutationResult>
  saveProfileEntry(input: ProfileEntryInput & { id?: string }): Promise<ProfileMutationResult>
  deleteProfileEntry(id: string): Promise<ProfileMutationResult>
  getEvidenceHistory(id: string): Promise<EvidenceRevision[]>
  getExperience(): Promise<ExperienceSnapshot>
  saveExperience(input: ExperienceInput & { id?: string }): Promise<ExperienceMutationResult>
  deleteExperience(id: string): Promise<ExperienceMutationResult>
  saveProject(input: ProjectInput & { id?: string }): Promise<ExperienceMutationResult>
  deleteProject(id: string): Promise<ExperienceMutationResult>
  saveJob(input: JobInput & { id?: string }): Promise<JobSaveResult>
  listJobs(): Promise<JobRecord[]>
  openJob(id: string): Promise<JobRecord | null>
  prepareOutboundConsent(jobId: string): Promise<OutboundConsentPreview>
  acceptOutboundConsent(token: string, accepted: boolean, freeTierTermsAcknowledged: boolean): Promise<OutboundConsentAction>
  cancelOutboundConsent(token: string): Promise<OutboundConsentAction>
  startAnalysis(consentToken: string): Promise<AnalysisResult>
  getAnalysis(jobId: string): Promise<AnalysisResult | null>
  cancelAnalysis(jobId: string): Promise<AnalysisResult>
  getAnalysisUsage(): Promise<AnalysisUsage>
}

export type WorkbenchStorageAPI = Omit<WorkbenchAPI, 'exportProfile' | 'previewProfileImport' | 'applyProfileImport' | 'cancelProfileImport'> & {
  validateProfileImport(input: string): Promise<{ ok: boolean; message: string }>
  replaceProfile(input: string): Promise<{ ok: boolean; message: string; profile?: ProfileSnapshot }>
}
