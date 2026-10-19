import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import type { ZodError } from 'zod'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createWorkbench } from './workbench'
import { appearanceSchema } from '../shared/appearance'
import { geminiKeyInputSchema, geminiModelSchema } from '../shared/gemini-settings'
import { contactSaveInputSchema, evidenceRevisionSchema, profileEntrySaveSchema, profileMutationResultSchema, profileSnapshotSchema, skillSaveInputSchema, uuidSchema } from '../shared/profile'
import { experienceSaveInputSchema, experienceSnapshotSchema, experienceMutationResultSchema, projectSaveInputSchema } from '../shared/experience'
import { jobRecordSchema, jobSaveInputSchema, jobSaveResultSchema } from '../shared/jobs'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { profileExchangeSchema, profileExchangeResultSchema } from '../shared/profile-exchange'

let window: BrowserWindow | undefined
let workspace: ReturnType<typeof createWorkbench> | undefined
const pendingImports = new Map<string, { value: ReturnType<typeof profileExchangeSchema.parse>; baseline: string }>()

function invalidProfileInput(error: ZodError, kind: string) {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) fieldErrors[issue.path.length ? issue.path.join('.') : '_'] = issue.message
  return profileMutationResultSchema.parse({ ok: false, error: { code: 'VALIDATION_ERROR', message: `Check the highlighted ${kind} fields.`, fieldErrors } })
}

function isTrusted(event: Electron.IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (!window || event.sender !== window.webContents || !frame || frame !== window.webContents.mainFrame) return false
  const url = new URL(frame.url)
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    return url.protocol === 'http:' && url.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
  }
  return url.protocol === 'file:' && fileURLToPath(url) === join(__dirname, '../renderer/index.html')
}

function trusted(event: Electron.IpcMainInvokeEvent): void {
  if (!isTrusted(event)) throw new Error('Untrusted IPC sender')
}

