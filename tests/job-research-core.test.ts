import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { normalizeJobResearchUrl, jobResearchRunSchema, promoteJobResearch } from '../src/shared/job-research'
import { fetchDirectJobResearch } from '../src/main/job-research-fetch'

const roleId = '4464025097'
const canonical = `https://www.linkedin.com/jobs/view/${roleId}/`
const selected = normalizeJobResearchUrl(canonical)
const sourceId = randomUUID(), findingId = randomUUID()
const base = {
  version: 1 as const, id: randomUUID(), selected, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), status: 'full' as const,
  sources: [{ version: 1 as const, id: sourceId, url: canonical, capturedAt: new Date().toISOString(), method: 'direct-html' as const, identity: 'exact-role' as const, title: 'Synthetic engineer', employer: 'Example Ltd', employerIdentityUrl: null }],
  findings: [{ version: 1 as const, id: findingId, sourceId, kind: 'direct-role-text' as const, text: 'Build practical software with measured outcomes. Collaborate with colleagues to maintain useful systems and explain technical decisions to reviewers.', completeness: 'full' as const }], unknowns: [],
}
const html = (body: string, id = roleId) => `<html><head><link rel="canonical" href="https://www.linkedin.com/jobs/view/${id}/"></head><body><h1 class="top-card-layout__title">Synthetic engineer</h1><div class="description__text"><div class="show-more-less-html__markup">${body}</div></div><code id="decoratedJobPostingId" style="display: none"><!--"${id}"--></code></body></html>`
const description = 'Build practical software with measured outcomes. Collaborate with colleagues to maintain useful systems and explain technical decisions to reviewers.'
const response = (body: string | Buffer, status = 200, headers: Record<string, string> = {}) => ({ status, body: Buffer.isBuffer(body) ? body : Buffer.from(body), headers: { 'content-type': 'text/html; charset=utf-8', ...headers } })
const fixtures = { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => response(html(description)) }

describe('job research identities', () => {
  it('selects exact LinkedIn and Indeed roles without keeping tracking', () => {
    expect(normalizeJobResearchUrl(`https://www.linkedin.com/jobs/search-results/?currentJobId=${roleId}&utm_source=mail`).canonicalUrl).toBe(canonical)
    expect(normalizeJobResearchUrl(`https://linkedin.com/jobs/view/synthetic-engineer-${roleId}?currentJobId=${roleId}`).canonicalUrl).toBe(canonical)
    expect(normalizeJobResearchUrl('https://www.indeed.com/jobs?vjk=1234567890abcdef&from=search').canonicalUrl).toBe('https://www.indeed.com/viewjob?jk=1234567890abcdef')
    expect(normalizeJobResearchUrl('https://jobs.example.org/job/one?utm_campaign=test').canonicalUrl).toBe('https://jobs.example.org/job/one')
  })
  it.each([
    `https://www.linkedin.com/jobs/view/${roleId}/?currentJobId=1111122222`,
    `https://www.linkedin.com/jobs/search/?currentJobId=${roleId}&currentJobId=${roleId}`,
    'https://www.linkedin.com/jobs/search/', 'https://www.indeed.com/jobs?q=engineer',
    'http://jobs.example.org/job/1', 'https://user:pass@jobs.example.org/one',
    'https://127.0.0.1/job', 'https://localhost/job', 'https://jobs.example.org:8443/one',
    'https://jobs.example.org/one?api_key=secret', 'https://jobs.example.org/one#anchor',
    'https://jobs.example.org/job/one?jobId=one&jobId=two',
  ])('rejects unsafe or ambiguous %s', value => expect(() => normalizeJobResearchUrl(value)).toThrow())
})

