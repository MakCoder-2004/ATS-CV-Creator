import { randomUUID } from 'node:crypto'
import type { OutboundBundle } from '../shared/outbound-consent'

interface ConsentRecord { id: string; runId: string; scopeHash: string; createdAt: string; revoked: boolean }
export function createOutboundConsentEngine() {
  const records = new Map<string, ConsentRecord>()
  return Object.freeze({
    grantConsent(runId: string, bundle: OutboundBundle, decision: { accepted: boolean; privacyAcknowledged: boolean }): Readonly<ConsentRecord> {
      if (!decision.accepted) throw new Error('Explicit consent must be accepted.')
      if (!decision.privacyAcknowledged) throw new Error('Review the outgoing-data privacy notice before authorizing this run.')
      const record = Object.freeze({ id: randomUUID(), runId, scopeHash: bundle.scopeHash, createdAt: new Date().toISOString(), revoked: false })
      records.set(record.id, { ...record })
      return record
    },
    restoreConsent(record: ConsentRecord): void {
      if (!record.id || !record.runId || !record.scopeHash || !record.createdAt || record.revoked) throw new Error('Persisted consent is invalid or revoked.')
      records.set(record.id, { ...record })
    },
    revoke(consentId: string): void {
      const record = records.get(consentId)
      if (record) record.revoked = true
    },
    authorizePayload<T>(runId: string, bundle: OutboundBundle, payload: T): T {
      const runConsents = [...records.values()].filter(record => record.runId === runId)
      const consent = runConsents.find(record => !record.revoked)
      if (!consent) throw new Error(runConsents.length ? 'Consent was revoked for this run.' : 'No active consent exists for this run.')
      if (consent.scopeHash !== bundle.scopeHash || !bundle.verifyIntegrity()) throw new Error('Authorization scope is stale or has expanded.')
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
