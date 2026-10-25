import { z } from 'zod'
import { contactInputSchema, profileEntryInputSchema, profileSnapshotSchema, skillInputSchema, uuidSchema } from './profile'
import { experienceInputSchema, experienceSnapshotSchema, projectInputSchema } from './experience'

const proposalRef = z.string().min(1).max(160)
const contactProposal = contactInputSchema.partial().extend({ fullName: z.string().min(1).max(160).optional(), proposalRef }).strict()
const skillProposal = skillInputSchema.extend({ proposalRef }).strict()
const factualProposal = z.object({ text: z.string().min(1).max(10_000), proposalRef }).strict()
const experienceProposal = experienceInputSchema.extend({ kind: z.enum(['employment', 'training', 'unresolved']), proposalRef, requiresDateResolution: z.boolean().optional(), factualItems: z.array(factualProposal).max(100) }).strict()
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
const mergeDecisionSchema = z.object({ action: z.enum(['add', 'update', 'skip']), targetId: uuidSchema.optional() }).strict().refine(value => value.action === 'update' ? Boolean(value.targetId) : !value.targetId, 'Choose an existing record only for an update.')
export const profilePdfProposalSchema = z.object({ ...proposalShape, sources: z.array(sourceSchema).max(15_000), proposalIds: z.record(z.string(), uuidSchema).refine(ids => Object.keys(ids).length <= 15_000), decisions: z.record(proposalRef, mergeDecisionSchema).optional() }).strict().superRefine((proposal, context) => {
  const refs = new Set(proposalRefs(proposal))
  if (refs.size !== proposalRefs(proposal).length) context.addIssue({ code: 'custom', path: ['proposalIds'], message: 'Proposal source references must be unique.' })
  if (new Set(Object.values(proposal.proposalIds)).size !== Object.keys(proposal.proposalIds).length) context.addIssue({ code: 'custom', path: ['proposalIds'], message: 'Proposal identities must be unique.' })
  for (const ref of refs) if (!proposal.proposalIds[ref]) context.addIssue({ code: 'custom', path: ['proposalIds', ref], message: 'Proposal source identity is missing.' })
  if (proposal.decisions) {
    const rootRefs = [ ...(proposal.contact ? [proposal.contact.proposalRef] : []), ...proposal.skills.map(item => item.proposalRef), ...proposal.experience.map(item => item.proposalRef), ...proposal.projects.map(item => item.proposalRef), ...proposal.entries.map(item => item.proposalRef) ]
    const nestedRefs = [...proposal.experience.flatMap(item => item.factualItems.map(fact => fact.proposalRef)), ...proposal.projects.flatMap(item => [...item.factualItems, ...item.technologies].map(child => child.proposalRef))]
    for (const ref of [...rootRefs, ...nestedRefs]) if (!proposal.decisions[ref]) context.addIssue({ code: 'custom', path: ['decisions', ref], message: 'Choose add, update, or skip for every proposed profile detail.' })
    for (const ref of Object.keys(proposal.decisions)) if (![...rootRefs, ...nestedRefs].includes(ref)) context.addIssue({ code: 'custom', path: ['decisions', ref], message: 'Merge decisions must target a proposed profile detail.' })
  }
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
export const profilePdfRebaseResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), message: z.string(), profile: profileSnapshotSchema, experience: experienceSnapshotSchema }).strict(),
  z.object({ ok: z.literal(false), message: z.string() }).strict()
])
export type ProfilePdfProposal = z.infer<typeof profilePdfProposalSchema>
export type ProfilePdfProposalDraft = z.infer<typeof profilePdfProposalDraftSchema>
export type ProfilePdfPreview = z.infer<typeof profilePdfPreviewSchema>
export type ProfilePdfRebaseResult = z.infer<typeof profilePdfRebaseResultSchema>
export type ProfilePdfSourcePage = { page: number; text: string; links?: Array<{ label: string; url: string; lineIndex?: number }>; warnings?: string[] }

