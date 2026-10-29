import { createHash } from 'node:crypto'
import { draftRevisionSchema } from '../shared/draft'
import { generationRecoverySnapshotSchema } from '../shared/generation-recovery'
import type { CoverLetterOperation, CoverLetterRevision, CoverLetterSource } from '../shared/cover-letter'
import type { ExperienceRecord } from '../shared/experience'
import { prepareOutboundBundle } from '../shared/outbound-consent'
import { prepareCoverLetterSources } from './cover-letter-generation'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
type Row = Record<string, unknown>
type Frozen = Extract<ReturnType<typeof generationRecoverySnapshotSchema.parse>, { version: 5 }>
type Origin = { status: 'known'; cvRevisionId: string; scopeHash: string; modelHash: string; postingUpdatedAt: string; sources: CoverLetterSource[]; experienceKinds: Readonly<Record<string, ExperienceRecord['kind']>>; frozen: Frozen; cv: ReturnType<typeof draftRevisionSchema.parse> } | { status: 'unknown' } | { status: 'invalid' }
const validPurpose = (consent: Row) => consent.purpose_version === 1 && ['cv', 'cv+cover-letter', 'cover-letter-only'].includes(String(consent.purpose)) && consent.purpose_hash === hash({ version: 1, scopeHash: consent.scope_hash, purpose: consent.purpose })

/** Data provenance, never cloud authority. A revoked CV grant may still identify frozen data. */
export function resolveCvParentOrigin(consent: Row | undefined, recovery: Row | undefined, readDraft: (id: string) => unknown): Origin {
  if (!consent || !validPurpose(consent) || !['cv', 'cv+cover-letter'].includes(String(consent.purpose))) return { status: 'invalid' }
  if (!recovery) return { status: 'unknown' }
  try {
    const frozen = generationRecoverySnapshotSchema.parse(JSON.parse(String(recovery.snapshot)))
    if (frozen.version !== 5) return { status: 'unknown' }
    const bundle = prepareOutboundBundle(frozen.source)
    if (recovery.status !== 'complete' || recovery.run_id !== consent.run_id || recovery.job_id !== consent.job_id || recovery.consent_id !== consent.id || recovery.scope_hash !== consent.scope_hash || frozen.runId !== consent.run_id || frozen.jobId !== consent.job_id || frozen.consentId !== consent.id || frozen.scopeHash !== consent.scope_hash || bundle.scopeHash !== frozen.scopeHash || frozen.source.job.id !== consent.job_id || frozen.identity.jobId !== consent.job_id || frozen.analysis.status !== 'complete' || !frozen.analysis.analysis || frozen.analysis.jobId !== frozen.jobId || frozen.analysis.runId !== frozen.runId || frozen.analysis.targetPostingUpdatedAt !== String(frozen.source.job.revision)) return { status: 'invalid' }
    const cv = draftRevisionSchema.parse(readDraft(frozen.identity.id))
    if (cv.id !== frozen.identity.id || cv.jobId !== consent.job_id || cv.revision !== frozen.identity.revision || cv.createdAt !== frozen.identity.createdAt || cv.targetPostingUpdatedAt !== frozen.identity.targetPostingUpdatedAt || cv.targetPostingUpdatedAt !== String(frozen.source.job.revision) || cv.checkReport?.findings.some(finding => finding.itemPath === 'generation') || !Object.values(cv.content).some(items => items.length > 0)) return { status: 'invalid' }
    const prepared = prepareCoverLetterSources(frozen.source, bundle)
    return { status: 'known', cvRevisionId: cv.id, scopeHash: frozen.scopeHash, modelHash: hash(frozen.source.model), postingUpdatedAt: String(frozen.source.job.revision), sources: prepared.local, experienceKinds: prepared.experienceKinds, frozen, cv }
  } catch { return { status: 'invalid' } }
}

type Intent = { consent: Row; operation?: CoverLetterOperation }
const operationMatchesConsent = (operation: CoverLetterOperation, consent: Row) => validPurpose(consent) && consent.id === operation.consentId && consent.run_id === operation.parentRunId && consent.job_id === operation.jobId && consent.purpose !== 'cv' && consent.purpose_hash === operation.purposeHash
const bindingMatches = (operation: CoverLetterOperation, origin: Origin) => !operation.initialBinding || origin.status === 'known' && operation.initialBinding.cvRevisionId === origin.cvRevisionId && operation.initialBinding.scopeHash === origin.scopeHash && operation.initialBinding.modelHash === origin.modelHash && operation.initialBinding.postingUpdatedAt === origin.postingUpdatedAt

