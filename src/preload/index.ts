import { contextBridge, ipcRenderer } from 'electron'
import { appearanceSchema, settingsSchema, type Appearance, type WorkbenchAPI } from '../shared/appearance'
import { geminiKeyInputSchema, geminiModelSchema, type GeminiModel } from '../shared/gemini-settings'
import { evidenceRevisionSchema, profileEntryInputSchema, profileMutationResultSchema, profileSnapshotSchema, uuidSchema, type ContactInput, type ProfileEntryInput, type SkillInput } from '../shared/profile'

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
  }
})
contextBridge.exposeInMainWorld('workbench', api)
