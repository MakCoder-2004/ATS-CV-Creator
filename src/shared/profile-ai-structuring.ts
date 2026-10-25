import { z } from 'zod'
import { profilePdfProposalDraftSchema, profilePdfProposalSchema, type ProfilePdfProposal, type ProfilePdfProposalDraft } from './profile-pdf-import'
import { PI_THINKING_LEVELS } from './pi-model'
import type { ProfileSourceEvidenceDocument } from './profile-source-evidence'

const uuid = z.string().uuid()
const sourceCitationSchema = z.object({ proposalRef: z.string().min(1).max(160), unitId: z.string().regex(/^page-\d+-passage-\d+$/) }).strict()
export const profileAiResultSchema = z.object({
  contact: profilePdfProposalSchema.shape.contact,
  skills: profilePdfProposalSchema.shape.skills,
  experience: profilePdfProposalSchema.shape.experience,
  projects: profilePdfProposalSchema.shape.projects,
  entries: profilePdfProposalSchema.shape.entries,
  citations: z.array(sourceCitationSchema).max(15_000), unmappedUnitIds: z.array(z.string().regex(/^page-\d+-passage-\d+$/)).max(15_000)
}).strict()
export type ProfileAiResult = z.infer<typeof profileAiResultSchema>

export const PROFILE_AI_RESIDUAL_NOTICE = 'The selected text is sent through Pi to the selected model provider and may still contain identifying or sensitive information. Local redaction is incomplete and does not make this anonymous.'

type ImportProposalAccess = { get: () => ProfilePdfProposal; set: (proposal: ProfilePdfProposal) => void; evidence?: ProfileSourceEvidenceDocument }
const importProposals = new Map<string, ImportProposalAccess>()
export function registerProfileAiImport(token: string, access: ImportProposalAccess) { importProposals.set(token, access) }
export function unregisterProfileAiImport(token: string) { importProposals.delete(token) }
export function getProfileAiImport(token: string) { return importProposals.get(token) }

/** Replaces recognizable contact strings before the preview is shown; original profile values remain local. */
export function minimizeProfileText(text: string, recognizable: string[] = []) {
  const replacements: Array<{ token: string; value: string }> = []
  let redacted = text
  for (const value of [...new Set(recognizable.filter(item => item.trim().length >= 3))].sort((a, b) => b.length - a.length)) {
    const token = `[PERSONAL_${replacements.length + 1}]`
    if (redacted.includes(value)) { redacted = redacted.replaceAll(value, token); replacements.push({ token, value }) }
  }
  redacted = redacted.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, value => {
    const token = `[EMAIL_${replacements.length + 1}]`; replacements.push({ token, value }); return token
  }).replace(/(?:\+?\d[\d ().-]{7,}\d)/g, value => {
    const token = `[PHONE_${replacements.length + 1}]`; replacements.push({ token, value }); return token
  })
  return { text: redacted, replacements }
}

export const profileAiConsentPreviewSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), token: uuid, providerId: z.string().min(1), modelId: z.string().min(1), thinkingLevel: z.enum(PI_THINKING_LEVELS), destination: z.literal('Pi'), outgoing: z.string().max(500_000), warning: z.string(), termsNotice: z.string() }).strict(),
  z.object({ ok: z.literal(false), message: z.string() }).strict()
])
export const profileAiConsentActionSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), token: uuid, message: z.string() }).strict(),
  z.object({ ok: z.literal(false), message: z.string() }).strict()
])
export type ProfileAiConsentPreview = z.infer<typeof profileAiConsentPreviewSchema>
export type ProfileAiConsentAction = z.infer<typeof profileAiConsentActionSchema>
export const profileAiRunResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), proposals: profilePdfProposalSchema, message: z.string() }).strict(),
  z.object({ ok: z.literal(false), message: z.string(), cancelled: z.boolean().optional() }).strict()
])
export type ProfileAiRunResult = z.infer<typeof profileAiRunResultSchema>

