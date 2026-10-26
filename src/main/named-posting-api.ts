import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import { isPublicAddress, pinnedAddressLookup } from './safe-posting-fetch'
import { namedPostingReferenceSchema, namedPostingAttemptSchema, namedPostingCandidateSchema, type NamedPostingReference, type NamedPostingAttempt, type NamedPostingCandidate } from '../shared/named-posting-contract'

type Address = { address: string; family: number }
type Response = { status: number; headers: IncomingHttpHeaders; body: Buffer }
export type NamedPostingApiOptions = {
  lookup?: (host: string) => Promise<Address[]>
  request?: (url: URL, address: Address, signal: AbortSignal, headers: Readonly<Record<string, string>>) => Promise<Response>
  now?: () => number
  signal?: AbortSignal
  /** Must come from trusted main-process settings; renderer input is never a grant. */
  eligibility?: { personalLocalOptIn: true; source: 'lever' | 'greenhouse'; scope: 'personal-local'; optedInAt: string } | null
}
const MAX_BYTES = 2 *  1024 * 1024
const MAX_TEXT = 100_000
const timeout = 15_000
const defaultLookup = async (host: string): Promise<Address[]> => (await dnsLookup(host, { all: true, verbatim: true })).map(({ address, family }) => ({ address, family }))
const headers = Object.freeze({ Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'CV-Tailor/1.0' })
const abortable = <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> => new Promise((resolve, reject) => {
  const cancel = () => reject(signal.reason ?? new Error('cancelled'))
  if (signal.aborted) return cancel()
  signal.addEventListener('abort', cancel, { once: true })
  operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
})
const defaultRequest = (url: URL, address: Address, signal: AbortSignal, requestHeaders: Readonly<Record<string, string>>): Promise<Response> => new Promise((resolve, reject) => {
  const req = httpsRequest(url, { method: 'GET', headers: requestHeaders, signal, servername: url.hostname, rejectUnauthorized: true, agent: false, lookup: pinnedAddressLookup(address) }, res => {
    const chunks: Buffer[] = []; let bytes = 0
    res.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_BYTES) req.destroy(new Error('oversized')); else chunks.push(Buffer.from(chunk)) })
    res.once('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
    res.once('error', reject)
  })
  req.setTimeout(timeout, () => req.destroy(new Error('deadline')))
  req.once('error', reject); req.end()
})
const cleanHtml = (html: string) => html.replace(/<(script|style|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])\s*>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

