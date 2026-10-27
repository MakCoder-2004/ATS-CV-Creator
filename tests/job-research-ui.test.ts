import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cancelPostingCaptureForManual, JobResearchFindings, JobResearchReview, startJobResearchFromIntake, startResearchWithCaptureLifecycle, transitionCapturedRead } from '../src/renderer/JobResearchReview'
import type { JobResearchRun } from '../src/shared/job-research-schema'
import { SavedJobs, temporaryDirectNotice } from '../src/renderer/SavedJobs'
import { createProvisionalReviewSession } from '../src/renderer/ProvisionalResearchAnalysis'

describe('universal research intake', () => {
  it('discards outgoing text from the session store on close and cancels the named preview token', async () => {
    const token = '00000000-0000-4000-8000-000000000001'
    const outgoing = { version: 1, researchRunId: token, selected: { canonicalUrl: 'https://jobs.example.org/role/1', host: 'jobs.example.org', provider: 'generic', roleId: null }, analysisScope: 'provisional', unknowns: [], roleEvidence: [{ findingId: token, sourceId: token, url: 'https://jobs.example.org/role/1', capturedAt: '2026-10-25T10:00:00Z', kind: 'direct-role-text', completeness: 'partial', text: 'Sensitive synthetic role wording' }] }
    const discardResearchAnalysis = vi.fn(async () => {})
    const api = { previewResearchAnalysis: async () => ({ token, expiresAt: Date.now() + 900_000, selection: { providerId: 'fake', modelId: 'fake', thinkingLevel: 'low' }, analysisScope: 'provisional', outgoingText: `Prompt\n${JSON.stringify(outgoing)}`, notice: 'Temporary' }), discardResearchAnalysis,
      consentResearchAnalysis: vi.fn(), startResearchAnalysis: vi.fn(), cancelResearchAnalysis: vi.fn() } as unknown as Parameters<typeof createProvisionalReviewSession>[0]
    const session = createProvisionalReviewSession(api, token)
    await session.inspect()
    expect(session.getSnapshot().outgoing?.roleEvidence[0].text).toBe('Sensitive synthetic role wording')
    session.close()
    expect(session.getSnapshot().outgoing).toBeUndefined()
    expect(session.getSnapshot().preview).toBeUndefined()
    expect(discardResearchAnalysis).toHaveBeenCalledWith(token)
  })
  it('offers an explicit research action and a separate manual posting route, without beginning research during render', () => {
    const html = renderToStaticMarkup(React.createElement(SavedJobs, { jobs: [], activeJob: null, onSaved: () => {}, onOpened: () => {}, onDeleted: async () => {}, onNavigate: () => {} }))
    expect(html).toContain('Import from link')
    expect(html).toContain('Posting and requirements')
    expect(html).toContain('Paste posting text instead')
    expect(html).toContain('Generic/direct LinkedIn, Indeed and Lever reads remain paused. The separate named Lever API route requires its own per-run local opt-in and review.')
    const source = readFileSync(new URL('../src/renderer/SavedJobs.tsx', import.meta.url), 'utf8')
    expect(source).toContain('placeholder="Paste a public job posting link"')
    expect(source).not.toContain('placeholder="https://www.linkedin.com')
    expect(html).not.toContain('Public Lever posting link')
    expect(html).not.toContain('Research indexed details')
  })
  it('keeps synthetic partial role evidence selectable and employer context unselectable', () => {
    const run: JobResearchRun = {
      version: 1, id: 'run', selected: { canonicalUrl: 'https://jobs.example.org/roles/123', host: 'jobs.example.org', provider: 'generic', roleId: null },
      startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z', status: 'provisional', unknowns: ['Work arrangement unknown'],
      sources: [
        { version: 1, id: 'role', url: 'https://jobs.example.org/roles/123', capturedAt: '2026-01-01T00:00:00Z', method: 'indexed-snippet', identity: 'exact-role', title: 'Data engineer', employer: 'Example Ltd', employerIdentityUrl: null },
        { version: 1, id: 'employer', url: 'https://example.org/about', capturedAt: '2026-01-01T00:01:00Z', method: 'employer-page', identity: 'verified-employer', title: 'About Example Ltd', employer: 'Example Ltd', employerIdentityUrl: 'https://example.org/' }
      ],
      findings: [
        { version: 1, id: 'role-finding', sourceId: 'role', kind: 'indexed-role-claim', text: 'Build data pipelines.', completeness: 'partial' },
        { version: 1, id: 'employer-finding', sourceId: 'employer', kind: 'verified-company-context', text: 'Example Ltd builds software.', completeness: 'partial' }
      ]
    }
    const html = renderToStaticMarkup(React.createElement(JobResearchFindings, { run, selected: ['role-finding'], disabled: false, onToggle: () => {} }))
    expect(html).toContain('Partial indexed excerpt')
    expect(html).toContain('Employer background only')
    expect(html).toContain('Source (not opened automatically)')
    expect(html).not.toContain('<a ')
    expect((html.match(/type="checkbox"/g) ?? [])).toHaveLength(1)
  })
  it('retains direct review without search-key inspection', () => {
    const run: JobResearchRun = {
      version: 1, id: 'unsafe-run', selected: { canonicalUrl: 'https://jobs.example.org/roles/123', host: 'jobs.example.org', provider: 'generic', roleId: null },
      startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z', status: 'blocked', accessFailure: 'unsafe', sources: [], findings: [], unknowns: ['Source identity was unsafe']
    }
    const html = renderToStaticMarkup(React.createElement(JobResearchReview, { url: run.selected.canonicalUrl }))
    expect(html).not.toContain('Search indexed details')
    expect(html).not.toContain('Tavily')
    expect(html).not.toContain('credit')
    expect(html).toContain('Research this exact role')

  })
  it('hands the first posting token to research instead of starting a duplicate public read', async () => {
    const calls: string[] = []
    const api = {
      startJobResearch: async (url: string) => { calls.push(`url:${url}`); return { token: 'wrong-token' } },
      startJobResearchFromPosting: async (token: string) => { calls.push(`posting:${token}`); return { token: 'research-token' } }
    }
    await expect(startJobResearchFromIntake(api, 'https://jobs.example.org/role/1', 'first-fetch-token')).resolves.toEqual({ token: 'research-token' })
    expect(calls).toEqual(['posting:first-fetch-token'])
  })
  it('consumes a captured read once, requires explicit refetch after cancel, and cancels the token on manual switch', async () => {
    const calls: string[] = []
    const api = {
      startJobResearch: async (url: string) => { calls.push(`url:${url}`); return { token: 'fresh-token' } },
      startJobResearchFromPosting: async (token: string) => { calls.push(`posting:${token}`); return { token: 'research-token' } },
      cancelPostingFetch: async (token: string) => { calls.push(`cancel:${token}`); return { ok: true } }
    }
    let lifecycle: 'available' | 'consumed' | 'restart-required' = 'available'
    await expect(startResearchWithCaptureLifecycle(api, 'https://jobs.example.org/role/1', 'first-fetch-token', lifecycle)).resolves.toEqual({ token: 'research-token' })
    lifecycle = transitionCapturedRead(lifecycle, 'transferred')
    lifecycle = transitionCapturedRead(lifecycle, 'cancelled')
    expect(lifecycle).toBe('restart-required')
    await expect(startResearchWithCaptureLifecycle(api, 'https://jobs.example.org/role/1', undefined, lifecycle)).rejects.toThrow('Fetch posting again')
    expect(calls).toEqual(['posting:first-fetch-token'])

    lifecycle = transitionCapturedRead(lifecycle, 'refetched')
    await expect(startResearchWithCaptureLifecycle(api, 'https://jobs.example.org/role/1', 'second-fetch-token', lifecycle)).resolves.toEqual({ token: 'research-token' })
    cancelPostingCaptureForManual(api, 'manual-switch-token')
    await Promise.resolve()
    expect(calls).toEqual(['posting:first-fetch-token', 'posting:second-fetch-token', 'cancel:manual-switch-token'])
  })
  it('keeps the transferred child mounted while the fetch token is retained, and replaces save-implying preview notices', () => {
    const source = readFileSync(new URL('../src/renderer/SavedJobs.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(/function finishResearchHandoff\(\)\s*\{[^}]*Keep the fetch token/)
    expect(source).toMatch(/\{fetchToken && <JobResearchReview key=\{`full-\$\{fetchToken\}`\}/)
    expect(temporaryDirectNotice('Direct public posting text was captured for this exact role. Review the full wording and employer before saving; availability and completeness cannot be guaranteed.')).toBe('Review this temporary source before analysis; nothing is saved.')
    expect(temporaryDirectNotice('This is a temporary source. Nothing is saved.')).toBe('This is a temporary source. Nothing is saved.')
    expect(temporaryDirectNotice('The source is temporary.')).toBe('The source is temporary.')
  })
  it('labels the captured full direct-posting handoff as temporary research without invoking it on render', () => {
    const html = renderToStaticMarkup(React.createElement(JobResearchReview, { url: 'https://jobs.example.org/role/1', postingFetchToken: 'first-fetch-token', temporaryFullPosting: true }))
    expect(html).toContain('Temporary research')
    expect(html).toContain('Review temporary findings')
    expect(html).toContain('Inspect the direct public findings captured during Fetch posting')
    expect(html).not.toContain('Save job')
    expect(html).not.toMatch(/before saving/i)
    expect(html).not.toMatch(/\bSave\b/i)
    expect(html).not.toContain('Refresh')
  })
  it('does not search on mount, identifies the optional separate search, and does not claim analysis ran', () => {
    const html = renderToStaticMarkup(React.createElement(JobResearchReview, { url: 'https://www.linkedin.com/jobs/view/1234567890/' }))
    expect(html).toContain('Research this exact role')
    expect(html).toContain('fresh public read of the selected job')
    expect(html).not.toContain('indexed search')
    expect(html).not.toContain('Searching will read the public source again, then run')
    expect(html).not.toContain('Configure a free Tavily Researcher key in Settings')
    expect(html).not.toContain('Search query:')
    expect(html).not.toContain('Search indexed details')
    expect(html).not.toContain('Job saved')
    expect(html).not.toContain('Analysis complete')
  })
})
