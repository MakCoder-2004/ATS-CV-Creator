import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { jobResearchRunSchema, jobResearchReferenceSchema, reviewedJobResearchSchema, type ReviewedJobResearch } from './job-research-schema'

export * from './job-research-schema'
export { normalizeJobResearchUrl } from './job-research-url'

/** App-issued source and finding IDs are checked against the immutable run, not client-supplied passages. */
export function promoteJobResearch(runInput: unknown, acceptedFindingIds: string[], acknowledgedPartial: boolean): ReviewedJobResearch {
  const run = jobResearchRunSchema.parse(runInput)
  if (run.status === 'blocked' || run.status === 'none' || !acceptedFindingIds.length || new Set(acceptedFindingIds).size !== acceptedFindingIds.length) throw new Error('No distinct reviewed role findings were selected.')
  const accepted = acceptedFindingIds.map(id => {
    const finding = run.findings.find(item => item.id === id)
    if (!finding || finding.kind === 'verified-company-context') throw new Error('Only app-issued role findings can be accepted.')
    return finding
  })
  const full = accepted.some(item => item.kind === 'direct-role-text' && item.completeness === 'full')
  if (!full && !acknowledgedPartial) throw new Error('Acknowledge incomplete role evidence before provisional analysis.')
  const scope = full ? 'full' : 'provisional'
  const evidence = accepted.map(finding => ({ finding, source: run.sources.find(source => source.id === finding.sourceId) })).sort((a, b) => a.finding.id.localeCompare(b.finding.id))
  const references = accepted.map(finding => {
    const source = run.sources.find(item => item.id === finding.sourceId)!
    return jobResearchReferenceSchema.parse({ version: 1, sourceId: source.id, findingId: finding.id, url: source.url, capturedAt: source.capturedAt, identity: 'exact-role', completeness: finding.completeness })
  })
  return reviewedJobResearchSchema.parse({ version: 1, runId: run.id, selected: run.selected, acceptedFindingIds: acceptedFindingIds.slice(), references, acknowledgedPartial, analysisScope: scope,
    evidenceHash: createHash('sha256').update(JSON.stringify({ version: 1, runId: run.id, selected: run.selected, scope, evidence, unknowns: run.unknowns })).digest('hex') })
}

/** A review is authenticated only against the immutable app-held run, never by its shape or hash alone. */
export function verifyReviewedJobResearch(runInput: unknown, reviewInput: unknown): ReviewedJobResearch {
  const review = reviewedJobResearchSchema.parse(reviewInput)
  const expected = promoteJobResearch(runInput, review.acceptedFindingIds, review.acknowledgedPartial)
  if (!isDeepStrictEqual(review, expected)) throw new Error('Reviewed evidence does not match the app-held research run.')
  return review
}
