import { describe, expect, it } from 'vitest'
import { prepareOutboundBundle, type ConsentSource } from '../src/shared/outbound-consent'
import { createOutboundConsentEngine } from '../src/main/outbound-consent'

const source: ConsentSource = {
  job: { id: 'job-1', revision: 3, title: 'Staff Engineer', company: 'Northstar Labs', description: 'Northstar Labs needs a leader. Contact jobs@northstar.example or 555-013-0022; build systems in 2022-06.' },
  profile: {
    revision: [['profile-revision', 8]],
    contact: { fullName: 'Ada Lovelace', email: 'ada.private@example.test', phone: '555-0199', location: 'London' },
    experience: [{ id: 'exp-1', revision: 2, title: 'Engineer', organization: 'Northstar Labs', startDate: '2019-01', endDate: '2022-05', description: 'Ada Lovelace built reliable systems at Northstar Labs.', factualItems: [{ id: 'fact-1', revision: 1, text: 'Led migration.' }] }],
    projects: [{ id: 'project-1', revision: 1, name: 'Orion Ledger', description: 'Orion Ledger reduced latency.', factualItems: [], technologies: [], links: [{ label: 'source', url: 'https://private.example.test' }] }],
    skills: [{ id: 'skill-1', revision: 1, name: 'TypeScript', category: 'Programming' }],
    education: [{ id: 'edu-1', revision: 1, section: 'education', title: 'MSc', institution: 'Westbridge University', startDate: '2015', endDate: '2017' }],
    summary: [{ section: 'summary', description: 'SECRET SUMMARY' }], languages: [{ section: 'languages', title: 'Secret language' }], extras: [{ section: 'extras', title: 'Secret extra' }]
  },
  model: { name: 'minimax/minimax-m3.1-flash:free', temperature: 0.2, ...({ apiKey: 'DO_NOT_SEND_KEY', arbitrary: 'private config' } as {}) }
}

