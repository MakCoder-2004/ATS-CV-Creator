import { createHash } from 'node:crypto'
import { z } from 'zod'

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
}).strict()
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
  sources: z.array(jobResearchSourceSchema).max(24),
  findings: z.array(jobResearchFindingSchema).max(48),
  unknowns: z.array(z.string().trim().min(1).max(500)).max(32),
}).strict().superRefine((run, ctx) => {
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

/** App-issued source and finding IDs are checked against the immutable run, not client-supplied passages. */
export function promoteJobResearch(runInput: unknown, acceptedFindingIds: string[], acknowledgedPartial: boolean): ReviewedJobResearch {
  const run = jobResearchRunSchema.parse(runInput)
  if (run.status === 'blocked' || run.status === 'none' || !acceptedFindingIds.length || new Set(acceptedFindingIds).size !== acceptedFindingIds.length) throw new Error('No distinct reviewed role findings were selected.')
  const accepted = acceptedFindingIds.map(id => {
    const finding = run.findings.find(item => item.id === id)
    if (!finding || finding.kind === 'verified-company-context') throw new Error('Only app-issued role findings can be accepted.')
    return finding
  })
  const full = accepted.some(item => item.kind === 'direct-role-text' && item.completeness === 'full')
  if (!full && !acknowledgedPartial) throw new Error('Acknowledge incomplete role evidence before provisional analysis.')
  const scope = full ? 'full' : 'provisional'
  const evidence = accepted.map(finding => ({ finding, source: run.sources.find(source => source.id === finding.sourceId) })).sort((a, b) => a.finding.id.localeCompare(b.finding.id))
  const references = accepted.map(finding => {
    const source = run.sources.find(item => item.id === finding.sourceId)!
    return jobResearchReferenceSchema.parse({ version: 1, sourceId: source.id, findingId: finding.id, url: source.url, capturedAt: source.capturedAt, identity: 'exact-role', completeness: finding.completeness })
  })
  return reviewedJobResearchSchema.parse({ version: 1, runId: run.id, selected: run.selected, acceptedFindingIds: acceptedFindingIds.slice(), references, acknowledgedPartial, analysisScope: scope,
    evidenceHash: createHash('sha256').update(JSON.stringify({ version: 1, runId: run.id, selected: run.selected, scope, evidence, unknowns: run.unknowns })).digest('hex') })
}

const tracking = /^(utm_[a-z0-9_]+|gclid|fbclid|li_fat_id|mc_cid|mc_eid|ref|refid|trk|trackingid|source|src|from)$/i
const sensitive = /(token|secret|password|passwd|auth|session|api.?key|email|e-mail|phone|user.?id|cookie|signature|access.?key)/i
const roleParam = /^(currentJobId|jobId|jk|vjk)$/i
export function normalizeJobResearchUrl(input: string): JobResearchIdentity {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > 2048 || input.trim() !== input || /[\u0000-\u0020\u007f\\]/.test(input) || /%(?:2f|5c|00|0a|0d)/i.test(input)) throw new Error('Invalid public job URL.')
  let url: URL
  try { url = new URL(input) } catch { throw new Error('Invalid public job URL.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !url.hostname.includes('.') || url.hostname.endsWith('.') || url.hostname.includes('..') || url.hostname === 'localhost' || /\.(local|internal|test|invalid|example)$/i.test(url.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname.includes(':')) throw new Error('Only public HTTPS job URLs without credentials, ports or fragments are accepted.')
  const hostname = url.hostname.toLowerCase()
  const ids: string[] = []
  for (const [key, value] of url.searchParams) {
    if (sensitive.test(key) || sensitive.test(value) && roleParam.test(key)) throw new Error('Sensitive query data is not accepted.')
    if (roleParam.test(key)) ids.push(value)
    if (tracking.test(key)) url.searchParams.delete(key)
  }
  if (ids.length > 1) throw new Error('Multiple role IDs cannot be selected safely.')
  if (hostname === 'linkedin.com' || hostname === 'www.linkedin.com' || hostname.endsWith('.linkedin.com')) {
    if (hostname !== 'www.linkedin.com' && hostname !== 'linkedin.com') throw new Error('Unsupported LinkedIn host.')
    const match = url.pathname.match(/^\/jobs\/view\/(?:[a-z0-9-]*-)?(\d{5,20})\/?$/i)
    const queryId = url.searchParams.get('currentJobId')
    if (queryId && !/^\d{5,20}$/.test(queryId)) throw new Error('Invalid LinkedIn role ID.')
    if (match && queryId && match[1] !== queryId || ids.length && !queryId) throw new Error('Conflicting LinkedIn role IDs.')
    if (!match && !/^\/jobs\/(search|search-results)\/?$/.test(url.pathname)) throw new Error('Select one LinkedIn role before researching.')
    const id = match?.[1] ?? queryId
    if (!id || [...url.searchParams.keys()].some(key => !tracking.test(key) && key !== 'currentJobId')) throw new Error('LinkedIn URL does not select one unambiguous role.')
    return { canonicalUrl: `https://www.linkedin.com/jobs/view/${id}/`, host: 'www.linkedin.com', provider: 'linkedin', roleId: id }
  }
  if (hostname === 'indeed.com' || hostname === 'www.indeed.com' || /^[a-z]{2}(?:\.[a-z]{2})?\.indeed\.com$/.test(hostname)) {
    const keys = [...url.searchParams.keys()]
    const identity = url.searchParams.get('jk') ?? url.searchParams.get('vjk')
    if (identity && /^[a-z0-9]{8,32}$/i.test(identity) && /^(\/viewjob|\/rc\/clk|\/jobs|\/m\/viewjob)\/?$/.test(url.pathname) && keys.every(key => tracking.test(key) || key === 'jk' || key === 'vjk')) {
      return { canonicalUrl: `https://${hostname}/viewjob?jk=${identity}`, host: hostname, provider: 'indeed', roleId: identity }
    }
    throw new Error('Indeed URL does not select one unambiguous job ID.')
  }
  if (ids.length || [...url.searchParams.keys()].some(key => sensitive.test(key))) throw new Error('Unknown identity or sensitive query parameters cannot be sent.')
  url.hostname = hostname
  const canonicalUrl = url.href
  if (Buffer.byteLength(canonicalUrl, 'utf8') > 2048) throw new Error('URL exceeds the safe limit.')
  return { canonicalUrl, host: hostname, provider: 'generic', roleId: null }
}
