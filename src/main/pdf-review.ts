import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { ProfileSnapshot } from '../shared/profile'
import type { ExperienceSnapshot } from '../shared/experience'
import { profileExchangeSchema, type ProfileExchange } from '../shared/profile-exchange'
import { confirmPdfImport, pdfImportSelectionSchema, pdfImportProposalSchema, pdfImportActionSchema, type PdfImportField, type PdfImportSelection, type PdfImportProposal, type PdfImportAction, type PdfImportReview } from '../shared/pdf-import'
import { extractPdfImport } from './pdf-import'

type ProfileServices = {
  getProfile(): Promise<ProfileSnapshot>
  getExperience(): Promise<ExperienceSnapshot>
  validateProfileImport(input: string): Promise<{ ok: boolean; message: string }>
  replaceProfile(input: string): Promise<{ ok: boolean; message: string }>
}

type Session = { fields: PdfImportField[]; baseline: string; proposal?: ProfileExchange }
const failure = (message: string): PdfImportAction => pdfImportActionSchema.parse({ ok: false, message })
const effect = (category: string, label: string, action: 'add' | 'replace' = 'add') => ({ action, category, label })

/** Extraction is untrusted. Only individually confirmed, typed fields become a replacement proposal. */
function makeProposal(review: PdfImportReview, profile: ProfileSnapshot, evidence: ExperienceSnapshot) {
  const groups = new Map<string, PdfImportField[]>()
  for (const row of review.fields.filter(row => row.category !== 'unmapped')) {
    if (!row.value.trim()) throw new Error('Remove blank text from the import or mark it as unmapped.')
    const key = `${row.category}:${row.record}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  if (!groups.size) throw new Error('Choose at least one confirmed fact to import; leave uncertain fragments unmapped.')
  const next: ProfileExchange = { format: 'cv-tailor-profile', version: 1, profile: structuredClone(profile), experience: structuredClone(evidence) }
  const effects: Array<{ action: 'add' | 'replace'; category: string; label: string }> = []
  for (const [key, rows] of groups) {
    const [category] = key.split(':')
    const fields = new Map<string, PdfImportField[]>()
    for (const row of rows) fields.set(row.field, [...(fields.get(row.field) ?? []), row])
    for (const [field, values] of fields) if (values.length > 1 && field !== 'link' && field !== 'text' && field !== 'technology') throw new Error(`Multiple ${field} values were mapped to the same ${category} record. Use separate record numbers.`)
    const one = (name: string) => fields.get(name)?.[0]?.value.trim()
    const allowed = (names: string[]) => {
      const unsupported = [...fields.keys()].find(field => !names.includes(field))
      if (unsupported) throw new Error(`The ${unsupported} field cannot be mapped to ${category}. Change the category or field.`)
    }
    if (category === 'contact') {
      allowed(['name', 'headline', 'email', 'phone', 'location', 'link'])
      if (key !== 'contact:1') throw new Error('Only one contact record can be imported.')
      const old = next.profile.contact
      const fullName = one('name') ?? old?.fullName
      if (!fullName) throw new Error('A full name is required to create contact details. Do not invent a missing value.')
      const links = [...(old?.links ?? []), ...(fields.get('link') ?? []).map(row => {
        if (!row.label?.trim()) throw new Error('Every contact link needs a reviewed label.')
        return { label: row.label.trim(), url: row.value.trim() }
      })]
      const updated = { ...(old ?? {}), fullName, ...(one('headline') ? { headline: one('headline') } : {}), ...(one('email') ? { email: one('email') } : {}), ...(one('phone') ? { phone: one('phone') } : {}), ...(one('location') ? { location: one('location') } : {}), links, id: old?.id ?? randomUUID(), revision: (old?.revision ?? 0) + 1 }
      if (!old || !isDeepStrictEqual({ ...old, revision: updated.revision }, updated)) { next.profile.contact = updated; effects.push(effect('contact', fullName, old ? 'replace' : 'add')) }
    } else if (category === 'education') {
      allowed(['title', 'name', 'organization', 'description', 'startDate', 'endDate', 'text'])
      const title = one('title') ?? one('name')
      if (!title) throw new Error('Education needs a reviewed title or degree.')
      next.profile.education.push({ section: 'education', title, ...(one('organization') ? { institution: one('organization') } : {}), ...(one('text') ? { field: one('text') } : {}), ...(one('description') ? { description: one('description') } : {}), ...(one('startDate') ? { startDate: one('startDate') } : {}), ...(one('endDate') ? { endDate: one('endDate') } : {}), id: randomUUID(), revision: 1 })
      effects.push(effect('education', title))
    } else if (category === 'certificate') {
      allowed(['title', 'name', 'organization', 'description', 'startDate', 'link'])
      const title = one('title') ?? one('name'), year = one('startDate')
      if (!title) throw new Error('A certificate needs a reviewed title.')
      if (year && !/^\d{4}$/.test(year)) throw new Error('Certificate year must be four digits.')
      next.profile.certificates.push({ section: 'certificates', title, ...(one('organization') ? { issuer: one('organization') } : {}), ...(one('description') ? { description: one('description') } : {}), ...(year ? { year: Number(year) } : {}), ...(one('link') ? { link: one('link') } : {}), id: randomUUID(), revision: 1 })
      effects.push(effect('certificate', title))
    } else if (category === 'skill') {
      allowed(['name', 'title', 'category'])
      const name = one('name') ?? one('title'), skillCategory = one('category')
      if (!name || !skillCategory) throw new Error('A skill needs a reviewed name and category.')
      next.profile.skills.push({ name, category: skillCategory, id: randomUUID(), revision: 1 })
      effects.push(effect('skill', name))
    } else if (category === 'experience') {
      allowed(['title', 'organization', 'description', 'startDate', 'endDate', 'text'])
      const title = one('title'), organization = one('organization'), description = one('description')
      const kinds = new Set(rows.map(row => row.experienceKind).filter(Boolean))
      if (!title || !organization || !description) throw new Error('Experience needs a reviewed title, organization and description.')
      if (kinds.size !== 1) throw new Error('Choose one consistent employment or training type for this experience.')
      next.experience.experience.push({ kind: [...kinds][0]!, title, organization, description, ...(one('startDate') ? { startDate: one('startDate') } : {}), ...(one('endDate') ? { endDate: one('endDate') } : {}), factualItems: (fields.get('text') ?? []).map(row => ({ id: randomUUID(), revision: 1, text: row.value.trim() })), id: randomUUID(), revision: 1 })
      effects.push(effect('experience', title))
    } else if (category === 'project') {
      allowed(['name', 'title', 'description', 'text', 'technology', 'link'])
      const name = one('name') ?? one('title'), description = one('description')
      if (!name || !description) throw new Error('A project needs a reviewed name and description.')
      const links = (fields.get('link') ?? []).map(row => {
        if (!row.label?.trim()) throw new Error('Every project link needs a reviewed label.')
        return { label: row.label.trim(), url: row.value.trim() }
      })
      next.experience.projects.push({ name, description, links, factualItems: (fields.get('text') ?? []).map(row => ({ id: randomUUID(), revision: 1, text: row.value.trim() })), technologies: (fields.get('technology') ?? []).map(row => ({ id: randomUUID(), revision: 1, text: row.value.trim() })), id: randomUUID(), revision: 1 })
      effects.push(effect('project', name))
    }
  }
  return { exchange: profileExchangeSchema.parse(next), effects }
}

export function createPdfReviewService(storage: ProfileServices) {
  const sessions = new Map<string, Session>()
  const snapshot = async () => JSON.stringify({ profile: await storage.getProfile(), experience: await storage.getExperience() })
  return {
    async stage(bytes: Uint8Array): Promise<PdfImportSelection> {
      try {
        const extraction = await extractPdfImport(bytes)
        if (extraction.source.length + extraction.links.length > 500) throw new Error('This PDF has too many text fragments for a safe review. Enter its facts manually.')
        const fields: PdfImportField[] = [
          ...extraction.source.map((item, index) => {
            const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.text.trim())
            return { category: email ? 'contact' as const : 'unmapped' as const, field: email ? 'email' as const : 'text' as const, value: item.text, sourceIndexes: [index], confidence: email ? 'suggested' as const : 'unmapped' as const, confirmed: false, record: 1 }
          }),
          ...extraction.links.map(link => ({ category: 'unmapped' as const, field: 'link' as const, value: link.target, sourceIndexes: [] as number[], confidence: 'uncertain' as const, confirmed: false, record: 1, ...(link.label ? { label: link.label } : {}) }))
        ]
        const token = randomUUID()
        sessions.set(token, { fields, baseline: await snapshot() })
        return pdfImportSelectionSchema.parse({ ok: true, token, preview: { extraction, fields, accepted: false } })
      } catch (error) {
        return pdfImportSelectionSchema.parse({ ok: false, cancelled: false, message: error instanceof Error ? error.message : 'The selected PDF could not be extracted locally.' })
      }
    },
    async review(token: string, input: unknown): Promise<PdfImportProposal> {
      const session = sessions.get(token)
      if (!session) return pdfImportProposalSchema.parse({ ok: false, message: 'The PDF review has expired. Select the file again.' })
      try {
        if (await snapshot() !== session.baseline) throw new Error('Your profile changed during review. Select the PDF again before importing.')
        const review = confirmPdfImport(input)
        if (review.fields.length !== session.fields.length || review.fields.some((row, index) => !isDeepStrictEqual(row.sourceIndexes, session.fields[index].sourceIndexes))) throw new Error('The extracted fragments changed. Select the PDF again.')
        const current = JSON.parse(session.baseline) as { profile: ProfileSnapshot; experience: ExperienceSnapshot }
        const proposal = makeProposal(review, current.profile, current.experience)
        const validation = await storage.validateProfileImport(JSON.stringify(proposal.exchange))
        if (!validation.ok) throw new Error(validation.message)
        session.proposal = proposal.exchange
        return pdfImportProposalSchema.parse({ ok: true, effects: proposal.effects, message: 'Review the profile replacement effects. Nothing has been saved yet.' })
      } catch (error) {
        session.proposal = undefined
        return pdfImportProposalSchema.parse({ ok: false, message: error instanceof Error ? error.message : 'Review these extracted fields and try again.' })
      }
    },
    async apply(token: string): Promise<PdfImportAction> {
      const session = sessions.get(token)
      if (!session?.proposal) return failure('Confirm each extracted fact and review the replacement effects first.')
      sessions.delete(token)
      if (await snapshot() !== session.baseline) return failure('Your profile changed after review. No PDF facts were imported; start again.')
      const result = await storage.replaceProfile(JSON.stringify(session.proposal))
      return pdfImportActionSchema.parse({ ok: result.ok, message: result.ok ? 'Reviewed PDF facts were saved to your profile. The original PDF was not changed.' : result.message })
    },
    cancel(token: string): PdfImportAction {
      const existed = sessions.delete(token)
      return existed ? pdfImportActionSchema.parse({ ok: true, message: 'PDF review cancelled. Nothing was imported.' }) : failure('This PDF review is no longer active.')
    }
  }
}