describe('outbound consent public contract', () => {
  it('minimizes free text, substitutes stable placeholders and excludes local-only fields including saved-job contacts', () => {
    const jobWithContact = { ...source.job, contacts: [{ id: 'contact-1', name: 'Morgan Recruiter', role: 'HR', profileUrl: 'https://example.com/morgan' }] }
    const bundle = prepareOutboundBundle({ ...source, job: jobWithContact })
    const wire = JSON.stringify(bundle.outgoing)
    for (const secret of ['Ada Lovelace', 'Northstar Labs', 'Orion Ledger', 'Westbridge University', 'ada.private@example.test', '555-0199', 'London', 'jobs@northstar.example', '555-013-0022', '2022-06', '2019-01', '2022-05', 'SECRET SUMMARY', 'Secret language', 'Secret extra', 'private.example.test', 'Morgan Recruiter', 'https://example.com/morgan']) expect(wire).not.toContain(secret)
    expect(wire).toContain('[[EMPLOYER_1]]')
    expect(wire).toContain('[[PERSON_1]]')
    expect(wire).toContain('[[PROJECT_1]]')
    expect(wire).not.toContain('DO_NOT_SEND_KEY')
    expect(wire).not.toContain('job-1')
    expect(wire).not.toContain('exp-1')
    expect(bundle.preview.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/identify/i)]))
    expect(bundle.restoreIdentifiers('[[EMPLOYER_1]] / [[PROJECT_1]]')).toBe('Northstar Labs / Orion Ledger')
    expect(bundle.outgoing.job.description).toContain('[DATE_OMITTED]')
  })

  it('protects only exact app-held UUID protocol IDs from phone-pattern scrubbing', () => {
    const trustedId = '12345678-1234-4234-8234-123456789012'
    const untrustedUuid = '87654321-4321-4321-8321-987654321098'
    const bundle = prepareOutboundBundle({ ...source, profile: { ...source.profile, experience: [{ ...source.profile.experience[0], id: trustedId }] } })
    const prompt = bundle.minimizeIdentifiers(JSON.stringify({ evidenceId: trustedId, freeText: untrustedUuid, marker: '[[PROTOCOL_UUID_0]]', adjacentPhone: 'Call 1234567890.' }))
    expect(JSON.parse(prompt)).toMatchObject({ evidenceId: trustedId, freeText: '[REDACTED_PHONE]', marker: '[[PROTOCOL_UUID_0]]', adjacentPhone: 'Call [REDACTED_PHONE].' })
    expect(bundle.containsRestoredIdentifier({ text: trustedId })).toBe(false)
    expect(bundle.containsRestoredIdentifier({ text: untrustedUuid })).toBe(true)
  })

  it('freezes per-run authorization and rejects absent, revoked, stale, expanded or restored-identifier payloads', () => {
    const bundle = prepareOutboundBundle(source)
    const engine = createOutboundConsentEngine()
    expect(() => engine.authorizePayload('run-a', bundle, { text: 'hello' })).toThrow(/consent/i)
    const consent = engine.grantConsent('run-a', bundle, { accepted: true, privacyAcknowledged: true })
    expect(() => engine.authorizePayload('run-a', bundle, { text: 'hello Ada Lovelace' })).toThrow(/identifier/i)
    const mutable = { text: bundle.outgoing.job.description }
    const authorized = engine.authorizePayload('run-a', bundle, mutable)
    expect(authorized).toEqual({ text: bundle.outgoing.job.description })
    mutable.text = 'secret after authorization'
    expect(authorized.text).toBe(bundle.outgoing.job.description)
    expect(Object.isFrozen(authorized)).toBe(true)
    // A matching scope hash alone cannot prove that new text came from the workflow.
    expect(() => engine.authorizePayload('run-a', bundle, { analysis: 'forged workflow-derived text', scopeHash: bundle.scopeHash })).toThrow(/scope|authorized/i)
    expect(() => engine.authorizePayload('run-a', bundle, { text: 'new secret acquisition strategy' })).toThrow(/scope|derived|authorized/i)
    expect(() => engine.authorizePayload('run-a', bundle, { text: 'Added a new sensitive fact: my medical leave' })).toThrow(/scope|derived|authorized/i)
    expect(() => engine.authorizePayload('run-a', bundle, { text: bundle.outgoing.job.description, privateSalary: 987654321 })).toThrow(/scope|authorized/i)
    expect(() => engine.authorizePayload('run-a', bundle, { 'ada.private@example.test': bundle.outgoing.job.description })).toThrow(/scope|authorized|identifier/i)
    expect(() => engine.authorizePayload('run-a', bundle, { text: '[[EMPLOYER_999]]' })).toThrow(/scope|authorized/i)
    expect(() => engine.authorizePayload('run-a', bundle, { text: 'added contact ada.private@example.test' })).toThrow(/identifier|scope/i)
    engine.revoke(consent.id)
    expect(() => engine.authorizePayload('run-a', bundle, { text: 'hello' })).toThrow(/revok/i)
    const next = engine.grantConsent('run-b', bundle, { accepted: true, privacyAcknowledged: true })
    expect(() => engine.authorizePayload('run-b', prepareOutboundBundle({ ...source, job: { ...source.job, revision: 4 } }), { text: 'hello' })).toThrow(/scope|stale/i)
    expect(next.id).not.toBe(consent.id)
  })

  it('binds Pi provider, model, and effort to the authorized outgoing scope', () => {
    const selected = prepareOutboundBundle({ ...source, model: { name: 'gpt-6-luna', providerId: 'openai-codex', thinkingLevel: 'low' } })
    const otherProvider = prepareOutboundBundle({ ...source, model: { name: 'gpt-6-luna', providerId: 'other-provider', thinkingLevel: 'low' } })
    const otherEffort = prepareOutboundBundle({ ...source, model: { name: 'gpt-6-luna', providerId: 'openai-codex', thinkingLevel: 'high' } })
    expect(selected.outgoing.model).toEqual({ name: 'gpt-6-luna', providerId: 'openai-codex', thinkingLevel: 'low' })
    expect(selected.scopeHash).not.toBe(otherProvider.scopeHash)
    expect(selected.scopeHash).not.toBe(otherEffort.scopeHash)
    expect(() => prepareOutboundBundle({ ...source, model: { name: 'gpt-6-luna', providerId: 'openai-codex' } })).toThrow(/thinking level/i)
  })

  it('does not let short restored organization identifiers escape in an extra prompt', () => {
    const bundle = prepareOutboundBundle({ ...source, job: { ...source.job, company: 'AI' }, profile: { ...source.profile, experience: [{ ...source.profile.experience[0], organization: 'AI' }] } })
    const engine = createOutboundConsentEngine()
    engine.grantConsent('short-name', bundle, { accepted: true, privacyAcknowledged: true })
    expect(JSON.stringify(bundle.outgoing)).not.toContain('"AI"')
    expect(() => engine.authorizePayload('short-name', bundle, { text: 'AI' })).toThrow(/identifier|authorized/i)
  })

  it('rejects missing, partial, and malformed restored purpose commitments', () => {
    const bundle = prepareOutboundBundle(source)
    const engine = createOutboundConsentEngine()
    const valid = engine.grantConsent('12345678-1234-4234-8234-123456789012', bundle, { accepted: true, privacyAcknowledged: true })
    const complete = { ...valid }
    expect(() => engine.restoreConsent(complete)).not.toThrow()
    for (const field of ['purposeVersion', 'purpose', 'purposeHash'] as const) {
      const partial = { ...valid } as Record<string, unknown>
      delete partial[field]
      expect(() => engine.restoreConsent(partial as never)).toThrow(/invalid|purpose/i)
    }
    for (const malformed of [
      { ...valid, purpose: 'cv+cover-letter', purposeHash: valid.purposeHash },
      { ...valid, purposeVersion: 2 },
      { ...valid, purpose: 'invalid' },
      { ...valid, purposeHash: 'f'.repeat(64) },
    ]) expect(() => engine.restoreConsent(malformed as never)).toThrow(/invalid|purpose/i)
  })

  it('requires explicit per-run consent and binds model configuration and exact evidence/job revisions', () => {
    const engine = createOutboundConsentEngine()
    const bundle = prepareOutboundBundle(source)
    expect(() => engine.grantConsent('run', bundle, { accepted: false, privacyAcknowledged: true })).toThrow(/accept/i)
    expect(() => engine.grantConsent('run', bundle, { accepted: true, privacyAcknowledged: false })).toThrow(/privacy notice/i)
    engine.grantConsent('run-1', bundle, { accepted: true, privacyAcknowledged: true })
    expect(() => engine.authorizePayload('run-2', bundle, { text: 'retry' })).toThrow(/consent/i)
    expect(() => engine.authorizePayload('run-1', prepareOutboundBundle({ ...source, model: { name: 'anthropic/claude-3.5-sonnet', temperature: 0.2 } }), { text: 'retry' })).toThrow(/scope|stale/i)
  })
})
