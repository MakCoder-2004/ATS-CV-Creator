import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { readFile, stat, writeFile } from 'node:fs/promises'
import type { WorkbenchStorageAPI } from '../shared/appearance'
import { profileExchangeSchema, profileExchangeResultSchema, type ProfileExchange } from '../shared/profile-exchange'
import { uuidSchema } from '../shared/profile'

function countRecords(data: ProfileExchange): number {
  return Object.values(data.profile).filter(Array.isArray).reduce((count, records) => count + records.length, 0) + data.experience.experience.length + data.experience.projects.length + (data.profile.contact ? 1 : 0)
}

function replacementEffects(before: ProfileExchange, after: ProfileExchange) {
  const collections = (exchange: ProfileExchange) => ({
    contact: exchange.profile.contact ? [{ id: exchange.profile.contact.id, label: exchange.profile.contact.fullName, record: exchange.profile.contact }] : [],
    skills: exchange.profile.skills.map(record => ({ id: record.id, label: record.name, record })),
    education: exchange.profile.education.map(record => ({ id: record.id, label: record.title, record })),
    experience: exchange.experience.experience.map(record => ({ id: record.id, label: `${record.title} — ${record.organization}`, record })),
    projects: exchange.experience.projects.map(record => ({ id: record.id, label: record.name, record })),
    certificates: exchange.profile.certificates.map(record => ({ id: record.id, label: record.title, record })),
    summary: exchange.profile.summary.map(record => ({ id: record.id, label: record.title, record })),
    languages: exchange.profile.languages.map(record => ({ id: record.id, label: record.title, record })),
    extras: exchange.profile.extras.map(record => ({ id: record.id, label: record.title, record }))
  })
  const oldCollections = collections(before), newCollections = collections(after)
  return Object.keys(oldCollections).flatMap(section => {
    const oldItems = oldCollections[section as keyof typeof oldCollections], newItems = newCollections[section as keyof typeof newCollections]
    const oldById = new Map(oldItems.map(item => [item.id, item])), newById = new Map(newItems.map(item => [item.id, item]))
    return [...oldItems.filter(item => !newById.has(item.id)).map(item => ({ section, action: 'remove' as const, currentLabel: item.label })),
      ...newItems.filter(item => !oldById.has(item.id)).map(item => ({ section, action: 'add' as const, replacementLabel: item.label })),
      ...newItems.filter(item => oldById.has(item.id) && !isDeepStrictEqual(item.record, oldById.get(item.id)!.record)).map(item => ({ section, action: 'replace' as const, currentLabel: oldById.get(item.id)!.label, replacementLabel: item.label }))]
  })
}

/** Owns temporary preview tokens and native profile JSON dialogs; never exposes arbitrary paths through IPC. */
export function registerProfileExchangeIpc(getWindow: () => BrowserWindow, getStorage: () => WorkbenchStorageAPI, trusted: (event: IpcMainInvokeEvent) => void): void {
  const pending = new Map<string, { value: ProfileExchange; baseline: string }>()
  const current = async () => ({ profile: await getStorage().getProfile(), experience: await getStorage().getExperience() })
  ipcMain.handle('profile:export', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length) throw new Error('Unexpected arguments')
    try {
      const selected = await dialog.showSaveDialog(getWindow(), { title: 'Export profile JSON', defaultPath: 'cv-tailor-profile.json', filters: [{ name: 'CV Tailor profile', extensions: ['json'] }] })
      if (selected.canceled || !selected.filePath) return { ok: false, cancelled: true, message: 'Profile export cancelled.' }
      const snapshot = await current()
      const data = profileExchangeSchema.parse({ format: 'cv-tailor-profile', version: 1, ...snapshot })
      await writeFile(selected.filePath, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
      return { ok: true, cancelled: false, message: 'Profile JSON exported.' }
    } catch { return { ok: false, cancelled: false, message: 'Profile export could not complete. Check the selected destination and its permissions.' } }
  })
  ipcMain.handle('profile:import:preview', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length) throw new Error('Unexpected arguments')
    try {
      const selected = await dialog.showOpenDialog(getWindow(), { title: 'Select profile JSON', properties: ['openFile'], filters: [{ name: 'CV Tailor profile', extensions: ['json'] }] })
      if (selected.canceled || !selected.filePaths[0]) return profileExchangeResultSchema.parse({ ok: false, cancelled: true, message: 'Profile import cancelled.' })
      const file = selected.filePaths[0]
      const info = await stat(file)
      if (!info.isFile() || info.size > 32 * 1024 * 1024) return profileExchangeResultSchema.parse({ ok: false, cancelled: false, message: 'Choose a readable profile JSON file smaller than 32 MB.' })
      const value = profileExchangeSchema.parse(JSON.parse(await readFile(file, 'utf8')))
      const validation = await getStorage().validateProfileImport(JSON.stringify(value))
      if (!validation.ok) return profileExchangeResultSchema.parse({ ok: false, cancelled: false, message: validation.message })
      const before = { ...value, ...(await current()) }
      const token = randomUUID()
      pending.set(token, { value, baseline: JSON.stringify({ profile: before.profile, experience: before.experience }) })
      return profileExchangeResultSchema.parse({ ok: true, token, value, current: { records: countRecords(before) }, replacement: { records: countRecords(value) }, effects: replacementEffects(before, value) })
    } catch { return profileExchangeResultSchema.parse({ ok: false, cancelled: false, message: 'This profile file could not be read or is invalid or incompatible.' }) }
  })
  ipcMain.handle('profile:import:cancel', (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 1) throw new Error('Expected import preview token')
    const token = uuidSchema.safeParse(args[0])
    if (!token.success || !pending.delete(token.data)) return { ok: false, message: 'This profile preview has expired.' }
    return { ok: true, message: 'Profile replacement cancelled; no data was changed.' }
  })
  ipcMain.handle('profile:import:apply', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 1) throw new Error('Expected import preview token')
    const token = uuidSchema.safeParse(args[0])
    const selected = token.success ? pending.get(token.data) : undefined
    if (token.success) pending.delete(token.data)
    if (!selected) return { ok: false, message: 'This preview expired. Select the file again.' }
    if (JSON.stringify(await current()) !== selected.baseline) return { ok: false, message: 'Your profile changed after preview. Select the file again to review the replacement.' }
    return getStorage().replaceProfile(JSON.stringify(selected.value))
  })
}
