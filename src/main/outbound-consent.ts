import { randomUUID } from 'node:crypto'
import type { OutboundBundle } from '../shared/outbound-consent'

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
      if (consent.scopeHash !== bundle.scopeHash || !bundle.verifyIntegrity()) throw new Error('Authorization scope is stale or has expanded.')
      if (bundle.containsRestoredIdentifier(payload)) throw new Error('Restored identifier is not authorized for outbound payloads.')
      const leaves: string[] = []
      const collect = (value: unknown) => { if (typeof value === 'string') leaves.push(value); else if (Array.isArray(value)) value.forEach(collect); else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(collect) }
      collect(payload)
      if (leaves.some(text => !bundle.isAuthorizedText(text))) throw new Error('Payload contains data outside the authorized bundle; use a scoped workflow-derived intermediate only when appropriate.')
      return payload
    },
    authorizeWorkflowIntermediate<T>(runId: string, bundle: OutboundBundle, intermediate: { scopeHash: string; value: T }): T {
      const runConsents = [...records.values()].filter(record => record.runId === runId)
      const consent = runConsents.find(record => !record.revoked)
      if (!consent) throw new Error(runConsents.length ? 'Consent was revoked for this run.' : 'No active consent exists for this run.')
      if (consent.scopeHash !== bundle.scopeHash || intermediate.scopeHash !== bundle.scopeHash || !bundle.verifyIntegrity()) throw new Error('Workflow intermediate scope is stale or expanded.')
      if (bundle.containsRestoredIdentifier(intermediate.value)) throw new Error('Restored identifier is not authorized for outbound payloads.')
      return intermediate.value
    }
  })
}
