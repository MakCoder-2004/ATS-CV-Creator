import { z } from 'zod'
import { factualCheckReportSchema } from './factual-report'
import { qualificationAssessmentSchema } from './qualification-coverage'

export const draftCitationSchema = z.object({ evidenceId: z.string().uuid(), revision: z.number().int().positive() }).strict()
export const generatedDescriptionFormatSchema = z.enum(['paragraph', 'bullets'])
export type GeneratedDescriptionFormat = z.infer<typeof generatedDescriptionFormatSchema>
export const countEnglishWords = (text: string) => text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?:[-‐‑‒–—][\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*)*/gu)?.length ?? 0
export const isGeneratedDescriptionParagraph = (text: string) => !/[\r\n]/.test(text) && !/^(?:[•●▪◦‣*-]|\d+[.)])\s/.test(text) && countEnglishWords(text) <= 60
export const generatedParagraphSchema = z.object({ text: z.string().trim().min(1).max(3000), descriptionFormat: generatedDescriptionFormatSchema.optional(), citations: z.array(draftCitationSchema).min(1), rationale: z.string().trim().min(1).max(500) }).strict()
export const generatedSkillSchema = z.object({ name: z.string().trim().min(1).max(160), citations: z.array(draftCitationSchema).min(1), rationale: z.string().trim().min(1).max(500) }).strict()
export const draftContentSchema = z.object({ education: z.array(generatedParagraphSchema).max(20), experience: z.array(generatedParagraphSchema).max(30), projects: z.array(generatedParagraphSchema).max(30), skills: z.array(generatedSkillSchema).max(100), certificates: z.array(generatedParagraphSchema).max(30) }).strict()
export const draftTailoringSchema = z.object({ headline: z.string().trim().min(1).max(160), summary: generatedParagraphSchema }).strict()
/** A new, reviewable CV title is separate from historical narrative headlines. */
export const cvTitleTextSchema = z.string().trim().min(1).max(100).refine(value => !/[\r\n]/.test(value) && countEnglishWords(value) <= 10, 'Use a concise, single-line professional title.')
/** A professional title can specialize a held role, but must not invent a new occupation. */
export function cvTitleHasHeldRoleAnchor(title: string, heldTitles: string[]): boolean {
  const roles = heldTitles.filter(Boolean).map(value => value.normalize('NFKC').toLocaleLowerCase())
  const text = title.normalize('NFKC').toLocaleLowerCase()
  const occupations = text.match(/\b(?:engineer|developer|analyst|scientist|designer|manager|architect|consultant|researcher|specialist|trainee|administrator|technician|coordinator|professional)\b/giu) ?? []
  return occupations.length ? occupations.every(term => roles.some(role => new RegExp(`\\b${term}\\b`, 'iu').test(role))) : roles.some(role => role.length > 2 && text.includes(role))
}
const cvTitleWords = (value: string) => value.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
/** Compare title modifiers to the cited facts, not merely to the job posting or a matching occupation word. */
export function cvTitleUnsupportedTerms(title: string, sourceText: string[], heldTitles: string[]): string[] {
  const supported = new Set(sourceText.flatMap(cvTitleWords))
  const held = new Set(heldTitles.flatMap(cvTitleWords))
  const connectors = new Set(['and', 'or', 'of', 'for', 'with', 'in', 'the', 'a', 'an'])
  // These terms imply a credential; a held-role label or incidental description is not license evidence.
  const credentialClaims = new Set(['licensed', 'licenced', 'license', 'licence', 'licensure', 'certified', 'certification', 'certificated', 'registered', 'registration', 'chartered', 'accredited', 'phd', 'doctor', 'md', 'mba', 'cpa', 'cfa', 'pmp'])
  const normalizedTitle = cvTitleWords(title).join(' ')
  const protectedPhrases = ['professional engineer', 'professional eng', 'prof engineer', 'p eng', 'p e', 'peng', 'pe', 'registered nurse', 'r n', 'rn', 'board certified', 'certified public accountant', 'ph d', 'm d']
  const protectedMatches = protectedPhrases.filter(phrase => (` ${normalizedTitle} `).includes(` ${phrase} `))
  const ordinary = [...new Set(cvTitleWords(title))].filter(word => credentialClaims.has(word) || !connectors.has(word) && !supported.has(word) && !held.has(word))
  return [...new Set([...ordinary, ...protectedMatches])]
}
export function cvTitleSourceValues(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(cvTitleSourceValues)
  if (value && typeof value === 'object') return Object.entries(value).filter(([key]) => !/^(?:id|revision|sourceIds|evidenceId|createdAt|updatedAt)$/i.test(key)).flatMap(([, child]) => cvTitleSourceValues(child))
  return []
}
export const cvTitleSchema = z.object({ text: cvTitleTextSchema, citations: z.array(draftCitationSchema).min(1).max(5), rationale: z.string().trim().min(1).max(500), authoredBy: z.enum(['model', 'user']) }).strict()
export const cvTitleChangeSchema = z.object({ jobId: z.string().uuid(), draftId: z.string().uuid(), title: cvTitleTextSchema.nullable() }).strict()
export type CvTitleChange = z.infer<typeof cvTitleChangeSchema>
export const suggestedSkillSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(160), postingTerm: z.string().trim().min(1).max(300), sourceJobRevision: z.union([z.string(), z.number()]), status: z.enum(['pending', 'confirmed', 'removed']), decidedAt: z.string().datetime().optional() }).strict()
export const suggestedSkillDecisionSchema = z.object({ jobId: z.string().uuid(), draftId: z.string().uuid(), skillId: z.string().uuid(), decision: z.enum(['pending', 'confirmed', 'removed']) }).strict()
export type SuggestedSkillDecision = z.infer<typeof suggestedSkillDecisionSchema>
export const draftTailoringCorrectionSchema = z.object({ jobId: z.string().uuid(), draftId: z.string().uuid(), field: z.enum(['headline', 'summary']), text: z.string().trim().min(1).max(3000) }).strict()
export type DraftTailoringCorrection = z.infer<typeof draftTailoringCorrectionSchema>
export const draftEvidenceSchema = z.object({ evidenceId: z.string().uuid(), revision: z.number().int().positive(), snapshot: z.unknown(), provenance: z.enum(['profile', 'manual']).optional(), profileOrigin: draftCitationSchema.optional() }).strict()
export const draftApprovalSchema = z.object({ contentHash: z.string().regex(/^[a-f0-9]{64}$/), evidenceHash: z.string().regex(/^[a-f0-9]{64}$/), checkHash: z.string().regex(/^[a-f0-9]{64}$/), targetPages: z.union([z.literal(1), z.literal(2)]), approvedAt: z.string().datetime() }).strict()
export const qualificationCoverageSchema = z.object({ assessments: z.array(qualificationAssessmentSchema).optional(), stale: z.boolean().optional(), analysisId: z.string().uuid(), label: z.literal('Evidence-supported relevance heuristic — not a universal ATS score or hiring guarantee.'), repairAttempts: z.number().int().min(0).max(100), factualChecksRerun: z.boolean(), supportedMatches: z.array(z.object({ qualification: z.string(), kind: z.enum(['required', 'preferred']), evidence: z.array(z.string().uuid()).min(1), matchedAs: z.string() }).strict()), gaps: z.array(z.object({ qualification: z.string(), kind: z.enum(['required', 'preferred']) }).strict()) }).strict()
export const draftRevisionSchema = z.object({ id: z.string().uuid(), jobId: z.string().uuid(), revision: z.number().int().positive(), targetPostingUpdatedAt: z.string().datetime().optional(), pageTarget: z.union([z.literal(1), z.literal(2)]), status: z.enum(['unverified', 'blocked']), approved: z.boolean(), approval: draftApprovalSchema.optional(), checkReport: factualCheckReportSchema.optional(), coverage: qualificationCoverageSchema.optional(), lockedFields: z.object({ fullName: z.string(), headline: z.string().optional(), experience: z.array(z.object({ evidenceId: z.string().uuid(), sourceIds: z.array(z.string().uuid()).optional(), title: z.string(), organization: z.string(), startDate: z.string().optional(), endDate: z.string().optional() }).strict()), education: z.array(z.object({ evidenceId: z.string().uuid(), title: z.string(), institution: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional() }).strict()), projects: z.array(z.object({ evidenceId: z.string().uuid(), sourceIds: z.array(z.string().uuid()).optional(), name: z.string() }).strict()), certificates: z.array(z.object({ evidenceId: z.string().uuid(), title: z.string(), issuer: z.string().optional(), year: z.number().optional() }).strict()) }).strict(), content: draftContentSchema, tailoring: draftTailoringSchema.optional(), cvTitle: cvTitleSchema.optional(), suggestedSkills: z.array(suggestedSkillSchema).max(100).optional(), evidence: z.array(draftEvidenceSchema), progress: z.string(), attempts: z.number().int().nonnegative(), createdAt: z.string().datetime() }).strict()
export type DraftRevision = z.infer<typeof draftRevisionSchema>
export const draftGenerationSchema = z.object({ ok: z.boolean(), message: z.string(), draft: draftRevisionSchema.optional() }).strict()
export const draftCorrectionInputSchema = z.object({ jobId: z.string().uuid(), section: z.enum(['education', 'experience', 'projects', 'skills', 'certificates']), index: z.number().int().nonnegative(), text: z.string().trim().min(1).max(3000), editIntent: z.enum(['wording-only', 'new-fact']).optional(), evidence: z.array(draftCitationSchema).min(1).optional() }).strict().superRefine((value, context) => { if (value.editIntent === 'new-fact' && !value.evidence?.length) context.addIssue({ code: 'custom', path: ['evidence'], message: 'New factual wording requires explicitly selected saved evidence.' }); if (value.editIntent === 'wording-only' && value.evidence) context.addIssue({ code: 'custom', path: ['evidence'], message: 'Evidence selection is only valid for the new-fact path.' }) })
export type DraftCorrectionInput = z.infer<typeof draftCorrectionInputSchema>
export const addDraftItemInputSchema = z.object({ jobId: z.string().uuid(), section: z.enum(['education', 'experience', 'projects', 'skills', 'certificates']), text: z.string().trim().min(1).max(3000), citation: draftCitationSchema }).strict()
export type AddDraftItemInput = z.infer<typeof addDraftItemInputSchema>
