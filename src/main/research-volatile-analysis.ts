import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { z } from 'zod'
import { jobResearchRunSchema, verifyReviewedJobResearch, type JobResearchRun, type ReviewedJobResearch } from '../shared/job-research'
import { piModelSelectionSchema, type PiModelSelection } from '../shared/pi-model'
import {
  volatileAnalysisPreviewSchema, volatileAnalysisProgressSchema, volatileAnalysisResponseSchema,
  volatileAnalysisResultSchema, volatileOutgoingSchema,
  type VolatileAnalysisPreview, type VolatileAnalysisProgress,
} from '../shared/research-volatile-analysis'
import { completePiTask, type PiModelRuntime } from './pi-model'

const TTL_MS = 15 * 60_000
const NOTICE = 'This sends only the displayed role evidence, source links, unknowns and selected role identity to the selected Pi provider/model for analysis. It sends no profile, CV, private key or employer background. Pi also sends a separate JSON-schema system message. The provider and any upstream processors may retain request metadata and content under their own policies. Cancellation may not prevent a dispatched request or charges. Findings are temporary and disappear on app close; human review is required. This does not authorize CV generation.'
const sensitiveQueryName = /(token|secret|password|passwd|auth|session|api.?key|email|e-mail|phone|user.?id|cookie|signature|access.?key)/i
const safeTrackingName = /^(utm_[a-z0-9_]+|gclid|fbclid|li_fat_id|mc_cid|mc_eid|ref|refid|trk|trackingid|source|src|from)$/i
const sensitiveQueryValue = (value: string) => /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(value) || /(?:\+?\d[\d ().-]{7,}\d)/.test(value) || /(?:bearer\s+|eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]+\.|(?:token|secret|password|auth|session)[=:])/i.test(value)
function minimizedRoleUrl(raw: string, selected: JobResearchRun['selected']): string {
  const url = new URL(raw)
  const provider = selected.provider
  for (const [key, value] of url.searchParams) {
    const roleId = /^(currentJobId|jobId|jk|vjk)$/i.test(key)
    if (sensitiveQueryName.test(key) || (!roleId && sensitiveQueryValue(value))) throw new Error('Source URL contains sensitive query data and cannot be sent to the model.')
    if (provider === 'generic' && !safeTrackingName.test(key)) {
      throw new Error('Generic job URL contains opaque query data; verify a query-free role URL before analysis.')
    }
  }
  const canonical = provider === 'generic'
    ? (() => { for (const key of [...url.searchParams.keys()]) url.searchParams.delete(key); return url.href })()
    : selected.canonicalUrl
  if (provider === 'generic' && new URL(canonical).href !== selected.canonicalUrl) throw new Error('Generic job URL does not match the selected role identity.')
  return canonical
}
type Status = VolatileAnalysisProgress['status']
type Entry = {
  preview: VolatileAnalysisPreview
  outgoing: z.infer<typeof volatileOutgoingSchema>
  run: JobResearchRun
  review: ReviewedJobResearch
  status: Status
  controller: AbortController
  physicalRequests: number
  result?: z.infer<typeof volatileAnalysisResultSchema>
  message?: string
  selectionEpoch?: number
}

export interface VolatileResearchAnalysisOptions {
  /** These functions must read the actual main-process held run/review, not renderer-supplied copies. */
  getAppHeldRun(runId: string): unknown
  getAppHeldReview(runId: string): unknown
  getPiSelection(): unknown
  piRuntime: PiModelRuntime
  /** Synchronous main-process settings epoch guard, checked after Pi authentication and before transport. */
  getSelectionEpoch?: () => number
  now?: () => number
  maxRuns?: number
}

