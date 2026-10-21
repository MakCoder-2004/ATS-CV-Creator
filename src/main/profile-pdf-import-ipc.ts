import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import type { WorkbenchStorageAPI } from '../shared/appearance'
import { profilePdfApplyResultSchema, profilePdfPreviewSchema, profilePdfProposalSchema, mapProfilePdfPages } from '../shared/profile-pdf-import'
import { extractProfilePdf, profilePdfLimits } from './profile-pdf-intake'

/** Native-picker only; renderer never supplies a filesystem path. Proposals live only in memory until apply/cancel. */
export function registerProfilePdfImportIpc(getWindow: () => BrowserWindow, getStorage: () => WorkbenchStorageAPI, trusted: (event: IpcMainInvokeEvent) => void) {
  const pending = new Map<string, { sourceHash: string; baseline: string; proposals: ReturnType<typeof profilePdfProposalSchema.parse> }>()
  ipcMain.handle('profile:pdf-import:preview', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length) throw new Error('Unexpected arguments')
    try {
      const selection = await dialog.showOpenDialog(getWindow(), { title: 'Choose a text PDF CV', properties: ['openFile'], filters: [{ name: 'PDF document', extensions: ['pdf'] }] })
      if (selection.canceled || !selection.filePaths[0]) return profilePdfPreviewSchema.parse({ ok: false, cancelled: true, message: 'CV upload cancelled.' })
      const path = selection.filePaths[0]
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > profilePdfLimits.bytes) return profilePdfPreviewSchema.parse({ ok: false, cancelled: false, message: 'Choose a regular PDF file smaller than 15 MiB.' })
      const capturedBytes = await readFile(path)
      if (capturedBytes.length !== info.size) return profilePdfPreviewSchema.parse({ ok: false, cancelled: false, message: 'The selected file changed while it was being read. Choose it again.' })
      const extracted = await extractProfilePdf(capturedBytes)
      const proposals = profilePdfProposalSchema.parse(mapProfilePdfPages(extracted.pages))
      const baseline = await getStorage().getProfileImportBaseline()
      const token = randomUUID()
      pending.set(token, { sourceHash: extracted.sha256, baseline, proposals })
      return profilePdfPreviewSchema.parse({ ok: true, token, sourceHash: extracted.sha256, proposals })
    } catch (error) {
      return profilePdfPreviewSchema.parse({ ok: false, cancelled: false, message: error instanceof Error ? error.message : 'The selected PDF could not be read.' })
    }
  })
  ipcMain.handle('profile:pdf-import:cancel', (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 1 || typeof args[0] !== 'string') throw new Error('Expected preview token')
    return pending.delete(args[0]) ? { ok: true, message: 'CV review discarded. No profile data was changed.' } : { ok: false, message: 'This CV review has expired.' }
  })
  ipcMain.handle('profile:pdf-import:apply', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 2 || typeof args[0] !== 'string') throw new Error('Expected preview token and reviewed proposals')
    const saved = pending.get(args[0]); pending.delete(args[0])
    if (!saved) return profilePdfApplyResultSchema.parse({ ok: false, message: 'This CV review expired. Select the PDF again.' })
    const proposals = profilePdfProposalSchema.safeParse(args[1])
    if (!proposals.success) return profilePdfApplyResultSchema.parse({ ok: false, message: 'Resolve invalid proposal fields or skip them before applying.' })
    const cited = new Set(saved.proposals.sources.map(source => JSON.stringify(source)))
    if (proposals.data.sources.some(source => !cited.has(JSON.stringify(source)))) return profilePdfApplyResultSchema.parse({ ok: false, message: 'A source passage changed during review. Select the PDF again.' })
    const unchanged = (section: 'skills' | 'experience' | 'projects' | 'entries') => JSON.stringify(proposals.data[section]) === JSON.stringify(saved.proposals[section])
    const acceptedSources = proposals.data.sources.filter(source => {
      const [group, field] = source.field.split('.')
      if (group === 'contact') return JSON.stringify(saved.proposals.contact?.[field as keyof NonNullable<typeof saved.proposals.contact>]) === JSON.stringify(proposals.data.contact?.[field as keyof NonNullable<typeof proposals.data.contact>])
      if (group === 'skills') return unchanged('skills')
      if (group === 'experience') return unchanged('experience')
      if (group === 'projects') return unchanged('projects')
      if (group === 'entries') return unchanged('entries')
      return false
    })
    return profilePdfApplyResultSchema.parse(await getStorage().importEmptyProfilePdf(saved.sourceHash, saved.baseline, { ...proposals.data, sources: acceptedSources }))
  })
  return { clear() { pending.clear() } }
}
