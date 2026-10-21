import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import type { WorkbenchStorageAPI } from '../shared/appearance'
import { profilePdfApplyResultSchema, profilePdfPreviewSchema, profilePdfProposalDraftSchema, profilePdfProposalSchema, mapProfilePdfPages, type ProfilePdfProposalDraft } from '../shared/profile-pdf-import'
import { extractProfilePdf, profilePdfLimits } from './profile-pdf-intake'

function bindProposalIds(draft: ProfilePdfProposalDraft) {
  const refs = new Set<string>()
  if (draft.contact) refs.add(draft.contact.proposalRef)
  for (const skill of draft.skills) refs.add(skill.proposalRef)
  for (const role of draft.experience) { refs.add(role.proposalRef); role.factualItems.forEach(fact => refs.add(fact.proposalRef)) }
  for (const project of draft.projects) { refs.add(project.proposalRef); project.factualItems.forEach(fact => refs.add(fact.proposalRef)); project.technologies.forEach(technology => refs.add(technology.proposalRef)) }
  for (const entry of draft.entries) refs.add(entry.proposalRef)
  const proposalIds = Object.fromEntries([...refs].map(ref => [ref, randomUUID()]))
  return profilePdfProposalSchema.parse({ ...draft, proposalIds, sources: draft.sources.map(source => ({ ...source, proposalId: proposalIds[source.proposalRef] })) })
}

