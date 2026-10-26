export type JobSourcePolicy = { status: 'paused'; source: 'lever' | 'linkedin' | 'indeed'; reason: string } | { status: 'unchanged' }

const paused = {
  lever: 'Automatic Lever fetching, saving, and refresh are paused while source rights remain unresolved. Paste the posting text instead.',
  linkedin: 'Automatic LinkedIn reads and indexed-search fallback are paused while source rights remain unresolved. Paste the posting text instead.',
  indeed: 'Automatic Indeed reads and indexed-search fallback are paused while source rights remain unresolved. Paste the posting text instead.'
} as const

export function decideJobSourcePolicy(input: string): JobSourcePolicy {
  let url: URL
  try { url = new URL(input) } catch { return { status: 'unchanged' } }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'jobs.lever.co' || host === 'api.lever.co') return { status: 'paused', source: 'lever', reason: paused.lever }
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return { status: 'paused', source: 'linkedin', reason: paused.linkedin }
  if (host === 'indeed.com' || host.endsWith('.indeed.com')) return { status: 'paused', source: 'indeed', reason: paused.indeed }
  return { status: 'unchanged' }
}