/** Model returns an editable draft; app assigns every persistent proposal identity. */
export function validateProfileAiDraft(current: ProfilePdfProposal, draft: ProfilePdfProposalDraft, newId: () => string, evidence?: ProfileSourceEvidenceDocument): ProfilePdfProposal {
  const authorized = current.sources.map(source => ({ key: `${source.page}|${source.passage}`, field: source.field, parent: source.proposalRef.replace(/:(?:fact|technology):\d+$/, '') }))
  const unmapped = new Set(current.unmapped.map(source => `${source.page}|${source.text}`))
  const evidenceSupports = (page: number, passage: string) => evidence?.units.some(unit => unit.page === page && [unit.text, ...unit.links.map(link => `${link.label} — ${link.url}`)].join('\n').includes(passage)) ?? false
  for (const source of draft.sources) if (!evidence && !authorized.some(item => item.key === `${source.page}|${source.passage}`) && !unmapped.has(`${source.page}|${source.passage}`)) throw new Error('The model cited text outside this CV review. Keep the local proposals and review them manually.')
  for (const item of draft.unmapped) if (evidence ? !evidence.pages.some(source => source.page === item.page && source.text.includes(item.text)) && !current.unmapped.some(source => source.page === item.page && source.text === item.text) : ![...current.sources.map(source => ({ page: source.page, text: source.passage })), ...current.unmapped].some(source => source.page === item.page && source.text.includes(item.text))) throw new Error('The model returned unmapped text outside this CV review.')
  const citedParents = new Map<string, Set<string>>()
  for (const source of draft.sources) {
    const key = `${source.page}|${source.passage}`
    const parents = authorized.filter(item => item.key === key).map(item => item.parent)
    const set = citedParents.get(source.proposalRef) ?? new Set<string>()
    for (const parent of parents) set.add(parent)
    if (!parents.length && (unmapped.has(key) || evidence?.pages.some(page => page.page === source.page && page.text.includes(source.passage)))) set.add('unmapped')
    citedParents.set(source.proposalRef, set)
  }
  const parentFor = (ref: string) => {
    const values = citedParents.get(ref) ?? new Set<string>()
    if (values.size > 1) throw new Error('A proposal cites more than one source parent. Keep roles and projects grouped separately.')
    return values.values().next().value as string | undefined
  }
  for (const role of draft.experience) for (const fact of role.factualItems) {
    if (parentFor(role.proposalRef) !== parentFor(fact.proposalRef)) throw new Error('An experience fact cites a different role than its parent. Keep the local proposals and review them manually.')
  }
  for (const project of draft.projects) for (const item of [...project.factualItems, ...project.technologies]) {
    if (parentFor(project.proposalRef) !== parentFor(item.proposalRef)) throw new Error('A project fact cites a different project than its parent. Keep the local proposals and review them manually.')
  }
  const normalized = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
  const citedText = (ref: string) => normalized(draft.sources.filter(source => source.proposalRef === ref).map(source => source.passage).join('\n'))
  const assertSupported = (ref: string, value: string | number | undefined, label: string) => {
    if (value === undefined || value === '') return
    if (!citedText(ref).includes(normalized(String(value)))) throw new Error(`The AI suggested ${label} that is not present in its cited CV passages. Keep the local proposals and review them manually.`)
  }
  const refs = new Set<string>(), fieldPrefixes = new Map<string, string[]>()
  if (draft.contact) { refs.add(draft.contact.proposalRef); fieldPrefixes.set(draft.contact.proposalRef, ['contact.']) }
  for (const item of draft.skills) { refs.add(item.proposalRef); fieldPrefixes.set(item.proposalRef, ['skills.']) }
  for (const item of draft.experience) { refs.add(item.proposalRef); fieldPrefixes.set(item.proposalRef, ['experience.role']); for (const fact of item.factualItems) { refs.add(fact.proposalRef); fieldPrefixes.set(fact.proposalRef, ['experience.factualItem']) } }
  for (const item of draft.projects) { refs.add(item.proposalRef); fieldPrefixes.set(item.proposalRef, ['projects.project', 'projects.links']); for (const fact of item.factualItems) { refs.add(fact.proposalRef); fieldPrefixes.set(fact.proposalRef, ['projects.factualItem']) }; for (const fact of item.technologies) { refs.add(fact.proposalRef); fieldPrefixes.set(fact.proposalRef, ['projects.technology']) } }
  for (const item of draft.entries) { refs.add(item.proposalRef); fieldPrefixes.set(item.proposalRef, [`entries.${item.section}`]) }
  const family = (field: string) => field.startsWith('contact.') ? 'contact' : field.startsWith('skills.') ? 'skills' : field.startsWith('experience.') ? 'experience' : field.startsWith('projects.') ? 'projects' : field.startsWith('entries.') ? field.split('.').slice(0, 2).join('.') : undefined
  if (draft.sources.some(source => !refs.has(source.proposalRef))) throw new Error('The model cited a proposal that is not in its result.')
  if (draft.sources.some(source => !fieldPrefixes.get(source.proposalRef)?.some(prefix => source.field.startsWith(prefix)))) throw new Error('The model associated a source with the wrong profile field.')
  for (const source of draft.sources) {
    const original = authorized.filter(item => item.key === `${source.page}|${source.passage}`)
    const expectedFamily = family(fieldPrefixes.get(source.proposalRef)?.[0] ?? '')
    if (original.length && original.some(item => family(item.field) !== expectedFamily)) throw new Error('The AI moved a source passage into an unrelated profile section.')
    if (!original.length && evidence && !evidenceSupports(source.page, source.passage)) throw new Error('The model cited text outside this CV review. Keep the local proposals and review them manually.')
  }
  const citedRefs = new Set(draft.sources.map(source => source.proposalRef))
  if ([...refs].some(ref => !citedRefs.has(ref))) throw new Error('The model returned a proposal without source support. Keep the local proposals and review them manually.')
  if (draft.contact) {
    for (const field of ['fullName', 'headline', 'email', 'phone', 'location'] as const) assertSupported(draft.contact.proposalRef, draft.contact[field], `contact ${field}`)
    for (const link of draft.contact.links ?? []) { assertSupported(draft.contact.proposalRef, link.label, 'contact link label'); assertSupported(draft.contact.proposalRef, link.url, 'contact link URL') }
  }
  const categories = new Set(['Technical', 'Tools', 'Domain', 'Languages', 'Leadership', 'Other'])
  for (const item of draft.skills) {
    if (!categories.has(item.category)) throw new Error('The AI proposed an unsupported skill category.')
    assertSupported(item.proposalRef, item.name, 'skill name')
    if (item.proficiency !== undefined || item.years !== undefined) throw new Error('AI cannot infer skill proficiency or years. Correct those details locally after structuring.')
  }
  for (const role of draft.experience) {
    const root = parentFor(role.proposalRef), original = current.experience.find(item => item.proposalRef === root)
    if (original ? role.kind !== original.kind : role.kind !== 'unresolved') throw new Error('The AI could not establish this role type from a source-matched local role.')
    assertSupported(role.proposalRef, role.organization, 'experience organization'); assertSupported(role.proposalRef, role.title, 'experience title'); assertSupported(role.proposalRef, role.description, 'experience description'); assertSupported(role.proposalRef, role.startDate, 'experience start date'); assertSupported(role.proposalRef, role.endDate, 'experience end date')
    for (const fact of role.factualItems) assertSupported(fact.proposalRef, fact.text, 'experience fact')
  }
  for (const project of draft.projects) {
    assertSupported(project.proposalRef, project.name, 'project name'); assertSupported(project.proposalRef, project.description, 'project description')
    for (const item of project.factualItems) assertSupported(item.proposalRef, item.text, 'project fact')
    for (const item of project.technologies) assertSupported(item.proposalRef, item.text, 'project technology')
    for (const link of project.links) { assertSupported(project.proposalRef, link.label, 'project link label'); assertSupported(project.proposalRef, link.url, 'project link URL') }
  }
  for (const entry of draft.entries) {
    if (!(entry.section === 'summary' && entry.title === 'Summary')) assertSupported(entry.proposalRef, entry.title, `${entry.section} title`)
    assertSupported(entry.proposalRef, entry.institution, 'institution'); assertSupported(entry.proposalRef, entry.issuer, 'issuer'); assertSupported(entry.proposalRef, entry.description, `${entry.section} description`); assertSupported(entry.proposalRef, entry.startDate, `${entry.section} start date`); assertSupported(entry.proposalRef, entry.endDate, `${entry.section} end date`); assertSupported(entry.proposalRef, entry.year, `${entry.section} year`)
  }
  const proposalIds = Object.fromEntries([...refs].map(ref => [ref, current.proposalIds[ref] ?? newId()]))
  return profilePdfProposalSchema.parse({ ...draft, proposalIds, sources: draft.sources.map(source => ({ ...source, proposalId: proposalIds[source.proposalRef] })) })
}

