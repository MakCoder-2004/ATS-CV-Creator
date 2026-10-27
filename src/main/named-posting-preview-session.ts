import { createHash, randomUUID } from 'node:crypto'
import { fetchNamedPostingApi, type NamedPostingApiOptions } from './named-posting-api'
import { createNamedPostingAcceptance } from '../shared/named-posting-contract'
import { namedPostingAttemptSchema, namedPostingCandidateSchema, namedPostingPreviewReplySchema, namedPostingReviewSchema, parseNamedPostingUrl, type NamedPostingAttempt, type NamedPostingCandidate, type NamedPostingPreviewReply } from '../shared/named-posting-schema'


type Entry = { generation: string; controller: AbortController; status: 'loading' | 'ready' | 'failed'; attempt?: NamedPostingAttempt; candidate?: NamedPostingCandidate; reviewToken?: string; review?: { attemptId: string; candidateHash: string; reviewedAt: string; exactRole: true; completeness: true }; timer: ReturnType<typeof setTimeout>; expiresAt: number }
const ttl = 10 * 60_000
/** Volatile exact Greenhouse detail preview; no persistence or promotion capability. */
export function createNamedPostingPreviewSession(options: NamedPostingApiOptions = {}, now = () => Date.now()) {
  const sessions = new Map<string, Entry>()
  let closed = false
  const discard = (token: string) => { const item = sessions.get(token); if (!item) return; clearTimeout(item.timer); item.controller.abort(); item.candidate = undefined; sessions.delete(token) }
  const start = (url: string, personalLocalOptIn: boolean) => {
    if (closed) throw new Error('Named posting previews are closed.')
    let reference
    try { reference = parseNamedPostingUrl(url) } catch { throw new Error('Paste one supported public Greenhouse job link.') }
    if (reference.source !== 'greenhouse') throw new Error('Automatic Lever reads remain paused. Paste the posting text instead.')
    if (personalLocalOptIn !== true) throw new Error('Confirm the personal-local, temporary preview notice before fetching.')
    const token = randomUUID(), generation = randomUUID(), controller = new AbortController(), started = now(), expiresAt = started + ttl
    // Grant derives only from the trusted main-process IPC action, not renderer eligibility data.
    const eligibility = { personalLocalOptIn: true as const, source: 'greenhouse' as const, scope: 'personal-local' as const, optedInAt: new Date(started).toISOString() }
    const timer = setTimeout(() => discard(token), ttl)
    const entry: Entry = { generation, controller, status: 'loading', timer, expiresAt }
    sessions.set(token, entry)
    void fetchNamedPostingApi({ source: reference.source, board: reference.board, postingId: reference.postingId, submittedUrl: url, canonicalUrl: reference.canonicalUrl }, { ...options, eligibility, signal: controller.signal, now }).then(result => {
      const live = sessions.get(token)
      if (closed || live !== entry || live.generation !== generation || controller.signal.aborted) return
      const attempt = namedPostingAttemptSchema.parse(result.attempt)
      live.attempt = attempt
      if (attempt.status === 'retrieved' && result.candidate) { live.candidate = namedPostingCandidateSchema.parse(result.candidate); live.status = 'ready' }
      else live.status = 'failed'
    }).catch(() => {
      const live = sessions.get(token)
      if (closed || live !== entry || live.generation !== generation || controller.signal.aborted) return
      live.attempt = namedPostingAttemptSchema.parse({ id: randomUUID(), reference: { source: 'greenhouse', board: reference.board, postingId: reference.postingId, submittedUrl: url, canonicalUrl: reference.canonicalUrl }, startedAt: new Date(started).toISOString(), status: 'failed', reason: 'source-error' })
      live.status = 'failed'
    })
    return { token }
  }
  const review = (token: string, exactRole: boolean, completeness: boolean) => {
    const item = sessions.get(token)
    if (!item || item.expiresAt <= now()) { discard(token); throw new Error('The temporary posting preview expired. Fetch it again.') }
    if (item.status !== 'ready' || !item.attempt || item.attempt.status !== 'retrieved' || !item.candidate) throw new Error('A complete exact-role preview is required before Save.')
    if (exactRole !== true || completeness !== true) { item.review = undefined; item.reviewToken = undefined; throw new Error('Confirm that you reviewed the exact role and complete posting before Save.') }
    const candidateHash = createHash('sha256').update(JSON.stringify(item.candidate)).digest('hex')
    const reviewedAt = new Date(now()).toISOString()
    item.review = namedPostingReviewSchema.parse({ attemptId: item.attempt.id, candidateHash, reviewedAt, exactRole: true, completeness: true })
    item.reviewToken = randomUUID()
    return { reviewToken: item.reviewToken, reviewedAt }
  }
  const save = async <T>(token: string, reviewToken: string, working: import('../shared/jobs').JobInput, persist: (acceptance: import('../shared/named-posting-schema').NamedPostingAcceptance, working: import('../shared/jobs').JobInput) => Promise<T>, succeeded: (result: T) => boolean): Promise<T> => {
    const item = sessions.get(token)
    if (!item || item.expiresAt <= now()) { discard(token); throw new Error('The temporary posting preview expired. Fetch it again.') }
    if (item.status !== 'ready' || !item.attempt || item.attempt.status !== 'retrieved' || !item.candidate || !item.review || item.reviewToken !== reviewToken) throw new Error('Review this exact posting again before Save.')
    const acceptance = createNamedPostingAcceptance(item.candidate, item.attempt, item.review, now())
    const result = await persist(acceptance, working)
    if (succeeded(result)) discard(token)
    return result
  }
  const read = (token: string): NamedPostingPreviewReply => {
    const item = sessions.get(token)
    if (!item || item.expiresAt <= now()) { discard(token); return namedPostingPreviewReplySchema.parse({ status: 'expired' }) }
    if (item.status === 'loading') return namedPostingPreviewReplySchema.parse({ status: 'loading', expiresAt: new Date(item.expiresAt).toISOString() })
    if (item.status === 'ready' && item.attempt && item.candidate) return namedPostingPreviewReplySchema.parse(structuredClone({ status: 'ready', attempt: item.attempt, candidate: item.candidate, expiresAt: new Date(item.expiresAt).toISOString() }))
    return namedPostingPreviewReplySchema.parse({ status: 'failed', attempt: item.attempt!, expiresAt: new Date(item.expiresAt).toISOString() })
  }
  return { start, read, review, save, cancel: (token: string) => { discard(token); return { ok: true as const } }, close: () => { closed = true; for (const token of [...sessions.keys()]) discard(token) } }
}
