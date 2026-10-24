import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import type { WorkbenchStorageAPI } from '../shared/appearance'
import { profilePdfApplyResultSchema, profilePdfPreviewSchema, profilePdfProposalDraftSchema, profilePdfProposalSchema, type ProfilePdfProposalDraft } from '../shared/profile-pdf-import'
import { mapProfileDocxPages } from '../shared/profile-docx-import'
import { registerProfileAiImport, unregisterProfileAiImport } from '../shared/profile-ai-structuring'
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
export function registerProfileDocxImportIpc(getWindow: () => BrowserWindow, getStorage: () => WorkbenchStorageAPI, trusted: (event: IpcMainInvokeEvent) => void, cancelAiForImport: (token: string) => void = () => {}) {
  const pending = new Map<string, { hash: string; baseline: string; proposals: ReturnType<typeof profilePdfProposalSchema.parse>; timer: NodeJS.Timeout }>()
  const discard = (token: string) => { const item = pending.get(token); if (!item) return false; clearTimeout(item.timer); cancelAiForImport(token); pending.delete(token); unregisterProfileAiImport(token); return true }
  ipcMain.handle('profile:docx-import:preview', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length) throw new Error('Unexpected arguments')
    try {
      const selection = await dialog.showOpenDialog(getWindow(), { title: 'Choose a Word CV', properties: ['openFile'], filters: [{ name: 'Word document', extensions: ['docx'] }] })
      if (selection.canceled || !selection.filePaths[0]) return profilePdfPreviewSchema.parse({ ok: false, cancelled: true, message: 'CV upload cancelled.' })
      const path = selection.filePaths[0], info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > profileDocxLimits.bytes) return profilePdfPreviewSchema.parse({ ok: false, cancelled: false, message: 'Choose a regular DOCX file smaller than 15 MiB.' })
      const baseline = await getStorage().getProfileImportBaseline(), bytes = await readFile(path)
      if (bytes.length !== info.size) return profilePdfPreviewSchema.parse({ ok: false, cancelled: false, message: 'The selected file changed while it was being read. Choose it again.' })
      const extracted = await extractProfileDocx(bytes)
      const proposals = bindIds(profilePdfProposalDraftSchema.parse(mapProfileDocxPages(extracted.pages)))
      const token = randomUUID(), timer = setTimeout(() => discard(token), 15 * 60_000); timer.unref()
      pending.set(token, { hash: extracted.sha256, baseline, proposals, timer })
      registerProfileAiImport(token, { get: () => pending.get(token)?.proposals ?? proposals, set: value => { const active = pending.get(token); if (active) active.proposals = value } })
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
    const valueForRef = (proposal: typeof parsed.data, ref: string): unknown => {
      if (proposal.contact?.proposalRef === ref) return proposal.contact
      for (const skill of proposal.skills) if (skill.proposalRef === ref) return skill
      for (const role of proposal.experience) { if (role.proposalRef === ref) return role; for (const fact of role.factualItems) if (fact.proposalRef === ref) return fact }
      for (const project of proposal.projects) { if (project.proposalRef === ref) return project; for (const fact of project.factualItems) if (fact.proposalRef === ref) return fact; for (const technology of project.technologies) if (technology.proposalRef === ref) return technology }
      for (const entry of proposal.entries) if (entry.proposalRef === ref) return entry
      return undefined
    }
    const sources = parsed.data.sources.filter(source => {
      const original = valueForRef(saved.proposals, source.proposalRef), accepted = valueForRef(parsed.data, source.proposalRef)
      if (source.field === 'experience.role') {
        const before = saved.proposals.experience.find(item => item.proposalRef === source.proposalRef), after = parsed.data.experience.find(item => item.proposalRef === source.proposalRef)
        const roleFields = (role: typeof before) => role && ({ kind: role.kind, organization: role.organization, title: role.title, startDate: role.startDate, endDate: role.endDate, description: role.description })
        return Boolean(before && after && JSON.stringify(roleFields(before)) === JSON.stringify(roleFields(after)))
      }
      if (source.field === 'experience.role.date') {
        const role = parsed.data.experience.find(item => item.proposalRef === source.proposalRef), prior = saved.proposals.experience.find(item => item.proposalRef === source.proposalRef)
        return Boolean(prior?.requiresDateResolution && role && (role.startDate || role.endDate))
      }
      if (source.field === 'entries.education.date') {
        const entry = parsed.data.entries.find(item => item.proposalRef === source.proposalRef), prior = saved.proposals.entries.find(item => item.proposalRef === source.proposalRef)
        return Boolean(prior?.requiresDateResolution && entry?.section === 'education' && (entry.startDate || entry.endDate))
      }
      if (source.field === 'entries.certificates.year') {
        const entry = parsed.data.entries.find(item => item.proposalRef === source.proposalRef), prior = saved.proposals.entries.find(item => item.proposalRef === source.proposalRef)
        return Boolean(prior?.requiresDateResolution && entry?.section === 'certificates' && entry.year)
      }
      if (source.field.startsWith('contact.') && source.field !== 'contact.links') {
        const field = source.field.slice('contact.'.length) as keyof NonNullable<typeof parsed.data.contact>
        return JSON.stringify(saved.proposals.contact?.[field]) === JSON.stringify(parsed.data.contact?.[field])
      }
      return original !== undefined && JSON.stringify(original) === JSON.stringify(accepted)
    })
    const result = profilePdfApplyResultSchema.parse(await getStorage().importEmptyProfilePdf(saved.hash, saved.baseline, { ...parsed.data, sources }))
    if (result.ok || /profile changed|profile is no longer empty/i.test(result.message)) discard(token)
    return result
  })
  return { clear() { for (const token of pending.keys()) discard(token) } }
}
