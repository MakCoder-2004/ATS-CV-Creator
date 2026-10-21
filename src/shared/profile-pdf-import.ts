import { z } from 'zod'
import { contactInputSchema, profileEntryInputSchema, profileSnapshotSchema, skillInputSchema, uuidSchema } from './profile'
import { experienceInputSchema, experienceSnapshotSchema, projectInputSchema } from './experience'

const proposalRef = z.string().min(1).max(160)
const contactProposal = contactInputSchema.partial().extend({ fullName: z.string().min(1).max(160).optional(), proposalRef }).strict()
const skillProposal = skillInputSchema.extend({ proposalRef }).strict()
const factualProposal = z.object({ text: z.string().min(1).max(10_000), proposalRef }).strict()
const experienceProposal = experienceInputSchema.extend({ proposalRef, requiresDateResolution: z.boolean().optional(), factualItems: z.array(factualProposal).max(100) }).strict()
const projectProposal = projectInputSchema.extend({ proposalRef, factualItems: z.array(factualProposal).max(100), technologies: z.array(factualProposal).max(100) }).strict()
const entryProposal = profileEntryInputSchema.extend({ proposalRef, requiresDateResolution: z.boolean().optional() }).strict()
const sourceDraftSchema = z.object({ proposalRef, page: z.number().int().positive(), passage: z.string().min(1).max(4000), field: z.string().min(1).max(200) }).strict()
const sourceSchema = sourceDraftSchema.extend({ proposalId: uuidSchema }).strict()
const unmappedSchema = z.object({ page: z.number().int().positive(), text: z.string().min(1).max(4000) }).strict()

const proposalShape = {
  contact: contactProposal.optional(), skills: z.array(skillProposal).max(100), experience: z.array(experienceProposal).max(30),
  projects: z.array(projectProposal).max(30), entries: z.array(entryProposal).max(100), unmapped: z.array(unmappedSchema).max(500)
}
export const profilePdfSourceSchema = sourceSchema
export const profilePdfProposalDraftSchema = z.object({ ...proposalShape, sources: z.array(sourceDraftSchema).max(15_000) }).strict()
const proposalRefs = (proposal: z.infer<typeof profilePdfProposalDraftSchema>) => [
  ...(proposal.contact ? [proposal.contact.proposalRef] : []), ...proposal.skills.map(item => item.proposalRef),
  ...proposal.experience.flatMap(item => [item.proposalRef, ...item.factualItems.map(fact => fact.proposalRef)]),
  ...proposal.projects.flatMap(item => [item.proposalRef, ...item.factualItems.map(fact => fact.proposalRef), ...item.technologies.map(technology => technology.proposalRef)]),
  ...proposal.entries.map(item => item.proposalRef)
]
export const profilePdfProposalSchema = z.object({ ...proposalShape, sources: z.array(sourceSchema).max(15_000), proposalIds: z.record(z.string(), uuidSchema).refine(ids => Object.keys(ids).length <= 15_000) }).strict().superRefine((proposal, context) => {
  const refs = new Set(proposalRefs(proposal))
  if (refs.size !== proposalRefs(proposal).length) context.addIssue({ code: 'custom', path: ['proposalIds'], message: 'Proposal source references must be unique.' })
  if (new Set(Object.values(proposal.proposalIds)).size !== Object.keys(proposal.proposalIds).length) context.addIssue({ code: 'custom', path: ['proposalIds'], message: 'Proposal identities must be unique.' })
  for (const ref of refs) if (!proposal.proposalIds[ref]) context.addIssue({ code: 'custom', path: ['proposalIds', ref], message: 'Proposal source identity is missing.' })
  for (const source of proposal.sources) if (!proposal.proposalIds[source.proposalRef] || proposal.proposalIds[source.proposalRef] !== source.proposalId) context.addIssue({ code: 'custom', path: ['sources'], message: 'A source reference is not associated with this review.' })
})
export const profilePdfPreviewSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), token: uuidSchema, sourceHash: z.string().regex(/^[a-f0-9]{64}$/), proposals: profilePdfProposalSchema }).strict(),
  z.object({ ok: z.literal(false), cancelled: z.boolean(), message: z.string() }).strict()
])
export const profilePdfApplyResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), message: z.string(), profile: profileSnapshotSchema, experience: experienceSnapshotSchema }).strict(),
  z.object({ ok: z.literal(false), message: z.string() }).strict()
])
export type ProfilePdfProposal = z.infer<typeof profilePdfProposalSchema>
export type ProfilePdfProposalDraft = z.infer<typeof profilePdfProposalDraftSchema>
export type ProfilePdfPreview = z.infer<typeof profilePdfPreviewSchema>

