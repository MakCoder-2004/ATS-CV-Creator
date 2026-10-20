import type { PostingAnalysis } from '../shared/posting-analysis'
import type { DraftRevision } from '../shared/draft'

const aliases: Record<string, string[]> = { javascript: ['js'], typescript: ['ts'], 'continuous integration': ['ci/cd'] }
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const contains = (text: string, term: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(term)}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(text)

/** A match is grounded in the exact cited source revision of the CV item that visibly expresses it. */
function coverage(analysis: PostingAnalysis, draft: DraftRevision) {
  const sources = new Map(draft.evidence.map(item => [`${item.evidenceId}:${item.revision}`, item]))
  const results: Array<{ qualification: string; kind: 'required' | 'preferred'; matchedAs: string; evidence: string[]; opportunities: Array<{ section: keyof DraftRevision['content']; index: number; evidenceId: string; revision: number }> }> = []
  for (const [kind, qualifications] of [['required', analysis.required], ['preferred', analysis.preferred]] as const) for (const qualification of qualifications) {
    const candidates = [qualification, ...(aliases[qualification.toLowerCase()] ?? [])]
    let result: typeof results[number] | undefined
    for (const candidate of candidates) {
      const matches: typeof results[number]['opportunities'] = []
      const evidence = new Set<string>()
      for (const section of ['education', 'experience', 'projects', 'skills', 'certificates'] as const) draft.content[section].forEach((item, index) => {
        const authored = 'text' in item ? item.text : item.name
        if (!contains(authored, candidate)) return
        for (const citation of item.citations) {
          const source = sources.get(`${citation.evidenceId}:${citation.revision}`)
          if (source && contains(JSON.stringify(source.snapshot), candidate)) { evidence.add(citation.evidenceId); matches.push({ section, index, ...citation }) }
        }
      })
      if (evidence.size) { result = { qualification, kind, matchedAs: candidate, evidence: [...evidence], opportunities: matches }; break }
    }
    results.push(result ?? { qualification, kind, matchedAs: '', evidence: [], opportunities: [] })
  }
  return results
}

export function supportedCoverageTerms(analysis: PostingAnalysis, draft: DraftRevision) {
  return coverage(analysis, draft).filter(item => !item.matchedAs).flatMap(item => {
    const candidates = [item.qualification, ...(aliases[item.qualification.toLowerCase()] ?? [])]
    const evidence = draft.evidence.filter(source => candidates.some(term => contains(JSON.stringify(source.snapshot), term))).map(source => source.evidenceId)
    if (!evidence.length) return []
    const eligible: Array<{ section: keyof DraftRevision['content']; index: number; evidenceId: string; revision: number }> = []
    const sections = ['education', 'experience', 'projects', 'skills', 'certificates'] as const
    for (const section of sections) draft.content[section].forEach((entry, index) => {
      const authored = 'text' in entry ? entry.text : entry.name
      for (const citation of entry.citations) {
        const citedSource = draft.evidence.find(source => source.evidenceId === citation.evidenceId && source.revision === citation.revision)
        if (citedSource && evidence.includes(citation.evidenceId) && candidates.some(term => contains(JSON.stringify(citedSource.snapshot), term)) && !candidates.some(term => contains(authored, term))) eligible.push({ section, index, ...citation })
      }
    })
    return eligible.length ? [{ qualification: item.qualification, kind: item.kind, matchedAs: candidates.find(term => evidence.some(id => contains(JSON.stringify(draft.evidence.find(source => source.evidenceId === id)?.snapshot ?? ''), term)))!, evidence, eligible }] : []
  })
}

export function qualificationCoverage(analysisId: string, analysis: PostingAnalysis, draft: DraftRevision) {
  const supportedMatches: Array<{ qualification: string; kind: 'required' | 'preferred'; evidence: string[]; matchedAs: string }> = []
  const gaps: Array<{ qualification: string; kind: 'required' | 'preferred' }> = []
  for (const item of coverage(analysis, draft)) item.matchedAs ? supportedMatches.push({ qualification: item.qualification, kind: item.kind, evidence: item.evidence, matchedAs: item.matchedAs }) : gaps.push({ qualification: item.qualification, kind: item.kind })
  return { analysisId, label: 'Evidence-supported relevance heuristic — not a universal ATS score or hiring guarantee.' as const, repairAttempts: 0, factualChecksRerun: true, supportedMatches, gaps }
}