const sectionNames = new Set(['experience', 'employment', 'work experience', 'professional experience', 'employment history', 'training', 'education', 'skills', 'technical skills', 'programming languages', 'tools', 'concepts', 'summary', 'professional summary', 'projects', 'personal projects', 'certificates', 'certifications', 'languages'])
const sectionAlias = (value: string) => {
  const key = value.trim().toLocaleLowerCase().replace(/[:.]$/, '').replace(/\s+/g, ' ')
  if (['experience', 'employment', 'work experience', 'professional experience', 'employment history', 'training'].includes(key)) return key === 'training' ? 'training' : 'experience'
  if (['projects', 'personal projects'].includes(key)) return 'projects'
  if (['skills', 'technical skills', 'programming languages', 'tools', 'concepts'].includes(key)) return key === 'programming languages' ? key : key === 'tools' || key === 'concepts' ? key : 'skills'
  if (['summary', 'professional summary'].includes(key)) return 'summary'
  return sectionNames.has(key) ? key : undefined
}
const source = (line: string, page: number, field: string, proposalRef: string) => ({ proposalRef, page, passage: line.slice(0, 4000), field })
const splitParts = (value: string) => value.split(/\s+[|]\s+/).map(part => part.trim())

type ProfilePdfPage = ProfilePdfSourcePage
type SectionedRoleHeader = { title: string; passage: string; page: number; organization?: { text: string; page: number } }

const monthName = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
const dateToken = `(?:${monthName}(?:\\s+(?:19|20)\\d{2})?|(?:19|20)\\d{2})`
const dateRange = `${dateToken}(?:\\s*(?:to|[-–—])\\s*(?:present|current|${dateToken}))?`
const dateRangeSuffix = new RegExp(`^(.+?)\\s+(${dateRange})$`, 'i')
const dateRangeOnly = new RegExp(`^(${dateRange})$`, 'i')
const possibleOrganization = (line: string) => line.length <= 240 && line.trim().split(/\s+/).length <= 7 && !/[.!?]$/.test(line) && !/[@/]/.test(line) && !/^page\s+\d+$/i.test(line)
const splitDates = (value: string) => {
  const dates = value.split(/\s+(?:to|[-–—])\s+/i)
  if (dates.length === 2 && new RegExp(`^${monthName}$`, 'i').test(dates[0]!) && /(?:19|20)\d{2}/.test(dates[1]!)) dates[0] = `${dates[0]} ${dates[1]!.match(/(?:19|20)\d{2}/)![0]}`
  return dates
}
const plainSection = (line: string) => !/^([A-Z][A-Z ]{2,}):\s*/.test(line) ? sectionAlias(line) : undefined
const isSectionedCv = (pages: ProfilePdfPage[]) => {
  const lines = pages.flatMap(page => page.text.split(/\n|\s{2,}/).map(line => line.trim()).filter(Boolean))
  const headings = lines.map(plainSection).filter(Boolean)
  return headings.length >= 3 && headings.some(section => section === 'education') && headings.some(section => section === 'experience') && lines.some(line => /^[•▪◦*-]\s/.test(line)) && lines.some(line => /(?:19|20)\d{2}/.test(line))
}

