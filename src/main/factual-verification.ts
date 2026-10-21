import { createHash } from 'node:crypto'
import { draftContentSchema, type DraftRevision } from '../shared/draft'
import { factualCheckReportSchema, type FactualFinding } from '../shared/factual-report'

const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}%$€£]+/gu, ' ').trim()
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}
// Compare the complete numeric expression (value, currency/unit, and nearby qualifier), not a value elsewhere.
function numericExpressions(text: string): string[] {
  const qualifier = '(?:(?:more\\s+than|less\\s+than|at\\s+least|up\\s+to|over|under|above|below|about|around|approximately|approx\\.?|nearly|almost|roughly)\\s+)?'
  const unit = '(?:%|percent(?:age)?|USD|EUR|GBP|CAD|AUD|dollars?|euros?|pounds?|yen|CNY|INR|currency|k|m|million|billion|thousand|hours?|days?|weeks?|months?|years?|users?|customers?|projects?|teams?|employees?|requests?|records?|items?|bytes?|MB|GB|TB|ms|seconds?|minutes?)'
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${qualifier}(?:[$€£]\\s*)?\\d+(?:[,.]\\d+)*(?:\\s*(?:%|${unit}\\b))?`, 'giu')
  return [...text.matchAll(pattern)].map(match => normalized(match[0]))
}

export function checkDraftFacts(draft: DraftRevision) {
  const findings: FactualFinding[] = []
  const parsed = draftContentSchema.safeParse(draft.content)
  if (!parsed.success) findings.push({ code: 'schema', itemPath: 'content', message: 'Draft content does not match the required five-section schema.', correction: 'Correct the malformed section or item and rerun factual checks.' })
  const evidence = new Map(draft.evidence.map(item => [item.evidenceId, item]))
  for (const suggestion of draft.suggestedSkills ?? []) if (suggestion.status === 'pending') findings.push({ code: 'unconfirmed-skill', itemPath: `suggestedSkills.${suggestion.id}`, message: `Skill “${suggestion.name}” must be confirmed or removed before approval.`, correction: 'Confirm this skill as your declaration or remove the suggestion.' })
  for (const [index, citation] of (draft.tailoring?.summary.citations ?? []).entries()) {
    const source = evidence.get(citation.evidenceId)
    if (!source) findings.push({ code: 'foreign-citation', itemPath: `tailoring.summary[${index}]`, evidenceId: citation.evidenceId, message: 'Summary citation is outside the frozen evidence revisions.', correction: 'Use only saved evidence included in this draft.' })
    else if (source.revision !== citation.revision) findings.push({ code: 'invalid-citation', itemPath: `tailoring.summary[${index}]`, evidenceId: citation.evidenceId, message: 'Summary citation revision does not match its frozen source.', correction: 'Use the source revision saved in this draft.' })
  }
  const parents = new Map<string, string>()
  for (const parent of [...draft.lockedFields.experience, ...draft.lockedFields.projects]) for (const sourceId of parent.sourceIds ?? [parent.evidenceId]) parents.set(sourceId, parent.evidenceId)
  const expectedParents: Record<string, Array<{ evidenceId: string; sourceIds?: string[] }>> = { experience: draft.lockedFields.experience, projects: draft.lockedFields.projects }
  const owners = new Map<string, string>()
  for (const section of ['experience', 'projects', 'education', 'certificates'] as const) for (const parent of draft.lockedFields[section]) for (const id of ('sourceIds' in parent ? parent.sourceIds : undefined) ?? [parent.evidenceId]) owners.set(id, section)
  for (const item of draft.evidence) if (!owners.has(item.evidenceId) && item.snapshot && typeof item.snapshot === 'object' && 'category' in item.snapshot && 'name' in item.snapshot) owners.set(item.evidenceId, 'skills')
  const sections = Object.entries(draft.content) as Array<[string, Array<{ citations: Array<{ evidenceId: string; revision: number }>; text?: string; name?: string }>]>
  for (const [section, items] of sections) items.forEach((item, index) => {
    const itemPath = `${section}[${index}]`
    if (!item.citations?.length) { findings.push({ code: 'missing-citation', itemPath, message: 'Factual draft item has no evidence citation.', correction: 'Cite relevant saved evidence or remove the unsupported claim.' }); return }
    const cited = item.citations.map(citation => ({ citation, source: evidence.get(citation.evidenceId) }))
    for (const { citation, source } of cited) {
      if (!source) { findings.push({ code: 'foreign-citation', itemPath, evidenceId: citation.evidenceId, message: 'Citation is outside this draft’s frozen evidence revisions.', correction: 'Choose evidence from this draft’s saved evidence snapshot.' }); continue }
      if (source.revision !== citation.revision) findings.push({ code: 'invalid-citation', itemPath, evidenceId: citation.evidenceId, message: 'Citation revision does not match the saved evidence revision.', correction: `Use the saved evidence revision r${source.revision} or regenerate from current evidence.` })
    }
    const expectedCategory = section
    const wrongType = cited.some(({ citation, source }) => source && owners.get(citation.evidenceId) !== expectedCategory)
    const associatedParents = new Set(cited.map(({ citation }) => parents.get(citation.evidenceId)).filter(Boolean))
    const parentMismatch = expectedParents[section]?.length && cited.some(({ citation }) => !expectedParents[section].some(parent => (parent.sourceIds ?? [parent.evidenceId]).includes(citation.evidenceId)))
    if (wrongType || parentMismatch || associatedParents.size > 1) findings.push({ code: 'wrong-parent', itemPath, message: 'Citation type or parent does not match this draft section and its frozen evidence ownership.', correction: 'Cite evidence of the correct section type from the matching saved parent record.' })
    const text = item.text ?? item.name ?? ''
    const citedText = cited.flatMap(({ source }) => source ? strings(source.snapshot) : []).join(' ')
    if (section === 'skills' && normalized(text) && !normalized(citedText).includes(normalized(text))) findings.push({ code: 'unsupported-skill', itemPath, message: `Skill “${text}” is not named in its cited evidence; equivalent wording needs explicit evidence support.`, correction: 'Use the saved skill name or add genuine supporting profile evidence.' })
    const sourceNumbers = new Set(numericExpressions(citedText))
    for (const expression of numericExpressions(text)) if (!sourceNumbers.has(expression)) findings.push({ code: 'unsupported-number', itemPath, evidenceId: item.citations[0]?.evidenceId, message: `Numeric value, unit, currency, or qualifier “${expression}” is not present in the cited evidence.`, correction: 'Use the cited source’s exact supported quantity and qualifier, cite directly relevant evidence, or remove the number.' })
  })
  const lockedEntries = [
    ...draft.lockedFields.experience.map(value => ({ value, fields: ['title', 'organization', 'startDate', 'endDate'] })),
    ...draft.lockedFields.projects.map(value => ({ value, fields: ['name'] })),
    ...draft.lockedFields.education.map(value => ({ value, fields: ['title', 'institution', 'startDate', 'endDate'] })),
    ...draft.lockedFields.certificates.map(value => ({ value, fields: ['title', 'issuer', 'year'] }))
  ]
  for (const { value, fields } of lockedEntries) {
    const source = evidence.get(value.evidenceId)
    if (!source) continue
    const snapshot = source.snapshot as Record<string, unknown>
    if (fields.some(field => value[field as keyof typeof value] !== snapshot[field])) findings.push({ code: 'locked-field-mismatch', itemPath: `lockedFields.${value.evidenceId}`, evidenceId: value.evidenceId, message: 'A locked authoritative field differs from its frozen evidence snapshot.', correction: 'Restore the local authoritative title, organization, institution, issuer, or date; do not edit it as generated wording.' })
  }
  const evidenceRevisionHash = createHash('sha256').update(JSON.stringify([...draft.evidence].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)))).digest('hex')
  return factualCheckReportSchema.parse({ draftId: draft.id, draftRevision: draft.revision, evidenceRevisionHash, passed: findings.length === 0, findings, checkedAt: new Date().toISOString(), limitation: 'Automated checks and optional LLM comparison are second opinions, not proof of semantic truth; human review remains required.' })
}
