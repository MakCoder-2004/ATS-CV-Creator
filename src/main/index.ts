import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createWorkbench } from './workbench'
import { appearanceSchema } from '../shared/appearance'
import { contactSaveInputSchema, evidenceRevisionSchema, profileMutationResultSchema, profileSnapshotSchema, skillSaveInputSchema, uuidSchema } from '../shared/profile'

let window: BrowserWindow | undefined
let workspace: ReturnType<typeof createWorkbench> | undefined

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
  workspace = createWorkbench(app.getPath('userData'))
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
  ipcMain.handle('profile:get', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    return profileSnapshotSchema.parse(await workspace!.api.getProfile())
  })
  ipcMain.handle('profile:contact:save', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1 || typeof args[0] !== 'object' || args[0] === null || Array.isArray(args[0])) throw new Error('Expected contact')
    const input = contactSaveInputSchema.parse(args[0])
    return profileMutationResultSchema.parse(await workspace!.api.saveContact(input))
  })
  ipcMain.handle('profile:contact:delete', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected contact ID')
    return profileMutationResultSchema.parse(await workspace!.api.deleteContact(uuidSchema.parse(args[0])))
  })
  ipcMain.handle('profile:skill:save', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1 || typeof args[0] !== 'object' || args[0] === null || Array.isArray(args[0])) throw new Error('Expected skill')
    const input = skillSaveInputSchema.parse(args[0])
    return profileMutationResultSchema.parse(await workspace!.api.saveSkill(input))
  })
  ipcMain.handle('profile:skill:delete', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected skill ID')
    return profileMutationResultSchema.parse(await workspace!.api.deleteSkill(uuidSchema.parse(args[0])))
  })
  ipcMain.handle('profile:history', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected evidence ID')
    return evidenceRevisionSchema.array().parse(await workspace!.api.getEvidenceHistory(uuidSchema.parse(args[0])))
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
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.once('ready-to-show', () => window?.show())
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => workspace?.close())
