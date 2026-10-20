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
  const pattern = /(?:[$€£]\s*)?\b\d+(?:[,.]\d+)*(?:\s*(?:%|percent|percentage|USD|EUR|GBP|dollars?|euros?|pounds?|k|m|million|billion|hours?|days?|weeks?|months?|years?|users?|customers?|projects?|teams?))?\b/giu
  return [...text.matchAll(pattern)].map(match => normalized(match[0]))
}

export function checkDraftFacts(draft: DraftRevision) {
  const findings: FactualFinding[] = []
  const parsed = draftContentSchema.safeParse(draft.content)
  if (!parsed.success) findings.push({ code: 'schema', itemPath: 'content', message: 'Draft content does not match the required five-section schema.', correction: 'Correct the malformed section or item and rerun factual checks.' })
  const evidence = new Map(draft.evidence.map(item => [item.evidenceId, item]))
  const parents = new Map<string, string>()
  for (const parent of [...draft.lockedFields.experience, ...draft.lockedFields.projects]) for (const sourceId of parent.sourceIds ?? [parent.evidenceId]) parents.set(sourceId, parent.evidenceId)
  const sections = Object.entries(draft.content) as Array<[string, Array<{ citations: Array<{ evidenceId: string; revision: number }>; text?: string; name?: string }>]>
  for (const [section, items] of sections) items.forEach((item, index) => {
    const itemPath = `${section}[${index}]`
    if (!item.citations?.length) { findings.push({ code: 'missing-citation', itemPath, message: 'Factual draft item has no evidence citation.', correction: 'Cite relevant saved evidence or remove the unsupported claim.' }); return }
    const cited = item.citations.map(citation => ({ citation, source: evidence.get(citation.evidenceId) }))
    for (const { citation, source } of cited) {
      if (!source) { findings.push({ code: 'foreign-citation', itemPath, evidenceId: citation.evidenceId, message: 'Citation is outside this draft’s frozen evidence revisions.', correction: 'Choose evidence from this draft’s saved evidence snapshot.' }); continue }
      if (source.revision !== citation.revision) findings.push({ code: 'invalid-citation', itemPath, evidenceId: citation.evidenceId, message: 'Citation revision does not match the saved evidence revision.', correction: `Use the saved evidence revision r${source.revision} or regenerate from current evidence.` })
    }
    const associatedParents = new Set(cited.map(({ citation }) => parents.get(citation.evidenceId)).filter(Boolean))
    if (associatedParents.size > 1) findings.push({ code: 'wrong-parent', itemPath, message: 'Citations combine evidence belonging to different experience or project records.', correction: 'Keep each paragraph tied to one parent record.' })
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
  return factualCheckReportSchema.parse({ draftId: draft.id, draftRevision: draft.revision, evidenceRevisionHash, passed: findings.length === 0, findings, checkedAt: new Date().toISOString(), limitation: 'Deterministic checks catch specified structural mismatches; citations do not prove semantic truth or detect every invention.' })
}
