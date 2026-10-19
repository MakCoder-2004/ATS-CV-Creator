import { createHash } from 'node:crypto'

export interface ConsentSource {
  job: { id: string; revision: number; title: string; company: string; description: string }
  profile: {
    revision: number
    contact: { fullName: string; [key: string]: unknown } | null
    experience: Array<{ id: string; revision: number; title: string; organization: string; description: string; factualItems?: Array<{ text: string; [key: string]: unknown }>; [key: string]: unknown }>
    projects: Array<{ id: string; revision: number; name: string; description: string; factualItems?: Array<{ text: string; [key: string]: unknown }>; technologies?: Array<{ text: string; [key: string]: unknown }>; [key: string]: unknown }>
    skills: Array<{ id: string; revision: number; name: string; category?: string }>
    education: Array<{ id: string; revision: number; section?: string; title: string; institution?: string; field?: string; description?: string; [key: string]: unknown }>
    certificates?: Array<{ title: string; issuer?: string; description?: string }>
    summary?: unknown[]; languages?: unknown[]; extras?: unknown[]
  }
  model: { name: string; [key: string]: unknown }
}

export interface OutboundBundle {
  readonly id: string
  readonly scopeHash: string
  readonly outgoing: Readonly<Record<string, any>>
  readonly restoreIdentifiers: (text: string) => string
  readonly containsRestoredIdentifier: (value: unknown) => boolean
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
  const restore = new Map<string, string>()
  const candidates: Array<{ value: string; kind: string }> = []
  const add = (value: string | undefined, kind: string) => { if (value?.trim()) candidates.push({ value: value.trim(), kind }) }
  add(source.profile.contact?.fullName, 'PERSON')
  source.profile.experience.forEach(item => add(item.organization, 'EMPLOYER'))
  source.profile.projects.forEach(item => add(item.name, 'PROJECT'))
  source.profile.education.forEach(item => add(item.institution, 'INSTITUTION'))
  source.job.company && add(source.job.company, 'EMPLOYER')
  const unique = new Map<string, string>()
  for (const item of candidates.sort((a, b) => b.value.length - a.value.length)) if (!unique.has(item.value.toLocaleLowerCase())) unique.set(item.value.toLocaleLowerCase(), item.kind)
  const identifiers: Array<{ value: string; token: string }> = []
  const counters = new Map<string, number>()
  for (const [key, kind] of unique) {
    const index = (counters.get(kind) ?? 0) + 1; counters.set(kind, index)
    const token = `[[${kind}_${index}]]`
    const value = candidates.find(candidate => candidate.value.toLocaleLowerCase() === key)!.value
    restore.set(token, value); identifiers.push({ value, token })
  }
  const scrub = (text: string) => identifiers.reduce((result, item) => result.replace(new RegExp(escapeRegExp(item.value), 'gi'), item.token), text)
  const outgoing = {
    job: { title: scrub(source.job.title), description: scrub(source.job.description) },
    profile: {
      experience: source.profile.experience.map(item => ({ title: scrub(item.title), organization: scrub(item.organization), description: scrub(item.description), evidence: (item.factualItems ?? []).map(f => scrub(f.text)) })),
      projects: source.profile.projects.map(item => ({ name: scrub(item.name), description: scrub(item.description), evidence: (item.factualItems ?? []).map(f => scrub(f.text)), technologies: (item.technologies ?? []).map(f => scrub(f.text)) })),
      skills: source.profile.skills.map(item => ({ name: scrub(item.name), category: item.category ? scrub(item.category) : undefined })),
      education: source.profile.education.map(item => ({ title: scrub(item.title), institution: item.institution ? scrub(item.institution) : undefined, field: item.field ? scrub(item.field) : undefined, description: item.description ? scrub(item.description) : undefined }))
    },
    model: { ...source.model },
    scope: { jobId: source.job.id, jobRevision: source.job.revision, profileRevision: source.profile.revision, evidenceRevisions: [...source.profile.experience, ...source.profile.projects, ...source.profile.skills, ...source.profile.education].map(item => [item.id, item.revision]) }
  }
  const frozen = deepFreeze(outgoing)
  const scopeHash = digest(frozen)
  const containsRestoredIdentifier = (value: unknown): boolean => {
    if (typeof value === 'string') return identifiers.some(({ value: identifier }) => identifier.length > 2 && value.toLocaleLowerCase().includes(identifier.toLocaleLowerCase())) || /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/.test(value) || /\b(?:\+?\d[\d ().-]{7,}\d)\b/.test(value)
    if (Array.isArray(value)) return value.some(containsRestoredIdentifier)
    if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(containsRestoredIdentifier)
    return false
  }
  return Object.freeze({ id: scopeHash, scopeHash, outgoing: frozen, restoreIdentifiers: (text: string) => [...restore].reduce((result, [token, value]) => result.replaceAll(token, value), text), containsRestoredIdentifier })
}

export const hashOutboundScope = digest
