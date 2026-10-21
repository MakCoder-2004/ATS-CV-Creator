import type { PostingAnalysis } from '../shared/posting-analysis'
import type { DraftRevision } from '../shared/draft'
import { type QualificationAssessment, type QualificationAssessmentEvidence } from '../shared/qualification-coverage'

const aliases: Record<string, string[]> = { javascript: ['js'], typescript: ['ts'], 'continuous integration': ['ci/cd'] }
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const contains = (text: string, term: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(term)}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(text)
const sections = ['education', 'experience', 'projects', 'skills', 'certificates'] as const

type ConceptGroup = { label: string; alternatives: string[] }
const degreeAliases = ['bachelor', 'bachelor’s', "bachelor's", 'bs', 'b.s.']
const fieldAliases = {
  'computer science': ['computer science', 'cs'],
  'data science': ['data science'],
} as const
const concepts: Array<{ label: string; pattern: RegExp }> = [
  { label: 'machine learning', pattern: /\bmachine[ -]learning\b|\bml\b/iu },
  { label: 'large language models', pattern: /\blarge language models?\b|\bllms?\b/iu },
  { label: 'retrieval-augmented generation', pattern: /\bretrieval[ -]augmented generation\b|\brag\b/iu },
  { label: 'production', pattern: /\bproduction\b/iu },
  { label: 'deployment', pattern: /\bdeploy(?:ed|ment)?\b/iu },
]
const neutralWords = new Set(['a', 'an', 'and', 'or', 'the', 'in', 'of', 'with', 'related', 'field', 'experience', 'experienced', 'knowledge', 'skill', 'skills', 'proficiency', 'proficient', 'background', 'working', 'familiarity', 'familiar', 'ability', 'to', 'years', 'year', 'plus', 'model', 'models'])
const normalizedWords = (text: string) => text.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []
function snapshotText(snapshot: unknown): string {
  if (typeof snapshot === 'string') return snapshot
  if (Array.isArray(snapshot)) return snapshot.map(snapshotText).join(' ')
  if (!snapshot || typeof snapshot !== 'object') return ''
  return Object.entries(snapshot).filter(([key]) => !/^(id|revision|createdAt|updatedAt)$/i.test(key)).map(([, value]) => snapshotText(value)).join(' ')
}
function requirementGroups(qualification: string): { groups: ConceptGroup[]; unknown: string[] } {
  const groups: ConceptGroup[] = []
  const text = qualification.toLocaleLowerCase()
  if (/\bdegree\b|\bbachelor'?s?\b|\bb\.?s\.?\b/iu.test(text)) groups.push({ label: 'bachelor degree', alternatives: degreeAliases })
  const fields = Object.entries(fieldAliases).filter(([, aliases]) => aliases.some(alias => contains(text, alias))).map(([label]) => label)
  if (fields.length) groups.push({ label: fields.join(' or '), alternatives: fields.flatMap(field => fieldAliases[field as keyof typeof fieldAliases]) })
  for (const concept of concepts) if (concept.pattern.test(qualification)) groups.push({ label: concept.label, alternatives: [concept.label, ...(concept.label === 'machine learning' ? ['ml'] : concept.label === 'large language models' ? ['llm', 'llms', 'large language model'] : concept.label === 'retrieval-augmented generation' ? ['rag', 'retrieval augmented generation'] : concept.label === 'deployment' ? ['deploy', 'deployed', 'deployment'] : [])] })
  const recognized = new Set(groups.flatMap(group => group.label.toLocaleLowerCase().split(/\s+or\s+/)).flatMap(label => normalizedWords(label)))
  const fieldTokens = new Set<string>(Object.values(fieldAliases).flatMap(aliases => aliases.flatMap(normalizedWords)))
  const degreeTokens = new Set<string>(degreeAliases.flatMap(normalizedWords))
  const originalTokens = qualification.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []
  const originalByNormalized = new Map<string, string>(originalTokens.map(token => [token.toLocaleLowerCase(), token]))
  const unknown: string[] = []
  for (const word of normalizedWords(qualification)) if (!neutralWords.has(word) && !recognized.has(word) && !degreeTokens.has(word) && !fieldTokens.has(word)) {
    const display = originalByNormalized.get(word) ?? word
    if (!unknown.includes(display)) unknown.push(display)
  }
  return { groups, unknown }
}
function sourceMatchesGroup(text: string, group: ConceptGroup): boolean {
  return group.alternatives.some(alias => contains(text, alias))
}
function assessQualifications(analysis: PostingAnalysis, draft: DraftRevision, fullProfileEvidence?: QualificationAssessmentEvidence[]): QualificationAssessment[] {
  const all = new Map<string, QualificationAssessmentEvidence>()
  for (const source of [...draft.evidence.map(item => ({ evidenceId: item.evidenceId, revision: item.revision, snapshot: item.snapshot })), ...(fullProfileEvidence ?? [])]) all.set(`${source.evidenceId}:${source.revision}`, source)
  const cited = new Set(Object.values(draft.content).flatMap(items => items.flatMap(item => item.citations.map(citation => `${citation.evidenceId}:${citation.revision}`))))
  return ([['required', analysis.required], ['preferred', analysis.preferred]] as const).flatMap(([kind, qualifications]) => qualifications.map(qualification => {
    const { groups, unknown } = requirementGroups(qualification)
    const matched = new Set<string>()
    const evidence = new Map<string, { evidenceId: string; revision: number }>()
    for (const source of all.values()) {
      const text = snapshotText(source.snapshot)
      for (const group of groups) if (!matched.has(group.label) && sourceMatchesGroup(text, group)) {
        matched.add(group.label)
        evidence.set(`${source.evidenceId}:${source.revision}`, { evidenceId: source.evidenceId, revision: source.revision })
      }
    }
    const remainingGroups = groups.filter(group => !matched.has(group.label)).map(group => group.label)
    const matchedConcepts = [...matched]
    const remainingConcepts = [...remainingGroups, ...unknown]
    const complete = groups.length > 0 && remainingGroups.length === 0 && unknown.length === 0
    const status: QualificationAssessment['status'] = complete ? 'supported' : matched.size > 0 ? 'partial' : unknown.length > 0 || groups.length === 0 ? 'unknown' : 'not-evidenced'
    const supportingEvidence = [...evidence.values()]
    return { qualification, kind, status, matchedConcepts, remainingConcepts, evidence: supportingEvidence, inDraft: supportingEvidence.some(item => cited.has(`${item.evidenceId}:${item.revision}`)) }
  }))
}

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
      for (const section of sections) draft.content[section].forEach((item, index) => {
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

export function qualificationCoverage(analysisId: string, analysis: PostingAnalysis, draft: DraftRevision, fullProfileEvidence?: QualificationAssessmentEvidence[]): { analysisId: string; label: 'Evidence-supported relevance heuristic — not a universal ATS score or hiring guarantee.'; repairAttempts: number; factualChecksRerun: boolean; supportedMatches: Array<{ qualification: string; kind: 'required' | 'preferred'; evidence: string[]; matchedAs: string }>; gaps: Array<{ qualification: string; kind: 'required' | 'preferred' }>; assessments?: QualificationAssessment[] } {
  const supportedMatches: Array<{ qualification: string; kind: 'required' | 'preferred'; evidence: string[]; matchedAs: string }> = []
  const gaps: Array<{ qualification: string; kind: 'required' | 'preferred' }> = []
  for (const item of coverage(analysis, draft)) item.matchedAs ? supportedMatches.push({ qualification: item.qualification, kind: item.kind, evidence: item.evidence, matchedAs: item.matchedAs }) : gaps.push({ qualification: item.qualification, kind: item.kind })
  return { analysisId, label: 'Evidence-supported relevance heuristic — not a universal ATS score or hiring guarantee.' as const, repairAttempts: 0, factualChecksRerun: true, supportedMatches, gaps, ...(fullProfileEvidence === undefined ? {} : { assessments: assessQualifications(analysis, draft, fullProfileEvidence) }) }
}
