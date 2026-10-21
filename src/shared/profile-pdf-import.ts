import { z } from 'zod'
import { contactInputSchema, profileEntryInputSchema, profileSnapshotSchema, skillInputSchema } from './profile'
import { experienceInputSchema, experienceSnapshotSchema, projectInputSchema } from './experience'

export const profilePdfSourceSchema = z.object({ page: z.number().int().positive(), passage: z.string().min(1).max(4000), field: z.string().min(1).max(200) }).strict()
export const profilePdfProposalSchema = z.object({
  contact: contactInputSchema.partial().extend({ fullName: z.string().min(1).max(160).optional() }).strict().optional(),
  skills: z.array(skillInputSchema).max(100),
  experience: z.array(experienceInputSchema).max(30),
  projects: z.array(projectInputSchema).max(30),
  entries: z.array(profileEntryInputSchema).max(100),
  sources: z.array(profilePdfSourceSchema).max(15_000),
  unmapped: z.array(z.object({ page: z.number().int().positive(), text: z.string().min(1).max(4000) }).strict()).max(500)
}).strict()
export const profilePdfPreviewSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), token: z.string().uuid(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), proposals: profilePdfProposalSchema }).strict(),
  z.object({ ok: z.literal(false), cancelled: z.boolean(), message: z.string() }).strict()
])
export const profilePdfApplyResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), message: z.string(), profile: profileSnapshotSchema, experience: experienceSnapshotSchema }).strict(),
  z.object({ ok: z.literal(false), message: z.string() }).strict()
])
export type ProfilePdfProposal = z.infer<typeof profilePdfProposalSchema>
export type ProfilePdfPreview = z.infer<typeof profilePdfPreviewSchema>

const sectionNames = new Set(['experience', 'employment', 'work experience', 'training', 'education', 'skills', 'technical skills', 'summary', 'projects', 'certificates', 'languages'])
const source = (line: string, page: number, field: string) => ({ page, passage: line.slice(0, 4000), field })
const splitParts = (value: string) => value.split(/\s+[|]\s+/).map(part => part.trim())

