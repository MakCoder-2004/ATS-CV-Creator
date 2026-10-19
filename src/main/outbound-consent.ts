import { randomUUID } from 'node:crypto'
import { hashOutboundScope, type OutboundBundle } from '../shared/outbound-consent'

interface ConsentRecord { id: string; runId: string; scopeHash: string; createdAt: string; revoked: boolean }
export function createOutboundConsentEngine() {
  const records = new Map<string, ConsentRecord>()
  return Object.freeze({
    grantConsent(runId: string, bundle: OutboundBundle, decision: { accepted: boolean; freeTierTermsAcknowledged: boolean }): Readonly<ConsentRecord> {
      if (!decision.accepted) throw new Error('Explicit consent must be accepted.')
      if (!decision.freeTierTermsAcknowledged) throw new Error('Free-tier data-use terms must be acknowledged.')
      const record = Object.freeze({ id: randomUUID(), runId, scopeHash: bundle.scopeHash, createdAt: new Date().toISOString(), revoked: false })
      records.set(record.id, { ...record })
      return record
    },
    revoke(consentId: string): void {
      const record = records.get(consentId)
      if (record) record.revoked = true
    },
    authorizePayload<T>(runId: string, bundle: OutboundBundle, payload: T): T {
      const runConsents = [...records.values()].filter(record => record.runId === runId)
      const consent = runConsents.find(record => !record.revoked)
      if (!consent) throw new Error(runConsents.length ? 'Consent was revoked for this run.' : 'No active consent exists for this run.')
      if (consent.scopeHash !== bundle.scopeHash || hashOutboundScope(bundle.outgoing) !== bundle.scopeHash) throw new Error('Authorization scope is stale or has expanded.')
      if (bundle.containsRestoredIdentifier(payload)) throw new Error('Restored identifier is not authorized for outbound payloads.')
      return payload
    }
  })
}
