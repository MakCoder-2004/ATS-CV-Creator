import type { CoverLetterSource } from './cover-letter'

/** Readable evidence, without rewriting the frozen source used for provenance/hashes. */
export function coverLetterSourceCopy(source: Pick<CoverLetterSource, 'category' | 'passage'>): string {
  if (source.category !== 'education' && source.category !== 'skill') return source.passage
  let value: unknown
  try { value = JSON.parse(source.passage) } catch { return source.passage }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return source.passage
  const record = value as Record<string, unknown>
  const fields: Array<readonly [string, string]> = source.category === 'education'
    ? [['title', ''], ['institution', 'Institution'], ['field', 'Field of study'], ['description', 'Details']]
    : [['name', ''], ['category', 'Category'], ['proficiency', 'Proficiency'], ['years', 'Years of use']]
  if (Object.keys(record).some(key => !fields.some(([field]) => field === key)) || Object.entries(record).some(([key, item]) => item !== undefined && item !== null && typeof item !== 'string' && !(key === 'years' && typeof item === 'number' && Number.isFinite(item)))) return source.passage
  const lines = fields.flatMap(([key, label]) => {
    const item = record[key]
    if (item === undefined || item === null || item === '') return []
    if (typeof item !== 'string' && !(key === 'years' && typeof item === 'number' && Number.isFinite(item))) return []
    return [label ? `${label}: ${item}` : String(item)]
  })
  return lines.length ? lines.join('\n') : source.passage
}
