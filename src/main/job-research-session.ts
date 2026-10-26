import { randomUUID } from 'node:crypto'
import { jobResearchRunSchema, normalizeJobResearchUrl, promoteJobResearch, verifyReviewedJobResearch, type JobResearchRun, type ReviewedJobResearch } from '../shared/job-research'
import { decideJobResearchPolicy, decideJobSourcePolicy } from '../shared/job-source-policy'
import { researchStateSchema, type ResearchState } from '../shared/job-research-ipc'
import { fetchDirectJobResearch, type JobResearchFetchOptions } from './job-research-fetch'

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
type Session = { state: ResearchState; controller: AbortController; expiresAt: number; generation: number; reviewed?: ReviewedJobResearch; timer?: ReturnType<typeof setTimeout> }
export type ResearchSessionOptions = {
  direct?: (url: string, options: JobResearchFetchOptions) => Promise<JobResearchRun>
  now?: () => number
}

/** Volatile, app-issued research; no SQLite, backup, cache, or saved-job API is reachable here. */
export function createJobResearchSessions(options: ResearchSessionOptions) {
  const sessions = new Map<string, Session>()
  const clock = options.now ?? Date.now
  const direct = options.direct ?? fetchDirectJobResearch
  function cancelEntry(token: string): void {
    const session = sessions.get(token)
    if (!session) return
    session.generation++
    if (session.timer) clearTimeout(session.timer)
    session.controller.abort()
    sessions.delete(token)
  }
  function retain(token: string, session: Session): void {
    sessions.set(token, session)
    session.timer = setTimeout(() => cancelEntry(token), Math.max(0, session.expiresAt - clock()))
    session.timer.unref?.()
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
    const policy = decideJobSourcePolicy(input.selected.canonicalUrl)
    if (policy.status === 'paused') throw new Error(policy.reason)
    const run = jobResearchRunSchema.parse(input)
    const runPolicy = decideJobResearchPolicy(run)
    if (runPolicy.status === 'paused') throw new Error(runPolicy.reason)
    assertCanAcceptInitialDirectRun()
    makeRoom()
    const expiresAt = Math.min(clock() + EXPIRY_MS, Date.parse(run.startedAt) + EXPIRY_MS)
    if (expiresAt <= clock()) throw new Error(missing)
    const token = randomUUID()
    retain(token, { state: safeState({ status: 'ready', run: freeze(clone(run)) }), controller: new AbortController(), generation: 0, expiresAt })
    return { token }
  }
  function startJobResearch(input: string): { token: string } {
    const policy = decideJobSourcePolicy(input)
    if (policy.status === 'paused') throw new Error(policy.reason)
    const selected = normalizeJobResearchUrl(input)
    makeRoom()
    const token = randomUUID()
    const session: Session = { state: { status: 'loading' }, controller: new AbortController(), generation: 0, expiresAt: clock() + EXPIRY_MS }
    retain(token, session)
    const generation = session.generation
    void direct(selected.canonicalUrl, { signal: session.controller.signal }).then(inputRun => {
      if (!live(token, session, generation)) return
      try {
        const run = jobResearchRunSchema.parse(inputRun)
        const returned = run.selected
        if (returned.canonicalUrl !== selected.canonicalUrl || returned.provider !== selected.provider || returned.host !== selected.host || returned.roleId !== selected.roleId) {
          session.state = safeState({ status: 'unavailable', message: 'The public read did not confirm the selected role identity. No source content was accepted; verify the original link or paste the posting.', settingsAction: false })
          return
        }
        const policy = decideJobResearchPolicy(run)
        if (policy.status === 'paused') {
          session.state = safeState({ status: 'unavailable', message: policy.reason, settingsAction: false })
          return
        }
        session.state = safeState({ status: 'ready', run: freeze(run) })
      } catch {
        session.state = safeState({ status: 'unavailable', message: 'The public read failed. No source content was accepted; try the original link or paste a posting.', settingsAction: false })
      }
    }, () => {
      if (live(token, session, generation)) session.state = safeState({ status: 'unavailable', message: 'The public read failed. No source content was accepted; try the original link or paste a posting.', settingsAction: false })
    })
    return { token }
  }
  function getJobResearch(token: string): ResearchState { return safeState(clone(get(token).state)) }
  async function searchJobResearch(token: string): Promise<ResearchState> {
    get(token) // validate app-issued token, but never inspect credentials or dispatch a provider request
    return safeState({ status: 'unavailable', message: 'Indexed search is unavailable. Use manual paste to provide the job posting; no search request was sent.', settingsAction: false, searchOutcome: 'not-sent' })
  }
  function reviewJobResearch(token: string, acceptedFindingIds: string[], acknowledgedPartial: boolean): ReviewedJobResearch {
    const session = get(token)
    if (session.state.status !== 'ready') throw new Error('No available research run to review.')
    const policy = decideJobResearchPolicy(session.state.run)
    if (policy.status === 'paused') throw new Error(policy.reason)
    const review = promoteJobResearch(session.state.run, acceptedFindingIds, acknowledgedPartial)
    session.reviewed = freeze(verifyReviewedJobResearch(session.state.run, review))
    return clone(session.reviewed)
  }
  function verifyAppHeldReview(token: string, review: unknown): ReviewedJobResearch {
    const session = get(token)
    if (session.state.status !== 'ready' || !session.reviewed) throw new Error('No reviewed app-held research is available.')
    const policy = decideJobResearchPolicy(session.state.run)
    if (policy.status === 'paused') throw new Error(policy.reason)
    const checked = verifyReviewedJobResearch(session.state.run, review)
    if (checked.evidenceHash !== session.reviewed.evidenceHash) throw new Error('Research review has changed. Review the current run again.')
    return checked
  }
  function getReviewedRunById(runId: string): { run: JobResearchRun; review: ReviewedJobResearch } {
    prune()
    for (const session of sessions.values()) {
      if (session.state.status !== 'ready' || session.state.run.id !== runId || !session.reviewed || session.controller.signal.aborted) continue
      const policy = decideJobResearchPolicy(session.state.run)
      if (policy.status === 'paused') throw new Error(policy.reason)
      const review = verifyReviewedJobResearch(session.state.run, session.reviewed)
      return { run: clone(session.state.run), review: clone(review) }
    }
    throw new Error('No current app-held reviewed research is available. Review the public read again.')
  }
  function getReviewedRun(token: string): { run: JobResearchRun; review: ReviewedJobResearch } {
    const session = get(token)
    if (session.state.status !== 'ready' || !session.reviewed || session.controller.signal.aborted) throw new Error('Review the public read before preparing outgoing analysis.')
    const policy = decideJobResearchPolicy(session.state.run)
    if (policy.status === 'paused') throw new Error(policy.reason)
    return getReviewedRunById(session.state.run.id)
  }
  return { startJobResearch, assertCanAcceptInitialDirectRun, acceptInitialDirectRun, getJobResearch, searchJobResearch, reviewJobResearch, verifyAppHeldReview, getReviewedRun, getReviewedRunById,
    cancelJobResearch(token: string): { ok: boolean } { const found = sessions.has(token); cancelEntry(token); return { ok: found } },
    close(): void { for (const token of sessions.keys()) cancelEntry(token) } }
}
