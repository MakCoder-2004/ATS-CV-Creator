import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { IncomingHttpHeaders } from 'node:http'
import { isPublicAddress, pinnedAddressLookup } from './safe-posting-fetch'
import { jobResearchRunSchema, normalizeJobResearchUrl, type JobResearchIdentity, type JobResearchRun } from '../shared/job-research'
import { decideJobSourcePolicy } from '../shared/job-source-policy'

type Address = { address: string; family: number }
type Response = { status: number; headers: IncomingHttpHeaders; body: Buffer }
type Extraction = { outcome: 'full'; description: string; title: string; employer: string | null } | { outcome: 'partial'; description: string; title: string; employer: string | null; reason?: string } | { outcome: 'none' | 'blocked'; reason: string }
export type JobResearchFetchOptions = {
  signal?: AbortSignal
  lookup?: (host: string) => Promise<Address[]>
  request?: (url: URL, address: Address, signal: AbortSignal) => Promise<Response>
  extract?: (html: string, selected: JobResearchIdentity, signal: AbortSignal) => Promise<Extraction>
  now?: () => Date
}
const MAX_COMPRESSED = 2 * 1024 * 1024
const MAX_EXPANDED = 8 * 1024 * 1024
const HEADERS = Object.freeze({ Accept: 'text/html,application/xhtml+xml', 'Accept-Encoding': 'gzip, br, deflate, identity', 'User-Agent': 'CV-Tailor/1.0' })

