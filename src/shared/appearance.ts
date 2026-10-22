import { z } from 'zod'
import type { ContactInput, EvidenceRevision, ProfileEntryInput, ProfileMutationResult, ProfileSnapshot, SkillInput } from './profile'
import type { ExperienceInput, ExperienceMutationResult, ExperienceSnapshot, ProjectInput } from './experience'
import { openRouterSettingsSchema, openRouterModelSchema, type OpenRouterModel } from './openrouter-settings'
import type { JobInput, JobRecord, JobSaveResult, PostingRefreshChoice } from './jobs'
import type { ProfileExchangeResult } from './profile-exchange'
import type { OutboundConsentAction, OutboundConsentPreview } from './outbound-consent-contract'
import type { AnalysisBudgets, AnalysisResult, AnalysisUsage, GenerationRecovery, RecoveryChoice } from './posting-analysis'
import type { AddDraftItemInput, DraftCorrectionInput, DraftRevision, SuggestedSkillDecision, DraftTailoringCorrection } from './draft'
import type { FactualCheckReport } from './factual-report'
import type { CanonicalDocument, DocumentFitReport, DocumentPdf } from './document'
import type { RegenerationProposal, RegenerationTarget } from './regeneration'
import type { MutateDraftRecordInput, MutateDraftRecordResult } from './draft-records'
import type { ProfilePdfProposal, ProfilePdfPreview } from './profile-pdf-import'
import type { ProfileAiConsentAction, ProfileAiConsentPreview, ProfileAiRunResult } from './profile-ai-structuring'
import type { PostingFetchState, PostingPreviewEdit, PostingRefreshComparison, PostingReview } from './posting-import'

export const appearanceSchema = z.enum(['light', 'dark'])
export type Appearance = z.infer<typeof appearanceSchema>
export const settingsSchema = z.object({ appearance: appearanceSchema, openRouter: openRouterSettingsSchema }).strict()
export type Settings = z.infer<typeof settingsSchema>
export const openRouterModelInputSchema = openRouterModelSchema

