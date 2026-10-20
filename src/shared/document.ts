import { z } from 'zod'
import type { DraftRevision } from './draft'
import type { ProfileSnapshot } from './profile'
import type { ExperienceSnapshot } from './experience'

export const documentSectionNames = ['Education', 'Experience', 'Projects', 'Skills', 'Certificates'] as const
const documentEntrySchema = z.object({ id: z.string().min(1), heading: z.string(), organization: z.string().optional(), dates: z.string().optional(), text: z.string(), links: z.array(z.object({ label: z.string(), url: z.string().url() }).strict()) }).strict()
export const canonicalDocumentSchema = z.object({ version: z.literal(1), draftId: z.string().uuid(), jobId: z.string().uuid(), revision: z.number().int().positive(), targetPages: z.union([z.literal(1), z.literal(2)]), identity: z.object({ name: z.string(), headline: z.string().optional(), contact: z.array(z.string()), links: z.array(z.object({ label: z.string(), url: z.string().url() }).strict()) }).strict(), sections: z.tuple([z.object({ name: z.literal('Education'), entries: z.array(documentEntrySchema) }), z.object({ name: z.literal('Experience'), entries: z.array(documentEntrySchema) }), z.object({ name: z.literal('Projects'), entries: z.array(documentEntrySchema) }), z.object({ name: z.literal('Skills'), entries: z.array(documentEntrySchema) }), z.object({ name: z.literal('Certificates'), entries: z.array(documentEntrySchema) })]), style: z.object({ fontFamily: z.literal('Arial'), bodyPt: z.literal(11), pageSize: z.literal('A4'), background: z.literal('#ffffff') }).strict() }).strict()
export type CanonicalDocument = z.infer<typeof canonicalDocumentSchema>
export const documentFitReportSchema = z.object({ documentHash: z.string().regex(/^[a-f0-9]{64}$/), targetPages: z.union([z.literal(1), z.literal(2)]), actualPages: z.number().int().positive(), extractedText: z.array(z.string()), linkTargets: z.array(z.string().url()), links: z.array(z.object({ label: z.string(), url: z.string().url() }).strict()).default([]), overflow: z.boolean(), proposedCuts: z.array(z.object({ entryId: z.string(), label: z.string(), section: z.string() }).strict()), measuredAt: z.string().datetime() }).strict()
export type DocumentFitReport = z.infer<typeof documentFitReportSchema>

const monthYear = (date?: string) => date?.replace(/^(\d{4})-(\d{2})$/, (_, year, month) => `${month}/${year}`) ?? date
const dateRange = (start?: string, end?: string) => [monthYear(start), monthYear(end)].filter(Boolean).join(' – ') || undefined
const documentText = (text: string) => {
  try { const parsed = JSON.parse(text); if (typeof parsed?.description === 'string') return parsed.description } catch { /* Ordinary generated paragraph. */ }
  return text
}