/** Inert exact-detail API adapter. It performs no policy decision, IPC, persistence, or source activation. */
export async function fetchNamedPostingApi(input: unknown, options: NamedPostingApiOptions = {}): Promise<{ attempt: NamedPostingAttempt; candidate?: NamedPostingCandidate }> {
  const reference = namedPostingReferenceSchema.parse(input)
  const started = (options.now ?? Date.now)(), startedAt = new Date(started).toISOString(), id = randomUUID()
  const failed = (reason: Extract<NamedPostingAttempt, {status:'failed'}>['reason']) => ({ attempt: namedPostingAttemptSchema.parse({ id, reference, startedAt, status: 'failed', reason }) as NamedPostingAttempt })
  const grant = options.eligibility
  if (!grant || grant.personalLocalOptIn !== true || grant.source !== reference.source || grant.scope !== 'personal-local' || Date.parse(grant.optedInAt) >= started) return failed('opt-in-required')
  const api = reference.source === 'lever' ? new URL(`https://api.lever.co/v0/postings/${reference.board}/${reference.postingId}`) : new URL(`https://boards-api.greenhouse.io/v1/boards/${reference.board}/jobs/${reference.postingId}`)
  const controller = new AbortController(); const abort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('deadline')), timeout)
  try {
    if (options.signal?.aborted) return failed('cancelled')
    const host = api.hostname, addresses = await abortable((options.lookup ?? defaultLookup)(host), controller.signal)
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address, a.family))) return failed('unsafe-address')
    if (controller.signal.aborted) return failed(options.signal?.aborted ? 'cancelled' : 'deadline')
    const response = await abortable((options.request ?? defaultRequest)(api, addresses[0], controller.signal, headers), controller.signal)
    if (response.body.length > MAX_BYTES) return failed('source-error')
    if ([301,302,303,307,308].includes(response.status)) return failed('unsafe-redirect')
    if (response.status === 404 || response.status === 410) return failed('not-found')
    if ([401,403,429].includes(response.status)) return failed('login-required')
    if (response.status !== 200) return failed('source-error')
    if (!String(response.headers['content-type'] ?? '').toLowerCase().includes('json') || String(response.headers['content-encoding'] ?? 'identity').toLowerCase() !== 'identity') return failed('incomplete')
    let value: any
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body)) } catch { return failed('incomplete') }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return failed('incomplete')
    let returnedBoard: string, returnedPostingId: string, title: string, employer: string, text: string, sourceUpdatedAt: string | null = null, hostedUrl: string | undefined
    if (reference.source === 'lever') {
      returnedBoard = typeof value.hostedUrl === 'string' ? new URL(value.hostedUrl).pathname.split('/')[1] : ''
      returnedPostingId = value.id
      title = value.text; employer = value.categories?.team ?? value.categories?.department ?? reference.board
      text = typeof value.descriptionPlain === 'string' && value.descriptionPlain.trim() ? value.descriptionPlain : cleanHtml(String(value.description ?? ''))
      hostedUrl = value.hostedUrl
    } else {
      returnedBoard = value.board_token ?? reference.board
      returnedPostingId = String(value.id ?? ''); title = value.title; employer = value.company_name
      text = cleanHtml(String(value.content ?? '')); hostedUrl = value.absolute_url
      if (typeof value.updated_at === 'string' && Number.isFinite(Date.parse(value.updated_at))) sourceUpdatedAt = new Date(value.updated_at).toISOString()
    }
    let hostUrl: URL
    try { hostUrl = new URL(hostedUrl ?? '') } catch { return failed('incomplete') }
    const expectedHost = reference.source === 'lever' ? 'jobs.lever.co' : ['boards.greenhouse.io','job-boards.greenhouse.io'].includes(hostUrl.hostname) ? hostUrl.hostname : ''
    const pathMatches = reference.source === 'lever'
      ? hostUrl.pathname === `/${reference.board}/${reference.postingId}`
      : hostUrl.pathname === `/${reference.board}/jobs/${reference.postingId}`
    if (hostUrl.protocol !== 'https:' || hostUrl.hostname !== expectedHost || hostUrl.username || hostUrl.password || hostUrl.port || hostUrl.search || hostUrl.hash || !pathMatches || returnedBoard !== reference.board || String(returnedPostingId) !== reference.postingId) return failed('ambiguous')
    text = text.replace(/\u0000/g, '').trim()
    if (typeof title !== 'string' || typeof employer !== 'string' || title.trim().length === 0 || employer.trim().length === 0 || text.length < 80 || text.length > MAX_TEXT) return failed('incomplete')
    const capturedAt = new Date((options.now ?? Date.now)()).toISOString()
    const candidate = namedPostingCandidateSchema.parse({ version: 1, attemptId: id, reference, returnedBoard, returnedPostingId: String(returnedPostingId), title: title.trim(), employer: employer.trim(), text, completeness: 'full', capturedAt, sourceUpdatedAt, retrievalMethod: reference.source === 'lever' ? 'lever-postings-api-v0' : 'greenhouse-job-board-api-v1', retrievalUrl: api.href })
    const attempt = namedPostingAttemptSchema.parse({ id, reference, startedAt, status: 'retrieved', expiresAt: new Date(started + 600_000).toISOString(), eligibility: grant })
    return { attempt: attempt as NamedPostingAttempt, candidate }
  } catch (error) { return failed(options.signal?.aborted ? 'cancelled' : controller.signal.aborted ? 'deadline' : error instanceof Error && error.message.includes('unsafe') ? 'unsafe-address' : 'source-error') }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort) }
}
