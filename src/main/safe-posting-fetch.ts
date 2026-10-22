import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { Readable } from 'node:stream'
import { Worker } from 'node:worker_threads'
import { URL } from 'node:url'
import { isIP } from 'node:net'

export type PostingPreview = { title: string; company: string | null; description: string; submittedUrl: string; finalUrl: string; notices: string[] }
export type Address = { address: string; family: number }
export type SafePostingFetchOptions = {
  lookup?: (hostname: string) => Promise<Address[]>
  request?: (url: URL, address: Address, signal: AbortSignal, headers: Readonly<Record<string, string>>) => Promise<{ status: number; headers: IncomingMessage['headers']; body: Buffer; location?: string }>
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  now?: () => number
}
type Lookup = NonNullable<SafePostingFetchOptions['lookup']>
type Request = NonNullable<SafePostingFetchOptions['request']>

const MAX_URL_BYTES = 2048
const MAX_COMPRESSED = 2 * 1024 * 1024
const MAX_DECOMPRESSED = 8 * 1024 * 1024
const TOTAL_TIMEOUT_MS = 30_000
const HOST = 'api.lever.co'
const REQUEST_HEADERS = Object.freeze({ Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'CV-Tailor/1.0' })
const utf8Length = (s: string) => Buffer.byteLength(s, 'utf8')
function textFromHtml(value: string): string {
  return value.replace(/<h[1-6][^>]*>/gi, '\n\n').replace(/<\/h[1-6]\s*>/gi, '\n').replace(/<li[^>]*>/gi, '\n• ').replace(/<\/li\s*>/gi, '').replace(/<\/(p|div|section|article)\s*>/gi, '\n').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Public unicast checks for IPv4 and IPv6; fail closed for special-use ranges. */
export function isPublicAddress(address: string, family: number): boolean {
  if (family === 4) {
    if (isIP(address) !== 4) return false
    const p = address.split('.').map(Number)
    if (p.length !== 4 || p.some(x => !Number.isInteger(x) || x < 0 || x > 255)) return false
    const [a, b] = p
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && (b === 0 || b === 88 && p[2] === 99)) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0))
  }
  if (family !== 6 || address.includes('%') || isIP(address) !== 6) return false
  let normalized = address.toLowerCase()
  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':')
    const octets = normalized.slice(lastColon + 1).split('.').map(Number)
    if (octets.length !== 4) return false
    normalized = `${normalized.slice(0, lastColon + 1)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`
  }
  const halves = normalized.split('::')
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : []
  const explicit = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right].map(part => parseInt(part || '0', 16))
  if (explicit.length !== 8 || explicit.some(group => !Number.isInteger(group) || group < 0 || group > 0xffff)) return false
  if (explicit.slice(0, 5).every(group => group === 0) && explicit[5] === 0xffff) {
    return isPublicAddress(`${explicit[6] >> 8}.${explicit[6] & 255}.${explicit[7] >> 8}.${explicit[7] & 255}`, 4)
  }
  const [first, second] = explicit
  // Global unicast currently occupies 2000::/3. Exclude IETF and transition ranges.
  if (first < 0x2000 || first > 0x3fff || first === 0x2002 || first === 0x3fff) return false
  if (first === 0x2001 && (second <= 0x03ff || second === 0x0db8)) return false // IETF special-purpose 2001::/23 and documentation prefix
  if (first === 0x2001 && (second & 0xfff0) === 0x0020) return false // ORCHIDv2 2001:20::/28
  return true
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
async function decodeBounded(body: Buffer, encoding: string, signal: AbortSignal): Promise<Buffer> {
  const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ? createInflate() : encoding === 'br' ? createBrotliDecompress() : null
  if (!decoder) { if (encoding !== 'identity') throw new Error('unsupported'); if (body.length > MAX_DECOMPRESSED) throw new Error('oversized'); return body }
  const output: Buffer[] = []; let bytes = 0
  const abort = () => decoder.destroy(new Error('Fetch cancelled.'))
  signal.addEventListener('abort', abort, { once: true })
  try {
    for await (const chunk of Readable.from([body]).pipe(decoder)) {
      if (signal.aborted) throw new Error('Fetch cancelled.')
      const value = Buffer.from(chunk); bytes += value.length
      if (bytes > MAX_DECOMPRESSED) { decoder.destroy(); throw new Error('oversized') }
      output.push(value)
    }
  } catch (error) { if (error instanceof Error && (error.message === 'oversized' || error.message === 'Fetch cancelled.')) throw error; throw new Error('The posting response could not be safely decompressed within 8 MiB.') }
  finally { signal.removeEventListener('abort', abort) }
  return Buffer.concat(output, bytes)
}
async function parseJsonBounded(text: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const worker = new Worker(`const { parentPort } = require('node:worker_threads'); parentPort.on('message', text => { let depth = 0, quoted = false, escaped = false; for (const char of text) { if (quoted) { if (escaped) escaped = false; else if (char === '\\\\') escaped = true; else if (char === '\"') quoted = false; continue } if (char === '\"') quoted = true; else if (char === '{' || char === '[') { depth++; if (depth > 64) { parentPort.postMessage({ error: 'JSON nesting exceeds 64 levels' }); return } } else if (char === '}' || char === ']') depth-- } try { parentPort.postMessage({ value: JSON.parse(text) }) } catch (error) { parentPort.postMessage({ error: String(error) }) } })`, { eval: true })
  return await new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); void worker.terminate() }
    const timer = setTimeout(() => { finish(); reject(new Error('The posting response exceeded the 2-second parsing budget.')) }, 2_000)
    const cancel = () => { finish(); reject(new Error('Fetch cancelled.')) }
    if (signal.aborted) return cancel()
    signal.addEventListener('abort', cancel, { once: true })
    worker.once('message', (result: { value?: unknown; error?: string }) => {
      finish()
      if (result.error || !result.value || typeof result.value !== 'object' || Array.isArray(result.value)) reject(new Error('The posting response was not valid posting JSON.'))
      else resolve(result.value as Record<string, unknown>)
    })
    worker.once('error', error => { finish(); reject(error) })
    worker.postMessage(text)
  })
}
const defaultWait = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(new Error('Fetch cancelled.'))
  const timer = setTimeout(done, milliseconds)
  function done() { signal.removeEventListener('abort', cancel); resolve() }
  function cancel() { clearTimeout(timer); reject(new Error('Fetch cancelled.')) }
  signal.addEventListener('abort', cancel, { once: true })
})
const lastRequestAt = new Map<string, number>()
function bounded<T>(operation: Promise<T>, milliseconds: number, signal: AbortSignal, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(() => reject(new Error(timeoutMessage))), milliseconds)
    const cancel = () => finish(() => reject(new Error('Fetch cancelled.')))
    const finish = (complete: () => void) => { clearTimeout(timer); signal.removeEventListener('abort', cancel); complete() }
    if (signal.aborted) return cancel()
    signal.addEventListener('abort', cancel, { once: true })
    operation.then(value => finish(() => resolve(value)), error => finish(() => reject(error)))
  })
}
const defaultRequest: Request = (url, address, signal, headers) => new Promise((resolve, reject) => {
  let complete = false
  const connectTimer = setTimeout(() => req.destroy(new Error('Connection/TLS handshake exceeded 5 seconds.')), 5_000)
  const responseTimer = setTimeout(() => req.destroy(new Error('Source response exceeded 15 seconds.')), 15_000)
  const finishError = (error: Error) => { if (complete) return; complete = true; clearTimeout(connectTimer); clearTimeout(responseTimer); reject(error) }
  const req = httpsRequest(url, { method: 'GET', signal, headers, servername: url.hostname, rejectUnauthorized: true, agent: false, lookup: (_host, _options, cb) => cb(null, address.address, address.family) }, res => {
    clearTimeout(connectTimer)
    const chunks: Buffer[] = []; let size = 0
    res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_COMPRESSED) { req.destroy(new Error('Response exceeded the 2 MiB download limit.')); return } chunks.push(chunk) })
    res.on('end', () => { if (complete) return; complete = true; clearTimeout(responseTimer); resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), location: res.headers.location }) })
    res.on('error', finishError)
  })
  req.on('socket', socket => { socket.once('secureConnect', () => clearTimeout(connectTimer)); socket.once('error', finishError) })
  req.on('error', finishError); req.end()
})

