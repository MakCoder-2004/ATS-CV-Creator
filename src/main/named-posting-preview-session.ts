import { randomUUID } from 'node:crypto'
import { fetchNamedPostingApi, type NamedPostingApiOptions } from './named-posting-api'
import { namedPostingAttemptSchema, namedPostingCandidateSchema, parseNamedPostingUrl, type NamedPostingAttempt, type NamedPostingCandidate } from '../shared/named-posting-contract'
import { decideJobSourcePolicy } from '../shared/job-source-policy'

type Entry = { controller: AbortController; attempt: NamedPostingAttempt; candidate?: NamedPostingCandidate; timer: ReturnType<typeof setTimeout>; expiresAt: number }
const ttl = 10 * 60_000
/** Volatile exact Greenhouse detail preview; no persistence or promotion capability. */
export function createNamedPostingPreviewSession(options: NamedPostingApiOptions = {}, now = () => Date.now()) {
  const sessions = new Map<string, Entry>()
  const discard = (token: string) => { const item = sessions.get(token); if (!item) return; clearTimeout(item.timer); item.controller.abort(); item.candidate = undefined; sessions.delete(token) }
  const start = async (url: string, personalLocalOptIn: boolean) => {
    let reference
    try { reference = parseNamedPostingUrl(url) } catch { throw new Error('Paste one supported public Greenhouse job link.') }
    const policy = decideJobSourcePolicy(url)
    if (policy.status === 'paused') return { token: randomUUID(), attempt: { id: randomUUID(), reference: { source: 'lever', board: reference.board, postingId: reference.postingId, canonicalUrl: reference.canonicalUrl }, startedAt: new Date(now()).toISOString(), status: 'failed', reason: 'opt-in-required' } as NamedPostingAttempt, reason: policy.reason }
    if (reference.source !== 'greenhouse') return { token: randomUUID(), attempt: { id: randomUUID(), reference: { source: 'lever', board: reference.board, postingId: reference.postingId, canonicalUrl: reference.canonicalUrl }, startedAt: new Date(now()).toISOString(), status: 'failed', reason: 'opt-in-required' } as NamedPostingAttempt, reason: 'Automatic Lever reads remain paused. Paste the posting text instead.' }
    if (personalLocalOptIn !== true) throw new Error('Confirm the personal-local, temporary preview notice before fetching.')
    const token = randomUUID(), controller = new AbortController(), startedAt = new Date(now()).toISOString()
    const eligibility = { personalLocalOptIn: true as const, source: 'greenhouse' as const, scope: 'personal-local' as const, optedInAt: new Date(now() - 1).toISOString() }
    const result = await fetchNamedPostingApi({ source: reference.source, board: reference.board, postingId: reference.postingId, submittedUrl: url, canonicalUrl: reference.canonicalUrl }, { ...options, eligibility, signal: controller.signal, now })
    const attempt = namedPostingAttemptSchema.parse(result.attempt)
    const expiry = attempt.status === 'retrieved' ? Date.parse(attempt.expiresAt) : now() + ttl
    const timer = setTimeout(() => discard(token), Math.max(0, expiry - now()))
    sessions.set(token, { controller, attempt, candidate: result.candidate && namedPostingCandidateSchema.parse(result.candidate), timer, expiresAt: expiry })
    return { token, attempt }
  }
  const read = (token: string) => { const item = sessions.get(token); if (!item || item.expiresAt <= now()) { discard(token); return { status: 'expired' as const } }; return { status: item.attempt.status === 'failed' ? 'failed' as const : 'ready' as const, attempt: item.attempt, ...(item.candidate ? { candidate: item.candidate } : {}) } }
  return { start, read, cancel: (token: string) => { discard(token); return { ok: true as const } }, close: () => { for (const token of sessions.keys()) discard(token) } }
}
