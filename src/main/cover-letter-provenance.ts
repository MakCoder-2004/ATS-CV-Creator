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

/** New letter-only parents must name the actual completed CV parent, not an arbitrary job CV. */
export function resolveLetterOrigin(operation: CoverLetterOperation, consent: Row | undefined, readConsent: (id: string) => Row | undefined, readRecovery: (runId: string) => Row | undefined, readDraft: (id: string) => unknown): Origin {
  if (!consent || !validPurpose(consent) || consent.id !== operation.consentId || consent.run_id !== operation.parentRunId || consent.job_id !== operation.jobId || consent.purpose === 'cv' || consent.purpose_hash !== operation.purposeHash) return { status: 'invalid' }
  const retry = operation.retryOrigin
  let origin: Origin
  if (consent.purpose === 'cover-letter-only') {
    if (!retry || !operation.initialBinding || retry.parentRunId === operation.parentRunId || retry.consentId === operation.consentId) return { status: 'invalid' }
    const parent = readConsent(retry.consentId)
    if (!parent || parent.run_id !== retry.parentRunId || parent.job_id !== operation.jobId) return { status: 'invalid' }
    origin = resolveCvParentOrigin(parent, readRecovery(retry.parentRunId), readDraft)
    if (origin.status !== 'known' || origin.scopeHash !== consent.scope_hash) return { status: 'invalid' }
  } else {
    if (retry || consent.purpose !== 'cv+cover-letter') return { status: 'invalid' }
    origin = resolveCvParentOrigin(consent, readRecovery(operation.parentRunId), readDraft)
  }
  const binding = operation.initialBinding
  if (binding && (origin.status !== 'known' || binding.cvRevisionId !== origin.cvRevisionId || binding.scopeHash !== origin.scopeHash || binding.modelHash !== origin.modelHash || binding.postingUpdatedAt !== origin.postingUpdatedAt)) return { status: 'invalid' }
  return origin
}

export function letterSourceMappingMatches(bound: CoverLetterSource, issued: CoverLetterSource | undefined): boolean {
  const legacySkillPassage = issued?.category === 'skill' && bound.passage === `Saved ${issued.heading} skill.`
  return !!issued && issued.ordinal === bound.ordinal && issued.evidenceId === bound.evidenceId && issued.revision === bound.revision && issued.category === bound.category && issued.parentId === bound.parentId && issued.heading === bound.heading && (issued.passage === bound.passage || legacySkillPassage)
}

export function letterOriginProblem(letter: CoverLetterRevision, origin: Origin): string | null {
  if (origin.status === 'unknown') return 'The originating cover-letter provenance is unavailable. This historical letter is read-only.'
  if (origin.status === 'invalid' || origin.cvRevisionId !== letter.cvRevisionId || origin.scopeHash !== letter.bindings.scopeHash || origin.modelHash !== letter.bindings.modelHash || origin.postingUpdatedAt !== letter.bindings.postingUpdatedAt) return 'The originating CV or cover-letter source binding is invalid.'
  if (letter.bindings.sources.some(bound => !letterSourceMappingMatches(bound, origin.sources.find(issued => issued.ordinal === bound.ordinal)))) return 'A cover-letter source ordinal or source passage does not match the issued mapping.'
  return null
}
