import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { uuidSchema } from '../shared/profile'
import { MAX_WORKSPACE_BACKUP_BYTES } from '../shared/workspace-backup'
import type { WorkspaceRestorePreview } from '../shared/workspace-backup'
import type { createWorkbench } from './workbench'

type Workspace = ReturnType<typeof createWorkbench>
const groups = [
  { label: 'Profile and evidence', tables: ['profile_contact', 'profile_skills', 'profile_entries', 'profile_experience', 'profile_projects', 'evidence_revisions'] },
  { label: 'Saved jobs', tables: ['jobs'] },
  { label: 'Drafts and review', tables: ['draft_revisions', 'regeneration_proposals', 'document_fit_reports'] },
  { label: 'Run history and checkpoints', tables: ['outbound_consents', 'posting_analysis_cache', 'analysis_run_state', 'analysis_attempts', 'provider_attempt_outcomes', 'generation_recovery', 'generation_recovery_extensions', 'langgraph_checkpoints', 'langgraph_checkpoint_writes'] },
  { label: 'Preferences', tables: ['settings'] }
]
function effects(preview: WorkspaceRestorePreview) {
  return groups.map(group => ({ label: group.label, current: group.tables.reduce((sum, table) => sum + (preview.rowCounts[table]?.current ?? 0), 0), replacement: group.tables.reduce((sum, table) => sum + (preview.rowCounts[table]?.restored ?? 0), 0) }))
}
function writableFile(path: string) {
  if (extname(path).toLowerCase() !== '.json') throw new Error('Choose a destination ending in .json.')
  if (existsSync(path) && !lstatSync(path).isFile()) throw new Error('Choose a regular file, not a directory or shortcut.')
}
function writeVerified(path: string, content: string) {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    const fd = openSync(temporary, 'wx', 0o600)
    try { writeFileSync(fd, content, 'utf8'); fsyncSync(fd) } finally { closeSync(fd) }
    if (readFileSync(temporary, 'utf8') !== content) throw new Error('Backup verification failed.')
    renameSync(temporary, path)
    if (readFileSync(path, 'utf8') !== content) throw new Error('Backup verification failed.')
    return content
  } finally { rmSync(temporary, { force: true }) }
}

/** Native-only file dialogs, temporary restore previews and verified safety copies. */
export function registerWorkspaceBackupIpc(getWindow: () => BrowserWindow, getWorkspace: () => Workspace, reopenWorkspace: () => void, trusted: (event: IpcMainInvokeEvent) => void) {
  const idle = () => { if (getWorkspace().hasActiveWork()) throw new Error('An operation is active. Cancel or finish it before backing up or restoring.') }
  ipcMain.handle('workspace:backup:status', (event, ...args: unknown[]) => {
    trusted(event); if (args.length) throw new Error('Unexpected arguments')
    return getWorkspace().backup.readBackupStatus()
  })
  ipcMain.handle('workspace:backup', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length) throw new Error('Unexpected arguments')
    try {
      idle()
      const selected = await dialog.showSaveDialog(getWindow(), { title: 'Back up personal workspace', defaultPath: 'cv-tailor-workspace.json', buttonLabel: 'Save backup', filters: [{ name: 'CV Tailor workspace', extensions: ['json'] }] })
      if (selected.canceled || !selected.filePath) return { ok: false, cancelled: true, message: 'Workspace backup cancelled.' }
      idle(); writableFile(selected.filePath)
      const content = getWorkspace().backup.createBackup()
      writeVerified(selected.filePath, content)
      return { ok: true, cancelled: false, message: 'Workspace backup saved. It contains personal data; store it securely. No API key was included.' }
    } catch (cause) { return { ok: false, cancelled: false, message: cause instanceof Error ? cause.message : 'Workspace backup failed. Check the destination and try again.' } }
  })
  ipcMain.handle('workspace:restore:preview', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length) throw new Error('Unexpected arguments')
    try {
      idle()
      const selected = await dialog.showOpenDialog(getWindow(), { title: 'Select workspace backup', properties: ['openFile'], filters: [{ name: 'CV Tailor workspace', extensions: ['json'] }] })
      if (selected.canceled || !selected.filePaths[0]) return { ok: false, cancelled: true, message: 'Workspace restore cancelled.' }
      idle()
      const path = selected.filePaths[0], size = statSync(path)
      if (!size.isFile() || size.size > MAX_WORKSPACE_BACKUP_BYTES) throw new Error('Choose a readable workspace backup no larger than 64 MiB.')
      const preview = getWorkspace().backup.previewRestore(readFileSync(path, 'utf8'))
      return { ok: true, preview: { token: preview.token, effects: effects(preview) } }
    } catch (cause) { return { ok: false, cancelled: false, message: cause instanceof Error ? cause.message : 'The backup is invalid or incompatible. Your workspace was not changed.' } }
  })
  ipcMain.handle('workspace:restore:cancel', (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 1) throw new Error('Expected restore preview token')
    const cancelled = getWorkspace().backup.cancelRestore(uuidSchema.parse(args[0]))
    return { ok: cancelled, message: cancelled ? 'Workspace replacement cancelled; nothing was changed.' : 'Restore preview expired.' }
  })
  ipcMain.handle('workspace:restore:apply', (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 1) throw new Error('Expected restore preview token')
    try {
      idle()
      const token = uuidSchema.parse(args[0])
      let safetyPath = ''
      getWorkspace().backup.applyRestore(token, content => {
        idle()
        const directory = join(app.getPath('userData'), 'workspace-safety-backups')
        mkdirSync(directory, { recursive: true })
        safetyPath = join(directory, `workspace-before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`)
        return writeVerified(safetyPath, content)
      })
      reopenWorkspace() // discard in-memory consent, usage counters and pending work after replacement
      return { ok: true, message: `Workspace restored. Safety backup saved to ${safetyPath}. Older Pi and OpenRouter API keys are not restored; your separately stored encrypted Tavily key remains on this device. No cloud work was resumed.` }
    } catch (cause) { return { ok: false, message: cause instanceof Error ? cause.message : 'Restore failed. Your previous workspace remains available.' } }
  })
}
