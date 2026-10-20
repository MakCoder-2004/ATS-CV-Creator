import { contextBridge, ipcRenderer } from 'electron'
import { z } from 'zod'
import { appearanceSchema, settingsSchema, type Appearance, type WorkbenchAPI } from '../shared/appearance'
import { openRouterKeyInputSchema, openRouterModelSchema, type OpenRouterModel } from '../shared/openrouter-settings'
import { evidenceRevisionSchema, profileEntryInputSchema, profileMutationResultSchema, profileSnapshotSchema, uuidSchema, type ContactInput, type ProfileEntryInput, type SkillInput } from '../shared/profile'
import { experienceSnapshotSchema, experienceMutationResultSchema, type ExperienceInput, type ProjectInput } from '../shared/experience'
import { jobRecordSchema, jobSaveResultSchema, type JobInput } from '../shared/jobs'
import { profileExchangeResultSchema } from '../shared/profile-exchange'
import { outboundConsentActionSchema, outboundConsentPreviewSchema } from '../shared/outbound-consent-contract'
import { analysisBudgetsSchema, analysisIdSchema, analysisResultSchema, analysisUsageSchema, generationRecoverySchema, recoveryChoiceSchema, type AnalysisBudgets, type AnalysisResult, type RecoveryChoice } from '../shared/posting-analysis'
import { addDraftItemInputSchema, draftCorrectionInputSchema, draftGenerationSchema, draftRevisionSchema } from '../shared/draft'
import { factualCheckReportSchema } from '../shared/factual-report'
import { canonicalDocumentSchema, documentFitReportSchema } from '../shared/document'
import { regenerationProposalSchema, regenerationResultSchema, regenerationTargetSchema } from '../shared/regeneration'

