import { z } from 'zod'
import { profilePdfProposalSchema, type ProfilePdfProposal } from './profile-pdf-import'

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
export function minimizeProfileText(text: string) {
  const replacements: Array<{ token: string; value: string }> = []
  const redacted = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, value => {
    const token = `[EMAIL_${replacements.length + 1}]`; replacements.push({ token, value }); return token
  }).replace(/(?:\+?\d[\d ().-]{7,}\d)/g, value => {
    const token = `[PHONE_${replacements.length + 1}]`; replacements.push({ token, value }); return token
  })
  return { text: redacted, replacements }
}

/** Bind candidate output to this review's source passages and app-issued proposal identities. */
export function bindProfileAiResult(current: ProfilePdfProposal, result: ProfileAiResult): ProfilePdfProposal {
  const refs = new Set(Object.keys(current.proposalIds))
  const sourceByKey = new Map(current.sources.map(source => [JSON.stringify({ proposalRef: source.proposalRef, page: source.page, passage: source.passage, field: source.field }), source]))
  for (const citation of result.citations) {
    if (!refs.has(citation.proposalRef) || !sourceByKey.has(JSON.stringify(citation))) throw new Error('The model cited text outside this CV review. Keep the local proposals and review them manually.')
  }
  const citations = new Map(result.citations.map(item => [item.proposalRef, item]))
  const bind = <T extends { proposalRef: string }>(item: T): T => item
  const next = {
    ...current,
    contact: result.contact ? { ...result.contact, proposalRef: current.contact?.proposalRef ?? result.contact.proposalRef } : current.contact,
    skills: result.skills.map(item => bind(item)), experience: result.experience.map(item => bind(item)), projects: result.projects.map(item => bind(item)), entries: result.entries.map(item => bind(item)), unmapped: result.unmapped,
    sources: current.sources.map(source => {
      const citation = citations.get(source.proposalRef)
      return citation ? { ...source, page: citation.page, passage: citation.passage, field: citation.field } : source
    }), proposalIds: current.proposalIds
  }
  // The model cannot create identities, ungrounded source passages, or a profile write capability.
  for (const collection of [next.skills, next.experience, next.projects, next.entries]) for (const item of collection) if (!refs.has(item.proposalRef)) throw new Error('The model proposed a record without an app-issued identity. Keep the local proposals and review them manually.')
  return profilePdfProposalSchema.parse(next)
}

export const profileAiConsentSchema = z.object({ token: uuid, model: z.string().min(1), text: z.string().max(500_000), warning: z.string() }).strict()
export const profileAiRunResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), proposals: profilePdfProposalSchema, message: z.string() }).strict(),
  z.object({ ok: z.literal(false), message: z.string(), cancelled: z.boolean().optional() }).strict()
])
