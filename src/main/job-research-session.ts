import { randomUUID } from 'node:crypto'
import { jobResearchRunSchema, normalizeJobResearchUrl, promoteJobResearch, verifyReviewedJobResearch, type JobResearchRun, type ReviewedJobResearch } from '../shared/job-research'
import { researchStateSchema, type ResearchState } from '../shared/job-research-ipc'
import { fetchDirectJobResearch, type JobResearchFetchOptions } from './job-research-fetch'
import { createTavilyResearchSession, TavilySearchError, type TavilySearchResult } from './tavily-search'
import type { ResearchSearchCredentials } from './research-search-credentials'

const EXPIRY_MS = 15 * 60_000
const MAX_RUNS = 5
const missing = 'This temporary research is unavailable or expired. Start a new public read.'
const clone = <T>(value: T): T => structuredClone(value)
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
const safeState = (state: ResearchState): ResearchState => researchStateSchema.parse(state)
type Session = { state: ResearchState; controller: AbortController; expiresAt: number; generation: number; searched: boolean; reviewed?: ReviewedJobResearch }
export type ResearchSessionOptions = {
  credentials: Pick<ResearchSearchCredentials, 'status' | 'withKey'>
  direct?: (url: string, options: JobResearchFetchOptions) => Promise<JobResearchRun>
  createSearch?: typeof createTavilyResearchSession
  now?: () => number
}

