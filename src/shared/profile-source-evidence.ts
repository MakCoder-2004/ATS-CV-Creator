import { z } from 'zod'
import type { ProfilePdfSourcePage } from './profile-pdf-import'
import type { ProfileDocxPage } from './profile-docx-import'

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const evidenceLinkSchema = z.object({ label: z.string().min(1).max(2048), url: z.string().url().max(2048).refine(value => /^https?:\/\//i.test(value)) }).strict()
const pageSchema = z.object({ page: z.number().int().positive(), text: z.string().max(500_000) }).strict()
const unitSchema = z.object({
  unitId: z.string().regex(/^page-\d+-passage-\d+$/), page: z.number().int().positive(), position: z.number().int().nonnegative(),
  start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), kind: z.enum(['text', 'link']),
  text: z.string().min(1).max(500_000), links: z.array(evidenceLinkSchema).max(100)
}).strict()
export const profileSourceEvidenceSchema = z.object({
  documentId: z.string().uuid(), sourceHash: digestSchema, format: z.enum(['pdf', 'docx']),
  pages: z.array(pageSchema).min(1).max(30), units: z.array(unitSchema).max(15_000)
}).strict().superRefine((document, context) => {
  const pageTexts = new Map(document.pages.map(page => [page.page, page.text]))
  const ids = new Set<string>(), positions = new Set<string>()
  for (const unit of document.units) {
    if (ids.has(unit.unitId)) context.addIssue({ code: 'custom', path: ['units'], message: 'Source unit identities must be unique.' })
    ids.add(unit.unitId)
    const position = `${unit.page}:${unit.position}`
    if (positions.has(position)) context.addIssue({ code: 'custom', path: ['units'], message: 'Source unit positions must be unique within each page.' })
    positions.add(position)
    const pageText = pageTexts.get(unit.page)
    if (pageText === undefined) context.addIssue({ code: 'custom', path: ['units'], message: 'A source unit refers to a page outside this document.' })
    else if (unit.kind === 'text' && (unit.start >= unit.end || pageText.slice(unit.start, unit.end) !== unit.text)) context.addIssue({ code: 'custom', path: ['units'], message: 'A source unit does not match the captured text span.' })
    else if (unit.kind === 'link' && (unit.start !== unit.end || unit.start > pageText.length || !unit.links.length)) context.addIssue({ code: 'custom', path: ['units'], message: 'A hyperlink source unit is not bound to its captured paragraph.' })
  }
})
export type ProfileSourceEvidenceDocument = z.infer<typeof profileSourceEvidenceSchema>
export type ProfileSourceEvidenceUnit = ProfileSourceEvidenceDocument['units'][number]

type NewId = () => string
const pdfPages = z.array(z.object({ page: z.number().int().positive(), text: z.string().max(500_000), links: z.array(evidenceLinkSchema.extend({ lineIndex: z.number().int().nonnegative().optional() })).optional(), warnings: z.array(z.string()).optional() }).strict()).min(1).max(30)
const docxPages = z.array(z.object({ page: z.number().int().positive(), text: z.string().max(500_000), links: z.array(z.never()).optional(), paragraphs: z.array(z.object({ text: z.string().max(500_000), links: z.array(evidenceLinkSchema).max(100) }).strict()).max(15_000) }).strict()).min(1).max(30)
const maximumUnitLength = 1800

function addTextUnits(units: ProfileSourceEvidenceDocument['units'], newId: NewId, page: number, text: string, start: number, position: { value: number }, links: Array<{ label: string; url: string }>) {
  const assigned = new Set<number>()
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(text.length, offset + maximumUnitLength)
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--
    const part = text.slice(offset, end)
    const partLinks = links.filter((link, index) => {
      if (assigned.has(index) || !part.toLocaleLowerCase().includes(link.label.toLocaleLowerCase())) return false
      assigned.add(index); return true
    })
    const unitPosition = position.value++
    units.push({ unitId: `page-${page}-passage-${unitPosition + 1}`, page, position: unitPosition, start: start + offset, end: start + end, kind: 'text', text: part, links: partLinks })
    offset = end
  }
  for (const [index, link] of links.entries()) if (!assigned.has(index)) {
    const unitPosition = position.value++
    units.push({ unitId: `page-${page}-passage-${unitPosition + 1}`, page, position: unitPosition, start, end: start, kind: 'link', text: link.label, links: [link] })
  }
}

function checkedDocument(document: unknown): ProfileSourceEvidenceDocument {
  const parsed = profileSourceEvidenceSchema.safeParse(document)
  if (!parsed.success && parsed.error.issues.some(issue => issue.path[0] === 'units' && issue.message.includes('15000'))) throw new Error('This document exceeds the 15,000 source-unit limit. Continue with local review or choose a smaller document.')
  if (!parsed.success) throw new Error('The selected document could not be prepared as exact source text. Continue with local review or choose it again.')
  return parsed.data
}

export function buildPdfSourceEvidence(sourceHash: string, input: ProfilePdfSourcePage[], newId: NewId): ProfileSourceEvidenceDocument {
  const pages = pdfPages.parse(input), units: ProfileSourceEvidenceDocument['units'] = []
  const storedPages = pages.map(page => ({ page: page.page, text: page.text }))
  for (const page of pages) {
    const position = { value: 0 }
    const lines = [...page.text.matchAll(/[^\n]+/g)].filter(match => match[0]!.trim())
    for (const [lineIndex, line] of lines.entries()) {
      const links = (page.links ?? []).filter(link => link.lineIndex === lineIndex).map(({ label, url }) => ({ label, url }))
      addTextUnits(units, newId, page.page, line[0]!, line.index!, position, links)
    }
    for (const link of page.links ?? []) if (link.lineIndex === undefined || link.lineIndex < 0 || link.lineIndex >= lines.length) {
      addTextUnits(units, newId, page.page, '', 0, position, [{ label: link.label, url: link.url }])
    }
  }
  if (units.length > 15_000) throw new Error('This document exceeds the 15,000 source-unit limit. Continue with local review or choose a smaller document.')
  return checkedDocument({ documentId: newId(), sourceHash, format: 'pdf', pages: storedPages, units })
}

export function buildDocxSourceEvidence(sourceHash: string, input: ProfileDocxPage[], newId: NewId): ProfileSourceEvidenceDocument {
  const pages = docxPages.parse(input), units: ProfileSourceEvidenceDocument['units'] = []
  const storedPages = pages.map(page => ({ page: page.page, text: page.text }))
  for (const page of pages) {
    let cursor = 0
    const position = { value: 0 }
    for (const paragraph of page.paragraphs) {
      const paragraphText = paragraph.text
      if (!paragraphText && !paragraph.links.length) { cursor++; continue }
      const start = paragraphText ? page.text.indexOf(paragraphText, cursor) : cursor
      if (start < 0) throw new Error('The DOCX paragraph does not match the captured text. Reopen the document and try again.')
      if (paragraphText) addTextUnits(units, newId, page.page, paragraphText, start, position, paragraph.links)
      else addTextUnits(units, newId, page.page, '', start, position, paragraph.links)
      cursor = paragraphText ? start + paragraphText.length + 1 : start
    }
  }
  if (units.length > 15_000) throw new Error('This document exceeds the 15,000 source-unit limit. Continue with local review or choose a smaller document.')
  return checkedDocument({ documentId: newId(), sourceHash, format: 'docx', pages: storedPages, units })
}
