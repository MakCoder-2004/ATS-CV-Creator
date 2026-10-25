import { z } from 'zod'
import type { DraftRevision } from './draft'
import type { ProfileSnapshot } from './profile'
import type { ExperienceSnapshot } from './experience'

/** Certificates and narrative fields remain readable for old saved documents, not new CVs. */
export const documentSectionNames = ['Education', 'Experience', 'Projects', 'Skills', 'Certificates'] as const
export const skillGroups = ['Languages', 'Technologies', 'Concepts'] as const
const linkSchema = z.object({ label: z.string(), url: z.string().url().refine(value => /^https?:\/\//i.test(value)) }).strict()
const documentEntrySchema = z.object({ id: z.string().min(1), heading: z.string(), organization: z.string().optional(), dates: z.string().optional(), grade: z.string().optional(), text: z.string(), descriptionFormat: z.enum(['paragraph', 'bullets']).optional(), bullets: z.array(z.string()).optional(), technologies: z.array(z.string()).optional(), skillGroup: z.enum(skillGroups).optional(), reviewItems: z.array(z.object({ id: z.string().min(1), text: z.string(), bullets: z.array(z.string()) }).strict()).optional(), links: z.array(linkSchema) }).strict()
const documentSectionSchema = z.object({ name: z.enum(documentSectionNames), entries: z.array(documentEntrySchema) }).strict()
export const canonicalDocumentSchema = z.object({ version: z.literal(1), draftId: z.string().uuid(), jobId: z.string().uuid(), revision: z.number().int().positive(), targetPages: z.union([z.literal(1), z.literal(2)]), identity: z.object({ name: z.string(), headline: z.string().optional(), summary: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), location: z.string().optional(), contact: z.array(z.string()), links: z.array(linkSchema) }).strict(), sections: z.array(documentSectionSchema).refine(sections => sections.every((section, index) => documentSectionNames.indexOf(section.name) > (index ? documentSectionNames.indexOf(sections[index - 1].name) : -1))), style: z.union([z.object({ fontFamily: z.literal('Lato'), templateRevision: z.literal(2).optional(), bodyPt: z.literal(11), pageSize: z.literal('Letter'), background: z.literal('#ffffff') }).strict(), z.object({ fontFamily: z.literal('Arial'), bodyPt: z.literal(11), pageSize: z.literal('A4'), background: z.literal('#ffffff') }).strict()]) }).strict()
export type CanonicalDocument = z.infer<typeof canonicalDocumentSchema>
export type CanonicalDocumentEntry = CanonicalDocument['sections'][number]['entries'][number]
export const documentPdfSchema = z.object({ documentHash: z.string().regex(/^[a-f0-9]{64}$/), pdfBase64: z.string().min(1).max(28_000_000) }).strict()
export type DocumentPdf = z.infer<typeof documentPdfSchema>
export const documentFitReportSchema = z.object({ documentHash: z.string().regex(/^[a-f0-9]{64}$/), targetPages: z.union([z.literal(1), z.literal(2)]), actualPages: z.number().int().positive(), extractedText: z.array(z.string()), linkTargets: z.array(z.string().url()), links: z.array(z.object({ label: z.string(), url: z.string().url() }).strict()).default([]), overflow: z.boolean(), proposedCuts: z.array(z.object({ entryId: z.string(), label: z.string(), section: z.string() }).strict()), measuredAt: z.string().datetime() }).strict()
export type DocumentFitReport = z.infer<typeof documentFitReportSchema>
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthYear = (date?: string) => date?.replace(/^(\d{4})-(\d{2})$/, (_, year, month) => `${months[Number(month) - 1]} ${year}`)
const dateRange = (start?: string, end?: string, ongoing = false) => [monthYear(start), monthYear(end) ?? (ongoing && start ? 'Present' : undefined)].filter(Boolean).join(' – ') || undefined
const documentText = (text: string) => {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'string') return parsed
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      return typeof record.description === 'string' ? record.description : typeof record.text === 'string' ? record.text : ''
    }
  } catch { /* Ordinary generated paragraph. */ }
  return text
}
export function splitDocumentBullets(text: string): string[] {
  return text.split(/\r?\n+/).map(line => line.trim().replace(/^(?:[•●▪◦‣*-]|\d+[.)])\s*/, '').trim()).filter(Boolean)
}
/** Remove only an exact, delimited metadata prefix, never a title used within an accomplishment. */
export function removeRepeatedEntryHeading(text: string, heading: string, organization?: string): string {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const labels = [heading, organization].filter((value): value is string => Boolean(value?.trim())).map(value => escape(value.trim()))
  if (!labels.length) return text
  const prefix = new RegExp(`^(?:${labels.join('|')})(?:\\s*\\([^\\n)]{0,100}\\))?\\s*(?:[—–|:]|\\s-\\s)\\s*`, 'iu')
  return splitDocumentBullets(text).map(line => {
    for (let i = 0; i < 2; i++) { const next = line.replace(prefix, ''); if (next === line) break; line = next }
    return labels.some(label => new RegExp(`^${label}$`, 'iu').test(line)) ? '' : line
  }).filter(Boolean).join('\n')
}
/** Strip only repeated locked education metadata; keep any distinct source-backed details. */
function educationDetails(text: string, heading: string, organization?: string, start?: string, end?: string): { text: string; grade?: string } {
  const labels = [heading, organization].filter((value): value is string => Boolean(value?.trim())).map(value => {
    const literal = value.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*').replace(/\\\(/g, '\\s*\\(')
    return new RegExp(`^${literal}(?=$|\\s*[,;|:]|\\s+[–—-]\\s+)\\s*(?:[,;|:]|[–—-])?\\s*`, 'iu')
  })
  const stripPrefix = (value: string) => {
    let remaining = value.trim(), removed = false
    for (let index = 0; index < labels.length; index++) {
      const pattern = labels.find(label => label.test(remaining))
      if (!pattern) break
      remaining = remaining.replace(pattern, '').trim()
      removed = true
    }
    return { remaining, removed }
  }
  const duplicateYears = start && end ? new RegExp(`^${start.slice(0, 4)}\\s*[–—-]\\s*${end.slice(0, 4)}[.]?$`) : null
  const fragments = splitDocumentBullets(text).flatMap(line => {
    const prefix = stripPrefix(line)
    const parts = prefix.removed || /^(?:C?GPA|Cumulative GPA)\s*[:=]?\s*\d/i.test(prefix.remaining) || duplicateYears?.test(prefix.remaining)
      ? prefix.remaining.split(/\s*[;|]\s*/)
      : [prefix.remaining]
    return parts.map(part => stripPrefix(part).remaining).filter(Boolean)
  })
  const pattern = /^(C?GPA|Cumulative GPA)\s*[:=]?\s*(\d+(?:\.\d+)?(?:\s*(?:\/|out of)\s*\d+(?:\.\d+)?)?)(?=$|[\s.;,|–—-])(.*)$/i
  const matches = fragments.map(fragment => {
    const match = pattern.exec(fragment)
    return match && (!match[3].trim() || /^[|;,:.–—-]/.test(match[3].trim())) ? match : null
  })
  const grades = [...new Set(matches.flatMap(match => match ? [`${match[1].toUpperCase()}: ${match[2].trim()}`] : []))]
  if (grades.length > 1) return { text }
  const remaining = fragments.flatMap((fragment, index) => {
    const rest = matches[index] ? matches[index]![3].trim().replace(/^[|;,:–—-]\s*/, '').trim() : fragment
    return !rest || rest === '.' || duplicateYears?.test(rest) || (grades.length && /^\[(?:REDACTED_PHONE|DATE_OMITTED)\]$/.test(rest)) ? [] : [rest]
  })
  return { ...(grades[0] ? { grade: grades[0] } : {}), text: remaining.join('\n') }
}
export function skillGroupFor(name: string, category = ''): typeof skillGroups[number] {
  if (/^(languages?|programming languages?)$/i.test(category) || /^(?:C\+\+|C#|C|CSS|HTML|JavaScript|TypeScript|Python|Java|Go|Golang|Rust|Ruby|PHP|Swift|Kotlin|Scala|R|SQL|Dart|Perl|Haskell|Lua|Bash|Shell|PowerShell|Julia|MATLAB|Groovy|Elixir|Erlang|F#|Objective-C|Assembly|COBOL|Fortran)$/i.test(name.trim())) return 'Languages'
  return /concept|domain|leadership|method|principle|other/i.test(category) ? 'Concepts' : 'Technologies'
}
export function visibleDocumentSections(document: CanonicalDocument) { return document.sections.filter(section => section.name !== 'Certificates' && section.entries.length) }
export function groupedDocumentSkills(entries: CanonicalDocumentEntry[]) {
  return skillGroups.map(name => ({ name, entries: entries.filter(entry => (entry.skillGroup ?? skillGroupFor(entry.heading)) === name) })).filter(group => group.entries.length)
}
function projectDocumentLink(value: CanonicalDocumentEntry['links'][number]): CanonicalDocumentEntry['links'][number] {
  try {
    const url = new URL(value.url)
    const [owner, repository] = url.pathname.split('/').filter(Boolean)
    if (!/^(?:www\.)?github\.com$/i.test(url.hostname) || !owner || !repository || /^(?:orgs|users|settings|search|marketplace|topics|collections|features)$/i.test(owner)) return value
    const name = decodeURIComponent(repository).replace(/\.git$/i, '')
    return name ? { ...value, label: `github/${name}` } : value
  } catch { return value }
}
export function createCanonicalDocument(draft: DraftRevision, profile: ProfileSnapshot, experience: ExperienceSnapshot): CanonicalDocument {
  const paragraphEntries = (section: 'education' | 'experience' | 'projects') => draft.content[section].map((item, index) => {
    const citations = item.citations.map(citation => citation.evidenceId)
    let heading = '', organization: string | undefined, dates: string | undefined, startDate: string | undefined, parentId: string | undefined, educationEnd: string | undefined, links: CanonicalDocumentEntry['links'] = [], technologies: string[] | undefined
    if (section === 'experience') {
      const locked = draft.lockedFields.experience.find(value => (value.sourceIds ?? [value.evidenceId]).some(id => citations.includes(id)))
      if (locked) { heading = locked.title; organization = locked.organization; dates = dateRange(locked.startDate, locked.endDate, true); startDate = locked.startDate; parentId = locked.evidenceId }
    } else if (section === 'education') {
      const locked = draft.lockedFields.education.find(value => citations.includes(value.evidenceId))
      const record = (draft.evidence?.find(value => value.evidenceId === locked?.evidenceId)?.snapshot ?? profile.education.find(value => value.id === locked?.evidenceId)) as ProfileSnapshot['education'][number] | undefined
      if (locked) { heading = locked.title; organization = locked.institution; dates = dateRange(locked.startDate, locked.endDate); startDate = locked.startDate; educationEnd = locked.endDate }
      if (record?.link) links = [{ label: record.link, url: record.link }]
    } else {
      const locked = draft.lockedFields.projects.find(value => (value.sourceIds ?? [value.evidenceId]).some(id => citations.includes(id)))
      const record = (draft.evidence?.find(value => value.evidenceId === locked?.evidenceId)?.snapshot ?? experience.projects.find(value => value.id === locked?.evidenceId)) as ExperienceSnapshot['projects'][number] | undefined
      if (locked) { heading = locked.name; parentId = locked.evidenceId }
      if (record) { links = (record.links ?? []).map(projectDocumentLink); technologies = (record.technologies ?? []).map(value => value.text) }
    }
    const prose = documentText(item.text)
    const cleaned = removeRepeatedEntryHeading(prose, heading, organization)
    const { text, grade } = section === 'education' ? educationDetails(cleaned, heading, organization, startDate, educationEnd) : { text: cleaned, grade: undefined }
    return { entry: { id: `${section}-${index}`, heading, ...(grade ? { grade } : {}), ...(organization ? { organization } : {}), ...(dates ? { dates } : {}), text, ...(section === 'experience' || section === 'projects' ? { descriptionFormat: item.descriptionFormat ?? 'bullets' as const } : {}), bullets: splitDocumentBullets(text), ...(technologies?.length ? { technologies } : {}), links }, index, startDate, parentId: section === 'education' ? undefined : parentId }
  }).sort((left, right) => (right.startDate ?? '').localeCompare(left.startDate ?? '') || left.index - right.index)
    .reduce<Array<{ entry: CanonicalDocumentEntry; index: number; startDate?: string; parentId?: string }>>((grouped, current) => {
      const existing = current.parentId && grouped.find(value => value.parentId === current.parentId)
      if (!existing) { grouped.push(current); return grouped }
      const reviewItems = existing.entry.reviewItems ?? [{ id: existing.entry.id, text: existing.entry.text, bullets: existing.entry.bullets ?? splitDocumentBullets(existing.entry.text) }]
      const currentReviewItems = [{ id: current.entry.id, text: current.entry.text, bullets: current.entry.bullets ?? splitDocumentBullets(current.entry.text) }]
      const bullets = [...new Set([...reviewItems, ...currentReviewItems].flatMap(item => item.bullets))]
      const paragraphTexts = [...new Set([...reviewItems, ...currentReviewItems].map(item => item.text.trim()))]
      const format = existing.entry.descriptionFormat ?? 'bullets'
      existing.entry = { ...existing.entry, text: format === 'paragraph' ? paragraphTexts.join(' ') : bullets.join('\n'), bullets, descriptionFormat: format, ...(reviewItems.length + currentReviewItems.length > 1 ? { reviewItems: [...reviewItems, ...currentReviewItems] } : {}) }
      existing.entry.technologies = [...new Set([...(existing.entry.technologies ?? []), ...(current.entry.technologies ?? [])])]
      existing.entry.links = [...new Map([...existing.entry.links, ...current.entry.links].map(link => [link.url, link])).values()]
      return grouped
    }, []).map(({ entry }) => entry)
  const recordedSkillNames = new Set(draft.content.skills.map(skill => skill.name.normalize('NFKC').trim().toLocaleLowerCase()))
  const skills: CanonicalDocumentEntry[] = [
    ...draft.content.skills.map((skill, index) => { const snapshot = draft.evidence?.find(source => skill.citations.some(citation => citation.evidenceId === source.evidenceId))?.snapshot as { category?: string } | undefined; return { id: `skills-${index}`, heading: skill.name, skillGroup: skillGroupFor(skill.name, snapshot?.category ?? profile.skills.find(source => skill.citations.some(citation => citation.evidenceId === source.id))?.category), text: '', links: [] } }),
    ...(draft.suggestedSkills ?? []).filter(skill => skill.status === 'confirmed' && !recordedSkillNames.has(skill.name.normalize('NFKC').trim().toLocaleLowerCase())).map(skill => ({ id: `suggested-skills-${skill.id}`, heading: skill.name, skillGroup: skillGroupFor(skill.name), text: '', links: [] }))
  ]
  const contact = profile.contact
  const sections = [{ name: 'Education' as const, entries: paragraphEntries('education') }, { name: 'Experience' as const, entries: paragraphEntries('experience') }, { name: 'Projects' as const, entries: paragraphEntries('projects') }, { name: 'Skills' as const, entries: skills }].filter(section => section.entries.length)
  return canonicalDocumentSchema.parse({ version: 1, draftId: draft.id, jobId: draft.jobId, revision: draft.revision, targetPages: draft.pageTarget, identity: { name: contact?.fullName ?? draft.lockedFields.fullName, ...(contact?.phone ? { phone: contact.phone } : {}), ...(contact?.email ? { email: contact.email } : {}), contact: [contact?.phone, contact?.email].filter((value): value is string => Boolean(value)), links: contact?.links ?? [] }, sections, style: { fontFamily: 'Lato', templateRevision: 2, bodyPt: 11, pageSize: 'Letter', background: '#ffffff' } })
}
export function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!) }
export function documentSectionDisplayName(name: CanonicalDocument['sections'][number]['name']): string { return name === 'Skills' ? 'Technical Skills' : name }
/** Matches template reading order, including the two-column metadata rows and grouped skills. */
export function canonicalDocumentTextParts(input: CanonicalDocument): string[] {
  const document = canonicalDocumentSchema.parse(input), parts = [document.identity.name, ...document.identity.contact, ...document.identity.links.map(link => link.label)]
  for (const section of visibleDocumentSections(document)) {
    parts.push(documentSectionDisplayName(section.name))
    if (section.name === 'Skills') { for (const group of groupedDocumentSkills(section.entries)) parts.push(`${group.name}:`, group.entries.map(entry => entry.heading).join(', ')); continue }
    for (const entry of section.entries) {
      if (section.name === 'Projects') { parts.push(entry.heading); if (entry.technologies?.length) parts.push('|', entry.technologies.join(', ')); if (entry.dates) parts.push(entry.dates); parts.push(...entry.links.map(link => link.label)) }
      else { if (entry.organization) parts.push(entry.organization); else parts.push(entry.heading); if (entry.dates) parts.push(entry.dates); if (entry.organization) parts.push(entry.heading); if (entry.grade) parts.push(entry.grade) }
      parts.push(...(entry.descriptionFormat === 'paragraph' ? [entry.text] : entry.bullets?.length ? entry.bullets : splitDocumentBullets(entry.text)))
      if (section.name !== 'Projects') parts.push(...entry.links.map(link => link.label))
    }
  }
  return parts.filter(Boolean)
}
/** Non-authoritative selectable review markup. PDF pagination comes only from pdfLaTeX. */
export function renderDocumentHtml(input: CanonicalDocument): string {
  const document = canonicalDocumentSchema.parse(input)
  const htmlLink = (link: { label: string; url: string }) => `<a href="${escapeHtml(link.url)}" rel="noreferrer noopener">${escapeHtml(link.label)}</a>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'none'; img-src 'none'; script-src 'none'; connect-src 'none';"><style>@page{size:Letter;margin:0.5in}*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#000;font-family:Lato,sans-serif;font-size:11pt}.identity{text-align:center}h1{font-size:26pt;margin:0 0 4pt}h2{font-size:13pt;font-variant:small-caps;border-bottom:1px solid #000}.row{display:flex;justify-content:space-between;gap:12pt}.dates{white-space:nowrap}.role{font-style:italic;font-size:10pt}ul{margin-top:3pt;padding-left:18pt}li{font-size:10pt;margin-bottom:2pt}</style></head><body><header class="identity"><h1>${escapeHtml(document.identity.name)}</h1><p>${document.identity.contact.map(escapeHtml).join(' · ')} ${document.identity.links.map(htmlLink).join(' · ')}</p></header>${visibleDocumentSections(document).map(section => `<section><h2>${documentSectionDisplayName(section.name)}</h2>${section.name === 'Skills' ? groupedDocumentSkills(section.entries).map(group => `<p><strong>${group.name}:</strong> ${group.entries.map(entry => escapeHtml(entry.heading)).join(', ')}</p>`).join('') : section.entries.map(entry => `<article><div class="row"><strong>${escapeHtml(section.name === 'Projects' ? entry.heading : entry.organization || entry.heading)}</strong>${section.name === 'Projects' && entry.technologies?.length ? `<em> | ${entry.technologies.map(escapeHtml).join(', ')}</em>` : ''}${entry.dates ? `<span class="dates">${escapeHtml(entry.dates)}</span>` : ''}${section.name === 'Projects' && entry.links.length ? `<span>${entry.links.map(htmlLink).join(' · ')}</span>` : ''}</div>${section.name !== 'Projects' && (entry.organization || entry.grade) ? `<div class="row role"><span>${entry.organization ? escapeHtml(entry.heading) : ''}</span>${entry.grade ? `<span class="grade">${escapeHtml(entry.grade)}</span>` : ''}</div>` : ''}${entry.descriptionFormat === 'paragraph' ? `<p class="paper-paragraph">${escapeHtml(entry.text)}</p>` : `<ul>${(entry.bullets?.length ? entry.bullets : splitDocumentBullets(entry.text)).map(bullet => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>`}${section.name !== 'Projects' ? entry.links.map(htmlLink).join(' · ') : ''}</article>`).join('')}</section>`).join('')}</body></html>`
}
