import { describe, expect, it, vi } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import { readFileSync } from 'node:fs'
import { createJobResearchSessions } from '../src/main/job-research-session'
import { createVolatileResearchAnalysis } from '../src/main/research-volatile-analysis'
import type { PiModelRuntime } from '../src/main/pi-model'
import type { PiModelSelection } from '../src/shared/pi-model'
import type { JobResearchRun } from '../src/shared/job-research'
import { researchAnalysisTokenSchema, researchAnalysisPreviewReplySchema, researchAnalysisProgressReplySchema, researchAnalysisConsentSchema } from '../src/shared/research-volatile-analysis-ipc'

const id = '00000000-0000-4000-8000-000000000001'
const findingId = '00000000-0000-4000-8000-000000000002'
const sourceId = '00000000-0000-4000-8000-000000000003'
const url = 'https://jobs.example.org/post/123'
const stamp = '2026-10-25T10:00:00.000Z'
const fixture: JobResearchRun = { version: 1, id, selected: { canonicalUrl: url, host: 'jobs.example.org', provider: 'generic', roleId: null }, startedAt: stamp, completedAt: stamp,
  status: 'provisional', sources: [{ version: 1, id: sourceId, url, capturedAt: stamp, method: 'indexed-snippet', identity: 'exact-role', title: 'Engineer', employer: 'Example', employerIdentityUrl: null }],
  findings: [{ version: 1, id: findingId, sourceId, kind: 'indexed-role-claim', text: 'TypeScript required.', completeness: 'partial' }], unknowns: ['Hours unknown'] }
const model = { id: 'synthetic', name: 'Fake', api: 'synthetic' as Api, provider: 'fake', baseUrl: 'https://example.invalid', input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: true, contextWindow: 8192, maxTokens: 4096 } as Model<Api>
const selection = { providerId: 'fake', modelId: 'synthetic', thinkingLevel: 'low' as const }
async function connected() {
  let clock = 0
  const sessions = createJobResearchSessions({ credentials: { status: async () => ({ configured: false, storageAvailable: false, message: '' }), withKey: async () => { throw Error('No search') } } as never,
    direct: async () => structuredClone(fixture), now: () => clock })
  const { token } = sessions.startJobResearch(url)
  await vi.waitFor(() => expect(sessions.getJobResearch(token).status).toBe('ready'))
  let choice: PiModelSelection = { ...selection }, epoch = 0
  const requests = vi.fn(async () => ({ role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ requirements: [{ text: 'TypeScript', category: 'skill', findingIds: [findingId] }] }) }], stopReason: 'stop', usage: { output: 40 } }))
  let releaseAuth: (() => void) | undefined
  let authGate: Promise<void> | undefined
  const getAvailable = vi.fn(async () => { if (authGate) await authGate; return [model] })
  const sdk = { getProviders: () => [], getPhysicalModel: () => model, getAvailable,
    getAuth: async () => ({ source: 'synthetic' }), completeSimple: requests } as unknown as PiModelRuntime
  const controller = createVolatileResearchAnalysis({ getAppHeldRun: runId => sessions.getReviewedRunById(runId).run,
    getAppHeldReview: runId => sessions.getReviewedRunById(runId).review, getPiSelection: () => choice, getSelectionEpoch: () => epoch, piRuntime: sdk })
  return { sessions, token, controller, requests, getAvailable, changeModel: () => { choice = { ...selection, thinkingLevel: 'high' }; epoch++ },
    holdAuth: () => { authGate = new Promise<void>(resolve => { releaseAuth = resolve }) }, releaseAuth: () => releaseAuth?.(),
    advanceTime: (milliseconds: number) => { clock += milliseconds } }
}