// The test override is disabled in packaged builds; production always uses Electron's userData.
if (!app.isPackaged && process.env.CV_TAILOR_TEST_USER_DATA_DIR) {
  mkdirSync(process.env.CV_TAILOR_TEST_USER_DATA_DIR, { recursive: true })
  app.setPath('userData', process.env.CV_TAILOR_TEST_USER_DATA_DIR)
}
app.whenReady().then(() => {
  workspace = createWorkbench(app.getPath('userData'), safeStorage)
  ipcMain.handle('settings:get', (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    return workspace!.api.getSettings()
  })
  ipcMain.handle('settings:appearance', (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected appearance')
    return workspace!.api.setAppearance(appearanceSchema.parse(args[0]))
  })
  ipcMain.handle('settings:gemini-model', (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected Gemini model')
    return workspace!.api.setGeminiModel(geminiModelSchema.parse(args[0]))
  })
  ipcMain.handle('settings:gemini-key:save', (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected Gemini API key')
    const input = geminiKeyInputSchema.safeParse(args[0])
    if (!input.success) throw new Error('API key input is invalid. Correct it and try again.')
    return workspace!.api.saveGeminiApiKey(input.data)
  })
  ipcMain.handle('settings:gemini-key:remove', (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    return workspace!.api.removeGeminiApiKey()
  })
  ipcMain.handle('profile:export', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length) throw new Error('Unexpected arguments')
    const selected = await dialog.showSaveDialog(window!, { title: 'Export profile JSON', defaultPath: 'cv-tailor-profile.json', filters: [{ name: 'CV Tailor profile', extensions: ['json'] }] })
    if (selected.canceled || !selected.filePath) return { ok: false, cancelled: true, message: 'Profile export cancelled.' }
    try {
      const value = profileExchangeSchema.parse({ format: 'cv-tailor-profile', version: 1, profile: await workspace!.api.getProfile(), experience: await workspace!.api.getExperience() })
      writeFileSync(selected.filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
      return { ok: true, cancelled: false, message: 'Profile JSON exported.' }
    } catch { return { ok: false, cancelled: false, message: 'Could not write the selected file. Choose a different destination or check its permissions.' } }
  })
  ipcMain.handle('profile:import:preview', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length) throw new Error('Unexpected arguments')
    const selected = await dialog.showOpenDialog(window!, { title: 'Select profile JSON', properties: ['openFile'], filters: [{ name: 'CV Tailor profile', extensions: ['json'] }] })
    if (selected.canceled || !selected.filePaths[0]) return profileExchangeResultSchema.parse({ ok: false, cancelled: true, message: 'Profile import cancelled.' })
    try {
      const value = profileExchangeSchema.parse(JSON.parse(readFileSync(selected.filePaths[0], 'utf8')))
      const token = randomUUID()
      const currentProfile = await workspace!.api.getProfile(), currentExperience = await workspace!.api.getExperience()
      pendingImports.set(token, { value, baseline: JSON.stringify({ profile: currentProfile, experience: currentExperience }) })
      const count = (p: typeof value) => Object.values(p.profile).filter(Array.isArray).reduce((n, xs) => n + xs.length, 0) + p.experience.experience.length + p.experience.projects.length + (p.profile.contact ? 1 : 0)
      return profileExchangeResultSchema.parse({ ok: true, token, value, current: { records: count({ ...value, profile: currentProfile, experience: currentExperience }) }, replacement: { records: count(value) } })
    } catch { return profileExchangeResultSchema.parse({ ok: false, cancelled: false, message: 'This file is not valid CV Tailor profile JSON.' }) }
  })
  ipcMain.handle('profile:import:apply', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 1 || typeof args[0] !== 'string') throw new Error('Expected import preview token')
    const pending = pendingImports.get(args[0]); pendingImports.delete(args[0])
    if (!pending) return { ok: false, message: 'This preview expired. Select the file again.' }
    const baseline = JSON.stringify({ profile: await workspace!.api.getProfile(), experience: await workspace!.api.getExperience() })
    if (baseline !== pending.baseline) return { ok: false, message: 'Your profile changed after preview. Select the file again to review the replacement.' }
    return workspace!.api.applyProfileImport(JSON.stringify(pending.value))
  })
  ipcMain.handle('profile:get', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    return profileSnapshotSchema.parse(await workspace!.api.getProfile())
  })
  ipcMain.handle('profile:contact:save', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected contact')
    const input = contactSaveInputSchema.safeParse(args[0])
    if (!input.success) return invalidProfileInput(input.error, 'contact')
    return profileMutationResultSchema.parse(await workspace!.api.saveContact(input.data))
  })
  ipcMain.handle('profile:contact:delete', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected contact ID')
    const id = uuidSchema.safeParse(args[0])
    if (!id.success) return invalidProfileInput(id.error, 'contact')
    return profileMutationResultSchema.parse(await workspace!.api.deleteContact(id.data))
  })
  ipcMain.handle('profile:skill:save', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected skill')
    const input = skillSaveInputSchema.safeParse(args[0])
    if (!input.success) return invalidProfileInput(input.error, 'skill')
    return profileMutationResultSchema.parse(await workspace!.api.saveSkill(input.data))
  })
  ipcMain.handle('profile:skill:delete', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected skill ID')
    const id = uuidSchema.safeParse(args[0])
    if (!id.success) return invalidProfileInput(id.error, 'skill')
    return profileMutationResultSchema.parse(await workspace!.api.deleteSkill(id.data))
  })
  ipcMain.handle('profile:entry:save', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected profile record')
    const input = profileEntrySaveSchema.safeParse(args[0])
    if (!input.success) return invalidProfileInput(input.error, 'profile')
    return profileMutationResultSchema.parse(await workspace!.api.saveProfileEntry(input.data))
  })
  ipcMain.handle('profile:entry:delete', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected profile record ID')
    const id = uuidSchema.safeParse(args[0])
    if (!id.success) return invalidProfileInput(id.error, 'profile')
    return profileMutationResultSchema.parse(await workspace!.api.deleteProfileEntry(id.data))
  })
  ipcMain.handle('profile:history', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected evidence ID')
    return evidenceRevisionSchema.array().parse(await workspace!.api.getEvidenceHistory(uuidSchema.parse(args[0])))
  })
  ipcMain.handle('profile:experience:get', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length) throw new Error('Unexpected arguments')
    return experienceSnapshotSchema.parse(await workspace!.api.getExperience())
  })
  const registerExperienceMutation = (channel: string, schema: typeof experienceSaveInputSchema | typeof projectSaveInputSchema, command: 'saveExperience' | 'saveProject') => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      trusted(event); if (args.length !== 1) throw new Error('Expected profile record')
      const parsed = schema.safeParse(args[0])
      if (!parsed.success) return experienceMutationResultSchema.parse({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Check the highlighted profile fields.', fieldErrors: Object.fromEntries(parsed.error.issues.map(issue => [issue.path.join('.') || '_', issue.message])) } })
      return experienceMutationResultSchema.parse(await workspace!.api[command](parsed.data as never))
    })
  }
  registerExperienceMutation('profile:experience:save', experienceSaveInputSchema, 'saveExperience')
  registerExperienceMutation('profile:project:save', projectSaveInputSchema, 'saveProject')
  for (const [channel, command] of [['profile:experience:delete', 'deleteExperience'], ['profile:project:delete', 'deleteProject']] as const) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      trusted(event); if (args.length !== 1) throw new Error('Expected profile record ID')
      const id = uuidSchema.safeParse(args[0])
      if (!id.success) return experienceMutationResultSchema.parse({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Profile record ID must be a UUID.', fieldErrors: { id: 'Invalid ID' } } })
      return experienceMutationResultSchema.parse(await workspace!.api[command](id.data))
    })
  }
  ipcMain.handle('jobs:save', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected job')
    const input = jobSaveInputSchema.safeParse(args[0])
    if (!input.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of input.error.issues) fieldErrors[issue.path.length ? issue.path.join('.') : '_'] = issue.message
      return jobSaveResultSchema.parse({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Enter a title, company, and job description.', fieldErrors } })
    }
    return jobSaveResultSchema.parse(await workspace!.api.saveJob(input.data))
  })
  ipcMain.handle('jobs:list', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    return jobRecordSchema.array().parse(await workspace!.api.listJobs())
  })
  ipcMain.handle('jobs:open', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected job ID')
    const id = uuidSchema.safeParse(args[0])
    if (!id.success) throw new Error('Invalid job ID')
    const job = await workspace!.api.openJob(id.data)
    return job === null ? null : jobRecordSchema.parse(job)
  })

  window = new BrowserWindow({
    width: 1400, height: 900, minWidth: 640, minHeight: 560,
    show: false,
    backgroundColor: '#f3f5f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'https://ai.google.dev/gemini-api/terms') void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.once('ready-to-show', () => window?.show())
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => workspace?.close())
