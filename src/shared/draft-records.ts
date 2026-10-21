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
export type MutateDraftRecordResult = { ok: boolean; message: string; draft?: DraftRevision; fieldErrors?: Record<string, string> }
export interface DraftRecordDescriptor { section: MutateDraftRecordInput['section']; index: number; sourceId?: string; sourceRevision?: number; value: DraftRecordValue }

/** Resolve form values only from this draft's frozen evidence, never live profile state. */
export function listDraftRecords(draft: DraftRevision): DraftRecordDescriptor[] {
  const result: DraftRecordDescriptor[] = []
  for (const section of ['education', 'experience', 'projects', 'skills'] as const) {
    draft.content[section].forEach((item, index) => {
      const citation = item.citations[0]
      const source = citation && draft.evidence.find(entry => entry.evidenceId === citation.evidenceId && entry.revision === citation.revision)
      const snapshot = source?.snapshot as Record<string, unknown> | undefined
      if (!snapshot) return
      let value: unknown
      if (section === 'education') value = { section: 'education', title: snapshot.title, ...(snapshot.institution ? { institution: snapshot.institution } : {}), ...(snapshot.field ? { field: snapshot.field } : {}), ...(snapshot.startDate ? { startDate: snapshot.startDate } : {}), ...(snapshot.endDate ? { endDate: snapshot.endDate } : {}), ...(snapshot.description ? { description: snapshot.description } : {}), ...(snapshot.link ? { link: snapshot.link } : {}) }
      else if (section === 'experience') value = { kind: snapshot.kind, title: snapshot.title, organization: snapshot.organization, ...(snapshot.startDate ? { startDate: snapshot.startDate } : {}), ...(snapshot.endDate ? { endDate: snapshot.endDate } : {}), description: snapshot.description ?? (item as { text: string }).text, factualItems: Array.isArray(snapshot.factualItems) ? snapshot.factualItems.map((fact: { text: string }) => ({ text: fact.text })) : [] }
      else if (section === 'projects') value = { name: snapshot.name, description: snapshot.description ?? (item as { text: string }).text, factualItems: Array.isArray(snapshot.factualItems) ? snapshot.factualItems.map((fact: { text: string }) => ({ text: fact.text })) : [], technologies: Array.isArray(snapshot.technologies) ? snapshot.technologies.map((fact: { text: string }) => ({ text: fact.text })) : [], links: Array.isArray(snapshot.links) ? snapshot.links : [] }
      else value = { name: snapshot.name ?? (item as { name: string }).name, category: snapshot.category ?? 'Technologies', ...(snapshot.proficiency ? { proficiency: snapshot.proficiency } : {}), ...(snapshot.years !== undefined ? { years: snapshot.years } : {}) }
      const parsed = draftRecordValueSchema.safeParse(value)
      if (parsed.success) result.push({ section, index, sourceId: citation.evidenceId, sourceRevision: citation.revision, value: parsed.data })
    })
  }
  return result
}
