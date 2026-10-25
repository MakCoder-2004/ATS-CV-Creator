import { describe, expect, it, vi } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import { normalizeJobResearchUrl, promoteJobResearch, type JobResearchRun } from '../src/shared/job-research'
import { createVolatileResearchAnalysis } from '../src/main/research-volatile-analysis'
import type { PiModelRuntime } from '../src/main/pi-model'
import type { PiModelSelection } from '../src/shared/pi-model'

const runId = '00000000-0000-4000-8000-000000000001'
const sourceId = '00000000-0000-4000-8000-000000000002'
const roleId = '00000000-0000-4000-8000-000000000003'
const companyId = '00000000-0000-4000-8000-000000000004'
const employerSourceId = '00000000-0000-4000-8000-000000000005'
const stamp = '2026-10-25T10:00:00.000Z'
const model = { id: 'synthetic', name: 'Fake', api: 'synthetic' as Api, provider: 'fake', baseUrl: 'https://example.invalid',
  input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: true, contextWindow: 8192, maxTokens: 4096 } as Model<Api>
const selection = { providerId: 'fake', modelId: 'synthetic', thinkingLevel: 'low' as const }
function fixture() {
  const run: JobResearchRun = {
    version: 1, id: runId, selected: { canonicalUrl: 'https://jobs.example.org/post/123', host: 'jobs.example.org', provider: 'generic', roleId: null },
    startedAt: stamp, completedAt: stamp, status: 'provisional', unknowns: ['Salary unknown'],
    sources: [
      { version: 1, id: sourceId, url: 'https://jobs.example.org/post/123', capturedAt: stamp, method: 'indexed-snippet', identity: 'exact-role', title: 'Engineer', employer: 'Example', employerIdentityUrl: 'https://example.org/' },
      { version: 1, id: employerSourceId, url: 'https://example.org/about', capturedAt: stamp, method: 'employer-page', identity: 'verified-employer', title: null, employer: 'Example', employerIdentityUrl: 'https://example.org/' },
    ],
    findings: [
      { version: 1, id: roleId, sourceId, kind: 'indexed-role-claim', text: 'Requires TypeScript experience.', completeness: 'partial' },
      { version: 1, id: companyId, sourceId: employerSourceId, kind: 'verified-company-context', text: 'PRIVATE COMPANY CONTEXT', completeness: 'partial' },
    ],
  }
  let review = promoteJobResearch(run, [roleId], true)
  let choice: PiModelSelection = { ...selection }
  let clock = 1_000
  let response = JSON.stringify({ requirements: [{ text: 'TypeScript experience', category: 'skill', findingIds: [roleId] }] })
  let resolve: ((value: any) => void) | undefined
  const completeSimple = vi.fn(async (_model, _context, _options) => {
    if (resolve) return new Promise<any>(fulfil => { resolve = fulfil })
    return { role: 'assistant', content: [{ type: 'text', text: response }], stopReason: 'stop', usage: { output: 40 } }
  })
  const sdk = { getProviders: () => [], getPhysicalModel: () => model, getAvailable: async () => [model],
    getAuth: async () => ({ source: 'fake' }), completeSimple } as unknown as PiModelRuntime
  const controller = createVolatileResearchAnalysis({ getAppHeldRun: () => run, getAppHeldReview: () => review,
    getPiSelection: () => choice, piRuntime: sdk, now: () => clock })
  return { run, controller, completeSimple, setChoice: (value: typeof choice) => { choice = value },
    setReview: (value: typeof review) => { review = value }, setResponse: (value: string) => { response = value },
    setClock: (value: number) => { clock = value }, holdResponse: () => { resolve = () => {} },
    release: (value: string) => resolve?.({ role: 'assistant', content: [{ type: 'text', text: value }], stopReason: 'stop', usage: { output: 40 } }),
  }
}

