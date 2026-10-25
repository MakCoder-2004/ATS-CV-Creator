import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpsRequest } from 'node:https'
import type { IncomingHttpHeaders } from 'node:http'
import { isPublicAddress, pinnedAddressLookup, type Address } from './safe-posting-fetch'
import type { ResearchSearchCredentials } from './research-search-credentials'

const ENDPOINT = 'https://api.tavily.com'
const MAX_RESPONSE = 256 * 1024
const DEADLINE_MS = 12_000
const ERROR = 'Search could not be verified or completed. No search result was accepted.'
const PLAN_ERROR = 'This pilot requires a verifiable free Researcher plan with pay-as-you-go disabled and available credits. Confirm your account plan in Tavily before searching.'
export type TavilySearchErrorCode = 'authentication' | 'billing' | 'quota' | 'plan_unverified'
const SAFE_ERRORS: Record<TavilySearchErrorCode, string> = {
  authentication: 'Search authentication failed. Reconnect your Tavily key.',
  billing: 'Tavily reports a billing restriction. Search was stopped; check your account without enabling paid use.',
  quota: 'Tavily reports exhausted search credits. Search was stopped.',
  plan_unverified: PLAN_ERROR
}
export class TavilySearchError extends Error {
  constructor(readonly code: TavilySearchErrorCode) { super(SAFE_ERRORS[code]); this.name = 'TavilySearchError' }
}

export type PublicJobSearch =
  | { kind: 'role'; title: string; postingHost: string; roleId?: string }
  | { kind: 'company'; verifiedEmployerDomain: string; title?: string }
export type TavilyLink = { url: string; title: string; snippet: string }
export type TavilySearchResult = { links: TavilyLink[]; credits: 1; requestId: string }
type WireResponse = { status: number; headers: IncomingHttpHeaders; body: Buffer }
export type TavilyTransport = {
  lookup(hostname: string): Promise<Address[]>
  request(url: URL, address: Address, method: 'GET' | 'POST', headers: Readonly<Record<string, string>>, body: Buffer | undefined, signal: AbortSignal): Promise<WireResponse>
}

