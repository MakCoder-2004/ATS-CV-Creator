import { createHash } from 'node:crypto'
import { draftRevisionSchema } from '../shared/draft'
import { generationRecoverySnapshotSchema } from '../shared/generation-recovery'
import type { CoverLetterOperation, CoverLetterRevision, CoverLetterSource } from '../shared/cover-letter'
import { prepareOutboundBundle } from '../shared/outbound-consent'
import { prepareCoverLetterSources } from './cover-letter-generation'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
type Row = Record<string, unknown>
type Origin = { status: 'known'; cvRevisionId: string; scopeHash: string; modelHash: string; postingUpdatedAt: string; sources: CoverLetterSource[] } | { status: 'unknown' } | { status: 'invalid' }

/** The CV parent's frozen identity/source is authoritative, never the optional child metadata.
 * A future letter-only parent needs an explicit originating-parent contract; it cannot infer
 * provenance from an arbitrary same-job CV. Unknown historical parents stay read-only.
 */
export function resolveInitialLetterOrigin(operation: CoverLetterOperation, consent: Row | undefined, recovery: Row | undefined, readDraft: (id: string) => unknown): Origin {
  if (!consent || consent.id !== operation.consentId || consent.run_id !== operation.parentRunId || consent.job_id !== operation.jobId || consent.purpose === 'cv' || consent.purpose_hash !== operation.purposeHash || consent.purpose_version !== 1 || consent.purpose_hash !== hash({ version: 1, scopeHash: consent.scope_hash, purpose: consent.purpose })) return { status: 'invalid' }
  if (!recovery) return { status: 'unknown' }
  try {
    const frozen = generationRecoverySnapshotSchema.parse(JSON.parse(String(recovery.snapshot)))
    if (frozen.version !== 5) return { status: 'unknown' }
    const bundle = prepareOutboundBundle(frozen.source)
    if (consent.purpose !== 'cv+cover-letter' || recovery.status !== 'complete' || recovery.run_id !== operation.parentRunId || recovery.job_id !== operation.jobId || recovery.consent_id !== operation.consentId || recovery.scope_hash !== consent.scope_hash || frozen.runId !== operation.parentRunId || frozen.jobId !== operation.jobId || frozen.consentId !== operation.consentId || frozen.scopeHash !== consent.scope_hash || bundle.scopeHash !== frozen.scopeHash || frozen.source.job.id !== operation.jobId || frozen.identity.jobId !== operation.jobId) return { status: 'invalid' }
    const cv = draftRevisionSchema.parse(readDraft(frozen.identity.id))
    if (cv.id !== frozen.identity.id || cv.jobId !== operation.jobId || cv.revision !== frozen.identity.revision || cv.createdAt !== frozen.identity.createdAt || cv.targetPostingUpdatedAt !== frozen.identity.targetPostingUpdatedAt || cv.targetPostingUpdatedAt !== String(frozen.source.job.revision) || cv.checkReport?.findings.some(finding => finding.itemPath === 'generation') || !Object.values(cv.content).some(items => items.length > 0)) return { status: 'invalid' }
    const origin = { status: 'known' as const, cvRevisionId: cv.id, scopeHash: frozen.scopeHash, modelHash: hash(frozen.source.model), postingUpdatedAt: String(frozen.source.job.revision), sources: prepareCoverLetterSources(frozen.source, bundle).local }
    const binding = operation.initialBinding
    if (binding && (binding.cvRevisionId !== origin.cvRevisionId || binding.scopeHash !== origin.scopeHash || binding.modelHash !== origin.modelHash || binding.postingUpdatedAt !== origin.postingUpdatedAt)) return { status: 'invalid' }
    return origin
  } catch { return { status: 'invalid' } }
}

export function letterSourceMappingMatches(bound: CoverLetterSource, issued: CoverLetterSource | undefined): boolean {
  // Historical backend records used this exact deterministic label for saved skills.
  const legacySkillPassage = issued?.category === 'skill' && bound.passage === `Saved ${issued.heading} skill.`
  return !!issued && issued.ordinal === bound.ordinal && issued.evidenceId === bound.evidenceId && issued.revision === bound.revision && issued.category === bound.category && issued.parentId === bound.parentId && issued.heading === bound.heading && (issued.passage === bound.passage || legacySkillPassage)
}

export function letterOriginProblem(letter: CoverLetterRevision, origin: Origin): string | null {
  if (origin.status === 'unknown') return 'The originating cover-letter provenance is unavailable. This historical letter is read-only.'
  if (origin.status === 'invalid' || origin.cvRevisionId !== letter.cvRevisionId || origin.scopeHash !== letter.bindings.scopeHash || origin.modelHash !== letter.bindings.modelHash || origin.postingUpdatedAt !== letter.bindings.postingUpdatedAt) return 'The originating CV or cover-letter source binding is invalid.'
  if (letter.bindings.sources.some(bound => !letterSourceMappingMatches(bound, origin.sources.find(issued => issued.ordinal === bound.ordinal)))) return 'A cover-letter source ordinal or source passage does not match the issued mapping.'
  return null
}
