import { z } from 'zod'
import type { DraftRevision } from './draft'
import type { ProfileSnapshot } from './profile'
import type { ExperienceSnapshot } from './experience'

export const documentSectionNames = ['Education', 'Experience', 'Projects', 'Skills', 'Certificates'] as const
const linkSchema = z.object({ label: z.string(), url: z.string().url().refine(value => /^https?:\/\//i.test(value)) }).strict()
const documentEntrySchema = z.object({ id: z.string().min(1), heading: z.string(), organization: z.string().optional(), dates: z.string().optional(), text: z.string(), bullets: z.array(z.string()).optional(), technologies: z.array(z.string()).optional(), links: z.array(linkSchema) }).strict()
const documentSectionSchema = z.object({ name: z.enum(documentSectionNames), entries: z.array(documentEntrySchema) }).strict()
export const canonicalDocumentSchema = z.object({ version: z.literal(1), draftId: z.string().uuid(), jobId: z.string().uuid(), revision: z.number().int().positive(), targetPages: z.union([z.literal(1), z.literal(2)]), identity: z.object({ name: z.string(), headline: z.string().optional(), summary: z.string().optional(), contact: z.array(z.string()), links: z.array(linkSchema) }).strict(), sections: z.array(documentSectionSchema).refine(sections => sections.every((section, index) => documentSectionNames.indexOf(section.name) > (index ? documentSectionNames.indexOf(sections[index - 1].name) : -1))), style: z.object({ fontFamily: z.literal('Arial'), bodyPt: z.literal(11), pageSize: z.literal('A4'), background: z.literal('#ffffff') }).strict() }).strict()
export type CanonicalDocument = z.infer<typeof canonicalDocumentSchema>
export type CanonicalDocumentEntry = CanonicalDocument['sections'][number]['entries'][number]
export const documentFitReportSchema = z.object({ documentHash: z.string().regex(/^[a-f0-9]{64}$/), targetPages: z.union([z.literal(1), z.literal(2)]), actualPages: z.number().int().positive(), extractedText: z.array(z.string()), linkTargets: z.array(z.string().url()), links: z.array(z.object({ label: z.string(), url: z.string().url() }).strict()).default([]), overflow: z.boolean(), proposedCuts: z.array(z.object({ entryId: z.string(), label: z.string(), section: z.string() }).strict()), measuredAt: z.string().datetime() }).strict()
export type DocumentFitReport = z.infer<typeof documentFitReportSchema>

const monthYear = (date?: string) => date?.replace(/^(\d{4})-(\d{2})$/, (_, year, month) => `${month}/${year}`) ?? date
const dateRange = (start?: string, end?: string) => [monthYear(start), monthYear(end)].filter(Boolean).join(' – ') || undefined
const documentText = (text: string) => {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'string') return parsed
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      // An echoed source object is metadata, not CV prose. Never expose serialized records.
      return typeof record.description === 'string' ? record.description : typeof record.text === 'string' ? record.text : ''
    }
  } catch { /* Ordinary generated paragraph. */ }
  return text
}
/** Splits authored/generated descriptions into readable bullets without changing their wording. */
export function splitDocumentBullets(text: string): string[] {
  return text.split(/\r?\n+/).map(line => line.trim().replace(/^(?:[•●▪◦‣*-]|\d+[.)])\s*/, '').trim()).filter(Boolean)
}