function mapSectionedProfilePdfPages(pages: ProfilePdfPage[]): ProfilePdfProposalDraft {
  const contact: Record<string, unknown> = {}, skills: Array<z.infer<typeof skillProposal>> = []
  const experience: Array<z.infer<typeof experienceProposal>> = [], projects: Array<z.infer<typeof projectProposal>> = []
  const entries: Array<z.infer<typeof entryProposal>> = [], sources: Array<z.infer<typeof sourceDraftSchema>> = [], unmapped: Array<z.infer<typeof unmappedSchema>> = []
  let section = '', currentRole: z.infer<typeof experienceProposal> | undefined, currentProject: z.infer<typeof projectProposal> | undefined
  let currentEducation: z.infer<typeof entryProposal> | undefined, pendingRole: SectionedRoleHeader | undefined
  let skillText = '', skillCategory = 'Technical', skillLines: Array<{ text: string; page: number }> = []
  let contactRef: string | undefined, skillSequence = 0, summaryText = ''
  const ensureContactRef = () => contactRef ??= 'contact:0'
  const addSource = (text: string, page: number, field: string, ref: string) => sources.push(source(text, page, field, ref))
  const addContactField = (field: string, value: string, text: string, page: number) => {
    const ref = ensureContactRef()
    contact[field] = value
    addSource(text, page, `contact.${field}`, ref)
  }
  const addSkill = (name: string, category: string, sourceLines: Array<{ text: string; page: number }>) => {
    const clean = name.trim()
    if (!clean) return
    let skill = skills.find(item => item.name.toLocaleLowerCase() === clean.toLocaleLowerCase() && item.category.toLocaleLowerCase() === category.toLocaleLowerCase())
    if (!skill) { skill = { name: clean, category, proposalRef: `skill:${skillSequence++}` }; skills.push(skill) }
    for (const line of sourceLines) addSource(line.text, line.page, `skills.${skill.name}`, skill.proposalRef)
  }
  const flushSkills = () => {
    for (const name of skillText.split(/[,;|•]/).map(value => value.trim()).filter(Boolean)) addSkill(name, skillCategory, skillLines)
    skillText = ''; skillLines = []
  }
  const addRoleFact = (role: z.infer<typeof experienceProposal>, text: string, page: number) => {
    const value = text.replace(/^[•▪◦*-]\s+/, '').trim()
    if (!value) return
    let fact = role.factualItems.at(-1)
    if (fact) fact.text = `${fact.text} ${value}`
    else { const ref = `${role.proposalRef}:fact:${role.factualItems.length}`; fact = { text: value, proposalRef: ref }; role.factualItems.push(fact) }
    addSource(text, page, 'experience.factualItem', fact.proposalRef)
  }
  const addProjectFact = (project: z.infer<typeof projectProposal>, text: string, page: number) => {
    const value = text.replace(/^[•▪◦*-]\s+/, '').trim()
    if (!value) return
    let fact = project.factualItems.at(-1)
    if (fact) fact.text = `${fact.text} ${value}`
    else { const ref = `${project.proposalRef}:fact:${project.factualItems.length}`; fact = { text: value, proposalRef: ref }; project.factualItems.push(fact) }
    addSource(text, page, 'projects.factualItem', fact.proposalRef)
  }
  const startRole = (header: SectionedRoleHeader, organization: string, evidenceLines: Array<{ text: string; page: number }>, dateText: string) => {
    const ref = `experience:${experience.length}`, dates = splitDates(dateText)
    currentRole = {
      kind: section === 'training' ? 'training' : 'unresolved', title: header.title, organization,
      description: [header.passage, ...evidenceLines.map(line => line.text)].join('\n'), factualItems: [], proposalRef: ref,
      ...(dates[0] ? { startDate: dates[0] } : {}), ...(dates[1] ? { endDate: dates[1] } : {})
    }
    currentProject = undefined; experience.push(currentRole)
    addSource(header.passage, header.page, 'experience.role', ref)
    for (const line of evidenceLines) addSource(line.text, line.page, 'experience.role', ref)
  }
  const addProject = (name: string, text: string, page: number) => {
    const ref = `project:${projects.length}`
    currentProject = { name, description: text, factualItems: [], technologies: [], links: [], proposalRef: ref }
    currentRole = undefined; projects.push(currentProject)
    addSource(text, page, 'projects.project', ref)
    return currentProject
  }
  const addCertificate = (text: string, page: number) => {
    const clean = text.replace(/^[•▪◦*-]\s+/, '').trim()
    const viewLabel = clean.match(/\s+(View Certificate|Certificate)\s*$/i)?.[0].trim()
    const content = viewLabel ? clean.slice(0, -viewLabel.length).trim() : clean
    const [title, ...issuerParts] = content.split(/\s+[–—-]\s+/)
    const issuer = issuerParts.join(' – ').trim()
    if (!title || (!issuer && !viewLabel)) { unmapped.push({ page, text }); return undefined }
    const proposalRef = `entry:${entries.length}`
    entries.push({ section: 'certificates', title, ...(issuer ? { issuer } : {}), ...(viewLabel ? { description: viewLabel } : {}), proposalRef })
    addSource(text, page, 'entries.certificates', proposalRef)
    return proposalRef
  }
  const flushPendingRole = () => {
    if (!pendingRole) return
    unmapped.push({ page: pendingRole.page, text: pendingRole.passage })
    if (pendingRole.organization) unmapped.push(pendingRole.organization)
    pendingRole = undefined
  }
  for (const page of pages) {
    const lines = page.text.split(/\n|\s{2,}/).map(line => line.trim()).filter(Boolean)
    const ambiguous = (page.warnings ?? []).some(warning => /multiple text columns|reading order may be ambiguous/i.test(warning))
    for (const warning of page.warnings ?? []) unmapped.push({ page: page.page, text: warning })
    if (ambiguous) {
      if (pendingRole) flushPendingRole()
      for (const line of lines) unmapped.push({ page: page.page, text: line })
      continue
    }
    const firstHeading = lines.findIndex(line => plainSection(line))
    const preamble = contact.fullName || firstHeading < 0 ? [] : lines.slice(0, firstHeading)
    const inlineContact = Boolean(preamble[0]?.includes('|') && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(preamble[0]))
    if (preamble.length && !inlineContact) {
      const nameLine = preamble[0]!
      if (/^[\p{L}][\p{L} .'-]{1,120}$/u.test(nameLine)) addContactField('fullName', nameLine, nameLine, page.page)
      const headlineLine = preamble[1]
      if (headlineLine && contact.fullName) {
        if (/^[\p{L}\p{N}][\p{L}\p{N} /&+.,()'-]{1,120}$/u.test(headlineLine) && /\b(?:engineer|developer|scientist|analyst|designer|manager|architect|consultant|researcher|specialist|trainee)\b/i.test(headlineLine)) addContactField('headline', headlineLine, headlineLine, page.page)
        else unmapped.push({ page: page.page, text: headlineLine })
      }
      for (const line of preamble) {
        const email = line.match(/[^\s@]+@[^\s@]+\.[^\s@]+/i)?.[0]
        if (email) addContactField('email', email.replace(/[.,;]$/, ''), line, page.page)
        const phone = line.match(/(?:\+\d{1,3}[\s.-]?)?\d[\d ()-]{6,}\d/)?.[0]
        if (phone) addContactField('phone', phone.trim(), line, page.page)
        const location = line.includes('|') && (email || phone) ? line.split('|').map(part => part.replace(/^[^\p{L}\p{N}]+/u, '').trim()).filter(part => part && !/[^\s@]+@[^\s@]+\.[^\s@]+/.test(part) && !/(?:\+?\d[\d ()-]{6,}\d)/.test(part) && !/^https?:\/\//i.test(part)).at(-1) : undefined
        if (location && /^[\p{L}][\p{L} .,'-]{1,80}$/u.test(location) && location.toLocaleLowerCase() !== headlineLine?.toLocaleLowerCase()) addContactField('location', location, line, page.page)
      }
    }
    const projectRefsAtLine = new Map<number, string>(), certificateRefsAtLine = new Map<number, string>()
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!
      if (preamble.includes(line)) continue
      if (pendingRole) {
        const dates = line.match(dateRangeOnly)
        if (dates) {
          if (pendingRole.organization) startRole(pendingRole, pendingRole.organization.text, [pendingRole.organization, { text: line, page: page.page }], dates[1]!)
          else { flushPendingRole(); unmapped.push({ page: page.page, text: line }); continue }
          pendingRole = undefined; continue
        }
        const match = line.match(dateRangeSuffix)
        if (match && match[1]!.trim()) { startRole(pendingRole, match[1]!.trim(), [...(pendingRole.organization ? [pendingRole.organization] : []), { text: line, page: page.page }], match[2]!); pendingRole = undefined; continue }
        if (line === contact.fullName || line === contact.headline) continue
        if (!pendingRole.organization && !plainSection(line) && !/^[•▪◦*-]\s/.test(line) && possibleOrganization(line)) { pendingRole.organization = { text: line, page: page.page }; continue }
        flushPendingRole()
      }
      const heading = plainSection(line)
      if (heading) {
        flushSkills(); section = heading; skillCategory = heading === 'programming languages' ? 'Languages' : heading === 'tools' ? 'Tools' : heading === 'concepts' ? 'Domain' : 'Technical'; currentRole = undefined; currentProject = undefined; currentEducation = undefined
        continue
      }
      if (section === 'skills' || section === 'programming languages' || section === 'tools' || section === 'concepts') {
        const categoryLine = line.match(/^([^:]{2,60}):\s*(.*)$/)
        if (categoryLine) {
          flushSkills()
          const label = categoryLine[1]!.trim().toLocaleLowerCase()
          skillCategory = ['languages', 'programming languages'].includes(label) ? 'Languages' : /tools|platforms/.test(label) ? 'Tools' : label === 'concepts' ? 'Domain' : 'Technical'
          skillText = categoryLine[2]!.trim(); skillLines = [{ text: line, page: page.page }]
        } else {
          if (skillText) skillText += ` ${line}`
          else skillText = line
          skillLines.push({ text: line, page: page.page })
          if (!skillCategory) skillCategory = section === 'programming languages' ? 'Languages' : section === 'tools' ? 'Tools' : section === 'concepts' ? 'Domain' : 'Technical'
        }
        continue
      }
      if (section === 'education') {
        const educationLine = line.replace(/^[•▪◦*-]\s+/, '')
        const monthDate = `${monthName}\\s+(?:19|20)\\d{2}`
        const namedDates = educationLine.match(new RegExp(`^(.+?)\\s+(${monthDate})(?:\\s*[–—-]\\s*(${monthDate}))?$`, 'i'))
        const dated = namedDates ?? educationLine.match(/^(.+?)\s+((?:19|20)\d{2}(?:-\d{2}(?:-\d{2})?)?)(?:\s*[–—-]\s*((?:19|20)\d{2}(?:-\d{2}(?:-\d{2})?)?))?$/)
        if (dated || /^[•▪◦*-]\s/.test(line)) {
          const title = dated?.[1]?.trim() ?? educationLine
          if (title) {
            const proposalRef = `entry:${entries.length}`
            const supportedDate = (date?: string) => {
              if (!date) return undefined
              if (/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(date)) return date
              const monthAndYear = date.match(new RegExp(`^${monthName}\\s+((?:19|20)\\d{2})$`, 'i'))
              if (!monthAndYear) return undefined
              const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(date.slice(0, 3).toLowerCase()) + 1
              return month ? `${monthAndYear[1]}-${String(month).padStart(2, '0')}` : undefined
            }
            const startDate = supportedDate(dated?.[2]), endDate = supportedDate(dated?.[3])
            const requiresDateResolution = Boolean(dated && (!startDate || dated[3] && !endDate))
            currentEducation = { section: 'education', title, ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}), ...(requiresDateResolution ? { requiresDateResolution: true } : {}), proposalRef }
            entries.push(currentEducation); addSource(line, page.page, 'entries.education', proposalRef)
            if (requiresDateResolution) { addSource(line, page.page, 'entries.education.date', proposalRef); unmapped.push({ page: page.page, text: `Date precision needs review: ${line}` }) }
            continue
          }
        }
        const grade = line.match(/(?:CGPA|GPA|Grade)\s*:?\s*[^,;]+/i)?.[0]
        const institution = (grade ? line.slice(0, line.indexOf(grade)) : line).trim()
        if (currentEducation && /(?:university|college|institute|school)\b/i.test(institution)) {
          currentEducation.institution = institution
          addSource(line, page.page, 'entries.education.institution', currentEducation.proposalRef)
          if (grade) { currentEducation.description = grade; addSource(line, page.page, 'entries.education.description', currentEducation.proposalRef) }
        } else unmapped.push({ page: page.page, text: line })
        continue
      }
      if (section === 'experience' || section === 'training') {
        const roleText = line.replace(/^[•▪◦*-]\s+/, '').trim()
        const inlineRole = roleText.match(/^(.+?)\s+[—–-]\s+(.+?)\s*[|,]\s*((?:19|20)\d{2}(?:\s*[-–—]\s*(?:(?:present|current)|(?:19|20)\d{2}))?)$/i)
        if (inlineRole) {
          const dateParts = splitDates(inlineRole[3]!), ref = `experience:${experience.length}`
          currentRole = { kind: section === 'training' ? 'training' : 'employment', title: inlineRole[1]!.trim(), organization: inlineRole[2]!.trim(), description: line, factualItems: [], proposalRef: ref, ...(dateParts[0] ? { startDate: dateParts[0] } : {}), ...(dateParts[1] ? { endDate: dateParts[1] } : {}) }
          experience.push(currentRole); addSource(line, page.page, 'experience.role', ref); continue
        }
        const nextLine = lines[index + 1], followingLine = lines[index + 2]
        const organizationThenDate = Boolean(nextLine && possibleOrganization(nextLine) && followingLine && dateRangeOnly.test(followingLine))
        const undatedRole = Boolean(nextLine && possibleOrganization(nextLine) && /^[\p{L}\p{N}][\p{L}\p{N} /&+.,'-]{2,180}\s+(?:Remote|Online|Hybrid)$/iu.test(roleText))
        if (/^[•▪◦*-]\s/.test(line) && (nextLine ? dateRangeSuffix.test(nextLine) || organizationThenDate || undatedRole : true)) {
          const title = roleText.replace(/\s+(?:Remote|Online|Hybrid)$/i, '').trim()
          pendingRole = { title, passage: line, page: page.page }; currentRole = undefined
          continue
        }
        if (currentRole) addRoleFact(currentRole, line, page.page)
        else unmapped.push({ page: page.page, text: line })
        continue
      }
      if (section === 'projects' || section === 'personal projects') {
        const bullet = /^[•▪◦*-]\s/.test(line)
        const linkSuffix = bullet && page.links?.some(link => line.toLocaleLowerCase().endsWith(link.label.toLocaleLowerCase()) && /github|repository/i.test(link.label))
        const projectText = line.replace(/^[•▪◦*-]\s+/, '').trim()
        const repositorySuffix = projectText.match(/\s+(?:GitHub|Repository|Repo)$/i)?.[0]
        const projectName = linkSuffix && repositorySuffix ? projectText.slice(0, -repositorySuffix.length).trim() : undefined
        const delimitedProject = projectText.match(/^(.+?)\s+[—–-]\s+([\w.+# ,/]+)$/)
        if (projectName || delimitedProject) {
          if (projectName) projectRefsAtLine.set(index, addProject(projectName, line, page.page).proposalRef)
          else {
            const name = delimitedProject![1]!.trim(), technologyText = delimitedProject![2]!, project = addProject(name, line, page.page)
            projectRefsAtLine.set(index, project.proposalRef)
            for (const text of technologyText.split(/[,;]+/).map(item => item.trim()).filter(Boolean)) { const ref = `${project.proposalRef}:technology:${project.technologies.length}`; project.technologies.push({ text, proposalRef: ref }); addSource(line, page.page, 'projects.technology', ref) }
          }
        } else if (currentProject) addProjectFact(currentProject, line, page.page)
        else unmapped.push({ page: page.page, text: line })
        continue
      }
      if (section === 'certificates' || section === 'certifications') {
        if (/^[•▪◦*-]\s/.test(line)) { const ref = addCertificate(line, page.page); if (ref) certificateRefsAtLine.set(index, ref) }
        else unmapped.push({ page: page.page, text: line })
        continue
      }
      if (section === 'summary') { summaryText = [summaryText, line].filter(Boolean).join('\n'); addSource(line, page.page, 'entries.summary', 'entry:summary'); continue }
      if (section === 'languages') {
        for (const title of line.replace(/^[•▪◦*-]\s+/, '').split(/[,;]+/).map(value => value.trim()).filter(Boolean)) {
          const proposalRef = `entry:${entries.length}`; entries.push({ section: 'languages', title, proposalRef }); addSource(line, page.page, 'entries.languages', proposalRef)
        }
        continue
      }
      unmapped.push({ page: page.page, text: line })
    }
    flushSkills()
    for (const link of page.links ?? []) {
      const passage = `${link.label} — ${link.url}`
      const contactLink = Boolean(contact.fullName) && /linkedin\.com|github\.com\/[^/]+\/?$/i.test(link.url)
      const anchoredProjectRef = link.lineIndex === undefined ? undefined : projectRefsAtLine.get(link.lineIndex)
      const anchoredProject = anchoredProjectRef ? projects.find(project => project.proposalRef === anchoredProjectRef) : undefined
      const anchoredCertificateRef = link.lineIndex === undefined ? undefined : certificateRefsAtLine.get(link.lineIndex)
      const anchoredCertificate = anchoredCertificateRef ? entries.find(entry => entry.proposalRef === anchoredCertificateRef) : undefined
      if (contactLink) { const label = /linkedin\.com/i.test(link.url) ? 'LinkedIn' : /github\.com/i.test(link.url) ? 'GitHub' : link.label; contact.links = [...(Array.isArray(contact.links) ? contact.links as Array<{ label: string; url: string }> : []), { label, url: link.url }]; addSource(passage, page.page, 'contact.links', ensureContactRef()) }
      else if (anchoredProject) { const label = /github/i.test(link.label) || /github\.com/i.test(link.url) ? 'GitHub' : /repository/i.test(link.label) ? 'Repository' : link.label; anchoredProject.links.push({ label, url: link.url }); addSource(passage, page.page, 'projects.links', anchoredProject.proposalRef) }
      else if (anchoredCertificate) { anchoredCertificate.link = link.url; addSource(passage, page.page, 'entries.certificates.link', anchoredCertificate.proposalRef) }
      else unmapped.push({ page: page.page, text: `Unassigned PDF hyperlink: ${passage}` })
    }
  }
  if (pendingRole) flushPendingRole()
  if (summaryText) entries.push({ section: 'summary', title: 'Summary', description: summaryText, proposalRef: 'entry:summary' })
  const cleanContact = Object.fromEntries(Object.entries(contact).filter(([, value]) => typeof value !== 'string' || value.trim()))
  if (Object.keys(cleanContact).length) Object.assign(cleanContact, { proposalRef: ensureContactRef() })
  return profilePdfProposalDraftSchema.parse({ ...(Object.keys(cleanContact).length ? { contact: cleanContact } : {}), skills, experience, projects, entries, sources, unmapped })
}

function mapMarkerLedProfilePdfPages(pages: ProfilePdfPage[]): ProfilePdfProposalDraft {
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
    const projectCountAtPageStart = projects.length
    const lines = page.text.split(/\n|\s{2,}/).map(line => line.trim()).filter(Boolean)
    const ambiguousReadingOrder = (page.warnings ?? []).some(warning => /multiple text columns|reading order may be ambiguous/i.test(warning))
    for (const warning of page.warnings ?? []) unmapped.push({ page: page.page, text: warning })
    if (ambiguousReadingOrder) {
      for (const line of lines) unmapped.push({ page: page.page, text: line })
      for (const link of page.links ?? []) unmapped.push({ page: page.page, text: `Unassigned PDF hyperlink: ${link.label} — ${link.url}` })
      continue
    }
    for (const line of lines) {
      if (line.length > 4000) {
        for (let offset = 0; offset < line.length; offset += 4000) unmapped.push({ page: page.page, text: line.slice(offset, offset + 4000) })
        currentRole = undefined; currentProject = undefined
        continue
      }
      const header = line.match(/^([A-Z][A-Z ]{2,}):\s*(.*)$/)
      if (!header) {
        const heading = sectionAlias(line)
        if (heading) { section = heading; currentRole = undefined; currentProject = undefined; continue }
        if (section === 'skills' && /^[A-Z][a-z]+(?: [A-Z]?[a-z]+){1,3}$/.test(line)) { section = ''; currentRole = undefined; currentProject = undefined; unmapped.push({ page: page.page, text: line }); continue }
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
        else if (section === 'experience' && !ambiguousReadingOrder) {
          const role = line.match(/^(.+?)\s+[—–-]\s+(.+?)\s*[|,]\s*((?:19|20)\d{2}(?:\s*[-–—]\s*(?:(?:present|current)|(?:19|20)\d{2}))?)$/i)
          const pipeRole = splitParts(line)
          const pipeDates = pipeRole[2]?.match(/^(?:19|20)\d{2}(?:\s*(?:to|[-–—])\s*(?:19|20)\d{2})?$/i) ? pipeRole[2].match(/(?:19|20)\d{2}/g) ?? [] : []
          if (role || (pipeRole.length >= 3 && pipeDates.length > 0 && pipeRole[0] && pipeRole[1])) {
            const title = role?.[1].trim() ?? pipeRole[0].trim(), organization = role?.[2].trim() ?? pipeRole[1].trim()
            const dates = role ? role[3].split(/\s*[-–—]\s*/) : pipeDates, ref = `experience:${experience.length}`
            currentRole = { kind: 'employment', title, organization, description: line, factualItems: [], proposalRef: ref, startDate: dates[0], ...(dates[1] ? { endDate: dates[1] } : {}) }
            currentProject = undefined; experience.push(currentRole); sources.push(source(line, page.page, 'experience.role', ref))
          } else if (currentRole) { const ref = `${currentRole.proposalRef}:fact:${currentRole.factualItems.length}`; currentRole.factualItems.push({ text: line, proposalRef: ref }); sources.push(source(line, page.page, 'experience.factualItem', ref)) }
          else unmapped.push({ page: page.page, text: line })
        }
        else if (section === 'projects') {
          const project = line.match(/^(.+?)\s+[—–-]\s+([\w.+# ,/]+)$/)
          const pipeProject = splitParts(line)
          if (project || (pipeProject.length >= 2 && /^[\w.+# ,/]+$/.test(pipeProject.slice(1).join(' | ')))) {
            const ref = `project:${projects.length}`, name = project?.[1].trim() ?? pipeProject[0].trim(), technologyText = project?.[2] ?? pipeProject.slice(1).join(', ')
            currentProject = { name, description: line, factualItems: [], technologies: [], links: [], proposalRef: ref }
            currentRole = undefined; projects.push(currentProject); sources.push(source(line, page.page, 'projects.project', ref))
            for (const text of technologyText.split(/[,;]+/).map(item => item.trim()).filter(Boolean)) { const technologyRef = `${ref}:technology:${currentProject.technologies.length}`; currentProject.technologies.push({ text, proposalRef: technologyRef }); sources.push(source(line, page.page, 'projects.technology', technologyRef)) }
          } else if (currentProject && !ambiguousReadingOrder) { const ref = `${currentProject.proposalRef}:fact:${currentProject.factualItems.length}`; currentProject.factualItems.push({ text: line.replace(/^[•▪◦*-]\s+/, ''), proposalRef: ref }); sources.push(source(line, page.page, 'projects.factualItem', ref)) }
          else unmapped.push({ page: page.page, text: line })
        }
        else if (currentRole && ['experience', 'employment', 'work experience', 'training'].includes(section) && !ambiguousReadingOrder) { const ref = `${currentRole.proposalRef}:fact:${currentRole.factualItems.length}`; currentRole.factualItems.push({ text: line.replace(/^[•▪◦*-]\s+/, ''), proposalRef: ref }); sources.push(source(line, page.page, 'experience.factualItem', ref)) }
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
    for (const link of page.links ?? []) {
      const passage = `${link.label} — ${link.url}`
      const contactLink = Boolean(contact.fullName) && /linkedin\.com|github\.com\/[^/]+\/?$/i.test(link.url)
      const pageProject = projects.length === projectCountAtPageStart + 1 ? projects[projectCountAtPageStart] : undefined
      const linkProject = pageProject
      const projectLink = Boolean(linkProject) && /repository|source|demo|live|project|website/i.test(link.label)
      if (contactLink) {
        const labelIndex = unmapped.findIndex(item => item.page === page.page && item.text === link.label)
        if (labelIndex >= 0) unmapped.splice(labelIndex, 1)
        const links = Array.isArray(contact.links) ? contact.links as Array<{ label: string; url: string }> : []
        links.push({ label: link.label, url: link.url }); contact.links = links
        sources.push(source(passage, page.page, 'contact.links', ensureContactRef()))
      } else if (projectLink && linkProject) {
        const labelIndex = unmapped.findIndex(item => item.page === page.page && item.text === link.label)
        if (labelIndex >= 0) unmapped.splice(labelIndex, 1)
        const linkedLabelRefs = new Set(linkProject.factualItems.filter(item => item.text === link.label).map(item => item.proposalRef))
        linkProject.factualItems = linkProject.factualItems.filter(item => !linkedLabelRefs.has(item.proposalRef))
        for (let index = sources.length - 1; index >= 0; index--) if (sources[index]!.page === page.page && linkedLabelRefs.has(sources[index]!.proposalRef)) sources.splice(index, 1)
        linkProject.links.push({ label: link.label, url: link.url })
        sources.push(source(passage, page.page, 'projects.links', linkProject.proposalRef))
      } else unmapped.push({ page: page.page, text: `Unassigned PDF hyperlink: ${passage}` })
    }
  }
  if (summaryText) entries.push({ section: 'summary', title: 'Summary', description: summaryText, proposalRef: 'entry:summary' })
  const cleanContact = Object.fromEntries(Object.entries(contact).filter(([, value]) => typeof value !== 'string' || value.trim()))
  if (Object.keys(cleanContact).length) Object.assign(cleanContact, { proposalRef: ensureContactRef() })
  return profilePdfProposalDraftSchema.parse({ ...(Object.keys(cleanContact).length ? { contact: cleanContact } : {}), skills, experience, projects, entries, sources, unmapped })
}

export function mapProfilePdfPages(pages: ProfilePdfPage[]): ProfilePdfProposalDraft {
  return isSectionedCv(pages) ? mapSectionedProfilePdfPages(pages) : mapMarkerLedProfilePdfPages(pages)
}
