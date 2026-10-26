import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import { decideJobSourcePolicy } from '../src/shared/job-source-policy'
import { fetchDirectJobResearch } from '../src/main/job-research-fetch'
import { fetchLeverPosting } from '../src/main/safe-posting-fetch'
import { createJobResearchSessions } from '../src/main/job-research-session'
import { normalizeJobResearchUrl, type JobResearchRun } from '../src/shared/job-research'

describe('paused job source policy', () => {
  it('matches source hosts exactly and preserves unchanged routes', () => {
    expect(decideJobSourcePolicy('https://sub.linkedin.com/jobs/view/123456789')).toMatchObject({ status: 'paused', source: 'linkedin' })
    for (const url of ['https://uk.indeed.com/viewjob?jk=abcdefgh', 'https://www.indeed.co.uk/viewjob?jk=abcdefgh', 'https://www.indeed.com.au/viewjob?jk=abcdefgh', 'https://www.indeed.co.jp/viewjob?jk=abcdefgh']) {
      expect(decideJobSourcePolicy(url)).toMatchObject({ status: 'paused', source: 'indeed' })
    }
    expect(decideJobSourcePolicy('https://api.lever.co/v0/postings/acme/role')).toMatchObject({ status: 'paused', source: 'lever' })
    expect(decideJobSourcePolicy('https://linkedin.com.attacker.example/jobs/view/123456789')).toEqual({ status: 'unchanged' })
    expect(decideJobSourcePolicy('https://indeed.co.uk.attacker.example/viewjob?jk=abcdefgh')).toEqual({ status: 'unchanged' })
    expect(decideJobSourcePolicy('https://indeed-lookalike.co.uk/viewjob?jk=abcdefgh')).toEqual({ status: 'unchanged' })
    expect(decideJobSourcePolicy('https://jobs.example.org/role')).toEqual({ status: 'unchanged' })
  })

  it('blocks the public workbench fetch while preserving manual saves', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'source-policy-'))
    const lookup = vi.fn(async () => [{ address: '203.0.113.9', family: 4 }])
    const wb = createWorkbench(directory, undefined, undefined, undefined, { lookup, request: vi.fn() })
    try {
      await expect(wb.api.startPostingFetch('https://www.linkedin.com/jobs/view/123456789/')).rejects.toThrow(/LinkedIn reads.*paused/)
      await expect(wb.api.startPostingFetch('https://www.indeed.co.uk/viewjob?jk=abcdefgh')).rejects.toThrow(/Indeed reads.*paused/)
      expect(lookup).not.toHaveBeenCalled()
      expect(await wb.api.saveJob({ title: 'Manual role', company: 'Example', description: 'Pasted text.' })).toMatchObject({ ok: true })
    } finally { wb.close(); await rm(directory, { recursive: true, force: true }) }
  })

  it('blocks direct adapters and research start before DNS or request dispatch', async () => {
    const lookup = vi.fn(async () => [{ address: '203.0.113.9', family: 4 }])
    const request = vi.fn()
    await expect(fetchDirectJobResearch('https://www.linkedin.com/jobs/view/123456789/'))
      .rejects.toThrow(/LinkedIn reads.*paused/)
    await expect(fetchDirectJobResearch('https://www.indeed.co.uk/viewjob?jk=abcdefgh', { lookup, request }))
      .rejects.toThrow(/Indeed reads.*paused/)
    await expect(fetchLeverPosting('https://jobs.lever.co/acme/role', { lookup, request }))
      .rejects.toThrow(/Lever fetching.*paused/)
    expect(lookup).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('blocks legacy regional Indeed research before review, search, or Tavily dispatch', async () => {
    const url = 'https://www.indeed.co.uk/viewjob?jk=abcdefgh'
    const selected = normalizeJobResearchUrl(url), runId = '00000000-0000-4000-8000-000000000001', sourceId = '00000000-0000-4000-8000-000000000002', findingId = '00000000-0000-4000-8000-000000000003'
    const run: JobResearchRun = { version: 1, id: runId, selected, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), status: 'full', sources: [{ version: 1, id: sourceId, url: selected.canonicalUrl, capturedAt: new Date().toISOString(), method: 'direct-html', identity: 'exact-role', title: 'Synthetic role', employer: 'Example', employerIdentityUrl: null }], findings: [{ version: 1, id: findingId, sourceId, kind: 'direct-role-text', text: 'A sufficiently detailed synthetic role description with responsibilities and qualifications that is long enough to satisfy the full posting schema.', completeness: 'full' }], unknowns: [] }
    const direct = vi.fn(async () => run), credentialChecks = vi.fn(async () => ({ configured: true, storageAvailable: true, message: '' }))
    const sessions = createJobResearchSessions({ credentials: { status: credentialChecks, withKey: async <T>(use: (key: string) => Promise<T>) => use('synthetic') }, direct })
    try {
      expect(() => sessions.startJobResearch(url)).toThrow(/Indeed reads.*paused/)
      expect(() => sessions.acceptInitialDirectRun(run)).toThrow(/Indeed reads.*paused/)
      await expect(sessions.searchJobResearch(runId)).rejects.toThrow()
      expect(direct).not.toHaveBeenCalled()
      expect(credentialChecks).not.toHaveBeenCalled()
    } finally { sessions.close() }
  })
})
