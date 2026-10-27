import { createHash } from 'node:crypto'
import { openRouterModelSchema } from './openrouter-settings'
import { piModelSelectionSchema } from './pi-model'

export type EvidenceScopeRevision = readonly [id: string, revision: number]

export interface ConsentSource {
  job: { id: string; revision: string | number; title: string; company: string; description: string }
  profile: {
    revision: readonly EvidenceScopeRevision[]
    contact: { fullName: string; email?: string; phone?: string; location?: string; [key: string]: unknown } | null
    experience: Array<{ id: string; revision: number; kind?: string; title: string; organization: string; startDate?: string; endDate?: string; description: string; factualItems?: Array<{ id?: string; revision?: number; text: string }> }>
    projects: Array<{ id: string; revision: number; name: string; description: string; factualItems?: Array<{ id?: string; revision?: number; text: string }>; technologies?: Array<{ id?: string; revision?: number; text: string }>; links?: unknown[] }>
    skills: Array<{ id: string; revision: number; name: string; category?: string; proficiency?: string; years?: number }>
    education: Array<{ id: string; revision: number; section?: string; title: string; institution?: string; field?: string; startDate?: string; endDate?: string; description?: string }>
    certificates?: Array<{ id?: string; revision?: number; title: string; issuer?: string; year?: number; description?: string; link?: string }>
    summary?: unknown[]; languages?: unknown[]; extras?: unknown[]
  }
  model: { name: string; providerId?: string; temperature?: number; topP?: number; maxOutputTokens?: number; thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
}
export interface OutboundPayload {
  readonly job: { readonly title: string; readonly description: string }
  readonly profile: {
    readonly experience: readonly { readonly kind?: string; readonly title: string; readonly organization: string; readonly description: string; readonly evidence: readonly string[] }[]
    readonly projects: readonly { readonly name: string; readonly description: string; readonly evidence: readonly string[]; readonly technologies: readonly string[] }[]
    readonly skills: readonly { readonly name: string; readonly category?: string; readonly proficiency?: string; readonly years?: number }[]
    readonly education: readonly { readonly title: string; readonly institution?: string; readonly field?: string; readonly description?: string }[]
    readonly certificates: readonly { readonly title: string; readonly issuer?: string; readonly description?: string }[]
  }
  readonly model: { readonly name: string; readonly providerId?: string; readonly temperature?: number; readonly topP?: number; readonly maxOutputTokens?: number; readonly thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
}
export interface OutboundBundle {
  readonly id: string
  readonly scopeHash: string
  readonly outgoing: Readonly<OutboundPayload>
  readonly preview: Readonly<{ warnings: readonly string[]; residualSensitivityNotice: string }>
  readonly restoreIdentifiers: (text: string) => string
  readonly minimizeIdentifiers: (text: string) => string
  readonly containsRestoredIdentifier: (value: unknown) => boolean
  readonly isAuthorizedText: (text: string) => boolean
  readonly isAuthorizedPayload: (payload: unknown) => boolean
  readonly verifyIntegrity: () => boolean
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
  if (source.model.providerId === undefined) {
    if (!openRouterModelSchema.safeParse(source.model.name).success) throw new Error('Invalid OpenRouter model ID.')
  } else if (!piModelSelectionSchema.safeParse({ providerId: source.model.providerId, modelId: source.model.name, thinkingLevel: source.model.thinkingLevel }).success) {
    throw new Error('Choose a valid Pi provider, model, and thinking level before reviewing outgoing data.')
  }
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
  const evidence = [...source.profile.experience, ...source.profile.projects, ...source.profile.skills, ...source.profile.education, ...(source.profile.certificates ?? [])]
  const trustedProtocolIds = new Set<string>()
  const addProtocolId = (id: string | undefined) => { if (id && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) trustedProtocolIds.add(id.toLowerCase()) }
  addProtocolId(source.job.id)
  source.profile.revision.forEach(([id]) => addProtocolId(id))
  for (const item of evidence) {
    if ('id' in item) addProtocolId(item.id)
    if ('factualItems' in item) item.factualItems?.forEach(child => addProtocolId(child.id))
    if ('technologies' in item) item.technologies?.forEach(child => addProtocolId(child.id))
  }
  const trustedUuidPattern = trustedProtocolIds.size ? new RegExp(`(?<![0-9a-f])(${[...trustedProtocolIds].map(escapeRegExp).join('|')})(?![0-9a-f])`, 'gi') : undefined
  const splitTrustedIds = (text: string) => trustedUuidPattern ? text.split(trustedUuidPattern) : [text]
  const isTrustedId = (part: string) => trustedProtocolIds.has(part.toLowerCase())
  const scrubUntrusted = (text: string) => identifiers.reduce((value, item) => value.replace(new RegExp(escapeRegExp(item.value), 'gi'), item.token), text)
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]')
    .replace(/\b(?:\+?\d[\d ().-]{7,}\d)\b/g, '[REDACTED_PHONE]')
    .replace(/\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?\b/g, '[DATE_OMITTED]')
  const scrub = (text: string) => splitTrustedIds(text).map(part => isTrustedId(part) ? part : scrubUntrusted(part)).join('')
  const model = { name: source.model.name, ...(source.model.providerId === undefined ? {} : { providerId: source.model.providerId }), ...(source.model.temperature === undefined ? {} : { temperature: source.model.temperature }), ...(source.model.topP === undefined ? {} : { topP: source.model.topP }), ...(source.model.maxOutputTokens === undefined ? {} : { maxOutputTokens: source.model.maxOutputTokens }), ...(source.model.thinkingLevel === undefined ? {} : { thinkingLevel: source.model.thinkingLevel }) }
  const scope = { jobId: source.job.id, jobRevision: source.job.revision, profileRevision: source.profile.revision, evidenceRevisions: evidence.flatMap(item => [['id' in item ? item.id : undefined, item.revision], ...('factualItems' in item ? (item.factualItems ?? []).map(child => [child.id, child.revision]) : []), ...('technologies' in item ? (item.technologies ?? []).map(child => [child.id, child.revision]) : [])]).filter(([id]) => id !== undefined) }
  const outgoing = {
    job: { title: scrub(source.job.title), description: scrub(source.job.description) },
    profile: {
      experience: source.profile.experience.map(item => ({ kind: item.kind, title: scrub(item.title), organization: scrub(item.organization), description: scrub(item.description), evidence: (item.factualItems ?? []).map(f => scrub(f.text)) })),
      projects: source.profile.projects.map(item => ({ name: scrub(item.name), description: scrub(item.description), evidence: (item.factualItems ?? []).map(f => scrub(f.text)), technologies: (item.technologies ?? []).map(f => scrub(f.text)) })),
      skills: source.profile.skills.map(item => ({ name: scrub(item.name), category: item.category ? scrub(item.category) : undefined, proficiency: item.proficiency, years: item.years })),
      education: source.profile.education.map(item => ({ title: scrub(item.title), institution: item.institution ? scrub(item.institution) : undefined, field: item.field ? scrub(item.field) : undefined, description: item.description ? scrub(item.description) : undefined })),
      certificates: (source.profile.certificates ?? []).map(item => ({ title: scrub(item.title), issuer: item.issuer ? scrub(item.issuer) : undefined, description: item.description ? scrub(item.description) : undefined }))
    },
    model
  }
  const frozen = deepFreeze(outgoing)
  const frozenScope = deepFreeze(scope)
  const scopeHash = digest({ outgoing: frozen, scope: frozenScope })
  const containsRestoredIdentifier = (input: unknown): boolean => {
    const seen = new WeakSet<object>()
    const contains = (value: unknown): boolean => {
      if (typeof value === 'string') return splitTrustedIds(value).some(part => {
        if (isTrustedId(part)) return false
        return identifiers.some(({ value: identifier }) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(identifier)}(?![\\p{L}\\p{N}])`, 'iu').test(part)) || /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/.test(part) || /\b(?:\+?\d[\d ().-]{7,}\d)\b/.test(part) || /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?\b/.test(part)
      })
      if (!value || typeof value !== 'object' || seen.has(value)) return false
      seen.add(value)
      if (Array.isArray(value)) return value.some(contains)
      return Object.entries(value as Record<string, unknown>).some(([key, child]) => contains(key) || contains(child))
    }
    return contains(input)
  }
  const authorizedStrings = new Set<string>(), authorizedNumbers = new Set<number>(), authorizedKeys = new Set(['text'])
  const collectAllowed = (value: unknown) => {
    if (typeof value === 'string') authorizedStrings.add(value)
    else if (typeof value === 'number') authorizedNumbers.add(value)
    else if (Array.isArray(value)) value.forEach(collectAllowed)
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { authorizedKeys.add(key); collectAllowed(child) }
  }
  collectAllowed(frozen)
  const isAuthorizedText = (text: string) => text === '' || [...authorizedStrings].some(allowed => allowed.includes(text))
  const isAuthorizedPayload = (payload: unknown): boolean => {
    const seen = new WeakSet<object>()
    const withinScope = (value: unknown): boolean => {
      if (typeof value === 'string') return isAuthorizedText(value)
      if (typeof value === 'number') return authorizedNumbers.has(value)
      if (value === null || value === undefined) return true
      if (typeof value !== 'object' || seen.has(value)) return false
      seen.add(value)
      if (Array.isArray(value)) return value.every(withinScope)
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false
      return Object.entries(value).every(([key, child]) => authorizedKeys.has(key) && withinScope(child))
    }
    return withinScope(payload)
  }
  return Object.freeze({ id: scopeHash, scopeHash, outgoing: frozen, verifyIntegrity: () => digest({ outgoing: frozen, scope: frozenScope }) === scopeHash, preview: deepFreeze({ warnings: ['Unstructured posting and career text can still identify you; review the complete outgoing preview.'], residualSensitivityNotice: 'Residual sensitivity may remain in free text; this bundle does not guarantee anonymity.' }), restoreIdentifiers: (text: string) => [...restore].reduce((result, [token, value]) => result.replaceAll(token, value), text), minimizeIdentifiers: scrub, containsRestoredIdentifier, isAuthorizedText, isAuthorizedPayload })
}

export const hashOutboundScope = digest