const transport: TavilyTransport = {
  lookup: async hostname => (await dnsLookup(hostname, { all: true, verbatim: true })).map(({ address, family }) => ({ address, family })),
  request: (url, address, method, headers, body, signal) => new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method, headers, signal, agent: false, servername: url.hostname,
      rejectUnauthorized: true, lookup: pinnedAddressLookup(address)
    }, res => {
      const chunks: Buffer[] = []; let bytes = 0
      res.on('data', (piece: Buffer) => {
        bytes += piece.length
        if (bytes > MAX_RESPONSE) { req.destroy(new Error('Oversized response.')); return }
        chunks.push(piece)
      })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks, bytes) }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end(body)
  })
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function parseBody(response: WireResponse): Record<string, unknown> {
  if (response.status === 401 || response.status === 403) throw new TavilySearchError('authentication')
  if (response.status === 402) throw new TavilySearchError('billing')
  if (response.status === 432 || response.status === 429) throw new TavilySearchError('quota')
  if (response.status !== 200 || response.body.length > MAX_RESPONSE || response.body.length === 0 ||
      !/^application\/json(?:\s*;|$)/i.test(String(response.headers['content-type'] ?? '')) ||
      response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new Error(ERROR)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(response.body)
  const parsed = record(JSON.parse(text) as unknown)
  if (!parsed) throw new Error(ERROR)
  return parsed
}
function queryFromPublicMetadata(input: PublicJobSearch): string {
  const text = (value: unknown, max: number): string => {
    if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\x00-\x1f\x7f@<>]/.test(value)) throw new Error('Enter only public job metadata for search.')
    const trimmed = value.trim()
    if (!trimmed) throw new Error('Enter only public job metadata for search.')
    return trimmed
  }
  const host = (value: unknown): string => {
    const name = text(value, 253)
    if (!/^(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i.test(name) || name.split('.').some(part => part.startsWith('-') || part.endsWith('-'))) throw new Error('Enter a public posting or verified employer domain.')
    return name.toLowerCase()
  }
  if (input.kind === 'role') {
    const title = text(input.title, 120)
    const postingHost = host(input.postingHost)
    const roleId = input.roleId === undefined ? '' : text(input.roleId, 100)
    if (roleId && !/^[a-z0-9_-]+$/i.test(roleId)) throw new Error('Enter only public job metadata for search.')
    return `${title} ${roleId} site:${postingHost}`.trim()
  }
  if (input.kind === 'company') return `${input.title === undefined ? 'careers' : text(input.title, 120)} site:${host(input.verifiedEmployerDomain)}`
  throw new Error('Enter only public job metadata for search.')
}
function verifyFreePlan(value: Record<string, unknown>): void {
  const account = record(value.account), key = record(value.key)
  if (!account || !key || account.current_plan !== 'Researcher' || account.plan_limit !== 1000 ||
      account.paygo_limit !== 0 || account.paygo_usage !== 0 || !integer(account.plan_usage) ||
      account.plan_usage >= 1000 || !integer(key.usage) || !integer(key.limit) || key.usage >= key.limit) throw new TavilySearchError('plan_unverified')
}
// These are inert, untrusted leads, never verified source URLs. No candidate DNS lookup here:
// the future fetcher MUST resolve all addresses again, reject private/mixed answers, pin
// public IP + hostname TLS for every request/redirect, and verify exact role/employer identity.
function candidateUrl(raw: string): string {
  if (!/^https:\/\//i.test(raw) || /[\\\x00-\x20\x7f]/.test(raw) || /%0[0-9a-f]|%1[0-9a-f]|%7f/i.test(raw)) throw new Error(ERROR)
  const authority = raw.slice(8).split(/[/?#]/, 1)[0]
  // Explicit :443 is unsafe too: URL.port normalizes it away.
  if (!authority || /[@:%\[\]]/.test(authority)) throw new Error(ERROR)
  let url: URL
  try { url = new URL(raw) } catch { throw new Error(ERROR) }
  const hostname = url.hostname.toLowerCase()
  const labels = hostname.split('.')
  const reserved = new Set(['localhost', 'local', 'internal', 'test', 'invalid', 'example', 'onion', 'lan', 'corp', 'home', 'arpa'])
  if (url.protocol !== 'https:' || url.username || url.password || url.port || isIP(hostname) ||
      hostname.length > 253 || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) || label.startsWith('xn--')) ||
      !/^[a-z]{2,63}$/.test(labels.at(-1)!) || reserved.has(labels.at(-1)!) || labels.some(label => ['localhost', 'local', 'internal'].includes(label)) || hostname !== authority.toLowerCase()) throw new Error(ERROR)
  url.hash = ''
  return url.href
}
function parseResult(value: Record<string, unknown>): TavilySearchResult {
  const usage = record(value.usage)
  if (usage?.credits !== 1 || typeof value.request_id !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(value.request_id) ||
      !Array.isArray(value.results) || value.results.length > 5) throw new Error(ERROR)
  const links = value.results.map((item): TavilyLink => {
    const link = record(item)
    if (!link || typeof link.url !== 'string' || link.url.length > 2048 || typeof link.title !== 'string' ||
        !link.title.trim() || link.title.length > 240 || typeof link.content !== 'string' || link.content.length > 2000) throw new Error(ERROR)
    return { url: candidateUrl(link.url), title: link.title, snippet: link.content }
  })
  return { links, credits: 1, requestId: value.request_id }
}

/** One explicit user action creates one session; it cannot dispatch more than three searches. */
export function createTavilyResearchSession(credentials: Pick<ResearchSearchCredentials, 'withKey'>, options: { transport?: TavilyTransport; signal?: AbortSignal } = {}) {
  let dispatched = 0
  let pending: Promise<unknown> = Promise.resolve()
  const network = options.transport ?? transport
  const request = async (key: string, route: '/usage' | '/search', body: Buffer | undefined) => {
    const controller = new AbortController()
    const cancel = () => controller.abort()
    options.signal?.addEventListener('abort', cancel, { once: true })
    const timeout = setTimeout(cancel, DEADLINE_MS)
    try {
      if (options.signal?.aborted) throw new Error('Search cancelled.')
      const url = new URL(route, ENDPOINT)
      const bounded = <T>(operation: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
        const abort = () => { controller.signal.removeEventListener('abort', abort); reject(new Error('Search cancelled or timed out.')) }
        if (controller.signal.aborted) return abort()
        controller.signal.addEventListener('abort', abort, { once: true })
        operation.then(value => { controller.signal.removeEventListener('abort', abort); resolve(value) }, error => { controller.signal.removeEventListener('abort', abort); reject(error) })
      })
      const addresses = await bounded(network.lookup(url.hostname))
      if (!addresses.length || addresses.some(address => !isPublicAddress(address.address, address.family))) throw new Error(ERROR)
      if (controller.signal.aborted) throw new Error('Search cancelled or timed out.')
      const headers = Object.freeze({ Authorization: `Bearer ${key}`, Accept: 'application/json', 'Accept-Encoding': 'identity', ...(body ? { 'Content-Type': 'application/json', 'Content-Length': String(body.length) } : {}) })
      return parseBody(await bounded(network.request(url, addresses[0], body ? 'POST' : 'GET', headers, body, controller.signal)))
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', cancel)
    }
  }
  return {
    search(input: PublicJobSearch): Promise<TavilySearchResult> {
      const query = queryFromPublicMetadata(input)
      if (dispatched >= 3) return Promise.reject(new Error('This research action has reached its three-search limit.'))
      dispatched++
      const run = async () => {
        if (options.signal?.aborted) throw new Error('Search cancelled.')
        return credentials.withKey(async key => {
          try {
            verifyFreePlan(await request(key, '/usage', undefined))
            if (options.signal?.aborted) throw new Error('Search cancelled.')
            const body = Buffer.from(JSON.stringify({ query, search_depth: 'basic', auto_parameters: false, include_answer: false, include_raw_content: false, max_results: 5, chunks_per_source: 1, topic: 'general', include_usage: true }))
            return parseResult(await request(key, '/search', body))
          } catch (error) {
            if (error instanceof TavilySearchError) throw error
            throw new Error(options.signal?.aborted ? 'Search cancelled.' : ERROR)
          }
        })
      }
      const result = pending.then(run, run)
      pending = result.catch(() => {})
      return result
    },
    get searchesDispatched() { return dispatched }
  }
}
