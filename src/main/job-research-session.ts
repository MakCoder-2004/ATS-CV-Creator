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
      const candidates = result.links.filter(link => {
        try { return normalizeJobResearchUrl(link.url).canonicalUrl === selected.canonicalUrl } catch { return false }
      })
      if (!candidates.length) {
        const run = jobResearchRunSchema.parse({ ...original, completedAt: new Date().toISOString(), unknowns: [...original.unknowns, 'No indexed result matched this exact selected role; similarly named employers and jobs were ignored.'] })
        session.state = { status: 'ready', run: freeze(run) }
        return getJobResearch(token)
      }
      const verified = jobResearchRunSchema.parse(await direct(selected.canonicalUrl, { signal: session.controller.signal }))
      if (!live(token, session, generation)) throw new Error(missing)
      if (verified.selected.canonicalUrl !== selected.canonicalUrl || verified.status === 'none' || verified.status === 'blocked') {
        session.state = { status: 'ready', run: freeze(jobResearchRunSchema.parse({ ...original, completedAt: new Date().toISOString(), unknowns: [...original.unknowns, 'An indexed link was found but the public source could not verify this role. No indexed claim was accepted.'] })) }
        return getJobResearch(token)
      }
      // Verified direct contents take precedence. A snippet alone never establishes a role
      // requirement; require both a fresh direct partial read and matching exact-role metadata.
      // Retain the original direct capture even if the verification read improves it.
      // Run IDs remain app-issued and the selected canonical identity stays unchanged.
      const preserved = (next: JobResearchRun): JobResearchRun => jobResearchRunSchema.parse({ ...next,
        sources: [...original.sources.filter(source => !next.sources.some(item => item.id === source.id)), ...next.sources],
        findings: [...original.findings.filter(finding => !next.findings.some(item => item.id === finding.id)), ...next.findings],
        unknowns: [...new Set([...original.unknowns, ...next.unknowns])],
      })
      if (verified.status === 'full') {
        session.state = { status: 'ready', run: freeze(preserved(verified)) }
        return getJobResearch(token)
      }
      const role = verified.sources.find(source => source.identity === 'exact-role' && source.title && source.employer)
      const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, ' ').trim()
      const match = role && candidates.find(candidate => normalized(candidate.title).includes(normalized(role.title!)) && normalized(candidate.title).includes(normalized(role.employer!)))
      if (!match || !role) {
        session.state = { status: 'ready', run: freeze(preserved(jobResearchRunSchema.parse({ ...verified, unknowns: [...verified.unknowns, 'Indexed title or employer did not match the directly verified role; the snippet was discarded.'] }))) }
        return getJobResearch(token)
      }
      const sourceId = randomUUID()
      const run = jobResearchRunSchema.parse({ ...verified, sources: [...verified.sources, { version: 1, id: sourceId, url: selected.canonicalUrl, capturedAt: new Date().toISOString(), method: 'indexed-snippet', identity: 'exact-role', title: role.title, employer: role.employer, employerIdentityUrl: null }], findings: [...verified.findings, { version: 1, id: randomUUID(), sourceId, kind: 'indexed-role-claim', text: match.snippet, completeness: 'partial' }], unknowns: [...verified.unknowns, 'Indexed excerpt is partial and not an independently verified full posting.'] })
      session.state = { status: 'ready', run: freeze(preserved(run)) }
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
  return { startJobResearch, assertCanAcceptInitialDirectRun, acceptInitialDirectRun, getJobResearch, searchJobResearch, reviewJobResearch, verifyAppHeldReview,
    cancelJobResearch(token: string): { ok: boolean } { const found = sessions.has(token); cancelEntry(token); return { ok: found } },
    close(): void { for (const token of sessions.keys()) cancelEntry(token) } }
}