/** Derive the root from the actual preceding same-job intent ledger, never from a child selector. */
export function resolveLetterOrigin(operation: CoverLetterOperation, consent: Row | undefined, readRecovery: (runId: string) => Row | undefined, readDraft: (id: string) => unknown, readPreviousIntent: (consentId: string) => Intent | undefined): Origin {
  if (!consent || !operationMatchesConsent(operation, consent)) return { status: 'invalid' }
  if (consent.purpose === 'cv+cover-letter') {
    if (operation.retryOrigin) return { status: 'invalid' }
    const origin = resolveCvParentOrigin(consent, readRecovery(operation.parentRunId), readDraft)
    return bindingMatches(operation, origin) ? origin : { status: 'invalid' }
  }
  try {
    const chain: Intent[] = [{ consent, operation }]
    const seen = new Set([String(consent.id)])
    let prior = readPreviousIntent(String(consent.id))
    while (prior?.consent.purpose === 'cover-letter-only') {
      if (seen.has(String(prior.consent.id)) || !prior.operation || !operationMatchesConsent(prior.operation, prior.consent) || prior.consent.job_id !== operation.jobId) return { status: 'invalid' }
      seen.add(String(prior.consent.id)); chain.push(prior)
      prior = readPreviousIntent(String(prior.consent.id))
    }
    if (!prior || seen.has(String(prior.consent.id)) || prior.consent.job_id !== operation.jobId) return { status: 'invalid' }
    const root = prior.consent
    const origin = resolveCvParentOrigin(root, readRecovery(String(root.run_id)), readDraft)
    if (origin.status !== 'known' || prior.operation && (!operationMatchesConsent(prior.operation, root) || prior.operation.retryOrigin || !bindingMatches(prior.operation, origin))) return { status: 'invalid' }
    for (const intent of chain) {
      const child = intent.operation!
      if (!child.retryOrigin || !child.initialBinding || child.retryOrigin.parentRunId !== root.run_id || child.retryOrigin.consentId !== root.id || intent.consent.scope_hash !== origin.scopeHash || !bindingMatches(child, origin)) return { status: 'invalid' }
    }
    return origin
  } catch { return { status: 'invalid' } }
}

export function letterSourceMappingMatches(bound: CoverLetterSource, issued: CoverLetterSource | undefined): boolean {
  return !!issued && issued.ordinal === bound.ordinal && issued.evidenceId === bound.evidenceId && issued.revision === bound.revision && issued.category === bound.category && issued.parentId === bound.parentId && issued.heading === bound.heading && issued.passage === bound.passage
}

/** Backup readability only. A deterministic old skill label never establishes current issued mapping. */
export function letterHistoricalMappingReadable(letter: CoverLetterRevision, origin: Origin): boolean {
  if (origin.status !== 'known') return false
  const canonical = { ...letter, bindings: { ...letter.bindings, sources: letter.bindings.sources.map(bound => {
    const issued = origin.sources.find(source => source.ordinal === bound.ordinal)
    return issued?.category === 'skill' && bound.passage === `Saved ${issued.heading} skill.` ? { ...bound, passage: issued.passage } : bound
  }) } }
  return letterOriginProblem(canonical, origin) === null
}

export function letterOriginProblem(letter: CoverLetterRevision, origin: Origin): string | null {
  if (origin.status === 'unknown') return 'The originating cover-letter provenance is unavailable. This historical letter is read-only.'
  if (origin.status === 'invalid' || origin.cvRevisionId !== letter.cvRevisionId || origin.scopeHash !== letter.bindings.scopeHash || origin.modelHash !== letter.bindings.modelHash || origin.postingUpdatedAt !== letter.bindings.postingUpdatedAt) return 'The originating CV or cover-letter source binding is invalid.'
  if (letter.bindings.sources.some(bound => !letterSourceMappingMatches(bound, origin.sources.find(issued => issued.ordinal === bound.ordinal)))) return 'A cover-letter source ordinal or source passage does not match the issued mapping.'
  return null
}
