import { z } from 'zod'
import { profilePdfProposalDraftSchema, profilePdfProposalSchema, type ProfilePdfProposal, type ProfilePdfProposalDraft } from './profile-pdf-import'

const uuid = z.string().uuid()
const citationSchema = z.object({ proposalRef: z.string().min(1).max(160), page: z.number().int().positive(), passage: z.string().min(1).max(4000), field: z.string().min(1).max(200) }).strict()
const mappedProposal = z.object({
  contact: profilePdfProposalSchema.shape.contact,
  skills: profilePdfProposalSchema.shape.skills,
  experience: profilePdfProposalSchema.shape.experience,
  projects: profilePdfProposalSchema.shape.projects,
  entries: profilePdfProposalSchema.shape.entries,
  unmapped: profilePdfProposalSchema.shape.unmapped,
  citations: z.array(citationSchema).max(15_000)
}).strict()
export const profileAiResultSchema = mappedProposal
export type ProfileAiResult = z.infer<typeof profileAiResultSchema>

export const PROFILE_AI_RESIDUAL_NOTICE = 'The selected text is sent to OpenRouter and may still contain identifying or sensitive information. Local redaction is incomplete and does not make this anonymous.'

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
  z.object({ ok: z.literal(true), token: uuid, model: z.string().min(1), destination: z.literal('OpenRouter'), outgoing: z.string().max(500_000), warning: z.string(), termsNotice: z.string() }).strict(),
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
export function validateProfileAiDraft(current: ProfilePdfProposal, draft: ProfilePdfProposalDraft, newId: () => string): ProfilePdfProposal {
  const authorized = current.sources.map(source => ({ key: `${source.page}|${source.passage}`, parent: source.proposalRef.replace(/:(?:fact|technology):\d+$/, '') }))
  const unmapped = new Set(current.unmapped.map(source => `${source.page}|${source.text}`))
  for (const source of draft.sources) if (!authorized.some(item => item.key === `${source.page}|${source.passage}`) && !unmapped.has(`${source.page}|${source.passage}`)) throw new Error('The model cited text outside this CV review. Keep the local proposals and review them manually.')
  const citedParents = new Map<string, Set<string>>()
  for (const source of draft.sources) {
    const key = `${source.page}|${source.passage}`
    const parents = authorized.filter(item => item.key === key).map(item => item.parent)
    const set = citedParents.get(source.proposalRef) ?? new Set<string>()
    for (const parent of parents) set.add(parent)
    if (!parents.length && unmapped.has(key)) set.add('unmapped')
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
  const refs = new Set<string>()
  if (draft.contact) refs.add(draft.contact.proposalRef)
  for (const item of draft.skills) refs.add(item.proposalRef)
  for (const item of draft.experience) { refs.add(item.proposalRef); item.factualItems.forEach(fact => refs.add(fact.proposalRef)) }
  for (const item of draft.projects) { refs.add(item.proposalRef); item.factualItems.forEach(fact => refs.add(fact.proposalRef)); item.technologies.forEach(fact => refs.add(fact.proposalRef)) }
  for (const item of draft.entries) refs.add(item.proposalRef)
  if (draft.sources.some(source => !refs.has(source.proposalRef))) throw new Error('The model cited a proposal that is not in its result.')
  const citedRefs = new Set(draft.sources.map(source => source.proposalRef))
  if ([...refs].some(ref => !citedRefs.has(ref))) throw new Error('The model returned a proposal without source support. Keep the local proposals and review them manually.')
  const proposalIds = Object.fromEntries([...refs].map(ref => [ref, current.proposalIds[ref] ?? newId()]))
  return profilePdfProposalSchema.parse({ ...draft, proposalIds, sources: draft.sources.map(source => ({ ...source, proposalId: proposalIds[source.proposalRef] })) })
}