const api: WorkbenchAPI = Object.freeze({
  async getSettings() {
    return settingsSchema.parse(await ipcRenderer.invoke('settings:get'))
  },
  async setAppearance(value: Appearance) {
    return settingsSchema.parse(await ipcRenderer.invoke('settings:appearance', appearanceSchema.parse(value)))
  },
  async setOpenRouterModel(value: OpenRouterModel) {
    return settingsSchema.parse(await ipcRenderer.invoke('settings:openrouter-model', openRouterModelSchema.parse(value)))
  },
  async setFaithfulnessCheck(value: boolean) {
    if (typeof value !== 'boolean') throw new Error('Faithfulness setting must be boolean.')
    return settingsSchema.parse(await ipcRenderer.invoke('settings:faithfulness', value))
  },
  async saveOpenRouterApiKey(value: string) {
    return settingsSchema.parse(await ipcRenderer.invoke('settings:openrouter-key:save', openRouterKeyInputSchema.parse(value)))
  },
  async revealOpenRouterApiKey() {
    const value: unknown = await ipcRenderer.invoke('settings:openrouter-key:reveal')
    return openRouterKeyInputSchema.parse(value)
  },
  async copyOpenRouterApiKey() {
    await ipcRenderer.invoke('settings:openrouter-key:copy')
  },
  async removeOpenRouterApiKey() {
    return settingsSchema.parse(await ipcRenderer.invoke('settings:openrouter-key:remove'))
  },
  async getProfile() {
    return profileSnapshotSchema.parse(await ipcRenderer.invoke('profile:get'))
  },
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
  async openJob(id: string) {
    const job = await ipcRenderer.invoke('jobs:open', uuidSchema.parse(id))
    return job === null ? null : jobRecordSchema.parse(job)
  },
  async prepareOutboundConsent(jobId: string) {
    return outboundConsentPreviewSchema.parse(await ipcRenderer.invoke('consent:outbound:preview', uuidSchema.parse(jobId)))
  },
  async acceptOutboundConsent(token: string, accepted: boolean, freeTierTermsAcknowledged: boolean) {
    return outboundConsentActionSchema.parse(await ipcRenderer.invoke('consent:outbound:accept', uuidSchema.parse(token), accepted, freeTierTermsAcknowledged))
  },
  async cancelOutboundConsent(token: string) {
    return outboundConsentActionSchema.parse(await ipcRenderer.invoke('consent:outbound:cancel', uuidSchema.parse(token)))
  },
  async startAnalysis(consentToken: string): Promise<AnalysisResult> { return analysisResultSchema.parse(await ipcRenderer.invoke('analysis:start', uuidSchema.parse(consentToken))) },
  async getAnalysis(jobId: string) { const value = await ipcRenderer.invoke('analysis:get', analysisIdSchema.parse(jobId)); return value === null ? null : analysisResultSchema.parse(value) },
  async generateDraft(consentToken: string, pageTarget: 1 | 2 = 1) { if (pageTarget !== 1 && pageTarget !== 2) throw new Error('Choose a one- or two-page target.'); return draftGenerationSchema.parse(await ipcRenderer.invoke('draft:generate', uuidSchema.parse(consentToken), pageTarget)) },
  async regenerateDraft(consentToken: string, target: Parameters<WorkbenchAPI['regenerateDraft']>[1]) { return regenerationResultSchema.parse(await ipcRenderer.invoke('draft:regenerate', uuidSchema.parse(consentToken), regenerationTargetSchema.parse(target))) },
  async getRegenerationProposal(jobId: string) { const value = await ipcRenderer.invoke('draft:regeneration:get', analysisIdSchema.parse(jobId)); return value === null ? null : regenerationProposalSchema.parse(value) },
  async resolveRegenerationProposal(jobId: string, proposalId: string, decision: 'accept' | 'reject') { if (decision !== 'accept' && decision !== 'reject') throw new Error('Choose accept or reject.'); return await ipcRenderer.invoke('draft:regeneration:resolve', analysisIdSchema.parse(jobId), uuidSchema.parse(proposalId), decision) },
  async getDraft(jobId: string) { const value = await ipcRenderer.invoke('draft:get', analysisIdSchema.parse(jobId)); return value === null ? null : draftRevisionSchema.parse(value) },
  async checkDraft(jobId: string) { const value = await ipcRenderer.invoke('draft:check', analysisIdSchema.parse(jobId)); return value === null ? null : factualCheckReportSchema.parse(value) },
  async approveDraft(jobId: string) { return await ipcRenderer.invoke('draft:approve', analysisIdSchema.parse(jobId)) },
  async assertDraftExportable(jobId: string) { return await ipcRenderer.invoke('draft:export-guard', analysisIdSchema.parse(jobId)) },
  async exportApprovedPdf(jobId: string) { return z.object({ ok: z.boolean(), cancelled: z.boolean(), message: z.string() }).strict().parse(await ipcRenderer.invoke('document:export-pdf', analysisIdSchema.parse(jobId))) },
  async exportDraftDocx(jobId: string) { return z.object({ ok: z.boolean(), cancelled: z.boolean(), message: z.string(), path: z.string().optional() }).strict().parse(await ipcRenderer.invoke('document:export-docx', analysisIdSchema.parse(jobId))) },
  async correctDraft(input: Parameters<WorkbenchAPI['correctDraft']>[0]) { const checked = draftCorrectionInputSchema.parse(input); const value = await ipcRenderer.invoke('draft:correct', checked); return value === null ? null : draftRevisionSchema.parse(value) },
  async addDraftItem(input: Parameters<WorkbenchAPI['addDraftItem']>[0]) { const checked = addDraftItemInputSchema.parse(input); const value = await ipcRenderer.invoke('draft:add-item', checked); return value === null ? null : draftRevisionSchema.parse(value) },
  async getCanonicalDocument(jobId: string) { const value = await ipcRenderer.invoke('document:preview', analysisIdSchema.parse(jobId)); return value === null ? null : canonicalDocumentSchema.parse(value) },
  async measureDocument(jobId: string) { return documentFitReportSchema.parse(await ipcRenderer.invoke('document:measure', analysisIdSchema.parse(jobId))) },
  async getDocumentFitReport(jobId: string) { const value = await ipcRenderer.invoke('document:fit:get', analysisIdSchema.parse(jobId)); return value === null ? null : documentFitReportSchema.parse(value) },
  async acceptDocumentCuts(jobId: string, documentHash: string, entryIds: string[]) { return await ipcRenderer.invoke('document:cuts:accept', analysisIdSchema.parse(jobId), documentHash, entryIds) },
  async cancelAnalysis(jobId: string) { return analysisResultSchema.parse(await ipcRenderer.invoke('analysis:cancel', analysisIdSchema.parse(jobId))) },
  async getGenerationRecovery(jobId: string) { const value = await ipcRenderer.invoke('generation:recovery:get', analysisIdSchema.parse(jobId)); return value === null ? null : generationRecoverySchema.parse(value) },
  async resumeGeneration(runId: string, choice?: RecoveryChoice) { return await ipcRenderer.invoke('generation:recovery:resume', analysisIdSchema.parse(runId), choice === undefined ? undefined : recoveryChoiceSchema.parse(choice)) },
  async cancelGenerationRecovery(runId: string) { return await ipcRenderer.invoke('generation:recovery:cancel', analysisIdSchema.parse(runId)) },
  async getAnalysisUsage() { return analysisUsageSchema.parse(await ipcRenderer.invoke('analysis:usage')) },
  async setAnalysisBudgets(value: AnalysisBudgets) { return analysisUsageSchema.parse(await ipcRenderer.invoke('analysis:budgets:set', analysisBudgetsSchema.parse(value))) }
})
contextBridge.exposeInMainWorld('workbench', api)