export function materializeProfileAiResult(current: ProfilePdfProposal, result: ProfileAiResult, evidence: ProfileSourceEvidenceDocument, newId: () => string): ProfilePdfProposal {
  const units = new Map(evidence.units.map(unit => [unit.unitId, unit]))
  const fields = new Map<string, string>()
  if (result.contact) fields.set(result.contact.proposalRef, 'contact.details')
  for (const item of result.skills) fields.set(item.proposalRef, `skills.${item.name}`)
  for (const role of result.experience) {
    fields.set(role.proposalRef, 'experience.role')
    for (const fact of role.factualItems) fields.set(fact.proposalRef, 'experience.factualItem')
  }
  for (const project of result.projects) {
    fields.set(project.proposalRef, 'projects.project')
    for (const fact of project.factualItems) fields.set(fact.proposalRef, 'projects.factualItem')
    for (const technology of project.technologies) fields.set(technology.proposalRef, 'projects.technology')
  }
  for (const entry of result.entries) fields.set(entry.proposalRef, `entries.${entry.section}`)
  const sourceRefs = new Set<string>(), usedUnits = new Set<string>(), citationKeys = new Set<string>()
  const sources = result.citations.map(citation => {
    const unit = units.get(citation.unitId), field = fields.get(citation.proposalRef)
    if (!unit || !field) throw new Error('The AI cited a source or proposal outside this CV review. Keep the local proposals and review them manually.')
    const key = `${citation.proposalRef}|${citation.unitId}`
    if (citationKeys.has(key)) throw new Error('The AI repeated a source reference. Keep the local proposals and review them manually.')
    citationKeys.add(key); sourceRefs.add(citation.proposalRef); usedUnits.add(unit.unitId)
    const linkedEvidence = unit.links.map(link => `${link.label} — ${link.url}`).join('\n')
    const passage = [unit.text, linkedEvidence].filter(Boolean).join('\n')
    if (passage.length > 4000) throw new Error('A cited source block exceeds the review limit. Continue with local review or choose a smaller document.')
    return { proposalRef: citation.proposalRef, page: unit.page, passage, field }
  })
  if ([...fields.keys()].some(ref => !sourceRefs.has(ref))) throw new Error('The AI returned a proposal without exact source support. Keep the local proposals and review them manually.')
  const unresolvedIds = new Set(result.unmappedUnitIds)
  if (unresolvedIds.size !== result.unmappedUnitIds.length) throw new Error('The AI repeated an unresolved source reference. Keep the local proposals and review them manually.')
  for (const unitId of unresolvedIds) if (!units.has(unitId)) throw new Error('The AI returned a source reference outside this CV review.')
  for (const unit of evidence.units) if (!usedUnits.has(unit.unitId) && !unresolvedIds.has(unit.unitId)) throw new Error('The AI omitted readable CV text from its proposals and unresolved review. Keep the local proposals and review the source manually.')
  const refsFor = (proposalRef: string) => result.citations.filter(citation => citation.proposalRef === proposalRef).map(citation => units.get(citation.unitId)!).sort((left, right) => left.page - right.page || left.position - right.position)
  const evidenceOrder = [...evidence.units].sort((left, right) => left.page - right.page || left.position - right.position)
  const evidenceIndex = new Map(evidenceOrder.map((unit, index) => [unit.unitId, index]))
  const assertChildrenFollowParent = (parents: Array<{ proposalRef: string; children: Array<{ proposalRef: string }> }>) => {
    const ordered = parents.map(parent => {
      const sourceUnits = refsFor(parent.proposalRef)
      return { ...parent, units: sourceUnits, start: sourceUnits[0], end: sourceUnits.at(-1) }
    }).sort((left, right) => (evidenceIndex.get(left.start?.unitId ?? '') ?? 0) - (evidenceIndex.get(right.start?.unitId ?? '') ?? 0))
    for (let index = 0; index < ordered.length; index++) {
      const parent = ordered[index]!, start = parent.start, end = parent.end
      if (!start || !end) continue
      const next = ordered[index + 1]?.start, nextIndex = next ? evidenceIndex.get(next.unitId) : undefined
      const endIndex = evidenceIndex.get(end.unitId)!
      for (const unit of parent.units) if (nextIndex !== undefined && (evidenceIndex.get(unit.unitId) ?? 0) >= nextIndex) throw new Error('A parent proposal cites source text from another role or project.')
      const childUnits = parent.children.flatMap(child => refsFor(child.proposalRef))
      const childIndexes = new Set(childUnits.map(unit => evidenceIndex.get(unit.unitId)!))
      for (const unit of childUnits) {
        const unitIndex = evidenceIndex.get(unit.unitId)!, afterParent = unitIndex >= (evidenceIndex.get(start.unitId) ?? 0)
        const beforeNext = nextIndex === undefined || unitIndex < nextIndex
        if (!afterParent || !beforeNext) throw new Error('A nested fact is not associated with the source-supported parent record. Keep the local proposals and review them manually.')
      }
      if (childUnits.length) {
        const lastChildIndex = Math.max(...childIndexes)
        for (let unitIndex = endIndex + 1; unitIndex <= lastChildIndex; unitIndex++) if (!childIndexes.has(unitIndex)) throw new Error('An unassigned source passage separates this nested fact from its parent. Keep the association unresolved for review.')
      }
    }
  }
  assertChildrenFollowParent(result.experience.map(role => ({ proposalRef: role.proposalRef, children: role.factualItems })))
  assertChildrenFollowParent(result.projects.map(project => ({ proposalRef: project.proposalRef, children: [...project.factualItems, ...project.technologies] })))
  const pageByUnit = new Map(evidence.units.map(unit => [unit.unitId, unit.page]))
  const unresolved = [...unresolvedIds].map(unitId => ({ page: pageByUnit.get(unitId)!, text: units.get(unitId)!.text }))
  for (const item of current.unmapped) if (!unresolved.some(source => source.page === item.page && source.text === item.text) && !evidence.units.some(unit => unit.page === item.page && unit.text === item.text)) unresolved.push(item)
  const parsedDraft = profilePdfProposalDraftSchema.safeParse({
    ...(result.contact ? { contact: result.contact } : {}), skills: result.skills, experience: result.experience,
    projects: result.projects, entries: result.entries, sources, unmapped: unresolved
  })
  if (!parsedDraft.success) throw new Error('Pi returned profile details outside the supported profile schema. Nothing was applied; continue with local review.')
  return validateProfileAiDraft(current, parsedDraft.data, newId, evidence)
}
