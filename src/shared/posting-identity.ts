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
    url.searchParams.sort()
    return url.toString()
  } catch { return null }
}

export function leverPostingIdentity(value: string): string | null {
  try {
    const url = new URL(value), parts = url.pathname.split('/').filter(Boolean)
    if (url.protocol !== 'https:') return null
    if (url.hostname === 'jobs.lever.co' && parts.length === 2) return `lever:${parts[0]}/${parts[1]}`
    if (url.hostname === 'api.lever.co' && parts.length === 4 && parts[0] === 'v0' && parts[1] === 'postings') return `lever:${parts[2]}/${parts[3]}`
  } catch {}
  return null
}

export function samePostingSource(a: { submittedUrl: string; finalUrl: string; sourceIdentity?: string }, b: { submittedUrl: string; finalUrl: string; sourceIdentity?: string }): boolean {
  const aProvider = a.sourceIdentity ?? leverPostingIdentity(a.submittedUrl)
  const bProvider = b.sourceIdentity ?? leverPostingIdentity(b.submittedUrl)
  if (aProvider && bProvider && aProvider === bProvider) return true
  const aUrls = new Set([normalizePostingUrl(a.submittedUrl), normalizePostingUrl(a.finalUrl)].filter((item): item is string => !!item))
  return [normalizePostingUrl(b.submittedUrl), normalizePostingUrl(b.finalUrl)].some(item => !!item && aUrls.has(item))
}
