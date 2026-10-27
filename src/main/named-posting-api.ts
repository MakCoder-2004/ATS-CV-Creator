import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
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
  eligibility?: { personalLocalOptIn: true; source: 'lever' | 'greenhouse' | 'wuzzuf'; scope: 'personal-local'; optedInAt: string } | null
  /** Deterministic adapter seam; production uses the bounded worker and fixed deadline. */
  extractHtml?: (sections: string[], signal: AbortSignal) => Promise<string[]>
  /** Test seam only. Production extraction stays at the 2-second worker deadline. */
  extractionTimeoutMs?: number
}
const MAX_BYTES = 2 *  1024 * 1024
const MAX_TEXT = 100_000
const timeout = 15_000
const extractionTimeout = 2_000
const defaultLookup = async (host: string): Promise<Address[]> => (await dnsLookup(host, { all: true, verbatim: true })).map(({ address, family }) => ({ address, family }))
const headers = Object.freeze({ Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'CV-Tailor/1.0' })
const htmlHeaders = Object.freeze({ Accept: 'text/html', 'Accept-Encoding': 'identity', 'User-Agent': 'CV-Tailor/1.0' })
const abortable = <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> => new Promise((resolve, reject) => {
  const cancel = () => reject(signal.reason ?? new Error('cancelled'))
  operation.then(value => { signal.removeEventListener('abort', cancel); resolve(value) }, error => { signal.removeEventListener('abort', cancel); reject(error) })
  if (signal.aborted) { cancel(); return }
  signal.addEventListener('abort', cancel, { once: true })
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
function extractHtmlSections(sections: string[], signal: AbortSignal, budgetMs = extractionTimeout): Promise<string[]> {
  if (sections.length > 202 || sections.reduce((size, section) => size + Buffer.byteLength(section, 'utf8'), 0) > 512 * 1024) return Promise.reject(new Error('HTML sections exceed the bounded parsing input.'))
  const worker = new Worker(join(__dirname, 'named-posting-html-worker.cjs'), { workerData: { sections }, resourceLimits: { maxOldGenerationSizeMb: 48, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 } })
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (action: () => void) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', cancel); void worker.terminate(); action() }
    const timer = setTimeout(() => finish(() => reject(new Error('HTML parsing exceeded its 2-second budget.'))), budgetMs)
    const cancel = () => finish(() => reject(new Error('HTML parsing cancelled.')))
    if (signal.aborted) return cancel()
    signal.addEventListener('abort', cancel, { once: true })
    worker.once('message', (result: { text?: string[]; error?: string }) => finish(() => result.error || !result.text ? reject(new Error(result.error ?? 'HTML parsing failed.')) : resolve(result.text)))
    worker.once('error', error => finish(() => reject(error)))
    worker.once('exit', code => { if (code !== 0) finish(() => reject(new Error('HTML parser worker exited unexpectedly.'))) })
  })
}
function extractBounded(sections: string[], signal: AbortSignal, options: NamedPostingApiOptions): Promise<string[]> {
  const budget = options.extractionTimeoutMs ?? extractionTimeout
  const extractionController = new AbortController()
  const relayAbort = () => extractionController.abort(signal.reason)
  if (signal.aborted) relayAbort()
  else signal.addEventListener('abort', relayAbort, { once: true })
  const extract = options.extractHtml ?? extractHtmlSections
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { extractionController.abort(new Error('HTML parsing exceeded its bounded deadline.')); reject(new Error('HTML parsing exceeded its bounded deadline.')) }, budget)
  })
  return Promise.race([extract(sections, extractionController.signal, budget), deadline]).finally(() => {
    if (timer) clearTimeout(timer)
    signal.removeEventListener('abort', relayAbort)
  })
}
async function leverText(value: any, signal: AbortSignal, options: NamedPostingApiOptions): Promise<string> {
  const pieces: string[] = [], htmlIndexes: number[] = []
  if (typeof value.descriptionPlain === 'string' && value.descriptionPlain.trim()) pieces.push(value.descriptionPlain.trim())
  else if (typeof value.description === 'string' && value.description.trim()) { htmlIndexes.push(pieces.length); pieces.push(value.description) }
  if (value.lists !== undefined) {
    if (!Array.isArray(value.lists) || value.lists.length > 100) throw new Error('Lever section format is ambiguous.')
    for (const list of value.lists) {
      if (!list || typeof list !== 'object' || typeof list.text !== 'string' || typeof list.content !== 'string' || !list.text.trim() || !list.content.trim()) throw new Error('Lever section format is ambiguous.')
      pieces.push(list.text.trim())
      htmlIndexes.push(pieces.length); pieces.push(list.content)
    }
  }
  if (value.additionalPlain !== undefined && typeof value.additionalPlain !== 'string') throw new Error('Lever additional text format is ambiguous.')
  if (typeof value.additionalPlain === 'string' && value.additionalPlain.trim()) pieces.push(value.additionalPlain.trim())
  else if (value.additional !== undefined) {
    if (typeof value.additional !== 'string') throw new Error('Lever additional HTML format is ambiguous.')
    if (value.additional.trim()) { htmlIndexes.push(pieces.length); pieces.push(value.additional) }
  }
  const extracted = htmlIndexes.length ? await extractBounded(htmlIndexes.map(index => pieces[index]), signal, options) : []
  htmlIndexes.forEach((index, i) => { pieces[index] = extracted[i] })
  return pieces.filter(Boolean).join('\n\n')
}

