import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import type { WorkbenchStorageAPI } from '../shared/appearance'
import { profilePdfApplyResultSchema, profilePdfPreviewSchema, profilePdfProposalDraftSchema, profilePdfProposalSchema, mapProfilePdfPages, type ProfilePdfProposalDraft } from '../shared/profile-pdf-import'
import { extractProfileDocx, profileDocxLimits } from './profile-docx-intake'

function bindIds(draft: ProfilePdfProposalDraft) {
  const refs = new Set<string>()
  if (draft.contact) refs.add(draft.contact.proposalRef)
  for (const skill of draft.skills) refs.add(skill.proposalRef)
  for (const role of draft.experience) { refs.add(role.proposalRef); role.factualItems.forEach(fact => refs.add(fact.proposalRef)) }
  for (const project of draft.projects) { refs.add(project.proposalRef); project.factualItems.forEach(fact => refs.add(fact.proposalRef)); project.technologies.forEach(item => refs.add(item.proposalRef)) }
  for (const entry of draft.entries) refs.add(entry.proposalRef)
  const proposalIds = Object.fromEntries([...refs].map(ref => [ref, randomUUID()]))
  return profilePdfProposalSchema.parse({ ...draft, proposalIds, sources: draft.sources.map(source => ({ ...source, proposalId: proposalIds[source.proposalRef] })) })
}

/** DOCX-specific native picker; preview state is memory-only and shares the PDF acceptance contract. */
export function registerProfileDocxImportIpc(getWindow: () => BrowserWindow, getStorage: () => WorkbenchStorageAPI, trusted: (event: IpcMainInvokeEvent) => void) {
  const pending = new Map<string, { hash: string; baseline: string; proposals: ReturnType<typeof profilePdfProposalSchema.parse>; timer: NodeJS.Timeout }>()
  const discard = (token: string) => { const item = pending.get(token); if (!item) return false; clearTimeout(item.timer); pending.delete(token); return true }
  ipcMain.handle('profile:docx-import:preview', async event => {
    trusted(event)
    try {
      const selection = await dialog.showOpenDialog(getWindow(), { title: 'Choose a Word CV', properties: ['openFile'], filters: [{ name: 'Word document', extensions: ['docx'] }] })
      if (selection.canceled || !selection.filePaths[0]) return profilePdfPreviewSchema.parse({ ok: false, cancelled: true, message: 'CV upload cancelled.' })
      const path = selection.filePaths[0], info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > profileDocxLimits.bytes) return profilePdfPreviewSchema.parse({ ok: false, cancelled: false, message: 'Choose a regular DOCX file smaller than 15 MiB.' })
      const baseline = await getStorage().getProfileImportBaseline(), bytes = await readFile(path)
      if (bytes.length !== info.size) return profilePdfPreviewSchema.parse({ ok: false, cancelled: false, message: 'The selected file changed while it was being read. Choose it again.' })
      const extracted = await extractProfileDocx(bytes)
      const mappedPages = extracted.pages.map(page => ({ ...page, text: [page.text, ...page.links.map(link => `CONTACT LINK: ${link.label} | ${link.url}`)].filter(Boolean).join('\n'), links: [] }))
      const proposals = bindIds(profilePdfProposalDraftSchema.parse(mapProfilePdfPages(mappedPages)))
      const token = randomUUID(), timer = setTimeout(() => pending.delete(token), 15 * 60_000); timer.unref()
      pending.set(token, { hash: extracted.sha256, baseline, proposals, timer })
      return profilePdfPreviewSchema.parse({ ok: true, token, sourceHash: extracted.sha256, proposals })
    } catch (error) { return profilePdfPreviewSchema.parse({ ok: false, cancelled: false, message: error instanceof Error ? error.message : 'The selected DOCX could not be read.' }) }
  })
  ipcMain.handle('profile:docx-import:cancel', (event, token: unknown) => { trusted(event); if (typeof token !== 'string') throw new Error('Expected preview token'); return discard(token) ? { ok: true, message: 'CV review discarded. No profile data was changed.' } : { ok: false, message: 'This CV review has expired.' } })
  ipcMain.handle('profile:docx-import:apply', async (event, token: unknown, input: unknown) => {
    trusted(event)
    if (typeof token !== 'string') throw new Error('Expected preview token and reviewed proposals')
    const saved = pending.get(token)
    if (!saved) return profilePdfApplyResultSchema.parse({ ok: false, message: 'This CV review expired. Select the DOCX again.' })
    const parsed = profilePdfProposalSchema.safeParse(input)
    if (!parsed.success || JSON.stringify(parsed.data.proposalIds) !== JSON.stringify(saved.proposals.proposalIds)) return profilePdfApplyResultSchema.parse({ ok: false, message: 'Resolve invalid proposal fields or reopen the DOCX review.' })
    const cited = new Set(saved.proposals.sources.map(source => JSON.stringify(source)))
    if (parsed.data.sources.some(source => !cited.has(JSON.stringify(source)))) return profilePdfApplyResultSchema.parse({ ok: false, message: 'A source passage changed during review. Select the DOCX again.' })
    if (parsed.data.experience.some(item => item.requiresDateResolution && !item.startDate && !item.endDate) || parsed.data.entries.some(item => item.requiresDateResolution && !(item.section === 'certificates' ? item.year : item.startDate || item.endDate))) return profilePdfApplyResultSchema.parse({ ok: false, message: 'Choose a supported date for selected details, or skip them.' })
    const includedRefs = new Set<string>()
    if (parsed.data.contact) includedRefs.add(parsed.data.contact.proposalRef)
    for (const item of parsed.data.skills) includedRefs.add(item.proposalRef)
    for (const item of parsed.data.experience) { includedRefs.add(item.proposalRef); item.factualItems.forEach(child => includedRefs.add(child.proposalRef)) }
    for (const item of parsed.data.projects) { includedRefs.add(item.proposalRef); item.factualItems.forEach(child => includedRefs.add(child.proposalRef)); item.technologies.forEach(child => includedRefs.add(child.proposalRef)) }
    for (const item of parsed.data.entries) includedRefs.add(item.proposalRef)
    const sources = parsed.data.sources.filter(source => includedRefs.has(source.proposalRef))
    const result = profilePdfApplyResultSchema.parse(await getStorage().importEmptyProfilePdf(saved.hash, saved.baseline, { ...parsed.data, sources }))
    if (result.ok || /profile changed|profile is no longer empty/i.test(result.message)) discard(token)
    return result
  })
  return { clear() { for (const token of pending.keys()) discard(token) } }
}
