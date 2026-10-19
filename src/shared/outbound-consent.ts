import { createHash } from 'node:crypto'

export interface ConsentSource {
  job: { id: string; revision: number; title: string; company: string; description: string }
  profile: {
    revision: number
    contact: { fullName: string; email?: string; phone?: string; location?: string; [key: string]: unknown } | null
    experience: Array<{ id: string; revision: number; kind?: string; title: string; organization: string; startDate?: string; endDate?: string; description: string; factualItems?: Array<{ id?: string; revision?: number; text: string }> }>
    projects: Array<{ id: string; revision: number; name: string; description: string; factualItems?: Array<{ id?: string; revision?: number; text: string }>; technologies?: Array<{ id?: string; revision?: number; text: string }>; links?: unknown[] }>
    skills: Array<{ id: string; revision: number; name: string; category?: string; proficiency?: string; years?: number }>
    education: Array<{ id: string; revision: number; section?: string; title: string; institution?: string; field?: string; startDate?: string; endDate?: string; description?: string }>
    certificates?: Array<{ id?: string; revision?: number; title: string; issuer?: string; year?: number; description?: string; link?: string }>
    summary?: unknown[]; languages?: unknown[]; extras?: unknown[]
  }
  model: { name: string; temperature?: number; topP?: number; maxOutputTokens?: number; thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high' }
}
export interface OutboundBundle {
  readonly id: string
  readonly scopeHash: string
  readonly outgoing: Readonly<Record<string, any>>
  readonly preview: Readonly<{ warnings: readonly string[]; residualSensitivityNotice: string }>
  readonly restoreIdentifiers: (text: string) => string
  readonly containsRestoredIdentifier: (value: unknown) => boolean
  readonly isAuthorizedText: (text: string) => boolean
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export function prepareOutboundBundle(source: ConsentSource): OutboundBundle {
  if (!['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'].includes(source.model.name)) throw new Error('Unsupported model configuration.')
  if (source.model.temperature !== undefined && (!Number.isFinite(source.model.temperature) || source.model.temperature < 0 || source.model.temperature > 2)) throw new Error('Invalid model temperature.')
  if (source.model.topP !== undefined && (!Number.isFinite(source.model.topP) || source.model.topP < 0 || source.model.topP > 1)) throw new Error('Invalid model topP.')
  if (source.model.maxOutputTokens !== undefined && (!Number.isInteger(source.model.maxOutputTokens) || source.model.maxOutputTokens < 1)) throw new Error('Invalid model output limit.')
  const restore = new Map<string, string>()
  const candidates: Array<{ value: string; kind: string }> = []
  const add = (value: string | undefined, kind: string) => { if (value?.trim()) candidates.push({ value: value.trim(), kind }) }
  add(source.profile.contact?.fullName, 'PERSON')
  add(source.profile.contact?.email, 'CONTACT')
  add(source.profile.contact?.phone, 'CONTACT')
  add(source.profile.contact?.location, 'CONTACT')
  source.profile.experience.forEach(item => add(item.organization, 'EMPLOYER'))
  source.profile.projects.forEach(item => add(item.name, 'PROJECT'))
  source.profile.education.forEach(item => add(item.institution, 'INSTITUTION'))
  source.profile.certificates?.forEach(item => add(item.issuer, 'INSTITUTION'))
  add(source.job.company, 'EMPLOYER')
  const unique = new Map<string, { value: string; kind: string }>()
  for (const item of [...candidates].sort((a, b) => b.value.length - a.value.length || a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value))) {
    if (!unique.has(item.value.toLocaleLowerCase())) unique.set(item.value.toLocaleLowerCase(), item)
  }
  const identifiers: Array<{ value: string; token: string }> = []
  const counters = new Map<string, number>()
  for (const item of unique.values()) {
    const index = (counters.get(item.kind) ?? 0) + 1; counters.set(item.kind, index)
    const token = `[[${item.kind}_${index}]]`
    restore.set(token, item.value); identifiers.push({ value: item.value, token })
  }
  const scrub = (text: string) => {
    let result = identifiers.reduce((value, item) => value.replace(new RegExp(escapeRegExp(item.value), 'gi'), item.token), text)
    result = result.replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]')
      .replace(/\b(?:\+?\d[\d ().-]{7,}\d)\b/g, '[REDACTED_PHONE]')
      .replace(/\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?\b/g, '[DATE_OMITTED]')
    return result
  }
  const model = { name: source.model.name, ...(source.model.temperature === undefined ? {} : { temperature: source.model.temperature }), ...(source.model.topP === undefined ? {} : { topP: source.model.topP }), ...(source.model.maxOutputTokens === undefined ? {} : { maxOutputTokens: source.model.maxOutputTokens }), ...(source.model.thinkingLevel === undefined ? {} : { thinkingLevel: source.model.thinkingLevel }) }
  const evidence = [...source.profile.experience, ...source.profile.projects, ...source.profile.skills, ...source.profile.education, ...(source.profile.certificates ?? [])]
  const outgoing = {
    job: { title: scrub(source.job.title), description: scrub(source.job.description) },
    profile: {
      experience: source.profile.experience.map(item => ({ kind: item.kind, title: scrub(item.title), organization: scrub(item.organization), description: scrub(item.description), evidence: (item.factualItems ?? []).map(f => scrub(f.text)) })),
      projects: source.profile.projects.map(item => ({ name: scrub(item.name), description: scrub(item.description), evidence: (item.factualItems ?? []).map(f => scrub(f.text)), technologies: (item.technologies ?? []).map(f => scrub(f.text)) })),
      skills: source.profile.skills.map(item => ({ name: scrub(item.name), category: item.category ? scrub(item.category) : undefined, proficiency: item.proficiency, years: item.years })),
      education: source.profile.education.map(item => ({ title: scrub(item.title), institution: item.institution ? scrub(item.institution) : undefined, field: item.field ? scrub(item.field) : undefined, description: item.description ? scrub(item.description) : undefined })),
      certificates: (source.profile.certificates ?? []).map(item => ({ title: scrub(item.title), issuer: item.issuer ? scrub(item.issuer) : undefined, description: item.description ? scrub(item.description) : undefined }))
    },
    model,
    scope: { jobId: source.job.id, jobRevision: source.job.revision, profileRevision: source.profile.revision, evidenceRevisions: evidence.map(item => [item.id, item.revision]).filter(([id]) => id !== undefined) }
  }
  const frozen = deepFreeze(outgoing)
  const scopeHash = digest(frozen)
  const containsRestoredIdentifier = (value: unknown): boolean => {
    if (typeof value === 'string') return identifiers.some(({ value: identifier }) => identifier.length > 2 && value.toLocaleLowerCase().includes(identifier.toLocaleLowerCase())) || /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/.test(value) || /\b(?:\+?\d[\d ().-]{7,}\d)\b/.test(value) || /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?\b/.test(value)
    if (Array.isArray(value)) return value.some(containsRestoredIdentifier)
    if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(containsRestoredIdentifier)
    return false
  }
  const authorizedStrings = new Set<string>()
  const collectStrings = (value: unknown) => { if (typeof value === 'string') authorizedStrings.add(value); else if (Array.isArray(value)) value.forEach(collectStrings); else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(collectStrings) }
  collectStrings(frozen)
  const isAuthorizedText = (text: string) => authorizedStrings.has(text) || [...authorizedStrings].some(allowed => allowed.length > 0 && text.includes(allowed) && text.replaceAll(allowed, '').replace(/\[\[(?:PERSON|CONTACT|EMPLOYER|PROJECT|INSTITUTION)_\d+\]\]/g, '').trim().length === 0)
  return Object.freeze({ id: scopeHash, scopeHash, outgoing: frozen, preview: deepFreeze({ warnings: ['Unstructured posting and career text can still identify you; review the complete outgoing preview.'], residualSensitivityNotice: 'Residual sensitivity may remain in free text; this bundle does not guarantee anonymity.' }), restoreIdentifiers: (text: string) => [...restore].reduce((result, [token, value]) => result.replaceAll(token, value), text), containsRestoredIdentifier, isAuthorizedText })
}

export const hashOutboundScope = digest
