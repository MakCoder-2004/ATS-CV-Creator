import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib'
import { URL } from 'node:url'

export type PostingPreview = { title: string; company: string | null; description: string; submittedUrl: string; finalUrl: string; notices: string[] }
type Address = { address: string; family: number }
type Lookup = (hostname: string) => Promise<Address[]>
type Request = (url: URL, address: Address, signal: AbortSignal) => Promise<{ status: number; headers: IncomingMessage['headers']; body: Buffer; location?: string }>

const MAX_URL_BYTES = 2048
const MAX_COMPRESSED = 2 * 1024 * 1024
const MAX_DECOMPRESSED = 8 * 1024 * 1024
const TOTAL_TIMEOUT_MS = 30_000
const HOST = 'api.lever.co'
const utf8Length = (s: string) => Buffer.byteLength(s, 'utf8')

/** Public unicast checks for IPv4 and IPv6; fail closed for special-use ranges. */
export function isPublicAddress(address: string, family: number): boolean {
  if (family === 4) {
    const p = address.split('.').map(Number)
    if (p.length !== 4 || p.some(x => !Number.isInteger(x) || x < 0 || x > 255)) return false
    const [a, b] = p
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51) || (a === 203 && b === 0))
  }
  if (family !== 6 || !address.includes(':')) return false
  const normalized = address.toLowerCase().split('%')[0]
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('ff')) return false
  if (normalized.startsWith('::ffff:')) {
    const tail = normalized.slice(7)
    if (tail.includes('.')) return isPublicAddress(tail, 4)
    const groups = tail.split(':').map(x => parseInt(x || '0', 16))
    return isPublicAddress(`${groups[0] >> 8}.${groups[0] & 255}.${groups[1] >> 8}.${groups[1] & 255}`, 4)
  }
  // Global unicast currently occupies 2000::/3. Special-use subranges are excluded.
  if (!/^2[0-9a-f]{3}:/.test(normalized)) return false
  return !normalized.startsWith('2001:db8:')
}

function parseSubmitted(value: string): { submitted: URL; api: URL } {
  if (typeof value !== 'string' || utf8Length(value) > MAX_URL_BYTES) throw new Error('The link is invalid or longer than 2,048 bytes.')
  let submitted: URL
  try { submitted = new URL(value) } catch { throw new Error('Enter a valid Lever posting link.') }
  if (submitted.protocol !== 'https:' || submitted.username || submitted.password || submitted.port || submitted.hash || submitted.search) throw new Error('Only public HTTPS Lever posting links without credentials, query strings, or fragments are supported.')
  if (submitted.hostname !== 'jobs.lever.co' || submitted.pathname.split('/').length !== 3 || !/^\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,150}$/.test(submitted.pathname)) throw new Error('Only a named Lever job-detail link is supported. Paste posting text instead for other sources.')
  const [, site, id] = submitted.pathname.split('/')
  return { submitted, api: new URL(`https://${HOST}/v0/postings/${site}/${id}`) }
}

const defaultLookup: Lookup = async hostname => (await dnsLookup(hostname, { all: true, verbatim: true })).map(x => ({ address: x.address, family: x.family }))
const defaultRequest: Request = (url, address, signal) => new Promise((resolve, reject) => {
  const req = httpsRequest(url, { method: 'GET', signal, headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'CV-Tailor/1.0' }, servername: url.hostname, rejectUnauthorized: true, lookup: (_host, _options, cb) => cb(null, address.address, address.family) }, res => {
    const chunks: Buffer[] = []; let size = 0
    res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_COMPRESSED) { req.destroy(new Error('Response exceeded the 2 MiB download limit.')); return } chunks.push(chunk) })
    res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), location: res.headers.location }))
  })
  req.on('error', reject); req.setTimeout(15_000, () => req.destroy(new Error('The posting request timed out.'))); req.end()
})

export async function fetchLeverPosting(input: string, options: { signal?: AbortSignal; lookup?: Lookup; request?: Request } = {}): Promise<PostingPreview> {
  const { submitted, api } = parseSubmitted(input)
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => controller.abort(new Error('Fetch exceeded the 30-second deadline.')), TOTAL_TIMEOUT_MS)
  const lookup = options.lookup ?? defaultLookup, request = options.request ?? defaultRequest
  try {
    let current = api, response: Awaited<ReturnType<Request>> | undefined
    const visited = new Set<string>()
    for (let hop = 0; hop <= 3; hop++) {
      if (controller.signal.aborted) throw new Error('Fetch cancelled or timed out.')
      if (current.protocol !== 'https:' || current.hostname !== HOST || current.port || current.pathname !== api.pathname || current.search || current.username || current.password) throw new Error('The posting redirected outside the approved Lever detail source.')
      if (visited.has(current.href)) throw new Error('The posting response contained a redirect loop.')
      visited.add(current.href)
      const addresses = await lookup(current.hostname)
      if (!addresses.length || addresses.some(a => !isPublicAddress(a.address, a.family))) throw new Error('The source resolved to a non-public network address.')
      response = await request(current, addresses[0], controller.signal)
      if (response.body.length > MAX_COMPRESSED) throw new Error('Response exceeded the 2 MiB download limit.')
      if ([301,302,303,307,308].includes(response.status) && response.location) {
        if (hop === 3) throw new Error('The posting exceeded the three-redirect limit.')
        current = new URL(response.location, current); continue
      }
      break
    }
    if (!response || response.status !== 200) throw new Error(response?.status === 403 || response?.status === 429 ? 'The source denied or rate-limited access. Try opening it or paste the posting text instead.' : `The posting source returned HTTP ${response?.status ?? 'error'}.`)
    let body = response.body
    const encoding = String(response.headers['content-encoding'] ?? 'identity').toLowerCase()
    try { if (encoding === 'gzip') body = gunzipSync(body, { maxOutputLength: MAX_DECOMPRESSED }); else if (encoding === 'deflate') body = inflateSync(body, { maxOutputLength: MAX_DECOMPRESSED }); else if (encoding === 'br') body = brotliDecompressSync(body, { maxOutputLength: MAX_DECOMPRESSED }); else if (encoding !== 'identity') throw new Error('unsupported') } catch { throw new Error('The posting response could not be safely decompressed within 8 MiB.') }
    if (body.length > MAX_DECOMPRESSED) throw new Error('The posting response exceeded the 8 MiB expanded limit.')
    if (!String(response.headers['content-type'] ?? '').toLowerCase().includes('json')) throw new Error('This response is not a supported Lever posting detail.')
    let data: Record<string, unknown>
    try { data = JSON.parse(body.toString('utf8')) } catch { throw new Error('The posting response was not valid JSON.') }
    const title = typeof data.text === 'string' ? data.text.trim() : ''
    const description = typeof data.descriptionPlain === 'string' && data.descriptionPlain.trim() ? data.descriptionPlain.trim() : typeof data.description === 'string' ? data.description.replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : ''
    const company = typeof data.company === 'string' && data.company.trim() ? data.company.trim() : null
    if (utf8Length(title) > 800 || [...description].length > 200_000 || utf8Length(description) > 1024 * 1024) throw new Error('The posting text exceeds the safe preview limit; no partial preview was created.')
    const notices = !company ? ['Employer name was not provided by the source. Review it before treating this preview as complete.'] : []
    return { title, company, description, submittedUrl: submitted.href, finalUrl: current.href, notices }
  } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort) }
}

export function validateLeverPostingUrl(value: string): boolean { try { parseSubmitted(value); return true } catch { return false } }
