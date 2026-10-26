import { randomUUID } from 'node:crypto'
import { fetchNamedPostingApi, type NamedPostingApiOptions } from './named-posting-api'
import { namedPostingAttemptSchema, namedPostingCandidateSchema, namedPostingPreviewReplySchema, parseNamedPostingUrl, type NamedPostingAttempt, type NamedPostingCandidate } from '../shared/named-posting-contract'


export type { NamedPostingPreviewReply } from '../shared/named-posting-contract'
import type { NamedPostingPreviewReply } from '../shared/named-posting-contract'
type Entry = { generation: string; controller: AbortController; status: 'loading' | 'ready' | 'failed'; attempt?: NamedPostingAttempt; candidate?: NamedPostingCandidate; timer: ReturnType<typeof setTimeout>; expiresAt: number }
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
  const read = (token: string): NamedPostingPreviewReply => {
    const item = sessions.get(token)
    if (!item || item.expiresAt <= now()) { discard(token); return namedPostingPreviewReplySchema.parse({ status: 'expired' }) }
    if (item.status === 'loading') return namedPostingPreviewReplySchema.parse({ status: 'loading', expiresAt: new Date(item.expiresAt).toISOString() })
    if (item.status === 'ready' && item.attempt && item.candidate) return namedPostingPreviewReplySchema.parse(structuredClone({ status: 'ready', attempt: item.attempt, candidate: item.candidate, expiresAt: new Date(item.expiresAt).toISOString() }))
    return namedPostingPreviewReplySchema.parse({ status: 'failed', attempt: item.attempt!, expiresAt: new Date(item.expiresAt).toISOString() })
  }
  return { start, read, cancel: (token: string) => { discard(token); return { ok: true as const } }, close: () => { closed = true; for (const token of [...sessions.keys()]) discard(token) } }
}
