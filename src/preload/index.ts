import { contextBridge, ipcRenderer } from 'electron'
import { appearanceSchema, settingsSchema, type Appearance, type WorkbenchAPI } from '../shared/appearance'
import { contactInputSchema, evidenceRevisionSchema, profileMutationResultSchema, profileSnapshotSchema, skillInputSchema, uuidSchema, type ContactInput, type SkillInput } from '../shared/profile'

const api: WorkbenchAPI = Object.freeze({
  async getSettings() {
    return settingsSchema.parse(await ipcRenderer.invoke('settings:get'))
  },
  async setAppearance(value: Appearance) {
    return settingsSchema.parse(await ipcRenderer.invoke('settings:appearance', appearanceSchema.parse(value)))
  },
  async getProfile() {
    return profileSnapshotSchema.parse(await ipcRenderer.invoke('profile:get'))
  },
  async saveContact(input: ContactInput & { id?: string }) {
    const { id, ...fields } = input
    const contact = contactInputSchema.parse(fields)
    const request = { ...contact, ...(id === undefined ? {} : { id: uuidSchema.parse(id) }) }
    return profileMutationResultSchema.parse(await ipcRenderer.invoke('profile:contact:save', request))
  },
  async deleteContact(id: string) {
    return profileMutationResultSchema.parse(await ipcRenderer.invoke('profile:contact:delete', uuidSchema.parse(id)))
  },
  async saveSkill(input: SkillInput & { id?: string }) {
    const { id, ...fields } = input
    const skill = skillInputSchema.parse(fields)
    const request = { ...skill, ...(id === undefined ? {} : { id: uuidSchema.parse(id) }) }
    return profileMutationResultSchema.parse(await ipcRenderer.invoke('profile:skill:save', request))
  },
  async deleteSkill(id: string) {
    return profileMutationResultSchema.parse(await ipcRenderer.invoke('profile:skill:delete', uuidSchema.parse(id)))
  },
  async getEvidenceHistory(id: string) {
    const revisions = await ipcRenderer.invoke('profile:history', uuidSchema.parse(id))
    return evidenceRevisionSchema.array().parse(revisions)
  }
})
contextBridge.exposeInMainWorld('workbench', api)