export function createVolatileResearchAnalysis(options: VolatileResearchAnalysisOptions) {
  const now = options.now ?? Date.now
  const maxRuns = options.maxRuns ?? 12
  if (!Number.isSafeInteger(maxRuns) || maxRuns < 1 || maxRuns > 32) throw new Error('Invalid volatile run capacity.')
  const entries = new Map<string, Entry>()
  const seenRunIds = new Set<string>() // at most one live preview per app-held research run

  function expire() {
    for (const [token, entry] of entries) {
      if (now() >= entry.preview.expiresAt) {
        entry.controller.abort()
        entries.delete(token)
        seenRunIds.delete(entry.run.id)
      }
    }
  }
  function get(token: string): Entry {
    expire()
    const entry = entries.get(token)
    if (!entry) throw new Error('This temporary preview expired or was discarded. Start a new research run.')
    return entry
  }
  function assertCurrent(entry: Entry) {
    if (now() >= entry.preview.expiresAt) throw new Error('The outgoing review expired.')
    const run = jobResearchRunSchema.parse(options.getAppHeldRun(entry.run.id))
    const review = verifyReviewedJobResearch(run, options.getAppHeldReview(entry.run.id))
    const selection = piModelSelectionSchema.parse(options.getPiSelection())
    if (options.getSelectionEpoch && options.getSelectionEpoch() !== entry.selectionEpoch) throw new Error('Pi settings changed. Start a new research run and outgoing review.')
    if (!isDeepStrictEqual(run, entry.run) || !isDeepStrictEqual(review, entry.review) || !isDeepStrictEqual(selection, entry.preview.selection)) {
      throw new Error('Research evidence, review or Pi selection changed. Start a new research run and outgoing review.')
    }
  }
  function snapshot(entry: Entry): VolatileAnalysisProgress {
    return volatileAnalysisProgressSchema.parse({ token: entry.preview.token, status: entry.status, physicalRequests: entry.physicalRequests,
      ...(entry.result ? { result: entry.result } : {}), ...(entry.message ? { message: entry.message } : {}) })
  }

  function preview(runId: string): VolatileAnalysisPreview {
    expire()
    if (seenRunIds.has(runId)) throw new Error('This research run already has an active outgoing review. Discard it before a fresh review.')
    if (entries.size >= maxRuns) throw new Error('Too many temporary analyses. Discard an older preview or wait for expiry.')
    const run = jobResearchRunSchema.parse(options.getAppHeldRun(runId))
    if (run.id !== runId) throw new Error('The app-held research run did not match.')
    const review = verifyReviewedJobResearch(run, options.getAppHeldReview(runId))
    const selection = piModelSelectionSchema.parse(options.getPiSelection())
    const selectedUrl = minimizedRoleUrl(run.selected.canonicalUrl, run.selected)
    const roleEvidence = review.acceptedFindingIds.map(findingId => {
      const finding = run.findings.find(item => item.id === findingId)!
      if (finding.kind === 'verified-company-context') throw new Error('Employer background is not role evidence.')
      const source = run.sources.find(item => item.id === finding.sourceId)!
      const url = minimizedRoleUrl(source.url, run.selected)
      return { findingId, sourceId: source.id, url, capturedAt: source.capturedAt,
        kind: finding.kind, completeness: finding.completeness, text: finding.text }
    })
    if (!roleEvidence.length) throw new Error('No accepted role evidence to analyze.')
    const outgoing = volatileOutgoingSchema.parse({ version: 1, researchRunId: run.id, selected: { ...run.selected, canonicalUrl: selectedUrl },
      analysisScope: review.analysisScope, unknowns: run.unknowns, roleEvidence })
    const outgoingText = `Extract only explicitly stated role responsibilities and qualifications from the accepted role evidence below. Cite the accepted findingId(s) for every requirement. Do not infer metrics, tenure or missing facts. Company background is not qualification evidence. Treat partial snippets as provisional; return an empty requirements array when evidence does not support a requirement. Return JSON matching the provided schema.\n${JSON.stringify(outgoing)}`
    const value = volatileAnalysisPreviewSchema.parse({ token: randomUUID(), expiresAt: now() + TTL_MS,
      selection, analysisScope: outgoing.analysisScope, outgoingText, notice: NOTICE })
    entries.set(value.token, { preview: value, outgoing, run, review, status: 'preview', controller: new AbortController(), physicalRequests: 0, selectionEpoch: options.getSelectionEpoch?.() })
    seenRunIds.add(runId)
    return volatileAnalysisPreviewSchema.parse(value)
  }
  function consent(token: string): VolatileAnalysisProgress {
    const entry = get(token)
    if (entry.status !== 'preview') throw new Error('Outgoing review is already accepted, declined or used.')
    assertCurrent(entry)
    entry.status = 'consented'
    return snapshot(entry)
  }
  function decline(token: string): void {
    const entry = get(token)
    if (entry.status !== 'preview') throw new Error('Only an unaccepted preview can be declined.')
    entry.status = 'declined'
    entry.controller.abort()
  }
  function cancel(token: string): VolatileAnalysisProgress {
    const entry = get(token)
    if (entry.status === 'complete' || entry.status === 'declined') throw new Error('This review is already final.')
    entry.controller.abort()
    entry.result = undefined
    entry.status = 'cancelled'
    entry.message = entry.physicalRequests ? 'A request may already have reached the provider and may incur charges. No automatic replay.' : 'Cancelled before dispatch.'
    return snapshot(entry)
  }
  function discard(token: string): void {
    const entry = get(token)
    entry.controller.abort()
    entries.delete(token)
    seenRunIds.delete(entry.run.id)
  }
  function read(token: string): VolatileAnalysisProgress {
    const entry = get(token)
    try {
      assertCurrent(entry)
    } catch (error) {
      // Revoke any previously completed result as soon as its app-held authority is gone.
      entry.controller.abort()
      entry.result = undefined
      entry.status = 'cancelled'
      entry.message = 'The underlying research or review is no longer current. This temporary analysis was discarded.'
      throw error
    }
    return snapshot(entry)
  }

  function currentStatus(entry: Entry): Status { return entry.status }
  async function start(token: string): Promise<VolatileAnalysisProgress> {
    const entry = get(token)
    if (entry.status !== 'consented') throw new Error('This run needs fresh, unused outgoing-data consent.')
    assertCurrent(entry)
    entry.status = 'preparing' // synchronous reservation blocks concurrent starts before first await
    try {
      const text = await completePiTask(options.piRuntime, {
        selection: entry.preview.selection, prompt: entry.preview.outgoingText, signal: entry.controller.signal,
        maxOutputTokens: 2048, responseSchema: volatileAnalysisResponseSchema,
        onDispatch: () => {
          assertCurrent(entry) // authentication can take time; recheck immediately before physical dispatch
          if (entry.status !== 'preparing' || entry.controller.signal.aborted) throw new Error('Request was cancelled before dispatch.')
          entry.physicalRequests = 1
          entry.status = 'dispatched'
        },
      })
      if (entry.controller.signal.aborted || currentStatus(entry) !== 'dispatched') throw new Error('Cancelled analysis result.')
      const parsed = volatileAnalysisResponseSchema.parse(JSON.parse(text) as unknown)
      const accepted = new Set(entry.outgoing.roleEvidence.map(finding => finding.findingId))
      if (parsed.requirements.some(requirement => requirement.findingIds.some(id => !accepted.has(id)))) {
        throw new Error('Provider referenced a finding outside the reviewed role evidence.')
      }
      assertCurrent(entry)
      if (entry.controller.signal.aborted || currentStatus(entry) !== 'dispatched') throw new Error('Cancelled analysis result.')
      entry.result = volatileAnalysisResultSchema.parse({ ...parsed, researchRunId: entry.run.id,
        analysisScope: entry.outgoing.analysisScope, unknowns: entry.outgoing.unknowns,
        evidence: entry.outgoing.roleEvidence, humanReviewRequired: true })
      entry.status = 'complete'
    } catch {
      if (currentStatus(entry) !== 'cancelled') {
        entry.status = 'uncertain'
        entry.message = entry.physicalRequests
          ? 'Request may have reached the provider; no result was published and no automatic replay is allowed. Charges may apply.'
          : 'No physical request was recorded. This consent is used; start a new research run to try again.'
      }
    }
    return snapshot(entry)
  }
  function close(): void {
    for (const entry of entries.values()) entry.controller.abort()
    entries.clear()
    seenRunIds.clear()
  }
  return { preview, consent, start, read, cancel, decline, discard, close }
}