export async function fetchLeverPosting(input: string, options: SafePostingFetchOptions & { signal?: AbortSignal } = {}): Promise<PostingPreview> {
  const { submitted, api } = parseSubmitted(input)
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => controller.abort(new Error('Fetch exceeded the 30-second deadline.')), TOTAL_TIMEOUT_MS)
  const lookup = options.lookup ?? defaultLookup, request = options.request ?? defaultRequest, wait = options.wait ?? defaultWait, now = options.now ?? Date.now
  try {
    let current = api, response: Awaited<ReturnType<Request>> | undefined
    const visited = new Set<string>()
    for (let hop = 0; hop <= 3; hop++) {
      if (controller.signal.aborted) throw new Error('Fetch cancelled or timed out.')
      if (current.protocol !== 'https:' || current.hostname !== HOST || current.port || current.pathname !== api.pathname || current.search || current.hash || current.username || current.password) throw new Error('The posting redirected outside the approved Lever detail source.')
      if (visited.has(current.href)) throw new Error('The posting response contained a redirect loop.')
      visited.add(current.href)
      const addresses = await bounded(lookup(current.hostname), 5_000, controller.signal, 'Source DNS resolution exceeded 5 seconds.')
      if (!addresses.length || addresses.some(a => !isPublicAddress(a.address, a.family))) throw new Error('The source resolved to a non-public network address.')
      let lastError: unknown
      for (let attempt = 0; attempt < 2; attempt++) {
        if (controller.signal.aborted) throw new Error('Fetch cancelled or timed out.')
        const elapsed = now() - (lastRequestAt.get(current.hostname) ?? 0)
        if (lastRequestAt.has(current.hostname) && elapsed < 2_000) await wait(2_000 - elapsed, controller.signal)
        lastRequestAt.set(current.hostname, now())
        try { response = await bounded(request(current, addresses[0], controller.signal, REQUEST_HEADERS), 15_000, controller.signal, 'Source response exceeded 15 seconds.') }
        catch (error) {
          lastError = error
          const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''
          const retryable = ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code)
          if (attempt === 0 && retryable && !controller.signal.aborted) { await wait(Math.max(0, 2_000 - (now() - lastRequestAt.get(current.hostname)!)), controller.signal); continue }
          if (controller.signal.aborted) throw new Error('Fetch cancelled or timed out.')
          if (code.startsWith('ERR_TLS') || code.startsWith('CERT_')) throw new Error('The source TLS certificate could not be verified. No insecure connection was attempted.')
          if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) throw new Error('The supported source hostname could not be resolved.')
          throw new Error('The source connection failed or timed out. Open the original posting or paste its text instead.')
        }
        if (response.body.length > MAX_COMPRESSED) throw new Error('Response exceeded the 2 MiB download limit.')
        if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt > 0) break
        const retryAfter = response.headers['retry-after']
        const seconds = retryAfter ? Number(retryAfter) : Number.NaN
        const retryDate = retryAfter && !Number.isFinite(seconds) ? Date.parse(retryAfter) : Number.NaN
        const requestedDelay = Number.isFinite(seconds) ? seconds * 1_000 : Number.isFinite(retryDate) ? retryDate - now() : 2_000
        const retryMs = Math.min(30_000, Math.max(2_000, requestedDelay))
        await wait(retryMs, controller.signal)
      }
      if (!response) throw lastError instanceof Error ? lastError : new Error('The posting request failed.')
      if ([301,302,303,307,308].includes(response.status) && response.location) {
        if (hop === 3) throw new Error('The posting exceeded the three-redirect limit.')
        current = new URL(response.location, current); continue
      }
      break
    }
    if (!response || response.status !== 200) throw new Error(response?.status === 403 || response?.status === 429 ? 'The source denied or rate-limited access. Try opening it or paste the posting text instead.' : `The posting source returned HTTP ${response?.status ?? 'error'}.`)
    let body: Buffer
    try { body = await decodeBounded(response.body, String(response.headers['content-encoding'] ?? 'identity').toLowerCase(), controller.signal) }
    catch (error) { throw error instanceof Error && error.message === 'oversized' ? new Error('The posting response exceeded the 8 MiB expanded limit.') : error }
    if (body.length > MAX_DECOMPRESSED) throw new Error('The posting response exceeded the 8 MiB expanded limit.')
    if (!String(response.headers['content-type'] ?? '').toLowerCase().includes('json')) {
      const sample = response.body.subarray(0, 64 * 1024).toString('utf8').toLowerCase()
      if (/captcha|verify you are human|sign in|log in|paywall/.test(sample)) throw new Error('The source requires sign-in or presents a CAPTCHA/paywall. Access will not be bypassed; open the posting or paste its text instead.')
      throw new Error('The source returned a webpage instead of the supported posting-detail JSON. Script-rendered and generic pages are not supported; paste posting text instead.')
    }
    let jsonText: string
    try { jsonText = new TextDecoder('utf-8', { fatal: true }).decode(body) } catch { throw new Error('The posting response was not valid UTF-8 JSON.') }
    const data = await parseJsonBounded(jsonText, controller.signal)
    const expectedId = api.pathname.split('/').at(-1)
    if (data.id !== expectedId) throw new Error('The source response did not match the requested posting.')
    const title = typeof data.text === 'string' ? data.text.trim() : ''
    let description = typeof data.descriptionPlain === 'string' && data.descriptionPlain.trim() ? data.descriptionPlain.trim() : typeof data.description === 'string' ? textFromHtml(data.description) : ''
    const supplemental = [data.openingPlain, data.descriptionBodyPlain, data.additionalPlain].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map(value => value.trim())
    for (const section of supplemental) if (!description.includes(section)) description += `${description ? '\n\n' : ''}${section}`
    if (Array.isArray(data.lists)) {
      if (data.lists.length > 1_000) throw new Error('The posting response contains too many structured sections to review safely.')
      let bulletCount = 0
      for (const value of data.lists) {
        if (!value || typeof value !== 'object') continue
        const list = value as { text?: unknown; content?: unknown }
        const heading = typeof list.text === 'string' ? textFromHtml(list.text) : ''
        const items: string[] = []
        if (typeof list.content === 'string') for (const match of list.content.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
          if (++bulletCount > 10_000) throw new Error('The posting response contains too many list items to review safely.')
          const item = textFromHtml(match[1]); if (item) items.push(item)
        }
        if (!items.length) continue
        const missing = items.filter(item => !description.includes(item))
        if (missing.length) {
          const sectionHeading = heading && !description.includes(heading) ? [heading] : []
          description += `${description ? '\n\n' : ''}${[...sectionHeading, ...missing.map(item => `• ${item}`)].join('\n')}`
        } else description = description.split('\n').map(line => items.includes(line.trim()) && !line.trim().startsWith('• ') ? `• ${line.trim()}` : line).join('\n')
      }
    }
    const company = typeof data.company === 'string' && data.company.trim() ? data.company.trim() : null
    if ([...title].length > 200 || (company && [...company].length > 200) || [...description].length > 200_000 || utf8Length(description) > 1024 * 1024) throw new Error('The posting text exceeds the safe preview limit; no partial preview was created.')
    const hasStructuredSections = Array.isArray(data.lists) && data.lists.some(item => item && typeof item === 'object' && typeof (item as { content?: unknown }).content === 'string')
    const hasSectionHeadings = /\b(responsibilities|requirements|qualifications|what you(?:'|’)ll do|what we(?:'|’)re looking for)\b/i.test(description)
    const notices = [!company ? 'Employer name was not provided by this source; this preview is incomplete.' : '', !title ? 'The source did not provide a job title; this preview is incomplete.' : '', !description ? 'The source did not provide posting text; this preview is incomplete.' : '', description.length < 200 || (!hasStructuredSections && !hasSectionHeadings) ? 'The response lacks enough posting-detail structure to establish complete source text; this preview is incomplete.' : ''].filter(Boolean)
    notices.push('Extraction cannot guarantee posting completeness or that the role remains open. Review the full source before relying on it.')
    if (controller.signal.aborted) throw new Error(options.signal?.aborted ? 'Fetch cancelled.' : 'Fetch exceeded the 30-second deadline.')
    return { title, company, description, submittedUrl: submitted.href, finalUrl: current.href, notices }
  } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort) }
}

export function validateLeverPostingUrl(value: string): boolean { try { parseSubmitted(value); return true } catch { return false } }
