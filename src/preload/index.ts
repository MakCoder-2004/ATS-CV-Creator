import { contextBridge, ipcRenderer } from 'electron'
import { z } from 'zod'
import { appearanceSchema, settingsSchema, type Appearance, type WorkbenchAPI } from '../shared/appearance'
import { piModelPreferenceInputSchema, type PiModelPreferenceInput } from '../shared/pi-model'
import { evidenceRevisionSchema, profileEntryInputSchema, profileMutationResultSchema, profileSnapshotSchema, uuidSchema, type ContactInput, type ProfileEntryInput, type SkillInput } from '../shared/profile'
import { experienceSnapshotSchema, experienceMutationResultSchema, type ExperienceInput, type ProjectInput } from '../shared/experience'
import { jobInputSchema, jobRecordSchema, jobSaveResultSchema, jobDeletionSelectionSchema, jobDeletionExecuteSchema, jobDeletionPreviewSchema, jobDeletionResultSchema, postingRefreshChoiceSchema, type JobInput } from '../shared/jobs'
import { profileExchangeResultSchema } from '../shared/profile-exchange'
import { outboundConsentActionSchema, outboundConsentPreviewSchema } from '../shared/outbound-consent-contract'
import { analysisIdSchema, analysisResultSchema, generationRecoverySchema, recoveryChoiceSchema, type AnalysisResult, type RecoveryChoice } from '../shared/posting-analysis'
import { addDraftItemInputSchema, draftCorrectionInputSchema, draftGenerationSchema, draftRevisionSchema, suggestedSkillDecisionSchema, draftTailoringCorrectionSchema } from '../shared/draft'
import { factualCheckReportSchema } from '../shared/factual-report'
import { canonicalDocumentSchema, documentFitReportSchema, documentPdfSchema } from '../shared/document'
import { regenerationProposalSchema, regenerationResultSchema, regenerationTargetSchema } from '../shared/regeneration'
import { mutateDraftRecordInputSchema } from '../shared/draft-records'
import { profilePdfApplyResultSchema, profilePdfPreviewSchema, profilePdfProposalSchema, profilePdfRebaseResultSchema } from '../shared/profile-pdf-import'
import { profileAiConsentActionSchema, profileAiConsentPreviewSchema, profileAiRunResultSchema } from '../shared/profile-ai-structuring'
import { postingFetchStateSchema, postingPreviewEditSchema, postingRefreshComparisonSchema, postingReviewSchema } from '../shared/posting-import'
import { workspaceBackupStatusSchema } from '../shared/workspace-backup'
import { researchCancelSchema, researchReviewInputSchema, researchReviewStateSchema, researchStartSchema, researchStateSchema } from '../shared/job-research-ipc'
import { normalizeJobResearchUrl } from '../shared/job-research-url'
import { researchSearchKeyInputSchema, researchSearchKeyStatusSchema } from '../shared/research-search-settings'
import { researchAnalysisTokenSchema, researchAnalysisConsentSchema, researchAnalysisPreviewReplySchema, researchAnalysisProgressReplySchema, researchAnalysisDiscardReplySchema } from '../shared/research-volatile-analysis-ipc'

const workspaceResult = z.object({ ok: z.boolean(), cancelled: z.boolean(), message: z.string() }).strict()
const restoreSelection = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), preview: z.object({ token: z.string().uuid(), effects: z.array(z.object({ label: z.string(), current: z.number().int().nonnegative(), replacement: z.number().int().nonnegative() }).strict()) }).strict() }).strict(),
  z.object({ ok: z.literal(false), cancelled: z.boolean(), message: z.string() }).strict()
])
const restoreDecision = z.object({ ok: z.boolean(), message: z.string() }).strict()

