import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { PROVISIONAL_REVIEW_ACKNOWLEDGEMENT, ProvisionalResearchAnalysis, ProvisionalReviewedSources, createProvisionalReviewSession, createSourceOpenHandler } from '../src/renderer/ProvisionalResearchAnalysis'
import type { WorkbenchAPI } from '../src/shared/appearance'
import type { VolatileAnalysisPreview, VolatileAnalysisProgress } from '../src/shared/research-volatile-analysis'

const runId = '82ba16d3-94d2-44fd-8cc0-964594182391'
const findingId = '6af45cdb-2c38-4a20-9720-5c0d36fa92b6'
const sourceId = '3e6b12f6-d61d-47aa-8241-0a98b4cd91b7'
const token = 'e5689b24-feb5-478b-a96e-aab98c7127c4'
const evidence = { findingId, sourceId, url: 'https://jobs.example.org/role/123', capturedAt: '2026-10-25T10:00:00Z', kind: 'indexed-role-claim' as const, completeness: 'partial' as const, text: 'Use TypeScript for role tasks.' }
const outgoing = { version: 1 as const, researchRunId: runId, selected: { canonicalUrl: 'https://jobs.example.org/role/123', host: 'jobs.example.org', provider: 'generic', roleId: null }, analysisScope: 'provisional' as const, unknowns: ['Full posting unavailable'], roleEvidence: [evidence] }
const preview: VolatileAnalysisPreview = { token, expiresAt: Date.now() + 100_000, selection: { providerId: 'demo-provider', modelId: 'model', thinkingLevel: 'low' }, analysisScope: 'provisional', outgoingText: `Extract only role evidence.\n${JSON.stringify(outgoing)}`, notice: 'Provider may retain data; cancellation may incur charges.' }
const progress = (status: VolatileAnalysisProgress['status']): VolatileAnalysisProgress => ({ token, status, physicalRequests: status === 'complete' ? 1 : 0 })
function fixture() {
  const api = {
    previewResearchAnalysis: vi.fn(async () => preview),
    consentResearchAnalysis: vi.fn(async () => progress('consented')),
    startResearchAnalysis: vi.fn(async (): Promise<VolatileAnalysisProgress> => ({ ...progress('complete'), result: { researchRunId: runId, analysisScope: 'provisional', evidence: [evidence], requirements: [{ category: 'skill', text: 'TypeScript (provider suggestion)', findingIds: [findingId] }], unknowns: outgoing.unknowns, humanReviewRequired: true } })),
    cancelResearchAnalysis: vi.fn(async () => progress('cancelled')),
    discardResearchAnalysis: vi.fn(async () => ({ ok: true as const })),
  }
  return api
}

