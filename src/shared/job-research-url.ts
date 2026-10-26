import type { JobResearchIdentity } from './job-research-schema'
import { isIndeedHost } from './job-source-policy'

const tracking = /^(utm_[a-z0-9_]+|gclid|fbclid|li_fat_id|mc_cid|mc_eid|ref|refid|trk|trackingid|source|src|from)$/i
const sensitive = /(token|secret|password|passwd|auth|session|api.?key|email|e-mail|phone|user.?id|cookie|signature|access.?key)/i
const roleParam = /^(currentJobId|jobId|jk|vjk)$/i
const linkedinSearchContext = new Set(['ebp', 'keywords', 'origin', 'geoid'])
const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength

/** Normalize only public HTTPS role URLs; safe to use in either process. */
export function normalizeJobResearchUrl(input: string): JobResearchIdentity {
  if (typeof input !== 'string' || utf8Bytes(input) > 2048 || input.trim() !== input || /[\u0000-\u0020\u007f\\]/.test(input) || /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(input)) throw new Error('Invalid public job URL.')
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
    if (!id || [...url.searchParams.keys()].some(key => !tracking.test(key) && key.toLowerCase() !== 'currentjobid' && !linkedinSearchContext.has(key.toLowerCase()))) throw new Error('LinkedIn URL does not select one unambiguous role.')
    return { canonicalUrl: `https://www.linkedin.com/jobs/view/${id}/`, host: 'www.linkedin.com', provider: 'linkedin', roleId: id }
  }
  if (isIndeedHost(hostname) || hostname === 'uk.indeed.com' || /^[a-z]{2}(?:\.[a-z]{2})?\.indeed\.com$/.test(hostname)) {
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
  if (utf8Bytes(canonicalUrl) > 2048) throw new Error('URL exceeds the safe limit.')
  return { canonicalUrl, host: hostname, provider: 'generic', roleId: null }
}
