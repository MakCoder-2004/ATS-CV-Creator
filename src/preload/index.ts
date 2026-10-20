import { contextBridge, ipcRenderer } from 'electron'
import { appearanceSchema, settingsSchema, type Appearance, type WorkbenchAPI } from '../shared/appearance'
import { geminiKeyInputSchema, geminiModelSchema, type GeminiModel } from '../shared/gemini-settings'
import { evidenceRevisionSchema, profileEntryInputSchema, profileMutationResultSchema, profileSnapshotSchema, uuidSchema, type ContactInput, type ProfileEntryInput, type SkillInput } from '../shared/profile'
import { experienceSnapshotSchema, experienceMutationResultSchema, type ExperienceInput, type ProjectInput } from '../shared/experience'
import { jobRecordSchema, jobSaveResultSchema, type JobInput } from '../shared/jobs'
import { profileExchangeResultSchema } from '../shared/profile-exchange'
import { outboundConsentActionSchema, outboundConsentPreviewSchema } from '../shared/outbound-consent-contract'
import { analysisBudgetsSchema, analysisIdSchema, analysisResultSchema, analysisUsageSchema, type AnalysisBudgets, type AnalysisResult } from '../shared/posting-analysis'
import { addDraftItemInputSchema, draftCorrectionInputSchema, draftGenerationSchema, draftRevisionSchema } from '../shared/draft'
import { factualCheckReportSchema } from '../shared/factual-report'
import { canonicalDocumentSchema, documentFitReportSchema } from '../shared/document'

const api: WorkbenchAPI = Object.freeze({
  async getSettings() {
    return settingsSchema.parse(await ipcRenderer.invoke('settings:get'))
  },
  async setAppearance(value: Appearance) {
    return settingsSchema.parse(await ipcRenderer.invoke('settings:appearance', appearanceSchema.parse(value)))
  },
  async setGeminiModel(value: GeminiModel) {
    return settingsSchema.parse(await ipcRenderer.invoke('settings:gemini-model', geminiModelSchema.parse(value)))
  },
  async saveGeminiApiKey(value: string) {
    return settingsSchema.parse(await ipcRenderer.invoke('settings:gemini-key:save', geminiKeyInputSchema.parse(value)))
  },
  async removeGeminiApiKey() {
    return settingsSchema.parse(await ipcRenderer.invoke('settings:gemini-key:remove'))
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
  async getDraft(jobId: string) { const value = await ipcRenderer.invoke('draft:get', analysisIdSchema.parse(jobId)); return value === null ? null : draftRevisionSchema.parse(value) },
  async checkDraft(jobId: string) { const value = await ipcRenderer.invoke('draft:check', analysisIdSchema.parse(jobId)); return value === null ? null : factualCheckReportSchema.parse(value) },
  async approveDraft(jobId: string) { return await ipcRenderer.invoke('draft:approve', analysisIdSchema.parse(jobId)) },
  async assertDraftExportable(jobId: string) { return await ipcRenderer.invoke('draft:export-guard', analysisIdSchema.parse(jobId)) },
  async correctDraft(input: Parameters<WorkbenchAPI['correctDraft']>[0]) { const checked = draftCorrectionInputSchema.parse(input); const value = await ipcRenderer.invoke('draft:correct', checked); return value === null ? null : draftRevisionSchema.parse(value) },
  async addDraftItem(input: Parameters<WorkbenchAPI['addDraftItem']>[0]) { const checked = addDraftItemInputSchema.parse(input); const value = await ipcRenderer.invoke('draft:add-item', checked); return value === null ? null : draftRevisionSchema.parse(value) },
  async getCanonicalDocument(jobId: string) { const value = await ipcRenderer.invoke('document:preview', analysisIdSchema.parse(jobId)); return value === null ? null : canonicalDocumentSchema.parse(value) },
  async measureDocument(jobId: string) { return documentFitReportSchema.parse(await ipcRenderer.invoke('document:measure', analysisIdSchema.parse(jobId))) },
  async getDocumentFitReport(jobId: string) { const value = await ipcRenderer.invoke('document:fit:get', analysisIdSchema.parse(jobId)); return value === null ? null : documentFitReportSchema.parse(value) },
  async acceptDocumentCuts(jobId: string, documentHash: string, entryIds: string[]) { return await ipcRenderer.invoke('document:cuts:accept', analysisIdSchema.parse(jobId), documentHash, entryIds) },
  async cancelAnalysis(jobId: string) { return analysisResultSchema.parse(await ipcRenderer.invoke('analysis:cancel', analysisIdSchema.parse(jobId))) },
  async getAnalysisUsage() { return analysisUsageSchema.parse(await ipcRenderer.invoke('analysis:usage')) },
  async setAnalysisBudgets(value: AnalysisBudgets) { return analysisUsageSchema.parse(await ipcRenderer.invoke('analysis:budgets:set', analysisBudgetsSchema.parse(value))) }
})
contextBridge.exposeInMainWorld('workbench', api)
