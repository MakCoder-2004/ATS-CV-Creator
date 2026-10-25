import { normalizeJobResearchUrl } from './job-research'

const trackingParameters = new Set(['gclid', 'fbclid', 'li_fat_id', 'mc_cid', 'mc_eid'])

/** Canonicalize transport-only URL variation without erasing posting identity. */
export function normalizePostingUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    url.hostname = url.hostname.toLowerCase()
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_[a-z0-9_]+$/i.test(key) || trackingParameters.has(key.toLowerCase())) url.searchParams.delete(key)
    }
    return url.toString()
  } catch { return null }
}

export function leverPostingIdentity(value: string): string | null {
  try {
    const url = new URL(value), parts = url.pathname.split('/').filter(Boolean)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null
    if (url.hostname === 'jobs.lever.co' && parts.length === 2) return `lever:${parts[0]}/${parts[1]}`
    if (url.hostname === 'api.lever.co' && parts.length === 4 && parts[0] === 'v0' && parts[1] === 'postings') return `lever:${parts[2]}/${parts[3]}`
  } catch {}
  return null
}

export function directPostingIdentity(value: string): string | null {
  try {
    const selected = normalizeJobResearchUrl(value)
    return `${selected.provider}:${selected.canonicalUrl}`
  } catch { return null }
}

export function samePostingSource(a: { submittedUrl: string; finalUrl: string; sourceIdentity?: string }, b: { submittedUrl: string; finalUrl: string; sourceIdentity?: string }): boolean {
  // Persisted identity/canonical hints are untrusted; derive provider IDs only from validated URLs.
  const aProvider = leverPostingIdentity(a.submittedUrl) ?? leverPostingIdentity(a.finalUrl)
  const bProvider = leverPostingIdentity(b.submittedUrl) ?? leverPostingIdentity(b.finalUrl)
  if (aProvider && bProvider) return aProvider === bProvider
  const aDirect = directPostingIdentity(a.submittedUrl)
  const bDirect = directPostingIdentity(b.submittedUrl)
  if (aDirect && bDirect && !aProvider && !bProvider) return aDirect === bDirect
  const aUrls = new Set([normalizePostingUrl(a.submittedUrl), normalizePostingUrl(a.finalUrl)].filter((item): item is string => !!item))
  return [normalizePostingUrl(b.submittedUrl), normalizePostingUrl(b.finalUrl)].some(item => !!item && aUrls.has(item))
}