export function createCanonicalDocument(draft: DraftRevision, profile: ProfileSnapshot, experience: ExperienceSnapshot): CanonicalDocument {
  const paragraphEntries = (section: 'education' | 'experience' | 'projects' | 'certificates') => draft.content[section].map((item, index) => {
    const citations = item.citations.map(citation => citation.evidenceId)
    let heading = item.text, organization: string | undefined, dates: string | undefined, authoritativeStartDate: string | undefined, links: CanonicalDocumentEntry['links'] = [], technologies: string[] | undefined
    if (section === 'experience') {
      const locked = draft.lockedFields.experience.find(value => (value.sourceIds ?? [value.evidenceId]).some(id => citations.includes(id)))
      if (locked) { heading = locked.title; organization = locked.organization; dates = dateRange(locked.startDate, locked.endDate); authoritativeStartDate = locked.startDate }
    } else if (section === 'education') {
      const locked = draft.lockedFields.education.find(value => citations.includes(value.evidenceId))
      const record = profile.education.find(value => value.id === locked?.evidenceId)
      if (locked) { heading = locked.title; organization = locked.institution; dates = dateRange(locked.startDate, locked.endDate); authoritativeStartDate = locked.startDate }
      if (record?.link) links = [{ label: record.link, url: record.link }]
    } else if (section === 'projects') {
      const locked = draft.lockedFields.projects.find(value => (value.sourceIds ?? [value.evidenceId]).some(id => citations.includes(id)))
      const record = experience.projects.find(value => value.id === locked?.evidenceId)
      if (locked) heading = locked.name
      if (record) { links = record.links; technologies = record.technologies.map(value => value.text) }
    } else {
      const locked = draft.lockedFields.certificates.find(value => citations.includes(value.evidenceId))
      const record = profile.certificates.find(value => value.id === locked?.evidenceId)
      if (locked) { heading = locked.title; organization = [locked.issuer, locked.year].filter(Boolean).join(' · ') }
      if (record?.link) links = [{ label: record.link, url: record.link }]
    }
    const prose = documentText(item.text)
    const text = (section === 'education' || section === 'certificates') && prose.trim() === heading.trim() ? '' : prose
    return { entry: { id: `${section}-${index}`, heading, ...(organization ? { organization } : {}), ...(dates ? { dates } : {}), text, bullets: splitDocumentBullets(text), ...(technologies?.length ? { technologies } : {}), links }, index, startDate: authoritativeStartDate }
  }).sort((left, right) => (right.startDate ?? '').localeCompare(left.startDate ?? '') || left.index - right.index).map(({ entry }) => entry)
  const skills: CanonicalDocumentEntry[] = [
    ...draft.content.skills.map((skill, index) => ({ id: `skills-${index}`, heading: skill.name, text: '', links: [] as CanonicalDocumentEntry['links'] })),
    ...(draft.suggestedSkills ?? []).filter(skill => skill.status === 'confirmed').map(skill => ({ id: `suggested-skills-${skill.id}`, heading: skill.name, text: '', links: [] as CanonicalDocumentEntry['links'] }))
  ]
  const contact = profile.contact
  const allSections: CanonicalDocument['sections'] = [
    { name: 'Education', entries: paragraphEntries('education') }, { name: 'Experience', entries: paragraphEntries('experience') }, { name: 'Projects', entries: paragraphEntries('projects') }, { name: 'Skills', entries: skills }, { name: 'Certificates', entries: paragraphEntries('certificates') }
  ]
  const sections = allSections.filter(section => section.entries.length > 0)
  return canonicalDocumentSchema.parse({ version: 1, draftId: draft.id, jobId: draft.jobId, revision: draft.revision, targetPages: draft.pageTarget, identity: { name: contact?.fullName ?? draft.lockedFields.fullName, ...(draft.tailoring?.headline ? { headline: draft.tailoring.headline } : contact?.headline ?? draft.lockedFields.headline ? { headline: contact?.headline ?? draft.lockedFields.headline } : {}), ...(draft.tailoring?.summary?.text ? { summary: documentText(draft.tailoring.summary.text) } : {}), contact: [contact?.email, contact?.phone, contact?.location].filter((value): value is string => Boolean(value)), links: contact?.links ?? [] }, sections, style: { fontFamily: 'Arial', bodyPt: 11, pageSize: 'A4', background: '#ffffff' } })
}