/** Conservative marker-led local mapper. Unrecognized lines remain visible as unmapped source text. */
export function mapProfilePdfPages(pages: Array<{ page: number; text: string; links?: Array<{ label: string; url: string }>; warnings?: string[] }>): ProfilePdfProposal {
  const contact: Record<string, unknown> = {}, skills: Array<{ name: string; category: string }> = []
  const experience: Array<z.infer<typeof experienceInputSchema>> = [], projects: Array<z.infer<typeof projectInputSchema>> = []
  const entries: Array<z.infer<typeof profileEntryInputSchema>> = [], sources: Array<z.infer<typeof profilePdfSourceSchema>> = [], unmapped: Array<{ page: number; text: string }> = []
  let section = '', currentRole: z.infer<typeof experienceInputSchema> | undefined, currentProject: z.infer<typeof projectInputSchema> | undefined, summaryText = ''
  for (const page of pages) {
    const lines = page.text.split(/\n|\s{2,}/).map(line => line.trim()).filter(Boolean)
    for (const warning of page.warnings ?? []) unmapped.push({ page: page.page, text: warning })
    for (const line of lines) {
      if (line.length > 4000) {
        for (let offset = 0; offset < line.length; offset += 4000) unmapped.push({ page: page.page, text: line.slice(offset, offset + 4000) })
        currentRole = undefined; currentProject = undefined
        continue
      }
      const header = line.match(/^([A-Z][A-Z ]{2,}):\s*(.*)$/)
      if (!header) {
        if (section === 'skills') {
          for (const name of line.split(/[,;|•]/).map(value => value.trim()).filter(Boolean)) { skills.push({ name, category: 'Technical' }); sources.push(source(line, page.page, `skills.${name}`)) }
        } else if (section === 'summary') { summaryText = [summaryText, line].filter(Boolean).join('\n'); sources.push(source(line, page.page, 'entries.summary')) }
        else if (currentRole && ['experience', 'employment', 'work experience', 'training'].includes(section)) { currentRole.factualItems.push({ text: line }); sources.push(source(line, page.page, 'experience.factualItem')) }
        else unmapped.push({ page: page.page, text: line })
        continue
      }
      const key = header[1].trim().toLowerCase(), value = header[2].trim()
      if (key === 'name' && value) { contact.fullName = value; sources.push(source(line, page.page, 'contact.fullName')); continue }
      if (key === 'headline' && value) { contact.headline = value; sources.push(source(line, page.page, 'contact.headline')); continue }
      if (key === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { contact.email = value; sources.push(source(line, page.page, 'contact.email')); continue }
      if (key === 'phone' && /^[+()\d][+()\d .-]{5,}$/.test(value)) { contact.phone = value; sources.push(source(line, page.page, 'contact.phone')); continue }
      if (key === 'contact link' && value) { const [label, url] = splitParts(value); if (label && url && /^https?:\/\//i.test(url)) { const links = Array.isArray(contact.links) ? contact.links as Array<{ label: string; url: string }> : []; links.push({ label, url }); contact.links = links; sources.push(source(line, page.page, 'contact.links')) } else unmapped.push({ page: page.page, text: line }); continue }
      if (key === 'project link' && currentProject && value) { const [label, url] = splitParts(value); if (label && url && /^https?:\/\//i.test(url)) { currentProject.links.push({ label, url }); sources.push(source(line, page.page, 'projects.links')) } else unmapped.push({ page: page.page, text: line }); continue }
      if (key === 'skills' || key === 'technical skills') {
        section = 'skills'
        for (const name of value.split(/[,;|•]/).map(item => item.trim()).filter(Boolean)) { skills.push({ name, category: 'Technical' }); sources.push(source(line, page.page, `skills.${name}`)) }
        continue
      }
      if (key === 'experience' || key === 'employment' || key === 'work experience' || key === 'training') {
        section = key === 'training' ? 'training' : 'experience'
        const pipeParts = value.split(/\s+[|]\s+/)
        const roleParts = pipeParts.length >= 2 ? pipeParts : value.split(/\s+[—–]\s+/)
        const organization = roleParts[0]?.trim(), title = roleParts[1]?.trim(), dateText = roleParts.slice(2).join(' | ').trim()
        currentProject = undefined
        if (organization && title) {
          const dates = dateText ? dateText.split(/\s+[–—]\s+/) : []
          currentRole = { kind: key === 'training' ? 'training' : 'employment', organization, title, description: line, factualItems: [], ...(dates[0] ? { startDate: dates[0] } : {}), ...(dates[1] ? { endDate: dates[1] } : {}) }
          experience.push(currentRole); sources.push(source(line, page.page, 'experience.role'))
        } else { currentRole = undefined; unmapped.push({ page: page.page, text: line }) }
        continue
      }
      if (key === 'fact' && currentRole && value) { currentRole.factualItems.push({ text: value }); sources.push(source(line, page.page, 'experience.factualItem')); continue }
      if (key === 'project' && value) {
        const [name, technologyText = ''] = value.split(/\s+[—–|]\s+/)
        currentRole = undefined
        currentProject = { name, description: line, factualItems: [], technologies: technologyText.split(/[,;]+/).map(text => text.trim()).filter(Boolean).map(text => ({ text })), links: [] }
        projects.push(currentProject); sources.push(source(line, page.page, 'projects.project'))
        if (technologyText) sources.push(source(line, page.page, 'projects.technology'))
        continue
      }
      if (key === 'technology' && currentProject && value) { currentProject.technologies.push({ text: value }); sources.push(source(line, page.page, 'projects.technology')); continue }
      if (key === 'fact' && currentProject && value) { currentProject.factualItems.push({ text: value }); sources.push(source(line, page.page, 'projects.factualItem')); continue }
      if (key === 'education' && value) {
        const parts = splitParts(value), title = parts[0] ?? '', institution = parts[1]
        const dateRange = parts.find(part => /\d{4}/.test(part)), dateParts = dateRange?.split(/\s+[–—-]\s+/) ?? []
        const supportedDate = (date?: string) => date && /^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(date) ? date : undefined
        const startDate = supportedDate(dateParts[0]), endDate = supportedDate(dateParts[1])
        const grade = parts.find(part => /(?:GPA|CGPA|grade)/i.test(part))
        entries.push({ section: 'education', title, ...(institution ? { institution } : {}), ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}), ...(grade ? { description: grade } : {}) })
        sources.push(source(line, page.page, 'entries.education'))
        if (dateRange && dateParts.some(date => date && !supportedDate(date))) unmapped.push({ page: page.page, text: `Date precision needs review: ${line}` })
        currentRole = undefined; currentProject = undefined; continue
      }
      if (key === 'certificate' && value) {
        const parts = splitParts(value), year = parts.find(part => /^\d{4}$/.test(part))
        entries.push({ section: 'certificates', title: parts[0] ?? '', ...(parts[1] ? { issuer: parts[1] } : {}), ...(year ? { year: Number(year) } : {}) })
        sources.push(source(line, page.page, 'entries.certificates')); currentRole = undefined; currentProject = undefined; continue
      }
      if (key === 'summary' && value) { section = 'summary'; summaryText = [summaryText, value].filter(Boolean).join('\n'); sources.push(source(line, page.page, 'entries.summary')); currentRole = undefined; currentProject = undefined; continue }
      if (key === 'spoken languages' && value) { for (const title of value.split(/[,;]+/).map(item => item.trim()).filter(Boolean)) entries.push({ section: 'languages', title }); sources.push(source(line, page.page, 'entries.languages')); currentRole = undefined; currentProject = undefined; continue }
      if (key === 'extra' && value) { entries.push({ section: 'extras', title: value, description: value }); sources.push(source(line, page.page, 'entries.extras')); currentRole = undefined; currentProject = undefined; continue }
      if (sectionNames.has(key)) { section = key; currentRole = undefined; currentProject = undefined; continue }
      currentRole = undefined; currentProject = undefined; unmapped.push({ page: page.page, text: line })
    }
    for (const link of page.links ?? []) unmapped.push({ page: page.page, text: `Unassigned PDF hyperlink: ${link.label} — ${link.url}` })
  }
  if (summaryText) entries.push({ section: 'summary', title: 'Summary', description: summaryText })
  const deduplicatedSkills = [...new Map(skills.map(skill => [skill.name.toLocaleLowerCase(), skill])).values()]
  const cleanContact = Object.fromEntries(Object.entries(contact).filter(([, value]) => typeof value !== 'string' || value.trim()))
  return profilePdfProposalSchema.parse({ ...(Object.keys(cleanContact).length ? { contact: cleanContact } : {}), skills: deduplicatedSkills, experience, projects, entries, sources, unmapped })
}