const api: WorkbenchAPI = Object.freeze({
  async getSettings() {
    return settingsSchema.parse(await ipcRenderer.invoke('settings:get'))
  },
  async getWorkspaceBackupStatus() {
    return workspaceBackupStatusSchema.parse(await ipcRenderer.invoke('workspace:backup:status'))
  },
  async setAppearance(value: Appearance) {
    return settingsSchema.parse(await ipcRenderer.invoke('settings:appearance', appearanceSchema.parse(value)))
  },
  async setPiModel(input: PiModelPreferenceInput) {
    return settingsSchema.parse(await ipcRenderer.invoke('settings:pi-model', piModelPreferenceInputSchema.parse(input)))
  },
  async getResearchSearchKeyStatus() { return researchSearchKeyStatusSchema.parse(await ipcRenderer.invoke('research-search:key:status')) },
  async saveResearchSearchKey(key: string) { return researchSearchKeyStatusSchema.parse(await ipcRenderer.invoke('research-search:key:save', researchSearchKeyInputSchema.parse(key))) },
  async removeResearchSearchKey() { return researchSearchKeyStatusSchema.parse(await ipcRenderer.invoke('research-search:key:remove')) },
  async exportWorkspaceBackup() { return workspaceResult.parse(await ipcRenderer.invoke('workspace:backup')) },
  async previewWorkspaceRestore() { return restoreSelection.parse(await ipcRenderer.invoke('workspace:restore:preview')) },
  async applyWorkspaceRestore(token: string) { return restoreDecision.parse(await ipcRenderer.invoke('workspace:restore:apply', uuidSchema.parse(token))) },
  async cancelWorkspaceRestore(token: string) { return restoreDecision.parse(await ipcRenderer.invoke('workspace:restore:cancel', uuidSchema.parse(token))) },
  async getProfile() {
    return profileSnapshotSchema.parse(await ipcRenderer.invoke('profile:get'))
  },
  async previewProfilePdfImport() { return profilePdfPreviewSchema.parse(await ipcRenderer.invoke('profile:pdf-import:preview')) },
  async cancelProfilePdfImport(token: string) { return z.object({ ok: z.boolean(), message: z.string() }).strict().parse(await ipcRenderer.invoke('profile:pdf-import:cancel', uuidSchema.parse(token))) },
  async rebaseProfilePdfImport(token: string) { return profilePdfRebaseResultSchema.parse(await ipcRenderer.invoke('profile:pdf-import:rebase', uuidSchema.parse(token))) },
  async applyProfilePdfImport(token: string, proposals: import('../shared/profile-pdf-import').ProfilePdfProposal) { return profilePdfApplyResultSchema.parse(await ipcRenderer.invoke('profile:pdf-import:apply', uuidSchema.parse(token), profilePdfProposalSchema.parse(proposals))) },
  async previewProfileDocxImport() { return profilePdfPreviewSchema.parse(await ipcRenderer.invoke('profile:docx-import:preview')) },
  async cancelProfileDocxImport(token: string) { return z.object({ ok: z.boolean(), message: z.string() }).strict().parse(await ipcRenderer.invoke('profile:docx-import:cancel', uuidSchema.parse(token))) },
  async rebaseProfileDocxImport(token: string) { return profilePdfRebaseResultSchema.parse(await ipcRenderer.invoke('profile:docx-import:rebase', uuidSchema.parse(token))) },
  async applyProfileDocxImport(token: string, proposals: import('../shared/profile-pdf-import').ProfilePdfProposal) { return profilePdfApplyResultSchema.parse(await ipcRenderer.invoke('profile:docx-import:apply', uuidSchema.parse(token), profilePdfProposalSchema.parse(proposals))) },
  async previewProfileAiStructuring(importToken: string) { return profileAiConsentPreviewSchema.parse(await ipcRenderer.invoke('profile:ai:preview', uuidSchema.parse(importToken))) },
  async consentProfileAiStructuring(token: string, accepted: boolean) { if (typeof accepted !== 'boolean') throw new Error('Choose whether to send this CV text.'); return profileAiConsentActionSchema.parse(await ipcRenderer.invoke('profile:ai:consent', uuidSchema.parse(token), accepted)) },
  async runProfileAiStructuring(token: string) { return profileAiRunResultSchema.parse(await ipcRenderer.invoke('profile:ai:run', uuidSchema.parse(token))) },
  async cancelProfileAiStructuring(token: string) { return z.object({ ok: z.boolean(), message: z.string() }).strict().parse(await ipcRenderer.invoke('profile:ai:cancel', uuidSchema.parse(token))) },
  async exportProfile() { return await ipcRenderer.invoke('profile:export') },
  async previewProfileImport() { return profileExchangeResultSchema.parse(await ipcRenderer.invoke('profile:import:preview')) },
  async applyProfileImport(token: string) { return await ipcRenderer.invoke('profile:import:apply', uuidSchema.parse(token)) },
  async cancelProfileImport(token: string) { return await ipcRenderer.invoke('profile:import:cancel', uuidSchema.parse(token)) },
  async saveContact(input: ContactInput & { id?: string }) {
    return profileMutationResultSchema.parse(await ipcRenderer.invoke('profile:contact:save', input))
  },
  async deleteContact(id: string) {
    return profileMutationResultSchema.parse(await ipcRenderer.invoke('profile:contact:delete', id))
  },
  async saveSkill(input: SkillInput & { id?: string }) {
    return profileMutationResultSchema.parse(await ipcRenderer.invoke('profile:skill:save', input))
  },
  async deleteSkill(id: string) {
    return profileMutationResultSchema.parse(await ipcRenderer.invoke('profile:skill:delete', id))
  },
  async saveProfileEntry(input: ProfileEntryInput & { id?: string }) {
    return profileMutationResultSchema.parse(await ipcRenderer.invoke('profile:entry:save', profileEntryInputSchema.extend({ id: uuidSchema.optional() }).parse(input)))
  },
  async deleteProfileEntry(id: string) {
    return profileMutationResultSchema.parse(await ipcRenderer.invoke('profile:entry:delete', uuidSchema.parse(id)))
  },
  async getEvidenceHistory(id: string) {
    const revisions = await ipcRenderer.invoke('profile:history', uuidSchema.parse(id))
    return evidenceRevisionSchema.array().parse(revisions)
  },
  async getExperience() {
    return experienceSnapshotSchema.parse(await ipcRenderer.invoke('profile:experience:get'))
  },
  async saveExperience(input: ExperienceInput & { id?: string }) {
    return experienceMutationResultSchema.parse(await ipcRenderer.invoke('profile:experience:save', input))
  },
  async deleteExperience(id: string) {
    return experienceMutationResultSchema.parse(await ipcRenderer.invoke('profile:experience:delete', id))
  },
  async saveProject(input: ProjectInput & { id?: string }) {
    return experienceMutationResultSchema.parse(await ipcRenderer.invoke('profile:project:save', input))
  },
  async deleteProject(id: string) {
    return experienceMutationResultSchema.parse(await ipcRenderer.invoke('profile:project:delete', id))
  },
  async saveJob(input: JobInput & { id?: string }) {
    return jobSaveResultSchema.parse(await ipcRenderer.invoke('jobs:save', input))
  },
  async listJobs() {
    return jobRecordSchema.array().parse(await ipcRenderer.invoke('jobs:list'))
  },
  async previewJobDeletion(jobIds: string[]) {
    return jobDeletionPreviewSchema.parse(await ipcRenderer.invoke('jobs:delete:preview', jobDeletionSelectionSchema.parse(jobIds)))
  },
  async executeJobDeletion(token: string, jobIds: string[]) {
    return jobDeletionResultSchema.parse(await ipcRenderer.invoke('jobs:delete:execute', jobDeletionExecuteSchema.parse({ token, jobIds })))
  },
  async openJob(id: string) {
    const job = await ipcRenderer.invoke('jobs:open', uuidSchema.parse(id))
    return job === null ? null : jobRecordSchema.parse(job)
  },
  async startJobResearch(url: string) {
    // Normalize only public metadata; never accept credential-bearing or tracking-laden IPC inputs.
    return researchStartSchema.parse(await ipcRenderer.invoke('job-research:start', normalizeJobResearchUrl(url).canonicalUrl))
  },
  async startJobResearchFromPosting(token: string) { return researchStartSchema.parse(await ipcRenderer.invoke('job-research:from-posting', uuidSchema.parse(token))) },
  async getJobResearch(token: string) { return researchStateSchema.parse(await ipcRenderer.invoke('job-research:get', uuidSchema.parse(token))) },
  async searchJobResearch(token: string) { return researchStateSchema.parse(await ipcRenderer.invoke('job-research:search', uuidSchema.parse(token))) },
  async reviewJobResearch(token: string, acceptedFindingIds: string[], acknowledgedPartial: boolean) {
    const review = researchReviewInputSchema.parse({ acceptedFindingIds, acknowledgedPartial })
    return researchReviewStateSchema.parse(await ipcRenderer.invoke('job-research:review', uuidSchema.parse(token), review))
  },
  async cancelJobResearch(token: string) { return researchCancelSchema.parse(await ipcRenderer.invoke('job-research:cancel', uuidSchema.parse(token))) },
  async previewResearchAnalysis(researchToken: string) { return researchAnalysisPreviewReplySchema.parse(await ipcRenderer.invoke('research-analysis:preview', researchAnalysisTokenSchema.parse(researchToken))) },
  async consentResearchAnalysis(token: string, accepted: boolean) { return researchAnalysisProgressReplySchema.parse(await ipcRenderer.invoke('research-analysis:consent', researchAnalysisTokenSchema.parse(token), researchAnalysisConsentSchema.parse(accepted))) },
  async startResearchAnalysis(token: string) { return researchAnalysisProgressReplySchema.parse(await ipcRenderer.invoke('research-analysis:start', researchAnalysisTokenSchema.parse(token))) },
  async readResearchAnalysis(token: string) { return researchAnalysisProgressReplySchema.parse(await ipcRenderer.invoke('research-analysis:read', researchAnalysisTokenSchema.parse(token))) },
  async cancelResearchAnalysis(token: string) { return researchAnalysisProgressReplySchema.parse(await ipcRenderer.invoke('research-analysis:cancel', researchAnalysisTokenSchema.parse(token))) },
  async discardResearchAnalysis(token: string) { return researchAnalysisDiscardReplySchema.parse(await ipcRenderer.invoke('research-analysis:discard', researchAnalysisTokenSchema.parse(token))) },
  async startPostingFetch(url: string) {
    if (typeof url !== 'string' || new TextEncoder().encode(url).length > 2048) throw new Error('The posting link is invalid or too long.')
    return z.object({ token: uuidSchema }).strict().parse(await ipcRenderer.invoke('posting-import:start', url))
  },
  async updatePostingPreview(token: string, expectedRevision: number, input: import('../shared/posting-import').PostingPreviewEdit) { return await ipcRenderer.invoke('posting-import:update-preview', uuidSchema.parse(token), expectedRevision, postingPreviewEditSchema.parse(input)) },
  async reviewPostingPreview(token: string, revision: number, review: import('../shared/posting-import').PostingReview) { return await ipcRenderer.invoke('posting-import:review-preview', uuidSchema.parse(token), revision, postingReviewSchema.parse(review)) },
  async acceptPostingImport(token: string, revision: number) { return jobSaveResultSchema.parse(await ipcRenderer.invoke('posting-import:accept', uuidSchema.parse(token), revision)) },
  async comparePostingRefresh(token: string, jobId: string, expectedUpdatedAt: string, expectedRevision: number) { return postingRefreshComparisonSchema.parse(await ipcRenderer.invoke('posting-refresh:compare', uuidSchema.parse(token), uuidSchema.parse(jobId), expectedUpdatedAt, expectedRevision)) },
  async acceptPostingRefresh(token: string, revision: number, jobId: string, expectedUpdatedAt: string, expectedBaseRevision: number, choices: import('../shared/jobs').PostingRefreshChoice) { return jobSaveResultSchema.parse(await ipcRenderer.invoke('posting-refresh:accept', uuidSchema.parse(token), revision, uuidSchema.parse(jobId), expectedUpdatedAt, expectedBaseRevision, postingRefreshChoiceSchema.parse(choices))) },
  async readPostingPreview(token: string) { return postingFetchStateSchema.parse(await ipcRenderer.invoke('posting-import:read', uuidSchema.parse(token))) },
  async cancelPostingFetch(token: string) { return z.object({ ok: z.boolean() }).strict().parse(await ipcRenderer.invoke('posting-import:cancel', uuidSchema.parse(token))) },
  async openPostingSource(url: string) { return z.object({ ok: z.boolean(), message: z.string() }).strict().parse(await ipcRenderer.invoke('posting-import:open-source', url)) },
  async prepareOutboundConsent(jobId: string) {
    return outboundConsentPreviewSchema.parse(await ipcRenderer.invoke('consent:outbound:preview', uuidSchema.parse(jobId)))
  },
  async acceptOutboundConsent(token: string, accepted: boolean, privacyAcknowledged: boolean) {
    return outboundConsentActionSchema.parse(await ipcRenderer.invoke('consent:outbound:accept', uuidSchema.parse(token), accepted, privacyAcknowledged))
  },
  async cancelOutboundConsent(token: string) {
    return outboundConsentActionSchema.parse(await ipcRenderer.invoke('consent:outbound:cancel', uuidSchema.parse(token)))
  },
  async startAnalysis(consentToken: string): Promise<AnalysisResult> { return analysisResultSchema.parse(await ipcRenderer.invoke('analysis:start', uuidSchema.parse(consentToken))) },
  async getAnalysis(jobId: string) { const value = await ipcRenderer.invoke('analysis:get', analysisIdSchema.parse(jobId)); return value === null ? null : analysisResultSchema.parse(value) },
  async generateDraft(consentToken: string, pageTarget: 1 | 2 = 1) { if (pageTarget !== 1 && pageTarget !== 2) throw new Error('Choose a one- or two-page target.'); return draftGenerationSchema.parse(await ipcRenderer.invoke('draft:generate', uuidSchema.parse(consentToken), pageTarget)) },
  async renewDraftReview(jobId: string) { return draftGenerationSchema.parse(await ipcRenderer.invoke('draft:renew-review', uuidSchema.parse(jobId))) },
  async regenerateDraft(consentToken: string, target: Parameters<WorkbenchAPI['regenerateDraft']>[1]) { return regenerationResultSchema.parse(await ipcRenderer.invoke('draft:regenerate', uuidSchema.parse(consentToken), regenerationTargetSchema.parse(target))) },
  async getRegenerationProposal(jobId: string) { const value = await ipcRenderer.invoke('draft:regeneration:get', analysisIdSchema.parse(jobId)); return value === null ? null : regenerationProposalSchema.parse(value) },
  async resolveRegenerationProposal(jobId: string, proposalId: string, decision: 'accept' | 'reject') { if (decision !== 'accept' && decision !== 'reject') throw new Error('Choose accept or reject.'); return await ipcRenderer.invoke('draft:regeneration:resolve', analysisIdSchema.parse(jobId), uuidSchema.parse(proposalId), decision) },
  async getDraft(jobId: string) { const value = await ipcRenderer.invoke('draft:get', analysisIdSchema.parse(jobId)); return value === null ? null : draftRevisionSchema.parse(value) },
  async checkDraft(jobId: string) { const value = await ipcRenderer.invoke('draft:check', analysisIdSchema.parse(jobId)); return value === null ? null : factualCheckReportSchema.parse(value) },
  async approveDraft(jobId: string) { return await ipcRenderer.invoke('draft:approve', analysisIdSchema.parse(jobId)) },
  async assertDraftExportable(jobId: string) { return await ipcRenderer.invoke('draft:export-guard', analysisIdSchema.parse(jobId)) },
  async exportApprovedPdf(jobId: string) { return z.object({ ok: z.boolean(), cancelled: z.boolean(), message: z.string() }).strict().parse(await ipcRenderer.invoke('document:export-pdf', analysisIdSchema.parse(jobId))) },
  async exportDraftDocx(jobId: string) { return z.object({ ok: z.boolean(), cancelled: z.boolean(), message: z.string(), path: z.string().optional() }).strict().parse(await ipcRenderer.invoke('document:export-docx', analysisIdSchema.parse(jobId))) },
  async decideSuggestedSkill(input: Parameters<WorkbenchAPI['decideSuggestedSkill']>[0]) { return draftGenerationSchema.parse(await ipcRenderer.invoke('draft:skill-decision', suggestedSkillDecisionSchema.parse(input))) },
  async correctDraftTailoring(input: Parameters<WorkbenchAPI['correctDraftTailoring']>[0]) { return draftGenerationSchema.parse(await ipcRenderer.invoke('draft:tailoring:correct', draftTailoringCorrectionSchema.parse(input))) },
  async correctDraft(input: Parameters<WorkbenchAPI['correctDraft']>[0]) { const checked = draftCorrectionInputSchema.parse(input); const value = await ipcRenderer.invoke('draft:correct', checked); return value === null ? null : draftRevisionSchema.parse(value) },
  async mutateDraftRecord(input: Parameters<WorkbenchAPI['mutateDraftRecord']>[0]) { return await ipcRenderer.invoke('draft:record:mutate', mutateDraftRecordInputSchema.parse(input)) },
  async addDraftItem(input: Parameters<WorkbenchAPI['addDraftItem']>[0]) { const checked = addDraftItemInputSchema.parse(input); const value = await ipcRenderer.invoke('draft:add-item', checked); return value === null ? null : draftRevisionSchema.parse(value) },
  async getCanonicalDocument(jobId: string) { const value = await ipcRenderer.invoke('document:preview', analysisIdSchema.parse(jobId)); return value === null ? null : canonicalDocumentSchema.parse(value) },
  async getDocumentPdf(jobId: string) { return documentPdfSchema.parse(await ipcRenderer.invoke('document:pdf', analysisIdSchema.parse(jobId))) },
  async measureDocument(jobId: string) { return documentFitReportSchema.parse(await ipcRenderer.invoke('document:measure', analysisIdSchema.parse(jobId))) },
  async getDocumentFitReport(jobId: string) { const value = await ipcRenderer.invoke('document:fit:get', analysisIdSchema.parse(jobId)); return value === null ? null : documentFitReportSchema.parse(value) },
  async acceptDocumentCuts(jobId: string, documentHash: string, entryIds: string[]) { return await ipcRenderer.invoke('document:cuts:accept', analysisIdSchema.parse(jobId), documentHash, entryIds) },
  async cancelAnalysis(jobId: string) { return analysisResultSchema.parse(await ipcRenderer.invoke('analysis:cancel', analysisIdSchema.parse(jobId))) },
  async getGenerationRecovery(jobId: string) { const value = await ipcRenderer.invoke('generation:recovery:get', analysisIdSchema.parse(jobId)); return value === null ? null : generationRecoverySchema.parse(value) },
  async resumeGeneration(runId: string, choice?: RecoveryChoice) { return await ipcRenderer.invoke('generation:recovery:resume', analysisIdSchema.parse(runId), choice === undefined ? undefined : recoveryChoiceSchema.parse(choice)) },
  async cancelGenerationRecovery(runId: string) { return await ipcRenderer.invoke('generation:recovery:cancel', analysisIdSchema.parse(runId)) }
})
contextBridge.exposeInMainWorld('workbench', api)