export type WorkspaceRestorePreview = { token: string; effects: Array<{ label: string; current: number; replacement: number }> }
export type WorkspaceRestoreSelection = { ok: true; preview: WorkspaceRestorePreview } | { ok: false; cancelled: boolean; message: string }
export type WorkspaceBackupResult = { ok: boolean; cancelled: boolean; message: string }

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
  exportWorkspaceBackup(): Promise<WorkspaceBackupResult>
  previewWorkspaceRestore(): Promise<WorkspaceRestoreSelection>
  applyWorkspaceRestore(token: string): Promise<{ ok: boolean; message: string }>
  cancelWorkspaceRestore(token: string): Promise<{ ok: boolean; message: string }>
  getProfile(): Promise<ProfileSnapshot>
  previewProfilePdfImport(): Promise<ProfilePdfPreview>
  cancelProfilePdfImport(token: string): Promise<{ ok: boolean; message: string }>
  applyProfilePdfImport(token: string, proposals: ProfilePdfProposal): Promise<{ ok: boolean; message: string; profile?: ProfileSnapshot; experience?: ExperienceSnapshot }>
  previewProfileDocxImport(): Promise<ProfilePdfPreview>
  cancelProfileDocxImport(token: string): Promise<{ ok: boolean; message: string }>
  applyProfileDocxImport(token: string, proposals: ProfilePdfProposal): Promise<{ ok: boolean; message: string; profile?: ProfileSnapshot; experience?: ExperienceSnapshot }>
  previewProfileAiStructuring(importToken: string): Promise<ProfileAiConsentPreview>
  consentProfileAiStructuring(token: string, accepted: boolean): Promise<ProfileAiConsentAction>
  runProfileAiStructuring(token: string): Promise<ProfileAiRunResult>
  cancelProfileAiStructuring(token: string): Promise<{ ok: boolean; message: string }>
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
  updatePostingPreview(token: string, expectedRevision: number, input: PostingPreviewEdit): Promise<{ ok: boolean; revision?: number; message?: string }>
  reviewPostingPreview(token: string, revision: number, review: PostingReview): Promise<{ ok: boolean; message?: string }>
  acceptPostingImport(token: string, revision: number): Promise<JobSaveResult>
  comparePostingRefresh(token: string, jobId: string, expectedUpdatedAt: string, expectedRevision: number): Promise<PostingRefreshComparison>
  acceptPostingRefresh(token: string, revision: number, jobId: string, expectedUpdatedAt: string, expectedBaseRevision: number, choices: PostingRefreshChoice): Promise<JobSaveResult>
  listJobs(): Promise<JobRecord[]>
  openJob(id: string): Promise<JobRecord | null>
  startPostingFetch(url: string): Promise<{ token: string }>
  readPostingPreview(token: string): Promise<PostingFetchState>
  cancelPostingFetch(token: string): Promise<{ ok: boolean }>
  openPostingSource(url: string): Promise<{ ok: boolean; message: string }>
  prepareOutboundConsent(jobId: string): Promise<OutboundConsentPreview>
  acceptOutboundConsent(token: string, accepted: boolean, freeTierTermsAcknowledged: boolean): Promise<OutboundConsentAction>
  cancelOutboundConsent(token: string): Promise<OutboundConsentAction>
  startAnalysis(consentToken: string): Promise<AnalysisResult>
  getAnalysis(jobId: string): Promise<AnalysisResult | null>
  cancelAnalysis(jobId: string): Promise<AnalysisResult>
  getGenerationRecovery(jobId: string): Promise<GenerationRecovery | null>
  resumeGeneration(runId: string, choice?: RecoveryChoice): Promise<{ ok: boolean; message: string }>
  cancelGenerationRecovery(runId: string): Promise<{ ok: boolean; message: string }>
  generateDraft(consentToken: string, pageTarget?: 1 | 2): Promise<{ ok: boolean; message: string; draft?: DraftRevision }>
  renewDraftReview(jobId: string): Promise<{ ok: boolean; message: string; draft?: DraftRevision }>
  regenerateDraft(consentToken: string, target: RegenerationTarget): Promise<{ ok: boolean; message: string; proposal?: RegenerationProposal }>
  getRegenerationProposal(jobId: string): Promise<RegenerationProposal | null>
  resolveRegenerationProposal(jobId: string, proposalId: string, decision: 'accept' | 'reject'): Promise<{ ok: boolean; message: string; draft?: DraftRevision; proposal?: RegenerationProposal }>
  getDraft(jobId: string): Promise<DraftRevision | null>
  checkDraft(jobId: string): Promise<FactualCheckReport | null>
  approveDraft(jobId: string): Promise<{ ok: boolean; message: string; draft?: DraftRevision }>
  assertDraftExportable(jobId: string): Promise<{ ok: boolean; message: string; document?: CanonicalDocument }>
  exportApprovedPdf(jobId: string): Promise<{ ok: boolean; cancelled: boolean; message: string }>
  exportDraftDocx(jobId: string): Promise<{ ok: boolean; cancelled: boolean; message: string; path?: string }>
  decideSuggestedSkill(input: SuggestedSkillDecision): Promise<{ ok: boolean; message: string; draft?: DraftRevision }>
  correctDraftTailoring(input: DraftTailoringCorrection): Promise<{ ok: boolean; message: string; draft?: DraftRevision }>
  correctDraft(input: DraftCorrectionInput): Promise<DraftRevision | null>
  mutateDraftRecord(input: MutateDraftRecordInput): Promise<MutateDraftRecordResult>
  addDraftItem(input: AddDraftItemInput): Promise<DraftRevision | null>
  getCanonicalDocument(jobId: string): Promise<CanonicalDocument | null>
  getDocumentPdf(jobId: string): Promise<DocumentPdf>
  measureDocument(jobId: string): Promise<DocumentFitReport>
  getDocumentFitReport(jobId: string): Promise<DocumentFitReport | null>
  acceptDocumentCuts(jobId: string, documentHash: string, entryIds: string[]): Promise<{ ok: boolean; message: string; draft?: DraftRevision }>
  getAnalysisUsage(): Promise<AnalysisUsage>
  setAnalysisBudgets(value: AnalysisBudgets): Promise<AnalysisUsage>
}

export type WorkbenchStorageAPI = Omit<WorkbenchAPI, 'exportProfile' | 'previewProfileImport' | 'applyProfileImport' | 'cancelProfileImport' | 'previewProfilePdfImport' | 'cancelProfilePdfImport' | 'applyProfilePdfImport' | 'previewProfileDocxImport' | 'cancelProfileDocxImport' | 'applyProfileDocxImport' | 'previewProfileAiStructuring' | 'consentProfileAiStructuring' | 'runProfileAiStructuring' | 'cancelProfileAiStructuring' | 'exportWorkspaceBackup' | 'previewWorkspaceRestore' | 'applyWorkspaceRestore' | 'cancelWorkspaceRestore' | 'measureDocument' | 'getDocumentPdf' | 'copyOpenRouterApiKey' | 'exportApprovedPdf' | 'exportDraftDocx' | 'openPostingSource'> & {
  saveDocumentFitReport(jobId: string, report: DocumentFitReport): Promise<DocumentFitReport>
  validateProfileImport(input: string): Promise<{ ok: boolean; message: string }>
  replaceProfile(input: string): Promise<{ ok: boolean; message: string; profile?: ProfileSnapshot }>
  getProfileImportBaseline(): Promise<string>
  importEmptyProfilePdf(sourceHash: string, baseline: string, proposals: ProfilePdfProposal): Promise<{ ok: boolean; message: string; profile?: ProfileSnapshot; experience?: ExperienceSnapshot }>
  authorizeProfileImportAi(runId: string): void
  generateProfileImportAi(runId: string, model: string, prompt: string, responseSchema: import('zod').ZodTypeAny): Promise<{ text: string; attempts: number }>
  cancelProfileImportAi(runId: string): void
}