describe('temporary research review', () => {
  test('source open is inert until its explicit action runs; reports a sanitized failure and truthful acknowledgement', async () => {
    const openPostingSource = vi.fn(async () => { throw new Error('Unsupported URL: private internal detail') })
    const report = vi.fn()
    const onClick = createSourceOpenHandler({ openPostingSource }, evidence.url, 'finding 1', report)
    expect(openPostingSource).not.toHaveBeenCalled()
    expect(PROVISIONAL_REVIEW_ACKNOWLEDGEMENT).toBe('I reviewed the displayed user message and understand a separate JSON-schema instruction is sent to Pi')

    await onClick()
    expect(openPostingSource).toHaveBeenCalledTimes(1)
    expect(openPostingSource).toHaveBeenCalledWith(evidence.url)
    expect(report).toHaveBeenNthCalledWith(1, 'Opening source for finding 1…', false)
    expect(report).toHaveBeenNthCalledWith(2, 'Could not open source for finding 1. Check the source address and try again; unsupported or unavailable sources cannot be opened.', true)
    expect(report.mock.calls.flat().join(' ')).not.toContain('private internal detail')
  })
  test('reviewed source cards hide finding IDs while exact outgoing data retains source attribution', () => {
    const sourcePanel = renderToStaticMarkup(React.createElement(ProvisionalReviewedSources, { evidence: outgoing.roleEvidence, openingSources: new Set<string>(), sourceStatuses: {}, onOpen() {} }))
    expect(sourcePanel).not.toContain('Finding ID:')
    expect(sourcePanel).toContain(`id="research-finding-1"`)
    expect(sourcePanel).toContain('Open source for finding 1')
    expect(sourcePanel).toContain(evidence.url)
    expect(sourcePanel).toContain(evidence.text)
    expect(preview.outgoingText).toContain(findingId)
    expect(preview.outgoingText).toContain(evidence.url)
    expect(preview.outgoingText).toContain('"findingId"')
  })

  test('no preview or provider dispatch on render; inspection, checkbox and consent never dispatch', async () => {
    const api = fixture()
    const html = renderToStaticMarkup(React.createElement(ProvisionalResearchAnalysis, { researchToken: runId, onClose() {}, api }))
    expect(html).toContain('<button')
    expect(html).toContain('Inspect outgoing data')
    expect(html).toContain('Discard and close')
    expect(html).not.toContain('Start analysis')
    expect(html).not.toContain('Export')
    expect(api.previewResearchAnalysis).not.toHaveBeenCalled()
    const session = createProvisionalReviewSession(api, runId)
    await session.start(); await session.authorize()
    expect(api.startResearchAnalysis).toHaveBeenCalledTimes(0)
    await session.inspect()
    expect(api.previewResearchAnalysis).toHaveBeenCalledWith(runId)
    expect(session.getSnapshot().preview?.outgoingText).toBe(preview.outgoingText)
    await session.authorize(); await session.start()
    expect(api.consentResearchAnalysis).toHaveBeenCalledTimes(0)
    session.setReviewed(true)
    await session.authorize()
    expect(session.getSnapshot().phase).toBe('authorized')
    expect(api.startResearchAnalysis).toHaveBeenCalledTimes(0)
    await session.start()
    expect(api.startResearchAnalysis).toHaveBeenCalledTimes(1)
    expect(session.getSnapshot().phase).toBe('complete')
    session.close()
  })

  test('close during late inspection discards the late token and never publishes it', async () => {
    let deliver!: (value: VolatileAnalysisPreview) => void
    const api = fixture()
    api.previewResearchAnalysis.mockImplementation(() => new Promise(resolve => { deliver = resolve }))
    const session = createProvisionalReviewSession(api, runId)
    const pending = session.inspect()
    session.close()
    deliver(preview)
    await pending
    expect(api.discardResearchAnalysis).toHaveBeenCalledWith(token)
    expect(api.startResearchAnalysis).toHaveBeenCalledTimes(0)
    expect(session.getSnapshot().preview).toBeUndefined()
  })

  test('cancel suppresses late provider completion and offers no replay', async () => {
    let deliver!: (value: VolatileAnalysisProgress) => void
    const api = fixture()
    api.startResearchAnalysis.mockImplementation(() => new Promise(resolve => { deliver = resolve }))
    const session = createProvisionalReviewSession(api, runId)
    await session.inspect(); session.setReviewed(true); await session.authorize()
    const pending = session.start()
    await session.cancel()
    deliver({ ...progress('complete'), result: { researchRunId: runId, analysisScope: 'provisional', evidence: [evidence], requirements: [], unknowns: [], humanReviewRequired: true } })
    await pending
    expect(session.getSnapshot().phase).toBe('cancelled')
    expect(session.getSnapshot().result).toBeUndefined()
    await session.start()
    expect(api.startResearchAnalysis).toHaveBeenCalledTimes(1)
    session.close()
  })

  test('closing an authorized review cancels before discarding, without dispatch', async () => {
    const events: string[] = []
    const api = fixture()
    api.cancelResearchAnalysis.mockImplementation(async () => { events.push('cancel'); return progress('cancelled') })
    api.discardResearchAnalysis.mockImplementation(async () => { events.push('discard'); return { ok: true } })
    const session = createProvisionalReviewSession(api, runId)
    await session.inspect(); session.setReviewed(true); await session.authorize()
    session.close()
    await vi.waitFor(() => expect(events).toEqual(['cancel', 'discard']))
    expect(api.startResearchAnalysis).not.toHaveBeenCalled()
  })

  test('provisional suggestions require reviewed finding IDs; no fabricated full posting', async () => {
    const api = fixture()
    const session = createProvisionalReviewSession(api, runId)
    await session.inspect(); session.setReviewed(true); await session.authorize(); await session.start()
    expect(session.getSnapshot()).toMatchObject({ phase: 'complete', result: { analysisScope: 'provisional', humanReviewRequired: true, unknowns: ['Full posting unavailable'] } })
    expect(session.getSnapshot().outgoing?.roleEvidence[0].url).toBe(evidence.url)
    expect(session.getSnapshot().outgoing?.roleEvidence[0].kind).toBe('indexed-role-claim')
    session.close()
    const invalid = fixture()
    invalid.startResearchAnalysis.mockResolvedValue({ ...progress('complete'), result: { ...((await fixture().startResearchAnalysis()).result!), requirements: [{ category: 'skill', text: 'Unlinked', findingIds: [sourceId] }] } })
    const second = createProvisionalReviewSession(invalid, runId)
    await second.inspect(); second.setReviewed(true); await second.authorize(); await second.start()
    expect(second.getSnapshot().result).toBeUndefined()
    expect(second.getSnapshot().phase).toBe('error')
    second.close()
  })
})