async function fetchWuzzuf(reference: NamedPostingReference, id: string, started: number, startedAt: string, retrieved: import('../shared/named-posting-schema').NamedPostingAttempt, failed: (reason: Extract<NamedPostingAttempt, {status:'failed'}>['reason']) => { attempt: NamedPostingAttempt }, options: NamedPostingApiOptions) {
  const url = new URL(reference.canonicalUrl)
  const controller = new AbortController(), relay = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', relay, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('deadline')), timeout)
  try {
    if (options.signal?.aborted) return failed('cancelled')
    const addresses = await abortable((options.lookup ?? defaultLookup)(url.hostname), controller.signal)
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address, a.family))) return failed('unsafe-address')
    const response = await abortable((options.request ?? defaultRequest)(url, addresses[0], controller.signal, htmlHeaders), controller.signal)
    if (response.body.length > MAX_BYTES) return failed('incomplete')
    if ([301,302,303,307,308].includes(response.status)) return failed('unsafe-redirect')
    if ([401,403].includes(response.status)) return failed('login-required')
    if (response.status === 404 || response.status === 410) return failed('not-found')
    if (response.status !== 200 || !String(response.headers['content-type'] ?? '').toLowerCase().includes('html') || String(response.headers['content-encoding'] ?? 'identity').toLowerCase() !== 'identity') return failed('incomplete')
    const html = new TextDecoder('utf-8', { fatal: true }).decode(response.body)
    const worker = new Worker(join(__dirname, 'wuzzuf-posting-worker.cjs'), { workerData: { html, url: url.href, canonicalUrl: reference.canonicalUrl }, resourceLimits: { maxOldGenerationSizeMb: 48, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 } })
    const data = await new Promise<{title:string; employer:string; text:string}>( (resolve, reject) => {
      let settled = false
      const finish = (action: () => void) => { if (settled) return; settled = true; clearTimeout(parseTimer); controller.signal.removeEventListener('abort', cancel); void worker.terminate(); action() }
      const parseTimer = setTimeout(() => finish(() => reject(new Error('deadline'))), 2_000)
      const cancel = () => finish(() => reject(new Error('cancelled')))
      if (controller.signal.aborted) return cancel()
      controller.signal.addEventListener('abort', cancel, { once: true })
      worker.once('message', (result: any) => finish(() => result.error ? reject(new Error(result.error)) : resolve(result)))
      worker.once('error', error => finish(() => reject(error)))
    })
    if (data.text.length > MAX_TEXT) return failed('incomplete')
    const candidate = namedPostingCandidateSchema.parse({ version: 1, attemptId: id, reference, returnedBoard: null, returnedPostingId: reference.postingId, title: data.title, employer: data.employer, text: data.text, completeness: 'full', capturedAt: new Date((options.now ?? Date.now)()).toISOString(), sourceUpdatedAt: null, retrievalMethod: 'wuzzuf-public-jobposting-v1', retrievalUrl: reference.canonicalUrl })
    return { attempt: retrieved, candidate }
  } catch (error) { return failed(options.signal?.aborted ? 'cancelled' : controller.signal.aborted ? 'deadline' : error instanceof Error && /identity|match|ambiguous/i.test(error.message) ? 'ambiguous' : error instanceof Error && /partial|missing|limit/i.test(error.message) ? 'incomplete' : 'source-error') }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', relay) }
}

