import { contextBridge, ipcRenderer } from 'electron'
import { appearanceSchema, settingsSchema, type Appearance, type WorkbenchAPI } from '../shared/appearance'

const api: WorkbenchAPI = Object.freeze({
  async getSettings() {
    return settingsSchema.parse(await ipcRenderer.invoke('settings:get'))
  },
  async setAppearance(value: Appearance) {
    return settingsSchema.parse(await ipcRenderer.invoke('settings:appearance', appearanceSchema.parse(value)))
  }
})
contextBridge.exposeInMainWorld('workbench', api)
