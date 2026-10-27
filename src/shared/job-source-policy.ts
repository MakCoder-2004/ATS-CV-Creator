export type JobSourcePolicy = { status: 'paused'; source: 'lever' | 'linkedin' | 'indeed' | 'greenhouse'; reason: string } | { status: 'unchanged' }

const paused = {
  greenhouse: 'Generic Greenhouse direct reads are unavailable. Use the explicit named Greenhouse preview or paste the posting text.',
  lever: 'Generic/direct Lever fetching, saving, and refresh stay paused. Only the separate opted-in named API preview can read and save an exact posting. Paste the text instead.',
  linkedin: 'Automatic LinkedIn reads remain paused without an approved selected-job route. Paste the posting text instead.',
  indeed: 'Automatic Indeed reads remain paused without an approved selected-job route. Paste the posting text instead.'
} as const

const indeedDomains = [
  'indeed.com', 'indeed.co.uk', 'indeed.ie', 'indeed.ca', 'indeed.com.au', 'indeed.co.nz',
  'indeed.fr', 'indeed.de', 'indeed.es', 'indeed.it', 'indeed.nl', 'indeed.be', 'indeed.ch',
  'indeed.at', 'indeed.se', 'indeed.no', 'indeed.dk', 'indeed.fi', 'indeed.pl', 'indeed.pt',
  'indeed.gr', 'indeed.cz', 'indeed.hu', 'indeed.ro', 'indeed.bg', 'indeed.hr', 'indeed.sk',
  'indeed.si', 'indeed.lt', 'indeed.lv', 'indeed.ee', 'indeed.is', 'indeed.co.jp', 'indeed.co.in',
  'indeed.com.br', 'indeed.com.mx', 'indeed.com.sg', 'indeed.com.hk', 'indeed.com.ph',
  'indeed.com.my', 'indeed.com.pk', 'indeed.com.sa', 'indeed.ae', 'indeed.co.za', 'indeed.com.tr',
  'indeed.co.kr'
] as const

export function isIndeedHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, '')
  return indeedDomains.some(domain => normalized === domain || normalized.endsWith(`.${domain}`))
}

export function decideJobResearchPolicy(run: { selected: { canonicalUrl: string }; sources: Array<{ url: string }> }): JobSourcePolicy {
  for (const source of [run.selected.canonicalUrl, ...run.sources.map(item => item.url)]) {
    const decision = decideJobSourcePolicy(source)
    if (decision.status === 'paused') return decision
  }
  return { status: 'unchanged' }
}

export function decideJobSourcePolicy(input: string): JobSourcePolicy {
  let url: URL
  try { url = new URL(input) } catch { return { status: 'unchanged' } }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'jobs.lever.co' || host === 'api.lever.co' || host === 'jobs.eu.lever.co' || host === 'api.eu.lever.co') return { status: 'paused', source: 'lever', reason: paused.lever }
  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io' || host === 'boards-api.greenhouse.io') return { status: 'paused', source: 'greenhouse', reason: paused.greenhouse }
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return { status: 'paused', source: 'linkedin', reason: paused.linkedin }
  if (isIndeedHost(host)) return { status: 'paused', source: 'indeed', reason: paused.indeed }
  return { status: 'unchanged' }
}
