import { z } from 'zod'
import type { ContactInput, EvidenceRevision, ProfileEntryInput, ProfileMutationResult, ProfileSnapshot, SkillInput } from './profile'
import type { ExperienceInput, ExperienceMutationResult, ExperienceSnapshot, ProjectInput } from './experience'
import { openRouterSettingsSchema, openRouterModelSchema, type OpenRouterModel } from './openrouter-settings'
import type { JobInput, JobRecord, JobSaveResult } from './jobs'
import type { ProfileExchangeResult } from './profile-exchange'
import type { OutboundConsentAction, OutboundConsentPreview } from './outbound-consent-contract'
import type { AnalysisBudgets, AnalysisResult, AnalysisUsage } from './posting-analysis'
import type { AddDraftItemInput, DraftCorrectionInput, DraftRevision } from './draft'
import type { FactualCheckReport } from './factual-report'
import type { CanonicalDocument, DocumentFitReport } from './document'
import type { RegenerationProposal, RegenerationTarget } from './regeneration'

export const appearanceSchema = z.enum(['light', 'dark'])
export type Appearance = z.infer<typeof appearanceSchema>
export const settingsSchema = z.object({ appearance: appearanceSchema, openRouter: openRouterSettingsSchema }).strict()
export type Settings = z.infer<typeof settingsSchema>
export const openRouterModelInputSchema = openRouterModelSchema

/** Public renderer-facing application contract; no generic invoke or file access. */
export interface WorkbenchAPI {
  getSettings(): Promise<Settings>
  setAppearance(value: Appearance): Promise<Settings>
  setOpenRouterModel(value: OpenRouterModel): Promise<Settings>
  setFaithfulnessCheck(value: boolean): Promise<Settings>
  saveOpenRouterApiKey(value: string): Promise<Settings>
  revealOpenRouterApiKey(): Promise<string>
  copyOpenRouterApiKey(): Promise<void>
  removeOpenRouterApiKey(): Promise<Settings>
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
  generateDraft(consentToken: string, pageTarget?: 1 | 2): Promise<{ ok: boolean; message: string; draft?: DraftRevision }>
  regenerateDraft(consentToken: string, target: RegenerationTarget): Promise<{ ok: boolean; message: string; proposal?: RegenerationProposal }>
  getRegenerationProposal(jobId: string): Promise<RegenerationProposal | null>
  resolveRegenerationProposal(jobId: string, proposalId: string, decision: 'accept' | 'reject'): Promise<{ ok: boolean; message: string; draft?: DraftRevision; proposal?: RegenerationProposal }>
  getDraft(jobId: string): Promise<DraftRevision | null>
  checkDraft(jobId: string): Promise<FactualCheckReport | null>
  approveDraft(jobId: string): Promise<{ ok: boolean; message: string; draft?: DraftRevision }>
  assertDraftExportable(jobId: string): Promise<{ ok: boolean; message: string; document?: CanonicalDocument }>
  exportApprovedPdf(jobId: string): Promise<{ ok: boolean; cancelled: boolean; message: string }>
  correctDraft(input: DraftCorrectionInput): Promise<DraftRevision | null>
  addDraftItem(input: AddDraftItemInput): Promise<DraftRevision | null>
  getCanonicalDocument(jobId: string): Promise<CanonicalDocument | null>
  measureDocument(jobId: string): Promise<DocumentFitReport>
  getDocumentFitReport(jobId: string): Promise<DocumentFitReport | null>
  acceptDocumentCuts(jobId: string, documentHash: string, entryIds: string[]): Promise<{ ok: boolean; message: string; draft?: DraftRevision }>
  getAnalysisUsage(): Promise<AnalysisUsage>
  setAnalysisBudgets(value: AnalysisBudgets): Promise<AnalysisUsage>
}

export type WorkbenchStorageAPI = Omit<WorkbenchAPI, 'exportProfile' | 'previewProfileImport' | 'applyProfileImport' | 'cancelProfileImport' | 'measureDocument' | 'copyOpenRouterApiKey' | 'exportApprovedPdf'> & {
  saveDocumentFitReport(jobId: string, report: DocumentFitReport): Promise<DocumentFitReport>
  validateProfileImport(input: string): Promise<{ ok: boolean; message: string }>
  replaceProfile(input: string): Promise<{ ok: boolean; message: string; profile?: ProfileSnapshot }>
}