export function createCanonicalDocument(draft: DraftRevision, profile: ProfileSnapshot, experience: ExperienceSnapshot): CanonicalDocument {
  const paragraphEntries = (section: 'education' | 'experience' | 'projects' | 'certificates') => draft.content[section].map((item, index) => {
    const citations = item.citations.map(citation => citation.evidenceId)
    let heading = item.text, organization: string | undefined, dates: string | undefined, authoritativeStartDate: string | undefined, links: CanonicalDocument['sections'][number]['entries'][number]['links'] = []
    if (section === 'experience') {
      const locked = draft.lockedFields.experience.find(value => (value.sourceIds ?? [value.evidenceId]).some(id => citations.includes(id)))
      const record = experience.experience.find(value => value.id === locked?.evidenceId)
      if (locked) { heading = locked.title; organization = locked.organization; dates = dateRange(locked.startDate, locked.endDate); authoritativeStartDate = locked.startDate }
      links = []
    } else if (section === 'education') {
      const locked = draft.lockedFields.education.find(value => citations.includes(value.evidenceId))
      const record = profile.education.find(value => value.id === locked?.evidenceId)
      if (locked) { heading = locked.title; organization = locked.institution; dates = dateRange(locked.startDate, locked.endDate); authoritativeStartDate = locked.startDate }
      if (record?.link) links = [{ label: record.link, url: record.link }]
    } else if (section === 'projects') {
      const locked = draft.lockedFields.projects.find(value => (value.sourceIds ?? [value.evidenceId]).some(id => citations.includes(id)))
      const record = experience.projects.find(value => value.id === locked?.evidenceId)
      if (locked) heading = locked.name
      links = record?.links ?? []
    } else {
      const locked = draft.lockedFields.certificates.find(value => citations.includes(value.evidenceId))
      const record = profile.certificates.find(value => value.id === locked?.evidenceId)
      if (locked) { heading = locked.title; organization = [locked.issuer, locked.year].filter(Boolean).join(' · ') }
      if (record?.link) links = [{ label: record.link, url: record.link }]
    }
    return { entry: { id: `${section}-${index}`, heading, ...(organization ? { organization } : {}), ...(dates ? { dates } : {}), text: documentText(item.text), links }, index, startDate: authoritativeStartDate }
  }).sort((left, right) => (right.startDate ?? '').localeCompare(left.startDate ?? '') || left.index - right.index).map(({ entry }) => entry)
  const skills = draft.content.skills.map((skill, index) => ({ id: `skills-${index}`, heading: skill.name, text: '', links: [] as { label: string; url: string }[] }))
  const contact = profile.contact
  return canonicalDocumentSchema.parse({ version: 1, draftId: draft.id, jobId: draft.jobId, revision: draft.revision, targetPages: draft.pageTarget, identity: { name: contact?.fullName ?? draft.lockedFields.fullName, ...(contact?.headline ?? draft.lockedFields.headline ? { headline: contact?.headline ?? draft.lockedFields.headline } : {}), contact: [contact?.email, contact?.phone, contact?.location].filter((value): value is string => Boolean(value)), links: contact?.links ?? [] }, sections: [
    { name: 'Education', entries: paragraphEntries('education') }, { name: 'Experience', entries: paragraphEntries('experience') }, { name: 'Projects', entries: paragraphEntries('projects') }, { name: 'Skills', entries: skills }, { name: 'Certificates', entries: paragraphEntries('certificates') }
  ], style: { fontFamily: 'Arial', bodyPt: 11, pageSize: 'A4', background: '#ffffff' } })
}

export function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!) }
export function renderDocumentHtml(input: CanonicalDocument): string {
  const document = canonicalDocumentSchema.parse(input)
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'none'; img-src 'none'; script-src 'none'; connect-src 'none';"><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#111;font-family:Arial,sans-serif;font-size:11pt;line-height:1.25}.identity{text-align:center;margin:0}.identity-rule{border-top:1px solid #333;margin:0 0 12pt}.identity h1{font-size:17pt;margin:0 0 3pt}.identity p{margin:2pt 0}section{margin:0 0 9pt}h2{font-size:12pt;text-transform:uppercase;border-bottom:1px solid #333;padding-bottom:2pt;margin:0 0 5pt}.entry{margin:0 0 6pt}.row{display:flex;justify-content:space-between;gap:12pt}.dates{white-space:nowrap}.description{margin:2pt 0;white-space:pre-wrap}.links{overflow-wrap:anywhere}</style></head><body><header class="identity"><h1>${escapeHtml(document.identity.name)}</h1>${document.identity.headline ? `<p>${escapeHtml(document.identity.headline)}</p>` : ''}${document.identity.contact.length ? `<p>${document.identity.contact.map(escapeHtml).join(' · ')}</p>` : ''}${document.identity.links.length ? `<p>${document.identity.links.map(link => `<a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a>`).join(' · ')}</p>` : ''}</header><div class="identity-rule"></div>${document.sections.map(section => `<section><h2>${section.name}</h2>${section.entries.map(entry => `<article class="entry"><div class="row"><strong>${escapeHtml(entry.heading)}</strong>${entry.dates ? `<span class="dates">${escapeHtml(entry.dates)}</span>` : ''}</div>${entry.organization ? `<div class="row"><span>${escapeHtml(entry.organization)}</span></div>` : ''}<p class="description">${escapeHtml(entry.text)}</p>${entry.links.length ? `<p class="links">${entry.links.map(link => `<a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a>`).join(' · ')}</p>` : ''}</article>`).join('')}</section>`).join('')}</body></html>`
}
