import { randomUUID } from 'node:crypto'
import type { OutboundBundle } from '../shared/outbound-consent'
import { coverLetterPurposeSchema, type CoverLetterPurpose } from '../shared/cover-letter'
import { hashOutboundScope } from '../shared/outbound-consent'

interface ConsentRecord { id: string; runId: string; scopeHash: string; purposeVersion: 1; purpose: CoverLetterPurpose; purposeHash: string; createdAt: string; revoked: boolean }
function purposeHash(scopeHash: string, purpose: CoverLetterPurpose): string { return hashOutboundScope({ version: 1, scopeHash, purpose }) }
export function createOutboundConsentEngine() {
  const records = new Map<string, ConsentRecord>()
  return Object.freeze({
    grantConsent(runId: string, bundle: OutboundBundle, decision: { accepted: boolean; privacyAcknowledged: boolean }, purpose: CoverLetterPurpose = 'cv'): Readonly<ConsentRecord> {
      if (!decision.accepted) throw new Error('Explicit consent must be accepted.')
      if (!decision.privacyAcknowledged) throw new Error('Review the outgoing-data privacy notice before authorizing this run.')
      const record = Object.freeze({ id: randomUUID(), runId, scopeHash: bundle.scopeHash, purposeVersion: 1 as const, purpose: coverLetterPurposeSchema.parse(purpose), purposeHash: purposeHash(bundle.scopeHash, purpose), createdAt: new Date().toISOString(), revoked: false })
      records.set(record.id, { ...record })
      return record
    },
    restoreConsent(record: ConsentRecord): void {
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Persisted consent is invalid or revoked.')
      const purpose = coverLetterPurposeSchema.parse(record.purpose)
      const fields = ['createdAt', 'id', 'purpose', 'purposeHash', 'purposeVersion', 'revoked', 'runId', 'scopeHash']
      if (Object.keys(record).sort().join(',') !== fields.join(',') || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(record.id) || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(record.runId) || !/^[a-f0-9]{64}$/.test(record.scopeHash) || !/^\d{4}-\d\d-\d\dT/.test(record.createdAt) || !Number.isFinite(Date.parse(record.createdAt)) || record.revoked !== false || record.purposeVersion !== 1 || !/^[a-f0-9]{64}$/.test(record.purposeHash) || record.purposeHash !== purposeHash(record.scopeHash, purpose)) throw new Error('Persisted consent is invalid or revoked.')
      records.set(record.id, { ...record, purpose, purposeHash: purposeHash(record.scopeHash, purpose) })
    },
    revoke(consentId: string): void {
      const record = records.get(consentId)
      if (record) record.revoked = true
    },
    authorizePayload<T>(runId: string, bundle: OutboundBundle, payload: T): T {
      const runConsents = [...records.values()].filter(record => record.runId === runId)
      const consent = runConsents.find(record => !record.revoked)
      if (!consent) throw new Error(runConsents.length ? 'Consent was revoked for this run.' : 'No active consent exists for this run.')
      if (consent.scopeHash !== bundle.scopeHash || consent.purposeVersion !== 1 || consent.purposeHash !== purposeHash(consent.scopeHash, consent.purpose) || !bundle.verifyIntegrity()) throw new Error('Authorization scope or purpose is stale or has expanded.')
      let request: T
      try { request = structuredClone(payload) }
      catch { throw new Error('Outbound payload cannot be safely copied for authorization.') }
      if (!bundle.isAuthorizedPayload(request)) {
        if (bundle.containsRestoredIdentifier(request)) throw new Error('Restored identifier is not authorized for outbound payloads.')
        throw new Error('Payload contains data outside the authorized bundle.')
      }
      if (bundle.containsRestoredIdentifier(request)) throw new Error('Restored identifier is not authorized for outbound payloads.')
      const freeze = (value: unknown): void => {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
        Object.freeze(value)
        for (const child of Object.values(value)) freeze(child)
      }
      freeze(request)
      return request
    }
  })
}