/** Native-picker only; renderer never supplies a filesystem path. Proposals live only in memory until apply/cancel. */
export function registerProfilePdfImportIpc(getWindow: () => BrowserWindow, getStorage: () => WorkbenchStorageAPI, trusted: (event: IpcMainInvokeEvent) => void) {
  const pending = new Map<string, { sourceHash: string; baseline: string; proposals: ReturnType<typeof profilePdfProposalSchema.parse>; timer: NodeJS.Timeout }>()
  const discard = (token: string) => { const active = pending.get(token); if (!active) return false; clearTimeout(active.timer); pending.delete(token); return true }
  ipcMain.handle('profile:pdf-import:preview', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length) throw new Error('Unexpected arguments')
    try {
      const selection = await dialog.showOpenDialog(getWindow(), { title: 'Choose a text PDF CV', properties: ['openFile'], filters: [{ name: 'PDF document', extensions: ['pdf'] }] })
      if (selection.canceled || !selection.filePaths[0]) return profilePdfPreviewSchema.parse({ ok: false, cancelled: true, message: 'CV upload cancelled.' })
      const path = selection.filePaths[0]
      const baseline = await getStorage().getProfileImportBaseline()
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > profilePdfLimits.bytes) return profilePdfPreviewSchema.parse({ ok: false, cancelled: false, message: 'Choose a regular PDF file smaller than 15 MiB.' })
      const capturedBytes = await readFile(path)
      if (capturedBytes.length !== info.size) return profilePdfPreviewSchema.parse({ ok: false, cancelled: false, message: 'The selected file changed while it was being read. Choose it again.' })
      const extracted = await extractProfilePdf(capturedBytes)
      const draft = profilePdfProposalDraftSchema.parse(mapProfilePdfPages(extracted.pages))
      const proposals = bindProposalIds(draft)
      const token = randomUUID()
      const timer = setTimeout(() => pending.delete(token), 15 * 60_000); timer.unref()
      pending.set(token, { sourceHash: extracted.sha256, baseline, proposals, timer })
      return profilePdfPreviewSchema.parse({ ok: true, token, sourceHash: extracted.sha256, proposals })
    } catch (error) {
      return profilePdfPreviewSchema.parse({ ok: false, cancelled: false, message: error instanceof Error ? error.message : 'The selected PDF could not be read.' })
    }
  })
  ipcMain.handle('profile:pdf-import:cancel', (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 1 || typeof args[0] !== 'string') throw new Error('Expected preview token')
    return discard(args[0]) ? { ok: true, message: 'CV review discarded. No profile data was changed.' } : { ok: false, message: 'This CV review has expired.' }
  })
  ipcMain.handle('profile:pdf-import:apply', async (event, ...args: unknown[]) => {
    trusted(event); if (args.length !== 2 || typeof args[0] !== 'string') throw new Error('Expected preview token and reviewed proposals')
    const saved = pending.get(args[0])
    if (!saved) return profilePdfApplyResultSchema.parse({ ok: false, message: 'This CV review expired. Select the PDF again.' })
    const proposals = profilePdfProposalSchema.safeParse(args[1])
    if (!proposals.success) return profilePdfApplyResultSchema.parse({ ok: false, message: 'Resolve invalid proposal fields or skip them before applying.' })
    if (JSON.stringify(proposals.data.proposalIds) !== JSON.stringify(saved.proposals.proposalIds)) return profilePdfApplyResultSchema.parse({ ok: false, message: 'Proposal identities changed during review. Reopen the PDF to review it again.' })
    for (const original of saved.proposals.experience) if (original.requiresDateResolution) {
      const selected = proposals.data.experience.find(item => item.proposalRef === original.proposalRef)
      if (selected && !selected.startDate && !selected.endDate) return profilePdfApplyResultSchema.parse({ ok: false, message: `Choose a supported date for ${selected.title}, or skip that record.` })
    }
    for (const original of saved.proposals.entries) if (original.requiresDateResolution) {
      const selected = proposals.data.entries.find(item => item.proposalRef === original.proposalRef)
      if (selected && !(selected.section === 'certificates' ? selected.year : selected.startDate || selected.endDate)) return profilePdfApplyResultSchema.parse({ ok: false, message: `Choose a supported date for ${selected.title}, or skip that record.` })
    }
    if (proposals.data.contact && !proposals.data.contact.fullName?.trim()) return profilePdfApplyResultSchema.parse({ ok: false, message: 'Add a full name to the contact proposal or skip it before applying.' })
    const cited = new Set(saved.proposals.sources.map(source => JSON.stringify(source)))
    if (proposals.data.sources.some(source => !cited.has(JSON.stringify(source)))) return profilePdfApplyResultSchema.parse({ ok: false, message: 'A source passage changed during review. Select the PDF again.' })
    const valueForRef = (proposal: typeof proposals.data, ref: string): unknown => {
      if (proposal.contact?.proposalRef === ref) return proposal.contact
      for (const skill of proposal.skills) if (skill.proposalRef === ref) return skill
      for (const role of proposal.experience) { if (role.proposalRef === ref) return role; for (const fact of role.factualItems) if (fact.proposalRef === ref) return fact }
      for (const project of proposal.projects) { if (project.proposalRef === ref) return project; for (const fact of project.factualItems) if (fact.proposalRef === ref) return fact; for (const technology of project.technologies) if (technology.proposalRef === ref) return technology }
      for (const entry of proposal.entries) if (entry.proposalRef === ref) return entry
      return undefined
    }
    const acceptedSources = proposals.data.sources.filter(source => {
      const original = valueForRef(saved.proposals, source.proposalRef), accepted = valueForRef(proposals.data, source.proposalRef)
      if (source.field === 'experience.role.date') {
        const role = proposals.data.experience.find(item => item.proposalRef === source.proposalRef), prior = saved.proposals.experience.find(item => item.proposalRef === source.proposalRef)
        return Boolean(prior?.requiresDateResolution && role && (role.startDate || role.endDate))
      }
      if (source.field === 'entries.education.date') {
        const entry = proposals.data.entries.find(item => item.proposalRef === source.proposalRef), prior = saved.proposals.entries.find(item => item.proposalRef === source.proposalRef)
        return Boolean(prior?.requiresDateResolution && entry?.section === 'education' && (entry.startDate || entry.endDate))
      }
      if (source.field === 'entries.certificates.year') {
        const entry = proposals.data.entries.find(item => item.proposalRef === source.proposalRef), prior = saved.proposals.entries.find(item => item.proposalRef === source.proposalRef)
        return Boolean(prior?.requiresDateResolution && entry?.section === 'certificates' && entry.year)
      }
      if (source.field.startsWith('contact.') && source.field !== 'contact.links') {
        const field = source.field.slice('contact.'.length) as keyof NonNullable<typeof proposals.data.contact>
        return JSON.stringify(saved.proposals.contact?.[field]) === JSON.stringify(proposals.data.contact?.[field])
      }
      return original !== undefined && JSON.stringify(original) === JSON.stringify(accepted)
    })
    const result = profilePdfApplyResultSchema.parse(await getStorage().importEmptyProfilePdf(saved.sourceHash, saved.baseline, { ...proposals.data, sources: acceptedSources }))
    if (result.ok || /profile changed|profile is no longer empty/i.test(result.message)) discard(args[0])
    return result
  })
  return { clear() { for (const token of pending.keys()) discard(token) } }
}
