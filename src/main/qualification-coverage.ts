import type { PostingAnalysis } from '../shared/posting-analysis'
import type { DraftRevision } from '../shared/draft'

const aliases: Record<string, string[]> = { javascript: ['js'], typescript: ['ts'], 'continuous integration': ['ci/cd'] }
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const contains = (text: string, term: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(term)}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(text)

/** Match only when the same wording is present in a saved source and the resulting draft. */
export function supportedCoverageTerms(analysis: PostingAnalysis, draft: DraftRevision) {
  const sources = draft.evidence.map(item => ({ id: item.evidenceId, text: JSON.stringify(item.snapshot) }))
  const output = JSON.stringify(draft.content)
  const terms: Array<{ qualification: string; kind: 'required' | 'preferred'; matchedAs: string; evidence: string[] }> = []
  for (const [kind, qualifications] of [['required', analysis.required], ['preferred', analysis.preferred]] as const) for (const qualification of qualifications) {
    const candidates = [qualification, ...(aliases[qualification.toLowerCase()] ?? [])]
    const match = candidates.map(term => ({ term, evidence: sources.filter(source => contains(source.text, term)) })).find(candidate => candidate.evidence.length)
    if (match && !contains(output, match.term)) terms.push({ qualification, kind, matchedAs: match.term, evidence: match.evidence.map(source => source.id) })
  }
  return terms
}

export function qualificationCoverage(analysisId: string, analysis: PostingAnalysis, draft: DraftRevision) {
  const sources = draft.evidence.map(item => ({ id: item.evidenceId, text: JSON.stringify(item.snapshot) }))
  const output = JSON.stringify(draft.content)
  const supportedMatches: Array<{ qualification: string; kind: 'required' | 'preferred'; evidence: string[]; matchedAs: string }> = []
  const gaps: Array<{ qualification: string; kind: 'required' | 'preferred' }> = []
  for (const [kind, terms] of [['required', analysis.required], ['preferred', analysis.preferred]] as const) for (const qualification of terms) {
    const candidates = [qualification, ...(aliases[qualification.toLowerCase()] ?? [])]
    const match = candidates.map(term => ({ term, evidence: sources.filter(source => contains(source.text, term) && contains(output, term)) })).find(candidate => candidate.evidence.length)
    if (match) supportedMatches.push({ qualification, kind, evidence: match.evidence.map(source => source.id), matchedAs: match.term })
    else gaps.push({ qualification, kind })
  }
  return { analysisId, label: 'Evidence-supported relevance heuristic — not a universal ATS score or hiring guarantee.' as const, repairAttempts: 0, factualChecksRerun: true, supportedMatches, gaps }
}