const sectionNames = new Set(['experience', 'employment', 'work experience', 'training', 'education', 'skills', 'technical skills', 'programming languages', 'tools', 'concepts', 'summary', 'projects', 'certificates', 'languages'])
const source = (line: string, page: number, field: string, proposalRef: string) => ({ proposalRef, page, passage: line.slice(0, 4000), field })
const splitParts = (value: string) => value.split(/\s+[|]\s+/).map(part => part.trim())

/** Conservative marker-led local mapper. Unrecognized lines remain visible as unmapped source text. */
export function mapProfilePdfPages(pages: Array<{ page: number; text: string; links?: Array<{ label: string; url: string }>; warnings?: string[] }>): ProfilePdfProposalDraft {
  const contact: Record<string, unknown> = {}, skills: Array<z.infer<typeof skillProposal>> = []
  const experience: Array<z.infer<typeof experienceProposal>> = [], projects: Array<z.infer<typeof projectProposal>> = []
  const entries: Array<z.infer<typeof entryProposal>> = [], sources: Array<z.infer<typeof sourceDraftSchema>> = [], unmapped: Array<z.infer<typeof unmappedSchema>> = []
  let section = '', currentRole: z.infer<typeof experienceProposal> | undefined, currentProject: z.infer<typeof projectProposal> | undefined, summaryText = ''
  let contactRef: string | undefined, skillSequence = 0
  const ensureContactRef = () => contactRef ??= 'contact:0'
  const addSkill = (name: string, category: string, line: string, page: number) => {
    let skill = skills.find(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase() && item.category.toLocaleLowerCase() === category.toLocaleLowerCase())
    if (!skill) { skill = { name, category, proposalRef: `skill:${skillSequence++}` }; skills.push(skill) }
    sources.push(source(line, page, `skills.${skill.name}`, skill.proposalRef))
  }
  for (const page of pages) {
    const lines = page.text.split(/\n|\s{2,}/).map(line => line.trim()).filter(Boolean)
    const ambiguousReadingOrder = (page.warnings ?? []).some(warning => /multiple text columns|reading order may be ambiguous/i.test(warning))
    for (const warning of page.warnings ?? []) unmapped.push({ page: page.page, text: warning })
    for (const line of lines) {
      if (line.length > 4000) {
        for (let offset = 0; offset < line.length; offset += 4000) unmapped.push({ page: page.page, text: line.slice(offset, offset + 4000) })
        currentRole = undefined; currentProject = undefined
        continue
      }
      const header = line.match(/^([A-Z][A-Z ]{2,}):\s*(.*)$/)
      if (!header) {
        if (!contact.fullName && !section) {
          const parts = line.split(/\s+[|]\s+/).map(value => value.trim())
          const emailIndex = parts.findIndex(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
          if (emailIndex > 0) {
            const ref = ensureContactRef()
            contact.fullName = parts[0]
            sources.push(source(line, page.page, 'contact.fullName', ref))
            contact.email = parts[emailIndex]
            sources.push(source(line, page.page, 'contact.email', ref))
            const headline = parts.slice(1, emailIndex).find(value => value && !/^[+()\d][+()\d .-]{5,}$/.test(value))
            if (headline) { contact.headline = headline; sources.push(source(line, page.page, 'contact.headline', ref)) }
            const phone = parts.slice(emailIndex + 1).find(value => /^[+()\d][+()\d .-]{5,}$/.test(value))
            if (phone) { contact.phone = phone; sources.push(source(line, page.page, 'contact.phone', ref)) }
            continue
          }
        }
        if (['skills', 'programming languages', 'tools', 'concepts'].includes(section)) {
          const category = section === 'programming languages' ? 'Languages' : section === 'tools' ? 'Tools' : section === 'concepts' ? 'Domain' : 'Technical'
          for (const name of line.split(/[,;|•]/).map(value => value.trim()).filter(Boolean)) addSkill(name, category, line, page.page)
        } else if (section === 'summary') { summaryText = [summaryText, line].filter(Boolean).join('\n'); sources.push(source(line, page.page, 'entries.summary', 'entry:summary')) }
        else if (currentRole && ['experience', 'employment', 'work experience', 'training'].includes(section) && !ambiguousReadingOrder) { const ref = `${currentRole.proposalRef}:fact:${currentRole.factualItems.length}`; currentRole.factualItems.push({ text: line, proposalRef: ref }); sources.push(source(line, page.page, 'experience.factualItem', ref)) }
        else unmapped.push({ page: page.page, text: line })
        continue
      }
      const key = header[1].trim().toLowerCase(), value = header[2].trim()
      if (key === 'name' && value) { const ref = ensureContactRef(); contact.fullName = value; sources.push(source(line, page.page, 'contact.fullName', ref)); continue }
      if (key === 'headline' && value) { const ref = ensureContactRef(); contact.headline = value; sources.push(source(line, page.page, 'contact.headline', ref)); continue }
      if (key === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { const ref = ensureContactRef(); contact.email = value; sources.push(source(line, page.page, 'contact.email', ref)); continue }
      if (key === 'phone' && /^[+()\d][+()\d .-]{5,}$/.test(value)) { const ref = ensureContactRef(); contact.phone = value; sources.push(source(line, page.page, 'contact.phone', ref)); continue }
      if (key === 'contact link' && value) { const [label, url] = splitParts(value), ref = ensureContactRef(); if (label && url && /^https?:\/\//i.test(url)) { const links = Array.isArray(contact.links) ? contact.links as Array<{ label: string; url: string }> : []; links.push({ label, url }); contact.links = links; sources.push(source(line, page.page, 'contact.links', ref)) } else unmapped.push({ page: page.page, text: line }); continue }
      if (key === 'project link' && currentProject && value) { const [label, url] = splitParts(value); if (label && url && /^https?:\/\//i.test(url)) { currentProject.links.push({ label, url }); sources.push(source(line, page.page, 'projects.links', currentProject.proposalRef)) } else unmapped.push({ page: page.page, text: line }); continue }
      if (['skills', 'technical skills', 'programming languages', 'tools', 'concepts'].includes(key)) {
        section = key === 'programming languages' ? 'programming languages' : key === 'tools' ? 'tools' : key === 'concepts' ? 'concepts' : 'skills'
        const category = section === 'programming languages' ? 'Languages' : section === 'tools' ? 'Tools' : section === 'concepts' ? 'Domain' : 'Technical'
        for (const name of value.split(/[,;|•]/).map(item => item.trim()).filter(Boolean)) addSkill(name, category, line, page.page)
        continue
      }
      if (key === 'experience' || key === 'employment' || key === 'work experience' || key === 'training') {
        section = key === 'training' ? 'training' : 'experience'
        const pipeParts = value.split(/\s+[|]\s+/), roleParts = pipeParts.length >= 2 ? pipeParts : value.split(/\s+[—–]\s+/)
        const organization = roleParts[0]?.trim(), title = roleParts[1]?.trim(), dateText = roleParts.slice(2).join(' | ').trim()
        currentProject = undefined
        if (organization && title) {
          const dates = dateText ? dateText.split(/\s+(?:to|[–—-])\s+/i) : [], ref = `experience:${experience.length}`
          const requiresDateResolution = dates.some(date => date.length > 80)
          const startDate = dates[0] && dates[0].length <= 80 ? dates[0] : undefined, endDate = dates[1] && dates[1].length <= 80 ? dates[1] : undefined
          if (requiresDateResolution) unmapped.push({ page: page.page, text: `Experience date needs review because it exceeds the structured field limit: ${line}` })
          currentRole = { kind: key === 'training' ? 'training' : 'employment', organization, title, description: line, factualItems: [], proposalRef: ref, ...(requiresDateResolution ? { requiresDateResolution: true } : {}), ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) }
          experience.push(currentRole); sources.push(source(line, page.page, 'experience.role', ref))
          if (requiresDateResolution) sources.push(source(line, page.page, 'experience.role.date', ref))
        } else { currentRole = undefined; unmapped.push({ page: page.page, text: line }) }
        continue
      }
      if (key === 'fact' && currentRole && value) { if (ambiguousReadingOrder) unmapped.push({ page: page.page, text: line }); else { const ref = `${currentRole.proposalRef}:fact:${currentRole.factualItems.length}`; currentRole.factualItems.push({ text: value, proposalRef: ref }); sources.push(source(line, page.page, 'experience.factualItem', ref)) } continue }
      if (key === 'project' && value) {
        const [name, technologyText = ''] = value.split(/\s+[—–|]\s+/), ref = `project:${projects.length}`
        currentRole = undefined
        currentProject = { name, description: line, factualItems: [], technologies: [], links: [], proposalRef: ref }
        projects.push(currentProject); sources.push(source(line, page.page, 'projects.project', ref))
        for (const text of technologyText.split(/[,;]+/).map(item => item.trim()).filter(Boolean)) { const technologyRef = `${ref}:technology:${currentProject.technologies.length}`; currentProject.technologies.push({ text, proposalRef: technologyRef }); sources.push(source(line, page.page, 'projects.technology', technologyRef)) }
        continue
      }
      if (key === 'technology' && currentProject && value) { if (ambiguousReadingOrder) unmapped.push({ page: page.page, text: line }); else { const ref = `${currentProject.proposalRef}:technology:${currentProject.technologies.length}`; currentProject.technologies.push({ text: value, proposalRef: ref }); sources.push(source(line, page.page, 'projects.technology', ref)) } continue }
      if (key === 'fact' && currentProject && value) { if (ambiguousReadingOrder) unmapped.push({ page: page.page, text: line }); else { const ref = `${currentProject.proposalRef}:fact:${currentProject.factualItems.length}`; currentProject.factualItems.push({ text: value, proposalRef: ref }); sources.push(source(line, page.page, 'projects.factualItem', ref)) } continue }
      if (key === 'education' && value) {
        const parts = splitParts(value), title = parts[0] ?? '', institution = parts[1], ref = `entry:${entries.length}`
        const dateRange = parts.find(part => /\d{4}/.test(part)), dateParts = dateRange?.split(/\s+(?:to|[–—-])\s+/i) ?? []
        const supportedDate = (date?: string) => date && /^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(date) ? date : undefined
        const startDate = supportedDate(dateParts[0]), endDate = supportedDate(dateParts[1]), grade = parts.find(part => /(?:GPA|CGPA|grade)/i.test(part))
        const requiresDateResolution = Boolean(dateRange && dateParts.some(date => date && !supportedDate(date)))
        entries.push({ section: 'education', title, ...(institution ? { institution } : {}), ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}), ...(grade ? { description: grade } : {}), proposalRef: ref, ...(requiresDateResolution ? { requiresDateResolution: true } : {}) })
        sources.push(source(line, page.page, 'entries.education', ref))
        if (requiresDateResolution) { sources.push(source(line, page.page, 'entries.education.date', ref)); unmapped.push({ page: page.page, text: `Date precision needs review: ${line}` }) }
        currentRole = undefined; currentProject = undefined; continue
      }
      if (key === 'certificate' && value) {
        const parts = splitParts(value), year = parts.find(part => /^\d{4}$/.test(part)), dateText = parts.find(part => /\d{4}/.test(part)), ref = `entry:${entries.length}`
        const requiresDateResolution = Boolean(dateText && !year)
        entries.push({ section: 'certificates', title: parts[0] ?? '', ...(parts[1] ? { issuer: parts[1] } : {}), ...(year ? { year: Number(year) } : {}), proposalRef: ref, ...(requiresDateResolution ? { requiresDateResolution: true } : {}) })
        sources.push(source(line, page.page, 'entries.certificates', ref))
        if (requiresDateResolution) { sources.push(source(line, page.page, 'entries.certificates.year', ref)); unmapped.push({ page: page.page, text: `Certificate date precision needs review: ${line}` }) }
        currentRole = undefined; currentProject = undefined; continue
      }
      if (key === 'summary' && value) { section = 'summary'; summaryText = [summaryText, value].filter(Boolean).join('\n'); sources.push(source(line, page.page, 'entries.summary', 'entry:summary')); currentRole = undefined; currentProject = undefined; continue }
      if (key === 'spoken languages' && value) { for (const title of value.split(/[,;]+/).map(item => item.trim()).filter(Boolean)) { const ref = `entry:${entries.length}`; entries.push({ section: 'languages', title, proposalRef: ref }); sources.push(source(line, page.page, 'entries.languages', ref)) } currentRole = undefined; currentProject = undefined; continue }
      if (key === 'extra' && value) { const ref = `entry:${entries.length}`; entries.push({ section: 'extras', title: value, description: value, proposalRef: ref }); sources.push(source(line, page.page, 'entries.extras', ref)); currentRole = undefined; currentProject = undefined; continue }
      if (sectionNames.has(key)) { section = key; currentRole = undefined; currentProject = undefined; continue }
      currentRole = undefined; currentProject = undefined; unmapped.push({ page: page.page, text: line })
    }
    for (const link of page.links ?? []) unmapped.push({ page: page.page, text: `Unassigned PDF hyperlink: ${link.label} — ${link.url}` })
  }
  if (summaryText) entries.push({ section: 'summary', title: 'Summary', description: summaryText, proposalRef: 'entry:summary' })
  const cleanContact = Object.fromEntries(Object.entries(contact).filter(([, value]) => typeof value !== 'string' || value.trim()))
  if (Object.keys(cleanContact).length) Object.assign(cleanContact, { proposalRef: ensureContactRef() })
  return profilePdfProposalDraftSchema.parse({ ...(Object.keys(cleanContact).length ? { contact: cleanContact } : {}), skills, experience, projects, entries, sources, unmapped })
}