describe('trusted provisional research analysis seam', () => {
  it('accepts only an app-held reviewed run; no provider request before explicit consent', async () => {
    const f = await connected()
    expect(() => f.controller.preview(id)).toThrow(/reviewed/)
    expect(() => f.sessions.getReviewedRun('00000000-0000-4000-8000-000000000099')).toThrow()
    expect(f.requests).toHaveBeenCalledTimes(0)
    f.sessions.reviewJobResearch(f.token, [findingId], true)
    const p = researchAnalysisPreviewReplySchema.parse(f.controller.preview(f.sessions.getReviewedRun(researchAnalysisTokenSchema.parse(f.token)).run.id))
    expect(p.outgoingText).toContain('TypeScript required.')
    expect(p.outgoingText).toContain('Hours unknown')
    expect(p.outgoingText).not.toContain('profile data')
    expect(p.notice).toContain('JSON-schema system message')
    expect(f.requests).toHaveBeenCalledTimes(0)
    expect(() => researchAnalysisConsentSchema.parse('true')).toThrow()
    researchAnalysisProgressReplySchema.parse(f.controller.consent(p.token))
    expect(f.requests).toHaveBeenCalledTimes(0)
    expect(researchAnalysisProgressReplySchema.parse(await f.controller.start(p.token))).toMatchObject({ status: 'complete', physicalRequests: 1, result: { analysisScope: 'provisional', humanReviewRequired: true } })
    expect(f.requests).toHaveBeenCalledTimes(1)
    expect(() => f.sessions.getReviewedRunById('00000000-0000-4000-8000-000000000099')).toThrow()
    f.controller.close(); f.sessions.close()
  }, 20_000) // Electron ABI 140 showed this real synthetic end-to-end consent/completion case can take ~16s on a cold Pi runtime; no external provider call is made.
  it('revokes completed results and source evidence after research cancellation or expiry', async () => {
    for (const revoke of ['cancel', 'expire'] as const) {
      const f = await connected()
      f.sessions.reviewJobResearch(f.token, [findingId], true)
      const p = f.controller.preview(id)
      f.controller.consent(p.token)
      expect(await f.controller.start(p.token)).toMatchObject({ status: 'complete', result: { evidence: [{ text: 'TypeScript required.' }] } })
      if (revoke === 'cancel') f.sessions.cancelJobResearch(f.token)
      else f.advanceTime(15 * 60_000)
      expect(() => f.controller.read(p.token)).toThrow()
      expect(() => f.sessions.getReviewedRunById(id)).toThrow()
      expect(f.requests).toHaveBeenCalledTimes(1)
      f.controller.close(); f.sessions.close()
    }
  }, 20_000) // Two synthetic completions run on a cold Pi runtime; no external provider call is made.
  it('rejects changed model/effort before dispatch and revoked research after review', async () => {
    const f = await connected()
    f.sessions.reviewJobResearch(f.token, [findingId], true)
    const p = f.controller.preview(id)
    f.changeModel()
    expect(() => f.controller.consent(p.token)).toThrow(/changed/)
    expect(f.requests).toHaveBeenCalledTimes(0)
    const g = await connected(); g.sessions.reviewJobResearch(g.token, [findingId], true)
    const q = g.controller.preview(id); g.controller.consent(q.token)
    g.sessions.cancelJobResearch(g.token)
    await expect(g.controller.start(q.token)).rejects.toThrow()
    expect(g.requests).toHaveBeenCalledTimes(0)
    f.controller.close(); g.controller.close()
  })
  it('does not publish a provider response after the app-held research is revoked in flight', async () => {
    const f = await connected(); f.sessions.reviewJobResearch(f.token, [findingId], true)
    const p = f.controller.preview(id); f.controller.consent(p.token)
    let release!: (value: { role: 'assistant'; content: { type: 'text'; text: string }[]; stopReason: 'stop'; usage: { output: number } }) => void
    f.requests.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const pending = f.controller.start(p.token)
    await vi.waitFor(() => expect(f.requests).toHaveBeenCalledTimes(1))
    f.sessions.cancelJobResearch(f.token)
    release({ role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ requirements: [] }) }], stopReason: 'stop', usage: { output: 1 } })
    expect(await pending).toMatchObject({ status: 'uncertain', physicalRequests: 1 })
    expect(() => f.controller.read(p.token)).toThrow()
    f.controller.close(); f.sessions.close()
  })
  it('checks model selection again at the physical dispatch boundary after provider authentication', async () => {
    const f = await connected(); f.sessions.reviewJobResearch(f.token, [findingId], true)
    const p = f.controller.preview(id); f.controller.consent(p.token); f.holdAuth()
    const pending = f.controller.start(p.token)
    await vi.waitFor(() => expect(f.getAvailable).toHaveBeenCalledTimes(1))
    expect(f.requests).toHaveBeenCalledTimes(0)
    f.changeModel(); f.releaseAuth()
    expect(await pending).toMatchObject({ status: 'uncertain', physicalRequests: 0 })
    expect(f.requests).toHaveBeenCalledTimes(0)
    f.controller.close(); f.sessions.close()
  })
  it('preload IPC imports stay browser-safe and neither volatile controller nor trusted handlers write durable rows', () => {
    const shared = readFileSync('src/shared/research-volatile-analysis.ts', 'utf8')
    const preload = readFileSync('src/preload/index.ts', 'utf8')
    const main = readFileSync('src/main/index.ts', 'utf8')
    const controller = readFileSync('src/main/research-volatile-analysis.ts', 'utf8')
    expect(shared).not.toContain("from './job-research'")
    expect(shared).not.toMatch(/node:(?:crypto|fs|sqlite)/)
    for (const method of ['preview', 'consent', 'start', 'read', 'cancel', 'discard']) {
      expect(main).toContain(`ipcMain.handle('research-analysis:${method}'`)
      expect(preload).toContain(`ipcRenderer.invoke('research-analysis:${method}'`)
    }
    expect(main).toContain('trusted(event)')
    expect(controller).not.toMatch(/\b(?:db\.prepare|saveJob|cache|backup)\(/)
    expect(preload).not.toContain("from '../shared/job-research'")
  })
})