export function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!) }
export function documentSectionDisplayName(name: CanonicalDocument['sections'][number]['name']): string { return name === 'Skills' ? 'Technical skills' : name }
/** Text fragments in the same reading order and with the same visible labels/content as the exports. */
export function canonicalDocumentTextParts(input: CanonicalDocument): string[] {
  const document = canonicalDocumentSchema.parse(input), parts = [document.identity.name]
  if (document.identity.headline) parts.push(document.identity.headline)
  if (document.identity.contact.length) parts.push(document.identity.contact.join(' · '))
  if (document.identity.links.length) parts.push(document.identity.links.map(link => link.label).join(' · '))
  if (document.identity.summary) parts.push('Professional summary', document.identity.summary)
  for (const section of document.sections) {
    if (!section.entries.length) continue
    parts.push(documentSectionDisplayName(section.name))
    if (section.name === 'Skills') { parts.push(section.entries.map(entry => entry.heading).join(' · ')); continue }
    for (const entry of section.entries) {
      parts.push(entry.heading)
      if (entry.dates) parts.push(entry.dates)
      if (entry.organization) parts.push(entry.organization)
      if (entry.technologies?.length) parts.push('Technologies:', entry.technologies.join(', '))
      const bullets = entry.bullets?.length ? entry.bullets : splitDocumentBullets(entry.text)
      parts.push(...bullets)
      if (entry.links.length) parts.push(entry.links.map(link => link.label).join(' · '))
    }
  }
  return parts.filter(Boolean)
}
const htmlLink = (link: { label: string; url: string }) => `<a href="${escapeHtml(link.url)}" rel="noreferrer noopener">${escapeHtml(link.label)}</a>`
export function renderDocumentHtml(input: CanonicalDocument): string {
  const document = canonicalDocumentSchema.parse(input)
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'none'; img-src 'none'; script-src 'none'; connect-src 'none';"><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#202838;font-family:Arial,sans-serif;font-size:11pt;line-height:1.4}.identity{text-align:center;margin:0 0 4pt;break-inside:avoid}.identity h1{font-size:17pt;margin:0 0 3pt}.identity p{margin:2pt 0}.identity-summary{text-align:left;margin:8pt 0 10pt;white-space:pre-wrap}section{margin:0 0 9pt;break-inside:auto}h2{font-size:12pt;border-bottom:1px solid #333;padding-bottom:2pt;margin:0 0 5pt;break-after:avoid}.entry{margin:0 0 6pt}.entry>.row:first-child{break-after:avoid}.skills-list{margin:0 0 6pt}.row{display:flex;justify-content:space-between;gap:12pt}.dates{white-space:nowrap}.description{margin:2pt 0;white-space:pre-wrap}.entry ul{margin:2pt 0 0;padding-left:18pt}.entry li{padding-left:2pt;margin:0 0 2pt;break-inside:avoid}.metadata{font-size:10pt;margin:2pt 0}.links{overflow-wrap:anywhere}</style></head><body><header class="identity"><h1>${escapeHtml(document.identity.name)}</h1>${document.identity.headline ? `<p>${escapeHtml(document.identity.headline)}</p>` : ''}${document.identity.contact.length ? `<p>${document.identity.contact.map(escapeHtml).join(' · ')}</p>` : ''}${document.identity.links.length ? `<p>${document.identity.links.map(htmlLink).join(' · ')}</p>` : ''}</header>${document.identity.summary ? `<section class="summary-section"><h2>Professional summary</h2><p class="identity-summary">${escapeHtml(document.identity.summary)}</p></section>` : ''}${document.sections.filter(section => section.entries.length).map(section => `<section><h2>${documentSectionDisplayName(section.name)}</h2>${section.name === 'Skills' ? `<p class="skills-list">${section.entries.map(entry => escapeHtml(entry.heading)).join(' · ')}</p>` : section.entries.map(entry => { const bullets = entry.bullets?.length ? entry.bullets : splitDocumentBullets(entry.text); return `<article class="entry"><div class="row"><strong>${escapeHtml(entry.heading)}</strong>${entry.dates ? `<span class="dates">${escapeHtml(entry.dates)}</span>` : ''}</div>${entry.organization ? `<div>${escapeHtml(entry.organization)}</div>` : ''}${entry.technologies?.length ? `<p class="metadata"><strong>Technologies:</strong> ${entry.technologies.map(escapeHtml).join(', ')}</p>` : ''}${bullets.length ? `<ul>${bullets.map(bullet => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>` : ''}${entry.links.length ? `<p class="links">${entry.links.map(htmlLink).join(' · ')}</p>` : ''}</article>` }).join('')}</section>`).join('')}</body></html>`
}
