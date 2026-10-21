type SourceSummary = { heading: string; detail: string }

function record(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text.startsWith('{') && !text.startsWith('[')) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch { return null }
}

/** Stored evidence may contain structured text; never print its serialized representation in review UI. */
export function readableText(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (!text || text.startsWith('{') || text.startsWith('[')) {
    const parsed = record(text)
    return parsed ? readableText(parsed.description) || readableText(parsed.text) || readableText(parsed.name) || readableText(parsed.title) : ''
  }
  return text
}

export function describeSource(snapshot: unknown): SourceSummary {
  const source = record(snapshot)
  if (!source) return { heading: 'Saved career fact', detail: '' }
  const nested = record(source.text)
  const value = nested ?? source
  const title = readableText(value.title) || readableText(value.name) || readableText(value.label)
  const organization = readableText(value.organization) || readableText(value.institution) || readableText(value.issuer)
  const heading = [title, organization].filter(Boolean).join(' · ') || 'Saved career fact'
  const detail = readableText(value.description) || (nested ? '' : readableText(value.text))
  return { heading, detail }
}