const lookupPublic = async (host: string): Promise<Address[]> => (await dnsLookup(host, { all: true, verbatim: true })).map(({ address, family }) => ({ address, family }))
const requestPinned = (url: URL, address: Address, signal: AbortSignal): Promise<Response> => new Promise((resolve, reject) => {
  const req = httpsRequest(url, { method: 'GET', headers: HEADERS, signal, servername: url.hostname, rejectUnauthorized: true, agent: false, lookup: pinnedAddressLookup(address) }, res => {
    const chunks: Buffer[] = []; let length = 0
    res.on('data', (chunk: Buffer) => {
      length += chunk.length
      if (length > MAX_COMPRESSED) { req.destroy(new Error('Response exceeds compressed byte limit.')); return }
      chunks.push(chunk)
    })
    res.once('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
    res.once('error', reject)
  })
  req.setTimeout(8_000, () => req.destroy(new Error('Source request timed out.')))
  req.once('error', reject)
  req.end()
})
async function expand(body: Buffer, encoding: string, signal: AbortSignal): Promise<Buffer> {
  if (body.length > MAX_COMPRESSED) throw new Error('Response exceeds compressed byte limit.')
  if (encoding === 'identity') return body
  const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : encoding === 'deflate' ? createInflate() : null
  if (!decoder) throw new Error('Unsupported response compression.')
  const chunks: Buffer[] = []; let length = 0
  const abort = () => decoder.destroy(new Error('Fetch cancelled.'))
  signal.addEventListener('abort', abort, { once: true })
  try {
    for await (const chunk of Readable.from([body]).pipe(decoder)) {
      length += chunk.length
      if (length > MAX_EXPANDED) { decoder.destroy(new Error('Response exceeds expanded byte limit.')); throw new Error('Response exceeds expanded byte limit.') }
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  } finally { signal.removeEventListener('abort', abort) }
}
const extractInWorker = (html: string, selected: JobResearchIdentity, signal: AbortSignal): Promise<Extraction> => new Promise((resolve, reject) => {
  const worker = new Worker(join(__dirname, 'job-research-extraction-worker.cjs'), { workerData: { html, selected } })
  let done = false
  const finish = (action: () => void) => { if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort); void worker.terminate(); action() }
  const timer = setTimeout(() => finish(() => reject(new Error('Extraction exceeded 2 seconds.'))), 2_000)
  const abort = () => finish(() => reject(new Error('Fetch cancelled.')))
  if (signal.aborted) return abort()
  signal.addEventListener('abort', abort, { once: true })
  worker.once('message', (value: Extraction) => finish(() => resolve(value)))
  worker.once('error', error => finish(() => reject(error)))
  worker.once('exit', code => { if (code !== 0) finish(() => reject(new Error('Extraction worker exited.'))) })
})

/** A single user-initiated direct read. Search enrichment and persistence belong to separate adapters. */
export async function fetchDirectJobResearch(input: string, options: JobResearchFetchOptions = {}): Promise<JobResearchRun> {
  const policy = decideJobSourcePolicy(input)
  if (policy.status === 'paused') throw new Error(policy.reason)
  const selected = normalizeJobResearchUrl(input)
  const startedAt = (options.now ?? (() => new Date()))().toISOString()
  const runId = randomUUID()
  const controller = new AbortController()
  const cancel = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', cancel, { once: true })
  if (options.signal?.aborted) cancel()
  const deadline = setTimeout(() => controller.abort(new Error('Research exceeded 20 seconds.')), 20_000)
  const finish = (status: JobResearchRun['status'], unknowns: string[], extraction?: Extract<Extraction, { outcome: 'full' }> | Extract<Extraction, { outcome: 'partial' }>, accessFailure?: JobResearchRun['accessFailure'], url = selected.canonicalUrl): JobResearchRun => {
    const sourceId = randomUUID()
    return jobResearchRunSchema.parse({ version: 1, id: runId, selected, startedAt, completedAt: (options.now ?? (() => new Date()))().toISOString(), status, ...(accessFailure ? { accessFailure } : {}),
      sources: extraction ? [{ version: 1, id: sourceId, url, capturedAt: startedAt, method: 'direct-html', identity: 'exact-role', title: extraction.title, employer: extraction.employer, employerIdentityUrl: null }] : [],
      findings: extraction ? [{ version: 1, id: randomUUID(), sourceId, kind: 'direct-role-text', text: extraction.description, completeness: extraction.outcome === 'full' ? 'full' : 'partial' }] : [], unknowns })
  }
  const bounded = async <T>(operation: Promise<T>, ms: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Research step timed out.')), ms) }), new Promise<never>((_, reject) => {
      if (controller.signal.aborted) reject(new Error('Fetch cancelled.'))
      else controller.signal.addEventListener('abort', () => reject(new Error('Fetch cancelled.')), { once: true })
    })]) } finally { clearTimeout(timer) }
  }
  try {
    let current = selected.canonicalUrl
    const visited = new Set<string>()
    for (let hop = 0; hop <= 2; hop++) {
      if (controller.signal.aborted) throw new Error('Fetch cancelled.')
      if (visited.has(current)) return finish('blocked', ['The source returned a redirect loop.'], undefined, 'unsafe')
      // Identify only a same-host HTTPS login gate before generic URLs can parse as a new role.
      if (hop > 0) {
        const redirect = new URL(current)
        if (redirect.protocol === 'https:' && redirect.host === selected.host && !redirect.username && !redirect.password && !redirect.search && !redirect.hash && /^\/(?:login|signin|authwall|uas\/login|account\/login|checkpoint\/challenge)\/?$/i.test(redirect.pathname))
          return finish('blocked', ['The selected posting requires sign-in.'], undefined, 'unreadable')
      }
      let destination: JobResearchIdentity
      try { destination = normalizeJobResearchUrl(current) } catch { return finish('blocked', ['The source redirected to an unsafe or ambiguous URL.'], undefined, 'unsafe') }
      if (destination.canonicalUrl !== current) return finish('blocked', ['The source redirected with tracking or unsafe query parameters.'], undefined, 'unsafe')
      if (destination.host !== selected.host || destination.roleId !== selected.roleId || selected.provider !== destination.provider) return finish('blocked', ['The source redirected away from the selected role.'], undefined, 'unsafe')
      visited.add(current)
      const addresses = await bounded((options.lookup ?? lookupPublic)(destination.host), 5_000)
      if (!addresses.length || addresses.some(item => !isPublicAddress(item.address, item.family))) throw new Error('The source resolved to a private or non-public address.')
      const response = await bounded((options.request ?? requestPinned)(new URL(current), addresses[0], controller.signal), 9_000)
      if (response.body.length > MAX_COMPRESSED) throw new Error('Response exceeds compressed byte limit.')
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.location
        if (typeof location !== 'string' || hop === 2) return finish('blocked', ['The source redirect could not be safely followed.'], undefined, 'unsafe')
        try { current = new URL(location, current).href } catch { return finish('blocked', ['The source returned an invalid redirect.'], undefined, 'unsafe') }
        continue
      }
      if ([401,403].includes(response.status)) return finish('blocked', [`The selected posting requires access (HTTP ${response.status}).`], undefined, 'unreadable')
      if ([404,410].includes(response.status)) return finish('blocked', [`The selected posting was unavailable (HTTP ${response.status}); no indexed excerpt can establish that it remains active.`], undefined, 'removed')
      if (response.status >= 500 && response.status <= 599) return finish('none', [`The source returned a server error (HTTP ${response.status}); no role evidence was collected.`], undefined, 'server-error')
      if (response.status !== 200) return finish('none', [`The source returned HTTP ${response.status}; no role evidence was collected.`], undefined, 'unsafe')
      const contentType = String(response.headers['content-type'] ?? '').toLowerCase()
      if (!/^text\/html\b|^application\/xhtml\+xml\b/.test(contentType)) return finish('none', ['The response was not an HTML posting page.'], undefined, 'unsafe')
      const encoding = String(response.headers['content-encoding'] ?? 'identity').toLowerCase()
      const decoded = await bounded(expand(response.body, encoding, controller.signal), 5_000)
      let html: string
      try { html = new TextDecoder('utf-8', { fatal: true }).decode(decoded) } catch { return finish('none', ['The response was not valid UTF-8.'], undefined, 'unsafe') }
      const extracted = await bounded((options.extract ?? extractInWorker)(html, selected, controller.signal), 2_500)
      if (controller.signal.aborted) throw new Error('Fetch cancelled.')
      if (extracted.outcome === 'full') return finish('full', [], extracted, undefined, current)
      if (extracted.outcome === 'partial') return finish('provisional', [extracted.reason ?? 'The selected role description may be incomplete.'], extracted, undefined, current)
      // Only an explicitly recognized unreadable page is eligible for indexed fallback.
      const unreadable = extracted.reason === 'The page requires sign-in, verification or blocks public access.' || extracted.reason === 'The selected page lacks a substantive readable job posting.'
      return finish(extracted.outcome, [extracted.reason], undefined, unreadable ? 'unreadable' : 'unsafe')
    }
    return finish('blocked', ['Too many redirects.'], undefined, 'unsafe')
  } finally { clearTimeout(deadline); options.signal?.removeEventListener('abort', cancel); controller.abort() }
}
