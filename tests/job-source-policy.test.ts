import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import { decideJobSourcePolicy } from '../src/shared/job-source-policy'
import { fetchDirectJobResearch } from '../src/main/job-research-fetch'
import { fetchLeverPosting } from '../src/main/safe-posting-fetch'

describe('paused job source policy', () => {
  it('matches source hosts exactly and preserves unchanged routes', () => {
    expect(decideJobSourcePolicy('https://sub.linkedin.com/jobs/view/123456789')).toMatchObject({ status: 'paused', source: 'linkedin' })
    expect(decideJobSourcePolicy('https://uk.indeed.com/viewjob?jk=abcdefgh')).toMatchObject({ status: 'paused', source: 'indeed' })
    expect(decideJobSourcePolicy('https://api.lever.co/v0/postings/acme/role')).toMatchObject({ status: 'paused', source: 'lever' })
    expect(decideJobSourcePolicy('https://linkedin.com.attacker.example/jobs/view/123456789')).toEqual({ status: 'unchanged' })
    expect(decideJobSourcePolicy('https://jobs.example.org/role')).toEqual({ status: 'unchanged' })
  })

  it('blocks the public workbench fetch while preserving manual saves', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'source-policy-'))
    const lookup = vi.fn(async () => [{ address: '203.0.113.9', family: 4 }])
    const wb = createWorkbench(directory, undefined, undefined, undefined, { lookup, request: vi.fn() })
    try {
      await expect(wb.api.startPostingFetch('https://www.linkedin.com/jobs/view/123456789/')).rejects.toThrow(/LinkedIn reads.*paused/)
      expect(lookup).not.toHaveBeenCalled()
      expect(await wb.api.saveJob({ title: 'Manual role', company: 'Example', description: 'Pasted text.' })).toMatchObject({ ok: true })
    } finally { wb.close(); await rm(directory, { recursive: true, force: true }) }
  })

  it('blocks direct adapters before DNS or request dispatch', async () => {
    const lookup = vi.fn(async () => [{ address: '203.0.113.9', family: 4 }])
    const request = vi.fn()
    await expect(fetchDirectJobResearch('https://www.linkedin.com/jobs/view/123456789/'))
      .rejects.toThrow(/LinkedIn reads.*paused/)
    await expect(fetchLeverPosting('https://jobs.lever.co/acme/role', { lookup, request }))
      .rejects.toThrow(/Lever fetching.*paused/)
    expect(lookup).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })
})
