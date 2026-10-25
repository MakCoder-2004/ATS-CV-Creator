import { z } from 'zod'
import { normalizeJobResearchUrl } from './job-research-url'

const text = z.string().trim().min(1).max(16_000)
const httpsUrl = z.string().url().max(2048).refine(value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && url.hostname.includes('.') && !url.hostname.endsWith('.') && !url.hostname.includes('..') && !/\.(local|internal|test|invalid|example)$/i.test(url.hostname) && !/^(?:\d+\.\d+\.\d+\.\d+|\[.*\])$/.test(url.hostname) } catch { return false }
}, 'Expected a plain HTTPS URL')
const timestamp = z.string().datetime({ offset: true })

export const jobResearchIdentitySchema = z.object({
  canonicalUrl: httpsUrl,
  host: z.string().min(1).max(253),
  provider: z.enum(['linkedin', 'indeed', 'generic']),
  roleId: z.string().min(1).max(160).nullable(),
}).strict().superRefine((selected, ctx) => {
  try {
    const normalized = normalizeJobResearchUrl(selected.canonicalUrl)
    if (normalized.canonicalUrl !== selected.canonicalUrl || normalized.host !== selected.host || normalized.provider !== selected.provider || normalized.roleId !== selected.roleId) {
      ctx.addIssue({ code: 'custom', message: 'Selected fields must match the canonical role identity.' })
    }
  } catch { ctx.addIssue({ code: 'custom', message: 'Selected URL is not a canonical role identity.' }) }
})
export type JobResearchIdentity = z.infer<typeof jobResearchIdentitySchema>

export const jobResearchSourceSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  url: httpsUrl,
  capturedAt: timestamp,
  method: z.enum(['direct-html', 'indexed-snippet', 'employer-page']),
  identity: z.enum(['exact-role', 'unverified-role', 'verified-employer', 'unverified-employer']),
  title: z.string().max(500).nullable(),
  employer: z.string().max(500).nullable(),
  employerIdentityUrl: httpsUrl.nullable(),
}).strict()
export type JobResearchSource = z.infer<typeof jobResearchSourceSchema>

export const jobResearchFindingSchema = z.discriminatedUnion('kind', [
  z.object({ version: z.literal(1), id: z.string().uuid(), sourceId: z.string().uuid(), kind: z.literal('direct-role-text'), text, completeness: z.enum(['full', 'partial']) }).strict(),
  z.object({ version: z.literal(1), id: z.string().uuid(), sourceId: z.string().uuid(), kind: z.literal('indexed-role-claim'), text, completeness: z.literal('partial') }).strict(),
  z.object({ version: z.literal(1), id: z.string().uuid(), sourceId: z.string().uuid(), kind: z.literal('verified-company-context'), text, completeness: z.literal('partial') }).strict(),
]).superRefine((finding, ctx) => {
  if (finding.kind === 'direct-role-text' && finding.completeness === 'full' && finding.text.length < 80) ctx.addIssue({ code: 'custom', message: 'A full posting needs substantive source text.' })
})
export type JobResearchFinding = z.infer<typeof jobResearchFindingSchema>

export const jobResearchRunSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  selected: jobResearchIdentitySchema,
  startedAt: timestamp,
  completedAt: timestamp,
  status: z.enum(['full', 'provisional', 'none', 'blocked']),
  // Optional for older ephemeral runs; absence never authorizes an indexed fallback.
  accessFailure: z.enum(['unreadable', 'unsafe', 'removed', 'server-error']).optional(),
  sources: z.array(jobResearchSourceSchema).max(24),
  findings: z.array(jobResearchFindingSchema).max(48),
  unknowns: z.array(z.string().trim().min(1).max(500)).max(32),
}).strict().superRefine((run, ctx) => {
  if (run.accessFailure && run.status !== 'blocked' && run.status !== 'none') ctx.addIssue({ code: 'custom', message: 'Access failure requires a blocked or empty read' })
  const sourceIds = new Set<string>(), findingIds = new Set<string>()
  for (const source of run.sources) {
    if (sourceIds.has(source.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate source ID' })
    sourceIds.add(source.id)
    if (source.identity === 'exact-role') {
      let same = false
      try { const identity = normalizeJobResearchUrl(source.url); same = identity.provider === run.selected.provider && identity.canonicalUrl === run.selected.canonicalUrl } catch {}
      if (!same) ctx.addIssue({ code: 'custom', message: 'Exact-role source does not match the selected job' })
    }
    if (source.identity === 'verified-employer') {
      const linked = run.sources.some(role => role.identity === 'exact-role' && role.employerIdentityUrl && (() => {
        const claimed = new URL(role.employerIdentityUrl), employer = new URL(source.url)
        return claimed.origin === employer.origin && (claimed.pathname === '/' || employer.pathname === claimed.pathname || employer.pathname.startsWith(claimed.pathname.replace(/\/$/, '') + '/'))
      })())
      if (!source.employerIdentityUrl || !linked) ctx.addIssue({ code: 'custom', message: 'Verified employer needs an explicit link from the exact role source' })
    }
  }
  for (const finding of run.findings) {
    const source = run.sources.find(item => item.id === finding.sourceId)
    if (findingIds.has(finding.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate finding ID' })
    findingIds.add(finding.id)
    if (!source) { ctx.addIssue({ code: 'custom', message: 'Finding source is absent' }); continue }
    if (finding.kind === 'direct-role-text' && (source.method !== 'direct-html' || source.identity !== 'exact-role') ||
      finding.kind === 'indexed-role-claim' && (source.method !== 'indexed-snippet' || source.identity !== 'exact-role') ||
      finding.kind === 'verified-company-context' && (source.method !== 'employer-page' || source.identity !== 'verified-employer')) ctx.addIssue({ code: 'custom', message: 'Finding is not supported by its source' })
  }
  const role = run.findings.filter(finding => finding.kind !== 'verified-company-context')
  const full = role.some(finding => finding.kind === 'direct-role-text' && finding.completeness === 'full')
  if (run.status === 'full' && !full || run.status === 'provisional' && (!role.length || full) ||
    (run.status === 'none' || run.status === 'blocked') && role.length) ctx.addIssue({ code: 'custom', message: 'Outcome does not match role evidence' })
})
export type JobResearchRun = z.infer<typeof jobResearchRunSchema>

export const jobResearchReferenceSchema = z.object({
  version: z.literal(1),
  sourceId: z.string().uuid(),
  findingId: z.string().uuid(),
  url: httpsUrl,
  capturedAt: timestamp,
  identity: z.enum(['exact-role', 'verified-employer']),
  completeness: z.enum(['full', 'partial']),
}).strict()
export type JobResearchReference = z.infer<typeof jobResearchReferenceSchema>

export const reviewedJobResearchSchema = z.object({
  version: z.literal(1),
  runId: z.string().uuid(),
  selected: jobResearchIdentitySchema,
  acceptedFindingIds: z.array(z.string().uuid()).min(1).max(48),
  references: z.array(jobResearchReferenceSchema).min(1).max(48),
  acknowledgedPartial: z.boolean(),
  analysisScope: z.enum(['full', 'provisional']),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export const jobResearchReviewedScopeSchema = reviewedJobResearchSchema
export type ReviewedJobResearch = z.infer<typeof reviewedJobResearchSchema>