describe('volatile, reviewed job-research analysis boundary', () => {
  it('previews exact minimized outgoing text and only dispatches once after explicit consent', async () => {
    const f = fixture(), p = f.controller.preview(runId)
    expect(f.completeSimple).toHaveBeenCalledTimes(0)
    expect(p.outgoingText).toContain('Requires TypeScript experience.')
    expect(p.outgoingText).toContain('https://jobs.example.org/post/123')
    expect(p.outgoingText).toContain('Salary unknown')
    expect(p.outgoingText).not.toContain('PRIVATE COMPANY CONTEXT')
    expect(p.outgoingText).not.toContain('profile') // prompt itself mentions no profile? see instruction below
    expect(p.notice).toContain('charges')
    f.controller.consent(p.token)
    expect(f.completeSimple).toHaveBeenCalledTimes(0)
    const result = await f.controller.start(p.token)
    expect(result.status).toBe('complete')
    expect(result.physicalRequests).toBe(1)
    expect(result.result).toMatchObject({ analysisScope: 'provisional', humanReviewRequired: true, requirements: [{ findingIds: [roleId] }] })
    expect(f.completeSimple).toHaveBeenCalledWith(model, expect.objectContaining({ tools: [], messages: [expect.objectContaining({ content: p.outgoingText })] }), expect.objectContaining({ maxRetries: 0 }))
    await expect(f.controller.start(p.token)).rejects.toThrow(/fresh/)
    expect(() => f.controller.preview(runId)).toThrow(/already/)
  }, 20_000) // Measured ~16s on the cold Pi runtime: this synthetic completion exercises the real Pi model-resolution/import path, without an external provider call.
  it('refuses modified evidence, model, effort or falsified review before dispatch', async () => {
    for (const alter of [(f: ReturnType<typeof fixture>) => { f.run.unknowns.push('New fact') },
      (f: ReturnType<typeof fixture>) => f.setChoice({ ...selection, modelId: 'different' }),
      (f: ReturnType<typeof fixture>) => f.setChoice({ ...selection, thinkingLevel: 'high' }),
      (f: ReturnType<typeof fixture>) => f.setReview({ ...promoteJobResearch(f.run, [roleId], true), evidenceHash: 'a'.repeat(64) })]) {
      const f = fixture(), p = f.controller.preview(runId)
      alter(f)
      expect(() => f.controller.consent(p.token)).toThrow()
      expect(f.completeSimple).toHaveBeenCalledTimes(0)
    }
  })
  it('rechecks selected provider/model/effort and evidence after consent, before dispatch', async () => {
    for (const mutate of [(f: ReturnType<typeof fixture>) => f.setChoice({ ...selection, modelId: 'other' }),
      (f: ReturnType<typeof fixture>) => f.setChoice({ ...selection, thinkingLevel: 'high' }),
      (f: ReturnType<typeof fixture>) => f.run.findings.push({ version: 1, id: '00000000-0000-4000-8000-000000000006', sourceId, kind: 'indexed-role-claim', text: 'Changed', completeness: 'partial' })]) {
      const f = fixture(), p = f.controller.preview(runId)
      f.controller.consent(p.token)
      mutate(f)
      await expect(f.controller.start(p.token)).rejects.toThrow(/changed/)
      expect(f.completeSimple).toHaveBeenCalledTimes(0)
    }
  })
  it('requires fresh review and consent after discard instead of replaying cached authorization', async () => {
    const f = fixture(), first = f.controller.preview(runId)
    f.controller.consent(first.token)
    expect((await f.controller.start(first.token)).physicalRequests).toBe(1)
    f.controller.discard(first.token)
    const second = f.controller.preview(runId)
    expect(second.token).not.toBe(first.token)
    expect(f.completeSimple).toHaveBeenCalledTimes(1)
    await expect(f.controller.start(second.token)).rejects.toThrow(/fresh/)
  })
  it('does not publish foreign citations or automatically retry ambiguous provider outcomes', async () => {
    const f = fixture(), p = f.controller.preview(runId)
    f.setResponse(JSON.stringify({ requirements: [{ text: 'Company policy', category: 'qualification', findingIds: [companyId] }] }))
    f.controller.consent(p.token)
    expect(await f.controller.start(p.token)).toMatchObject({ status: 'uncertain', physicalRequests: 1 })
    await expect(f.controller.start(p.token)).rejects.toThrow(/fresh/)
    expect(f.completeSimple).toHaveBeenCalledTimes(1)
  })
  it('discards late responses after cancellation and blocks concurrent duplicate dispatch', async () => {
    const f = fixture(), p = f.controller.preview(runId)
    f.holdResponse(); f.controller.consent(p.token)
    const pending = f.controller.start(p.token)
    await expect(f.controller.start(p.token)).rejects.toThrow(/fresh/)
    await vi.waitFor(() => expect(f.completeSimple).toHaveBeenCalledTimes(1))
    expect(f.controller.cancel(p.token)).toMatchObject({ status: 'cancelled', physicalRequests: 1 })
    f.release(JSON.stringify({ requirements: [] }))
    expect(await pending).toMatchObject({ status: 'cancelled', physicalRequests: 1 })
    expect(f.controller.read(p.token).result).toBeUndefined()
  })
  it('rejects sensitive values and opaque generic identity queries before consent or provider access', () => {
    for (const query of ['candidate=alice%40example.com', 'ref=+1-202-555-0144', 'campaign=eyJhbGciOiJIUzI1NiJ9.payload.signature', 'posting=opaque-identity']) {
      const f = fixture()
      f.run.sources[0].url = `https://jobs.example.org/post/123?${query}`
      f.run.selected.canonicalUrl = normalizeJobResearchUrl(f.run.sources[0].url).canonicalUrl
      f.setReview(promoteJobResearch(f.run, [roleId], true))
      expect(() => f.controller.preview(runId)).toThrow()
      expect(f.completeSimple).toHaveBeenCalledTimes(0)
    }
  })
  it('checks selected generic identity query values and sends query-free generic tracking URLs', () => {
    const f = fixture()
    f.run.sources[0].url = 'https://jobs.example.org/post/123?candidate=alice%40example.com'
    f.run.selected.canonicalUrl = normalizeJobResearchUrl(f.run.sources[0].url).canonicalUrl
    f.setReview(promoteJobResearch(f.run, [roleId], true))
    expect(() => f.controller.preview(runId)).toThrow()
    const g = fixture()
    g.run.sources[0].url += '?utm_source=search'
    g.setReview(promoteJobResearch(g.run, [roleId], true))
    const preview = g.controller.preview(runId)
    expect(preview.outgoingText).toContain('https://jobs.example.org/post/123')
    expect(preview.outgoingText).not.toContain('utm_source')
  })
  it('sends canonical LinkedIn and Indeed identities without original query context', () => {
    for (const [provider, canonical, source] of [
      ['linkedin', 'https://www.linkedin.com/jobs/view/4464025097/', 'https://www.linkedin.com/jobs/view/4464025097/?trackingId=synthetic'],
      ['indeed', 'https://www.indeed.com/viewjob?jk=1234567890abcdef', 'https://www.indeed.com/viewjob?jk=1234567890abcdef&from=search'],
    ] as const) {
      const f = fixture()
      f.run.selected = { canonicalUrl: canonical, host: new URL(canonical).hostname, provider, roleId: provider === 'linkedin' ? '4464025097' : '1234567890abcdef' }
      f.run.sources[0].url = source
      f.setReview(promoteJobResearch(f.run, [roleId], true))
      const outgoing = f.controller.preview(runId).outgoingText
      expect(outgoing).toContain(canonical)
      expect(outgoing).not.toContain('trackingId')
      expect(outgoing).not.toContain('from=search')
    }
  })
  it('rejects no role evidence, expiry and declined consent without calls', async () => {
    const f = fixture()
    f.run.status = 'none'; f.run.findings = f.run.findings.filter(item => item.kind === 'verified-company-context')
    expect(() => f.controller.preview(runId)).toThrow()
    const g = fixture(), p = g.controller.preview(runId)
    g.controller.decline(p.token)
    await expect(g.controller.start(p.token)).rejects.toThrow(/fresh/)
    expect(g.completeSimple).toHaveBeenCalledTimes(0)
    const h = fixture(), q = h.controller.preview(runId)
    h.setClock(q.expiresAt)
    expect(() => h.controller.consent(q.token)).toThrow(/expired/)
    expect(h.completeSimple).toHaveBeenCalledTimes(0)
  })
})
