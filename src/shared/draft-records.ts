import { z } from 'zod'
import { profileEntryInputSchema, skillInputSchema } from './profile'
import { experienceInputSchema, projectInputSchema } from './experience'
import type { DraftRevision } from './draft'

export const draftRecordSectionSchema = z.enum(['education', 'experience', 'projects', 'skills'])
export const draftRecordValueSchema = z.union([profileEntryInputSchema, experienceInputSchema, projectInputSchema, skillInputSchema])
export const mutateDraftRecordInputSchema = z.object({
  jobId: z.string().uuid(), draftId: z.string().uuid(), sourceRevision: z.number().int().positive(),
  section: draftRecordSectionSchema, operation: z.enum(['add', 'update', 'remove']),
  index: z.number().int().nonnegative().optional(), scope: z.enum(['cv-only', 'profile']).default('cv-only'),
  value: z.unknown().optional()
}).strict().superRefine((input, context) => {
  if (input.operation !== 'add' && input.index === undefined) context.addIssue({ code: 'custom', path: ['index'], message: 'Select a record to update or remove.' })
  if (input.operation !== 'remove' && input.value === undefined) context.addIssue({ code: 'custom', path: ['value'], message: 'Record details are required.' })
})
export type MutateDraftRecordInput = z.infer<typeof mutateDraftRecordInputSchema>
export type DraftRecordValue = z.infer<typeof draftRecordValueSchema>
export type MutateDraftRecordResult = { ok: boolean; message: string; draft?: DraftRevision; recordIndex?: number; fieldErrors?: Record<string, string>; profileDeleteWarning?: boolean }
export interface DraftRecordDescriptor { section: MutateDraftRecordInput['section']; index: number; sourceId?: string; sourceRevision?: number; value: DraftRecordValue }

/** Prefill from frozen evidence and current CV prose; generated parents resolve child citations via frozen ownership locks. */
export function listDraftRecords(draft: DraftRevision): DraftRecordDescriptor[] {
  const descriptors: DraftRecordDescriptor[] = []
  for (const section of ['education', 'experience', 'projects', 'skills'] as const) {
    const records = draft.content[section]
    records.forEach((item, index) => {
      const itemCitations = item.citations
      const lock = section === 'experience' || section === 'projects'
        ? draft.lockedFields[section].find(parent => (parent.sourceIds ?? [parent.evidenceId]).some(id => itemCitations.some(citation => citation.evidenceId === id)))
        : undefined
      const parentId = lock?.evidenceId
      const sourceCitation = parentId
        ? itemCitations.find(citation => citation.evidenceId === parentId) ?? { evidenceId: parentId, revision: draft.evidence.find(source => source.evidenceId === parentId)?.revision ?? 1 }
        : itemCitations[0]
      const source = sourceCitation && draft.evidence.find(entry => entry.evidenceId === sourceCitation.evidenceId && entry.revision === sourceCitation.revision)
      const snapshot = (source?.snapshot ?? (parentId ? draft.evidence.find(entry => entry.evidenceId === parentId)?.snapshot : undefined) ?? (lock ? { ...lock, ...(section === 'experience' ? { kind: 'employment' } : {}) } : undefined)) as Record<string, unknown> | undefined
      if (!snapshot) return
      const grouped = parentId && (section === 'experience' || section === 'projects')
        ? records.filter(candidate => candidate.citations.some(citation => (lock!.sourceIds ?? [lock!.evidenceId]).includes(citation.evidenceId)))
        : [item]
      const prose = grouped.map(candidate => 'text' in candidate ? candidate.text : candidate.name).filter(Boolean).join('\n')
      let value: unknown
      if (section === 'education') value = { section: 'education', title: snapshot.title, ...(snapshot.institution ? { institution: snapshot.institution } : {}), ...(snapshot.field ? { field: snapshot.field } : {}), ...(snapshot.startDate ? { startDate: snapshot.startDate } : {}), ...(snapshot.endDate ? { endDate: snapshot.endDate } : {}), ...(snapshot.issuer ? { issuer: snapshot.issuer } : {}), ...(snapshot.year ? { year: snapshot.year } : {}), ...(prose ? { description: prose } : {}), ...(snapshot.link ? { link: snapshot.link } : {}) }
      else if (section === 'experience') value = { kind: snapshot.kind, title: snapshot.title, organization: snapshot.organization, ...(snapshot.startDate ? { startDate: snapshot.startDate } : {}), ...(snapshot.endDate ? { endDate: snapshot.endDate } : {}), description: prose || snapshot.description, factualItems: Array.isArray(snapshot.factualItems) ? snapshot.factualItems.map((fact: { id?: string; text: string }) => ({ ...(fact.id ? { id: fact.id } : {}), text: fact.text })) : [] }
      else if (section === 'projects') value = { name: snapshot.name, description: prose || snapshot.description, factualItems: Array.isArray(snapshot.factualItems) ? snapshot.factualItems.map((fact: { id?: string; text: string }) => ({ ...(fact.id ? { id: fact.id } : {}), text: fact.text })) : [], technologies: Array.isArray(snapshot.technologies) ? snapshot.technologies.map((fact: { id?: string; text: string }) => ({ ...(fact.id ? { id: fact.id } : {}), text: fact.text })) : [], links: Array.isArray(snapshot.links) ? snapshot.links : [] }
      else value = { name: (item as { name: string }).name ?? snapshot.name, category: snapshot.category ?? 'Technologies', ...(snapshot.proficiency ? { proficiency: snapshot.proficiency } : {}), ...(snapshot.years !== undefined ? { years: snapshot.years } : {}) }
      const parsed = draftRecordValueSchema.safeParse(value)
      if (parsed.success) descriptors.push({ section, index, sourceId: parentId ?? sourceCitation?.evidenceId, sourceRevision: source?.revision, value: parsed.data })
    })
  }
  return descriptors
}