describe('immutable research and review contracts', () => {
  it('promotes full direct evidence without rewriting it', () => {
    const result = promoteJobResearch(base, [findingId], false)
    expect(result).toMatchObject({ runId: base.id, analysisScope: 'full', acceptedFindingIds: [findingId] })
    expect(result.evidenceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.references).toEqual([{ version: 1, sourceId, findingId, url: canonical, capturedAt: base.sources[0].capturedAt, identity: 'exact-role', completeness: 'full' }])
  })
  it('requires acknowledgement for partial claims and refuses company background', () => {
    const partial = { ...base, status: 'provisional', sources: [{ ...base.sources[0], method: 'indexed-snippet' }], findings: [{ ...base.findings[0], kind: 'indexed-role-claim', completeness: 'partial' }] }
    expect(() => promoteJobResearch(partial, [findingId], false)).toThrow(/Acknowledge/)
    expect(promoteJobResearch(partial, [findingId], true).analysisScope).toBe('provisional')
    const employerUrl = 'https://company.example.org/careers'
    const companySourceId = randomUUID()
    const company = { ...base, status: 'none', sources: [{ ...base.sources[0], employerIdentityUrl: employerUrl }, { ...base.sources[0], id: companySourceId, url: employerUrl, method: 'employer-page', identity: 'verified-employer', employerIdentityUrl: employerUrl }], findings: [{ ...base.findings[0], sourceId: companySourceId, kind: 'verified-company-context', completeness: 'partial' }] }
    expect(jobResearchRunSchema.safeParse(company).success).toBe(true)
    expect(jobResearchRunSchema.safeParse({ ...company, sources: [company.sources[0], { ...company.sources[1], url: 'https://namesake.example.net/about' }] }).success).toBe(false)
    expect(() => promoteJobResearch(company, [findingId], true)).toThrow()
    expect(() => promoteJobResearch(base, [randomUUID()], true)).toThrow()
  })
  it('rejects unsupported and unverified findings', () => {
    expect(jobResearchRunSchema.safeParse({ ...base, sources: [{ ...base.sources[0], identity: 'unverified-role' }] }).success).toBe(false)
    expect(jobResearchRunSchema.safeParse({ ...base, sources: [] }).success).toBe(false)
    expect(jobResearchRunSchema.safeParse({ ...base, status: 'none' }).success).toBe(false)
    expect(jobResearchRunSchema.safeParse({ ...base, sources: [{ ...base.sources[0], url: 'https://www.linkedin.com/jobs/view/9999999999/' }] }).success).toBe(false)
  })
})

describe('bounded direct read', () => {
  it('extracts a synthetic LinkedIn primary description in an inert worker', async () => {
    const run = await fetchDirectJobResearch(canonical, fixtures)
    expect(run.status).toBe('full')
    expect(run.findings[0]).toMatchObject({ kind: 'direct-role-text', text: description, completeness: 'full' })
  })
  it('accepts one exact structured generic role but not a different role on the same page', async () => {
    const generic = 'https://jobs.example.org/positions/engineer'
    const structured = (url: string) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', url, title: 'Synthetic engineer', hiringOrganization: { name: 'Example Ltd' }, description: `<p>${description}</p>` })}</script>`
    const exact = await fetchDirectJobResearch(generic, { ...fixtures, request: async () => response(structured(generic)) })
    expect(exact.status).toBe('full')
    const namesake = await fetchDirectJobResearch(generic, { ...fixtures, request: async () => response(structured('https://jobs.example.org/positions/other-engineer')) })
    expect(namesake.status).toBe('none')
  })
  it('does not treat namesakes or mixed roles as the selected full posting', async () => {
    const mismatch = await fetchDirectJobResearch(canonical, { ...fixtures, request: async () => response(html(description, '9999999999')) })
    expect(mismatch.status).toBe('none')
    const mixed = await fetchDirectJobResearch(canonical, { ...fixtures, request: async () => response(`<script type="application/ld+json">${JSON.stringify({ '@graph': [
      { '@type': 'JobPosting', url: canonical, title: 'Role A', description },
      { '@type': 'JobPosting', url: canonical, title: 'Role B', description },
    ] })}</script>`) })
    expect(mixed.status).toBe('none')
  })
  it('returns blocked rather than fabricated evidence for login and redirects', async () => {
    expect((await fetchDirectJobResearch(canonical, { ...fixtures, request: async () => response('<h1>Sign in to view</h1>') })).status).toBe('blocked')
    let calls = 0
    const blocked = await fetchDirectJobResearch(canonical, { ...fixtures, request: async () => { calls++; return response('', 307, { location: 'https://www.linkedin.com/login' }) } })
    expect(blocked.status).toBe('blocked')
    expect(calls).toBe(1)
  })
  it('rejects non-public DNS and compression bombs before parsing', async () => {
    await expect(fetchDirectJobResearch(canonical, { ...fixtures, lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] })).rejects.toThrow(/private/)
    await expect(fetchDirectJobResearch(canonical, { ...fixtures, request: async () => response(gzipSync(Buffer.alloc(8 * 1024 * 1024 + 1, 65)), 200, { 'content-encoding': 'gzip' }) })).rejects.toThrow(/expanded/)
  })
  it('marks truncated descriptions provisional rather than claiming a full source', async () => {
    const result = await fetchDirectJobResearch(canonical, { ...fixtures, request: async () => response(html(description.repeat(150))) })
    expect(result.status).toBe('provisional')
    expect(result.findings[0].completeness).toBe('partial')
    expect(() => promoteJobResearch(result, [result.findings[0].id], false)).toThrow(/Acknowledge/)
  })
  it('honors cancellation and rejects overlong downloads', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(fetchDirectJobResearch(canonical, { ...fixtures, signal: controller.signal })).rejects.toThrow(/cancelled/)
    await expect(fetchDirectJobResearch(canonical, { ...fixtures, request: async () => response(Buffer.alloc(2 * 1024 * 1024 + 1)) })).rejects.toThrow(/compressed/)
  })
})
