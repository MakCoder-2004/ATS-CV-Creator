import type { PostingAnalysis } from '../shared/posting-analysis'
import type { DraftRevision } from '../shared/draft'
import { type QualificationAssessment, type QualificationAssessmentEvidence } from '../shared/qualification-coverage'

const aliases: Record<string, string[]> = { javascript: ['js'], typescript: ['ts'], 'continuous integration': ['ci/cd'] }
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const contains = (text: string, term: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(term)}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(text)
const sections = ['education', 'experience', 'projects', 'skills', 'certificates'] as const

type ConceptGroup = { label: string; alternatives: string[]; degreeFields?: boolean; allFields?: string[][] }
const degreePattern = /\b(?:bachelor(?:['’]s)?|b\.?\s*s\.?c?)\b/iu
const degreeAliases = ['bachelor', 'bachelor’s', "bachelor's", 'bs', 'b.s', 'bsc', 'b.sc', 'bachelor of science']
const fieldAliases = {
  'computer science': ['computer science', 'cs'],
  engineering: ['engineering'],
  'artificial intelligence': ['artificial intelligence', 'ai'],
  'data science': ['data science'],
} as const
const conceptAliases: Record<string, string[]> = {
  'machine learning': ['ml', 'machine-learning', 'scikit-learn', 'sklearn'],
  APIs: ['API', 'APIs', 'REST API', 'RESTful APIs', 'FastAPI', 'application programming interface'],
  databases: ['database', 'databases', 'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'SQLite'],
  'data processing pipelines': ['data processing pipeline', 'data processing pipelines', 'data pipelines', 'ETL'],
  'software integration': ['software integration', 'system integration', 'systems integration', 'integrated APIs'],
  'generative AI': ['generative AI', 'GenAI'],
  'prompt engineering': ['prompt engineering'],
}
const concepts: Array<{ label: string; pattern: RegExp }> = [
  { label: 'APIs', pattern: /\bapis?\b|\bapplication programming interfaces?\b/iu },
  { label: 'databases', pattern: /\bdatabases?\b/iu },
  { label: 'data processing pipelines', pattern: /\bdata(?: processing)? pipelines?\b/iu },
  { label: 'software integration', pattern: /\b(?:software|systems?) integration\b/iu },
  { label: 'generative AI', pattern: /\bgenerative ai\b|\bgenai\b/iu },
  { label: 'prompt engineering', pattern: /\bprompt engineering\b/iu },
  { label: 'machine learning', pattern: /\bmachine[ -]learning\b|\bml\b/iu },
  { label: 'large language models', pattern: /\blarge language models?\b|\bllms?\b/iu },
  { label: 'retrieval-augmented generation', pattern: /\bretrieval[ -]augmented generation\b|\brag\b/iu },
  { label: 'production', pattern: /\bproduction\b/iu },
  { label: 'deployment', pattern: /\bdeploy(?:ed|ment)?\b/iu },
]
const neutralWords = new Set(['a', 'an', 'and', 'or', 'the', 'in', 'of', 'with', 'related', 'field', 'degree', 'experience', 'experienced', 'knowledge', 'skill', 'skills', 'proficiency', 'proficient', 'background', 'working', 'familiarity', 'familiar', 'ability', 'to', 'years', 'year', 'plus', 'model', 'models'])
const normalizedWords = (text: string) => text.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []
function snapshotText(snapshot: unknown): string {
  if (typeof snapshot === 'string') return snapshot
  if (Array.isArray(snapshot)) return snapshot.map(snapshotText).join(' ')
  if (!snapshot || typeof snapshot !== 'object') return ''
  return Object.entries(snapshot).filter(([key]) => !/^(id|revision|createdAt|updatedAt)$/i.test(key)).map(([, value]) => snapshotText(value)).join(' ')
}
function requirementGroups(qualification: string, namedSkills: string[]): { groups: ConceptGroup[]; unknown: string[] } {
  const groups: ConceptGroup[] = []
  const text = qualification.toLocaleLowerCase()
  const requiresDegree = /\bdegree\b/iu.test(text) || degreePattern.test(text)
  const fields = Object.entries(fieldAliases).filter(([, aliases]) => aliases.some(alias => contains(text, alias))).map(([label]) => label)
  if (requiresDegree && fields.length) groups.push({ label: `bachelor degree in one of: ${fields.join(', ')}`, alternatives: fields.flatMap(field => fieldAliases[field as keyof typeof fieldAliases]), degreeFields: true, ...(/\band\b/iu.test(text) && !/\bor\b/iu.test(text) ? { allFields: fields.map(field => [...fieldAliases[field as keyof typeof fieldAliases]]) } : {}) })
  else if (requiresDegree) groups.push({ label: 'bachelor degree', alternatives: degreeAliases })
  else if (fields.length) groups.push({ label: fields.join(' or '), alternatives: fields.flatMap(field => fieldAliases[field as keyof typeof fieldAliases]) })
  for (const concept of concepts) if (concept.pattern.test(qualification)) groups.push({ label: concept.label, alternatives: [concept.label, ...(conceptAliases[concept.label] ?? []), ...(concept.label === 'machine learning' ? [] : concept.label === 'large language models' ? ['llm', 'llms', 'large language model'] : concept.label === 'retrieval-augmented generation' ? ['rag', 'retrieval augmented generation'] : concept.label === 'deployment' ? ['deploy', 'deployed', 'deployment'] : [])] })
  for (const [term, alternatives] of Object.entries(aliases)) if (contains(qualification, term) || alternatives.some(alias => contains(qualification, alias))) groups.push({ label: term, alternatives: [term, ...alternatives] })
  for (const skill of namedSkills) if (contains(qualification, skill) && !groups.some(group => group.alternatives.some(alias => alias.toLocaleLowerCase() === skill.toLocaleLowerCase()))) groups.push({ label: skill, alternatives: [skill] })
  const recognized = new Set(groups.flatMap(group => [group.label, ...group.alternatives]).flatMap(normalizedWords))
  const fieldTokens = new Set<string>(Object.values(fieldAliases).flatMap(aliases => aliases.flatMap(normalizedWords)))
  const degreeTokens = new Set<string>(degreeAliases.flatMap(normalizedWords))
  const tenure = unverifiedTenure(qualification)
  const tenureWords = new Set(tenure ? normalizedWords(tenure) : [])
  const originalTokens = qualification.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []
  const originalByNormalized = new Map<string, string>(originalTokens.map(token => [token.toLocaleLowerCase(), token]))
  const unknown: string[] = []
  for (const word of normalizedWords(qualification)) if (!neutralWords.has(word) && !recognized.has(word) && !degreeTokens.has(word) && !fieldTokens.has(word) && !tenureWords.has(word)) {
    const display = originalByNormalized.get(word) ?? word
    if (!unknown.includes(display)) unknown.push(display)
  }
  return { groups, unknown }
}
function isEducation(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false
  const record = snapshot as Record<string, unknown>
  return record.section === 'education' || typeof record.field === 'string' || typeof record.institution === 'string'
}
function isFutureDate(value: unknown, isEnd: boolean): boolean {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})(?:-(\d{2}))?$/.exec(value)
  if (!match) return false
  const year = Number(match[1]), month = match[2] ? Number(match[2]) : isEnd ? 12 : 1
  const day = isEnd ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 1
  return Date.UTC(year, month - 1, day) > Date.now()
}
function positiveContains(text: string, term: string): boolean {
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(term)}(?=$|[^\\p{L}\\p{N}])`, 'giu')
  return [...text.matchAll(pattern)].some(match => {
    const preceding = text.slice(Math.max(0, match.index! - 100), match.index).split(/[.!?;\n]/).pop() ?? ''
    return !/\b(?:no|not|without|never|lack|lacking)\b(?:\s+[\p{L}-]+){0,5}\s*$/iu.test(preceding)
  })
}
function sourceMatchesGroup(text: string, group: ConceptGroup, snapshot: unknown): boolean {
  if (group.degreeFields || group.label === 'bachelor degree') {
    if (!isEducation(snapshot)) return false
    const record = snapshot as Record<string, unknown>
    const metadata = [record.title, record.field].filter(value => typeof value === 'string').join(' ')
    if (!degreeAliases.some(alias => positiveContains(metadata, alias))) return false
    if (!group.degreeFields) return true
    return group.allFields ? group.allFields.every(aliases => aliases.some(alias => positiveContains(metadata, alias))) : group.alternatives.some(alias => positiveContains(metadata, alias))
  }
  return group.alternatives.some(alias => positiveContains(text, alias))
}
function hasFutureEducationDate(snapshot: unknown): boolean {
  if (!isEducation(snapshot)) return false
  const record = snapshot as Record<string, unknown>
  return isFutureDate(record.startDate, false) || isFutureDate(record.endDate, true)
}
function unverifiedTenure(qualification: string): string | undefined {
  const match = /\b(?:\d+\s*(?:-|–|to)\s*\d+|\d+\+?)\s+years?(?:\s+(?:of\s+)?experience)?\b/iu.exec(qualification)
  return match?.[0].replace(/\s+/g, ' ')
}
function assessQualifications(analysis: PostingAnalysis, draft: DraftRevision, fullProfileEvidence?: QualificationAssessmentEvidence[]): QualificationAssessment[] {
  const currentById = new Map<string, QualificationAssessmentEvidence>()
  for (const source of fullProfileEvidence ?? []) if (!currentById.has(source.evidenceId) || currentById.get(source.evidenceId)!.revision < source.revision) currentById.set(source.evidenceId, source)
  const cited = new Set(Object.values(draft.content).flatMap(items => items.flatMap(item => item.citations.map(citation => `${citation.evidenceId}:${citation.revision}`))))
  const fallbackById = new Map<string, QualificationAssessmentEvidence>()
  for (const item of draft.evidence) if (item.provenance === 'manual' && cited.has(`${item.evidenceId}:${item.revision}`) && !currentById.has(item.evidenceId)) fallbackById.set(item.evidenceId, item)
  const all = new Map([...fallbackById, ...currentById].map(([id, source]) => [`${id}:${source.revision}`, source]))
  const orderedSources = [...all.values()].sort((a, b) => Number(hasFutureEducationDate(a.snapshot)) - Number(hasFutureEducationDate(b.snapshot)) || Number(cited.has(`${b.evidenceId}:${b.revision}`)) - Number(cited.has(`${a.evidenceId}:${a.revision}`)) || a.evidenceId.localeCompare(b.evidenceId))
  const namedSkills = orderedSources.flatMap(source => { const value = source.snapshot as Record<string, unknown> | null; return value && typeof value.name === 'string' && typeof value.category === 'string' ? [value.name] : [] }).sort((a, b) => a.localeCompare(b))
  return ([['required', analysis.required], ['preferred', analysis.preferred]] as const).flatMap(([kind, qualifications]) => qualifications.map(qualification => {
    const { groups, unknown } = requirementGroups(qualification, namedSkills)
    const matched = new Set<string>()
    const evidence = new Map<string, { evidenceId: string; revision: number }>()
    const incompleteEducation = new Set<string>()
    for (const source of orderedSources) {
      const text = snapshotText(source.snapshot)
      for (const group of groups) if (!matched.has(group.label) && sourceMatchesGroup(text, group, source.snapshot)) {
        matched.add(group.label)
        evidence.set(`${source.evidenceId}:${source.revision}`, { evidenceId: source.evidenceId, revision: source.revision })
        if (group.degreeFields && hasFutureEducationDate(source.snapshot)) incompleteEducation.add(group.label)
      }
    }
    const remainingGroups = groups.filter(group => !matched.has(group.label)).map(group => group.label)
    const tenure = unverifiedTenure(qualification)
    const deploymentContext = groups.filter(group => ['machine learning', 'large language models', 'retrieval-augmented generation', 'production', 'deployment'].includes(group.label))
    const needsSharedContext = deploymentContext.some(group => ['production', 'deployment'].includes(group.label)) && deploymentContext.some(group => !['production', 'deployment'].includes(group.label))
    const sharedContext = !needsSharedContext || [...all.values()].some(source => deploymentContext.every(group => sourceMatchesGroup(snapshotText(source.snapshot), group, source.snapshot)))
    const unresolved = [...unknown, ...(tenure ? [tenure] : []), ...(incompleteEducation.size ? ['degree completion'] : []), ...(!sharedContext ? ['production/deployment in the same technical context'] : [])]
    const matchedConcepts = [...matched]
    const remainingConcepts = [...remainingGroups, ...unresolved]
    const complete = groups.length > 0 && remainingGroups.length === 0 && unresolved.length === 0
    const status: QualificationAssessment['status'] = complete ? 'supported' : matched.size > 0 ? 'partial' : unresolved.length > 0 || groups.length === 0 ? 'unknown' : 'not-evidenced'
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