/** Volatile, app-issued research; no SQLite, backup, cache, or saved-job API is reachable here. */
export function createJobResearchSessions(options: ResearchSessionOptions) {
  const sessions = new Map<string, Session>()
  const clock = options.now ?? Date.now
  const direct = options.direct ?? fetchDirectJobResearch
  const searchFactory = options.createSearch ?? createTavilyResearchSession
  function cancelEntry(token: string): void {
    const session = sessions.get(token)
    if (!session) return
    session.generation++
    session.controller.abort()
    sessions.delete(token)
  }
  function prune(): void {
    for (const [token, session] of sessions) if (session.expiresAt <= clock()) cancelEntry(token)
  }
  function get(token: string): Session {
    prune()
    const session = sessions.get(token)
    if (!session) throw new Error(missing)
    return session
  }
  function live(token: string, session: Session, generation: number): boolean {
    return sessions.get(token) === session && session.generation === generation && !session.controller.signal.aborted && session.expiresAt > clock()
  }
  function makeRoom(): void {
    prune()
    if (sessions.size >= MAX_RUNS) {
      const oldest = [...sessions].find(([, session]) => session.state.status !== 'loading')
      if (!oldest) throw new Error('Temporary research is full. Wait for a read or cancel one before starting another.')
      cancelEntry(oldest[0])
    }
  }
  function assertCanAcceptInitialDirectRun(): void {
    prune()
    if (sessions.size >= MAX_RUNS && ![...sessions.values()].some(session => session.state.status !== 'loading')) throw new Error('Temporary research is full. Wait for a read or cancel one before starting another.')
  }
  function acceptInitialDirectRun(input: JobResearchRun): { token: string } {
    const run = jobResearchRunSchema.parse(input)
    assertCanAcceptInitialDirectRun()
    makeRoom()
    const token = randomUUID()
    sessions.set(token, { state: safeState({ status: 'ready', run: freeze(clone(run)) }), controller: new AbortController(), generation: 0, searched: false, expiresAt: clock() + EXPIRY_MS })
    return { token }
  }
  function startJobResearch(input: string): { token: string } {
    const selected = normalizeJobResearchUrl(input)
    makeRoom()
    const token = randomUUID()
    const session: Session = { state: { status: 'loading' }, controller: new AbortController(), generation: 0, searched: false, expiresAt: clock() + EXPIRY_MS }
    sessions.set(token, session)
    const generation = session.generation
    void direct(selected.canonicalUrl, { signal: session.controller.signal }).then(run => {
      if (live(token, session, generation)) session.state = safeState({ status: 'ready', run: freeze(jobResearchRunSchema.parse(run)) })
    }, () => {
      if (live(token, session, generation)) session.state = safeState({ status: 'unavailable', message: 'The public read failed. No source content was accepted; try the original link or paste a posting.', settingsAction: false })
    })
    return { token }
  }
  function getJobResearch(token: string): ResearchState { return safeState(clone(get(token).state)) }
  async function searchJobResearch(token: string): Promise<ResearchState> {
    const session = get(token)
    if (session.state.status !== 'ready') throw new Error('Wait for the public read before requesting search.')
    if (session.state.run.status === 'full') throw new Error('The exact direct posting is already complete; no indexed search is needed.')
    if (session.searched) throw new Error('This research already used its one explicit search action. Start a new public read to try again.')
    session.searched = true // includes missing-key/failed attempts: never retry a possibly charged request silently
    session.reviewed = undefined // a search attempt invalidates any earlier review, including failed search
    const generation = ++session.generation
    const original = session.state.run
    session.state = { status: 'loading' }
    const available = await options.credentials.status().catch(() => ({ configured: false, storageAvailable: false, message: '' }))
    if (!live(token, session, generation)) throw new Error(missing)
    if (!available.configured || !available.storageAvailable) {
      session.state = { status: 'ready', run: original }
      return safeState({ status: 'unavailable', message: available.storageAvailable ? 'Set up your Tavily key in Settings before searching. No request was sent.' : 'Encrypted search-key storage is unavailable on this device. Open Settings; no request was sent.', settingsAction: true })
    }
    // Only a canonical host and exact public role ID leave the device; no title, CV, profile,
    // contact detail, untrusted page words, or URL query string is sent to the index provider.
    const selected = original.selected
    const query = { kind: 'role' as const, title: 'job', postingHost: selected.host, ...(selected.roleId ? { roleId: selected.roleId } : {}) }
    try {
      const result: TavilySearchResult = await searchFactory(options.credentials, { signal: session.controller.signal }).search(query)
      if (!live(token, session, generation)) throw new Error(missing)
      // Search links are leads, not full role evidence. Never navigate to a search-provided
      // destination: only the canonical selected URL may be re-read by the pinned direct adapter.
      const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, ' ').trim()
      const candidates = result.links.filter(link => {
        try {
          // An indexed URL is an identity lead, not proof that the snippet describes the posting.
          // Generic links have no role ID: their *entire* canonical URL must still match.
          return normalizeJobResearchUrl(link.url).canonicalUrl === selected.canonicalUrl &&
            typeof link.title === 'string' && link.title.trim().length <= 240 &&
            /[a-z]{3}/i.test(link.title) && !/^(?:job|jobs|apply|sign in|log in)$/i.test(link.title.trim()) &&
            typeof link.snippet === 'string' && !!link.snippet.trim() && link.snippet.length <= 2000
        } catch { return false }
      })
      if (!candidates.length) {
        const run = jobResearchRunSchema.parse({ ...original, completedAt: new Date().toISOString(), unknowns: [...original.unknowns, 'No usable indexed result matched this exact selected role; similarly named employers and jobs were ignored.'] })
        session.state = { status: 'ready', run: freeze(run) }
        return getJobResearch(token)
      }
      // The only follow-up GET is to the already selected canonical URL. Only typed,
      // explicitly unreadable outcomes can authorize a URL-only indexed fallback.
      let verified: JobResearchRun | undefined
      let readFailed = false
      try { verified = jobResearchRunSchema.parse(await direct(selected.canonicalUrl, { signal: session.controller.signal })) }
      catch {
        // DNS, TLS, request and unknown errors have no proven-safe destination.
        readFailed = true
      }
      if (!live(token, session, generation)) throw new Error(missing)
      const identityMismatch = !!verified && verified.selected.canonicalUrl !== selected.canonicalUrl
      if (identityMismatch) verified = undefined
      const preserved = (next?: JobResearchRun): JobResearchRun => jobResearchRunSchema.parse({ ...original,
        completedAt: new Date().toISOString(),
        // A failed earlier read cannot label a run once direct evidence exists.
        accessFailure: original.status === 'provisional' || next?.status === 'provisional' ? undefined : original.accessFailure,
        status: next?.status === 'full' ? 'full' : original.status === 'provisional' || next?.status === 'provisional' ? 'provisional' : original.status,
        sources: [...original.sources, ...(next?.sources ?? []).filter(source => !original.sources.some(item => item.id === source.id))],
        findings: [...original.findings, ...(next?.findings ?? []).filter(finding => !original.findings.some(item => item.id === finding.id))],
        unknowns: [...new Set([...original.unknowns, ...(next?.unknowns ?? [])])],
      })
      if (verified?.status === 'full') {
        session.state = { status: 'ready', run: freeze(jobResearchRunSchema.parse({ ...verified, id: original.id, startedAt: original.startedAt })) }
        return getJobResearch(token)
      }
      const base = preserved(verified?.status === 'provisional' ? verified : undefined)
      // Untagged historical blocked/none runs remain readable but cannot grant fallback.
      const cannotFallback = original.accessFailure === 'unsafe' || readFailed || identityMismatch ||
        (verified?.status !== 'provisional' && verified?.accessFailure !== 'unreadable')
      if (cannotFallback) {
        session.state = { status: 'ready', run: freeze(jobResearchRunSchema.parse({ ...base, unknowns: [...base.unknowns, 'The selected source could not be safely reached; the indexed excerpt was not accepted.'] })) }
        return getJobResearch(token)
      }
      const directRoles = base.sources.filter(source => source.method === 'direct-html' && source.identity === 'exact-role' && source.title)
      const matchesDirect = (candidate: TavilySearchResult['links'][number]) => directRoles.every(role => {
        const title = normalized(role.title!)
        const indexed = normalized(candidate.title)
        if (!role.employer) return indexed === title
        // Strip only an exact, directly verified employer suffix, never an extra title word.
        const employer = normalized(role.employer)
        const suffix = candidate.title.match(/^(.*?)\s+(?:[—–|\-]|at)\s+(.+)$/i)
        return !!suffix && normalized(suffix[1]) === title && normalized(suffix[2]) === employer
      })
      const match = candidates.find(matchesDirect)
      if (!match) {
        session.state = { status: 'ready', run: freeze(jobResearchRunSchema.parse({ ...base, unknowns: [...base.unknowns, 'Indexed title or employer did not match the directly read role; the snippet was discarded.'] })) }
        return getJobResearch(token)
      }
      const sourceId = randomUUID()
      const directlyVerifiedEmployer = directRoles.find(role => role.employer)?.employer ?? null
      const { accessFailure: _accessFailure, ...evidenceBase } = base
      const run = jobResearchRunSchema.parse({ ...evidenceBase, status: 'provisional', sources: [...base.sources, {
        version: 1, id: sourceId, url: selected.canonicalUrl, capturedAt: new Date().toISOString(),
        method: 'indexed-snippet', identity: 'exact-role', title: match.title.trim(), employer: directlyVerifiedEmployer, employerIdentityUrl: null,
      }], findings: [...base.findings, { version: 1, id: randomUUID(), sourceId, kind: 'indexed-role-claim', text: match.snippet.trim(), completeness: 'partial' }],
      unknowns: [...base.unknowns, directRoles.length
        ? 'The indexed title and excerpt match directly read role metadata, but the excerpt is partial and not independently confirmed on source; verify on original.'
        : 'Identity matched by selected URL only; job title/employer and excerpt are indexed, not independently confirmed on source; verify on original.'] })
      session.state = { status: 'ready', run: freeze(run) }
      return getJobResearch(token)
    } catch (error) {
      if (!live(token, session, generation)) throw new Error(missing)
      session.state = { status: 'ready', run: original }
      const message = error instanceof TavilySearchError ? error.message : 'Search could not be verified or completed. No search result was accepted. Check your Tavily plan and key in Settings.'
      return safeState({ status: 'unavailable', message, settingsAction: true })
    }
  }
  function reviewJobResearch(token: string, acceptedFindingIds: string[], acknowledgedPartial: boolean): ReviewedJobResearch {
    const session = get(token)
    if (session.state.status !== 'ready') throw new Error('No available research run to review.')
    const review = promoteJobResearch(session.state.run, acceptedFindingIds, acknowledgedPartial)
    session.reviewed = freeze(verifyReviewedJobResearch(session.state.run, review))
    return clone(session.reviewed)
  }
  function verifyAppHeldReview(token: string, review: unknown): ReviewedJobResearch {
    const session = get(token)
    if (session.state.status !== 'ready' || !session.reviewed) throw new Error('No reviewed app-held research is available.')
    const checked = verifyReviewedJobResearch(session.state.run, review)
    if (checked.evidenceHash !== session.reviewed.evidenceHash) throw new Error('Research review has changed. Review the current run again.')
    return checked
  }
  function getReviewedRunById(runId: string): { run: JobResearchRun; review: ReviewedJobResearch } {
    prune()
    for (const session of sessions.values()) {
      if (session.state.status !== 'ready' || session.state.run.id !== runId || !session.reviewed || session.controller.signal.aborted) continue
      const review = verifyReviewedJobResearch(session.state.run, session.reviewed)
      return { run: clone(session.state.run), review: clone(review) }
    }
    throw new Error('No current app-held reviewed research is available. Review the public read again.')
  }
  function getReviewedRun(token: string): { run: JobResearchRun; review: ReviewedJobResearch } {
    const session = get(token)
    if (session.state.status !== 'ready' || !session.reviewed || session.controller.signal.aborted) throw new Error('Review the public read before preparing outgoing analysis.')
    return getReviewedRunById(session.state.run.id)
  }
  return { startJobResearch, assertCanAcceptInitialDirectRun, acceptInitialDirectRun, getJobResearch, searchJobResearch, reviewJobResearch, verifyAppHeldReview, getReviewedRun, getReviewedRunById,
    cancelJobResearch(token: string): { ok: boolean } { const found = sessions.has(token); cancelEntry(token); return { ok: found } },
    close(): void { for (const token of sessions.keys()) cancelEntry(token) } }
}