/** Inert exact-detail adapter. It performs no policy decision, IPC, persistence, or source activation. */
export async function fetchNamedPostingApi(input: unknown, options: NamedPostingApiOptions = {}): Promise<{ attempt: NamedPostingAttempt; candidate?: NamedPostingCandidate }> {
  const reference = namedPostingReferenceSchema.parse(input)
  const started = (options.now ?? Date.now)(), startedAt = new Date(started).toISOString(), id = randomUUID()
  const failed = (reason: Extract<NamedPostingAttempt, {status:'failed'}>['reason']) => ({ attempt: namedPostingAttemptSchema.parse({ id, reference, startedAt, status: 'failed', reason }) as NamedPostingAttempt })
  const preflight = namedPostingAttemptSchema.safeParse({ id, reference, startedAt, status: 'retrieved', expiresAt: new Date(started + 600_000).toISOString(), eligibility: options.eligibility })
  if (!preflight.success || preflight.data.status !== 'retrieved') return failed('opt-in-required')
  if (reference.source === 'wuzzuf') return fetchWuzzuf(reference, id, started, startedAt, preflight.data, failed, options)
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
    if ([401,403].includes(response.status)) return failed('login-required')
    if (response.status === 429) return failed('source-error')
    if (response.status !== 200) return failed('source-error')
    if (!String(response.headers['content-type'] ?? '').toLowerCase().includes('json') || String(response.headers['content-encoding'] ?? 'identity').toLowerCase() !== 'identity') return failed('incomplete')
    let value: any
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body)) } catch { return failed('incomplete') }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return failed('incomplete')
    let returnedBoard: string | null, returnedPostingId: string, title: string, employer: string, text: string, sourceUpdatedAt: string | null = null
    if (reference.source === 'lever') {
      let hosted: URL
      try { hosted = new URL(typeof value.hostedUrl === 'string' ? value.hostedUrl : '') } catch { return failed('incomplete') }
      returnedBoard = hosted.pathname.split('/')[1] ?? ''
      returnedPostingId = value.id
      title = value.text; employer = value.categories?.team ?? value.categories?.department
      text = await leverText(value, controller.signal, options)
      if (hosted.protocol !== 'https:' || hosted.hostname !== 'jobs.lever.co' || hosted.username || hosted.password || hosted.port || hosted.search || hosted.hash || hosted.pathname !== `/${reference.board}/${reference.postingId}`) return failed('ambiguous')
    } else {
      returnedBoard = null
      returnedPostingId = String(value.id ?? ''); title = value.title; employer = value.company_name
      text = (await extractBounded([String(value.content ?? '')], controller.signal, options))[0]
      if (value.gh_jid !== undefined && String(value.gh_jid) !== reference.postingId) return failed('ambiguous')
      if (value.absolute_url !== undefined) {
        if (typeof value.absolute_url !== 'string' || value.absolute_url.length > 2048) return failed('ambiguous')
        let displayed: URL
        try { displayed = new URL(value.absolute_url) } catch { return failed('ambiguous') }
        if (!['http:', 'https:'].includes(displayed.protocol) || displayed.username || displayed.password) return failed('ambiguous')
        const decoratedIds = displayed.searchParams.getAll('gh_jid')
        if (decoratedIds.length > 1 || decoratedIds.length === 1 && decoratedIds[0] !== reference.postingId) return failed('ambiguous')
      }
      if (typeof value.updated_at === 'string') {
        const update = Date.parse(value.updated_at)
        if (!Number.isFinite(update)) return failed('incomplete')
        sourceUpdatedAt = new Date(update).toISOString()
      }
    }
    if (String(returnedPostingId) !== reference.postingId || reference.source === 'lever' && returnedBoard !== reference.board) return failed('ambiguous')
    text = text.replace(/\u0000/g, '').trim()
    if (typeof title !== 'string' || typeof employer !== 'string' || title.trim().length === 0 || employer.trim().length === 0 || text.length < 80 || text.length > MAX_TEXT) return failed('incomplete')
    const capturedAt = new Date((options.now ?? Date.now)()).toISOString()
    const candidate = namedPostingCandidateSchema.parse({ version: 1, attemptId: id, reference, returnedBoard, returnedPostingId: String(returnedPostingId), title: title.trim(), employer: employer.trim(), text, completeness: 'full', capturedAt, sourceUpdatedAt, retrievalMethod: reference.source === 'lever' ? 'lever-postings-api-v0' : 'greenhouse-job-board-api-v1', retrievalUrl: api.href })
    return { attempt: preflight.data, candidate }
  } catch (error) { return failed(options.signal?.aborted ? 'cancelled' : controller.signal.aborted ? 'deadline' : error instanceof Error && error.message.includes('unsafe') ? 'unsafe-address' : 'source-error') }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort) }
}
