import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { normalizeJobResearchUrl, jobResearchRunSchema, reviewedJobResearchSchema, promoteJobResearch, verifyReviewedJobResearch } from '../src/shared/job-research'
import { normalizeJobResearchUrl as normalizeBrowserJobUrl } from '../src/shared/job-research-url'
import { directPostingIdentity, samePostingSource } from '../src/shared/posting-identity'
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
const completeDescription = '<h2>Responsibilities</h2><p>Build practical software with measured outcomes. Collaborate with colleagues to maintain useful systems and explain technical decisions to reviewers. Document service boundaries and keep systems reliable for customers.</p><h2>Qualifications</h2><p>Experience building production services, reviewing code, resolving incidents, and communicating decisions with a cross-functional team. Apply for this role if you enjoy developing reliable software.</p>'
const response = (body: string | Buffer, status = 200, headers: Record<string, string> = {}) => ({ status, body: Buffer.isBuffer(body) ? body : Buffer.from(body), headers: { 'content-type': 'text/html; charset=utf-8', ...headers } })
const fixtures = { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => response(html(description)) }

describe('job research identities', () => {
  it('selects exact LinkedIn and Indeed roles without keeping tracking', () => {
    expect(normalizeJobResearchUrl(`https://www.linkedin.com/jobs/search-results/?currentJobId=${roleId}&utm_source=mail`).canonicalUrl).toBe(canonical)
    const linkedInSearch = `https://www.linkedin.com/jobs/search-results/?currentJobId=${roleId}&eBP=NOT_ELIGIBLE_FOR_CHARGING&refId=synthetic-ref&trackingId=synthetic-tracking&keywords=platform%20engineer&origin=PREFERENCES_LANDING&geoId=106155005`
    expect(normalizeBrowserJobUrl(linkedInSearch).canonicalUrl).toBe(canonical)
    expect(normalizeJobResearchUrl(linkedInSearch).canonicalUrl).toBe(canonical)
    expect(normalizeJobResearchUrl(`https://www.linkedin.com/jobs/search/?currentJobId=${roleId}&keywords=platform%20engineer&origin=JOBS_HOME`).canonicalUrl).toBe(canonical)
    expect(normalizeJobResearchUrl(`https://www.linkedin.com/jobs/view/${roleId}/?trackingId=synthetic-tracking`).canonicalUrl).toBe(canonical)
    expect(normalizeJobResearchUrl(`https://linkedin.com/jobs/view/synthetic-engineer-${roleId}?currentJobId=${roleId}`).canonicalUrl).toBe(canonical)
    expect(normalizeJobResearchUrl('https://www.indeed.com/jobs?vjk=1234567890abcdef&from=search').canonicalUrl).toBe('https://www.indeed.com/viewjob?jk=1234567890abcdef')
    expect(normalizeJobResearchUrl('https://jobs.example.org/job/one?utm_campaign=test').canonicalUrl).toBe('https://jobs.example.org/job/one')
  })
  it.each([
    `https://www.linkedin.com/jobs/view/${roleId}/?currentJobId=1111122222`,
    `https://www.linkedin.com/jobs/search/?currentJobId=${roleId}&currentJobId=${roleId}`,
    'https://www.linkedin.com/jobs/search/', 'https://www.indeed.com/jobs?q=engineer',
    `https://www.linkedin.com/jobs/search-results/?currentJobId=${roleId}&access_token=synthetic-secret`,
    `https://www.linkedin.com/jobs/search-results/?currentJobId=${roleId}&currentJobId=${roleId}`,
    `https://www.linkedin.com/jobs/search-results/?currentJobId=${roleId}&keywords=platform%01engineer`,
    'https://www.linkedin.com/jobs/search-results/?keywords=platform%20engineer',
    `https://www.linkedin.com.evil/jobs/search-results/?currentJobId=${roleId}`,
    `https://www.linkedin.com/jobs/search-results/extra?currentJobId=${roleId}`,
    `https://www.linkedin.com/jobs/search-results/?currentJobId=${roleId}%2fother`,
    `https://www.linkedin.com/jobs/search-results/?currentJobId=${roleId}&unknown=something`,
    'http://jobs.example.org/job/1', 'https://user:pass@jobs.example.org/one',
    'https://127.0.0.1/job', 'https://localhost/job', 'https://jobs.example.org:8443/one',
    'https://jobs.example.org/one?api_key=secret', 'https://jobs.example.org/one#anchor',
    'https://jobs.example.org/job/one?jobId=one&jobId=two',
  ])('rejects unsafe or ambiguous %s', value => expect(() => normalizeJobResearchUrl(value)).toThrow())
  it('preserves UTF-8 byte bounds in the browser-safe normalizer and server re-export', () => {
    const prefix = 'https://jobs.example.org/'
    const atLimit = prefix + 'a'.repeat(2048 - prefix.length)
    expect(normalizeBrowserJobUrl(atLimit)).toEqual(normalizeJobResearchUrl(atLimit))
    expect(() => normalizeBrowserJobUrl(atLimit + 'a')).toThrow(/Invalid public job URL/)
    expect(() => normalizeBrowserJobUrl(prefix + 'é'.repeat(350))).toThrow(/safe limit/)
    expect(normalizeBrowserJobUrl(`https://linkedin.com/jobs/view/${roleId}/?utm_source=mail`)).toEqual(selected)
    expect(() => normalizeBrowserJobUrl(`https://linkedin.com/jobs/view/${roleId}/?currentJobId=9999999999`)).toThrow()
  })
  it('compares browser posting sources by validated role identity, not stale hints or a shared redirect', () => {
    const another = 'https://www.linkedin.com/jobs/view/9999999999/'
    const source = (submittedUrl: string, sourceIdentity?: string) => ({ submittedUrl, finalUrl: 'https://www.linkedin.com/jobs/search/', sourceIdentity })
    expect(directPostingIdentity(`https://linkedin.com/jobs/view/${roleId}/?utm_source=mail`)).toBe(`linkedin:${canonical}`)
    expect(samePostingSource(source(canonical, `linkedin:${another}`), source(`https://linkedin.com/jobs/view/${roleId}/?utm_source=mail`))).toBe(true)
    expect(samePostingSource(source(canonical, `linkedin:${another}`), source(another, `linkedin:${canonical}`))).toBe(false)
    expect(directPostingIdentity(`https://www.linkedin.com/jobs/view/${roleId}/?api_key=secret`)).toBeNull()
  })
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
  it('keeps legacy runs readable but limits typed access failures to blocked/none', () => {
    expect(jobResearchRunSchema.safeParse(base).success).toBe(true)
    expect(jobResearchRunSchema.safeParse({ ...base, status: 'none', findings: [], sources: [], accessFailure: 'unreadable' }).success).toBe(true)
    for (const accessFailure of ['removed', 'server-error'] as const) {
      expect(jobResearchRunSchema.safeParse({ ...base, status: 'none', findings: [], sources: [], accessFailure }).success).toBe(true)
      expect(jobResearchRunSchema.safeParse({ ...base, accessFailure }).success).toBe(false)
    }
    expect(jobResearchRunSchema.safeParse({ ...base, accessFailure: 'unsafe' }).success).toBe(false)
    expect(jobResearchRunSchema.safeParse({ ...base, status: 'none', findings: [], sources: [], accessFailure: 'arbitrary' }).success).toBe(false)
  })
  it('refuses selected identity mutations even when canonical URL remains unchanged', () => {
    for (const selectedMutation of [
      { ...selected, roleId: '9999999999' },
      { ...selected, host: 'other.example.org' },
      { ...selected, provider: 'generic' as const },
    ]) {
      expect(jobResearchRunSchema.safeParse({ ...base, selected: selectedMutation }).success).toBe(false)
    }
  })
  it('verifies review scope, references and evidence against the app-held run', () => {
    const review = promoteJobResearch(base, [findingId], false)
    expect(verifyReviewedJobResearch(base, review)).toEqual(review)
    const alternateUrl = 'https://www.linkedin.com/jobs/view/9999999999/'
    const forged = [
      { ...review, runId: randomUUID() },
      { ...review, selected: { ...selected, roleId: '9999999999' } },
      { ...review, selected: { ...selected, host: 'other.example.org' } },
      { ...review, selected: normalizeJobResearchUrl(alternateUrl) },
      { ...review, references: [{ ...review.references[0], url: alternateUrl }] },
      { ...review, references: [{ ...review.references[0], sourceId: randomUUID() }] },
      { ...review, references: [{ ...review.references[0], completeness: 'partial' as const }] },
      { ...review, evidenceHash: 'a'.repeat(64) },
      { ...review, analysisScope: 'provisional' as const },
    ]
    // A shape-only schema cannot authenticate a review without the app-held run.
    expect(reviewedJobResearchSchema.safeParse(forged.at(-1)).success).toBe(true)
    for (const mutation of forged) expect(() => verifyReviewedJobResearch(base, mutation)).toThrow()
    expect(() => verifyReviewedJobResearch({ ...base, findings: [{ ...base.findings[0], text: description.repeat(2) }] }, review)).toThrow()
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
  it('keeps the selected LinkedIn primary markup when JSON-LD is a teaser', async () => {
    const structured = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', url: canonical, title: 'Synthetic engineer', description })}</script>`
    const run = await fetchDirectJobResearch(canonical, { ...fixtures, request: async () => response(html(completeDescription) + structured) })
    expect(run.status).toBe('full')
    expect(run.findings[0].text).toContain('Qualifications')
  })
  it('marks a selected LinkedIn primary with an explicit truncation marker provisional', async () => {
    const run = await fetchDirectJobResearch(canonical, { ...fixtures, request: async () => response(html(`${description} Read more`)) })
    expect(run.status).toBe('provisional')
  })
  it('accepts one exact structured generic role but not a different role on the same page', async () => {
    const generic = 'https://jobs.example.org/positions/engineer'
    const structured = (url: string) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', url, title: 'Synthetic engineer', hiringOrganization: { name: 'Example Ltd' }, description: completeDescription })}</script>`
    const exact = await fetchDirectJobResearch(generic, { ...fixtures, request: async () => response(structured(generic)) })
    expect(exact.status).toBe('full')
    const namesake = await fetchDirectJobResearch(generic, { ...fixtures, request: async () => response(structured('https://jobs.example.org/positions/other-engineer')) })
    expect(namesake.status).toBe('none')
  })
  it('treats read-more controls in job description as provisional, not unrelated controls or LinkedIn clamps', async () => {
    const generic = 'https://jobs.example.org/positions/engineer'
    const structured = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', url: generic, title: 'Synthetic engineer', description: completeDescription })}</script>`
    const insideDescription = `<main><section class="job-description"><h2>Job description</h2><div>${completeDescription}</div><button>Read more</button></section></main>${structured}`
    const provisional = await fetchDirectJobResearch(generic, { ...fixtures, request: async () => response(insideDescription) })
    expect(provisional.status).toBe('provisional')
    const unrelated = await fetchDirectJobResearch(generic, { ...fixtures, request: async () => response(`<aside><button>Read more</button></aside>${structured}`) })
    expect(unrelated.status).toBe('full')
    const linkedInClamped = html(completeDescription).replace('show-more-less-html__markup', 'show-more-less-html__markup show-more-less-html__clamp')
    expect((await fetchDirectJobResearch(canonical, { ...fixtures, request: async () => response(linkedInClamped) })).status).toBe('full')
  })
  it('rejects search-page or query-conflicting Indeed structured identities', async () => {
    const indeed = 'https://www.indeed.com/viewjob?jk=1234567890abcdef'
    const structured = (url: string) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', url, title: 'Synthetic engineer', description: completeDescription })}</script>`
    expect((await fetchDirectJobResearch(indeed, { ...fixtures, request: async () => response(structured(indeed)) })).status).toBe('full')
    for (const url of [
      'https://www.indeed.com/jobs?q=engineer&jk=1234567890abcdef',
      'https://www.indeed.com/viewjob?jk=1234567890abcdef&q=engineer',
      'https://www.indeed.com/viewjob?jk=1234567890abcdef&vjk=1111111111111111',
      'https://www.indeed.com/rc/clk?jk=1234567890abcdef',
      'https://www.indeed.com/viewjob?jk=1234567890abcdef#other',
    ]) {
      expect((await fetchDirectJobResearch(indeed, { ...fixtures, request: async () => response(structured(url)) })).status).toBe('none')
    }
  })
  it.each([
    ['listing shell', '<h1>Search results</h1><form><input name="q"></form><div class="job-list">More jobs</div>', completeDescription],
    ['short teaser', '', description],
    ['long teaser mentioning sections without sections', '', `${description} Responsibilities include collaboration and delivery. Qualifications include software experience. ${description} ${description}`],
    ['unfinished sectioned teaser', '', `${completeDescription.slice(0, -10)}`],
    ['trailing ellipsis', '', `${completeDescription.slice(0, 220)}...`],
    ['read-more marker', '', `${completeDescription.slice(0, 220)} Read more`],
    ['truncated role text', '', `${completeDescription.slice(0, 220)}…`],
  ])('does not mark %s JSON-LD as full', async (_, shell, teaser) => {
    const generic = 'https://jobs.example.org/positions/engineer'
    const html = `${shell}<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', url: generic, title: 'Synthetic engineer', description: teaser })}</script>`
    const run = await fetchDirectJobResearch(generic, { ...fixtures, request: async () => response(html) })
    expect(run.status).toBe('provisional')
    expect(run.findings[0].completeness).toBe('partial')
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
    expect(blocked).toMatchObject({ status: 'blocked', accessFailure: 'unreadable' })
    expect(calls).toBe(1)
    const denied = await fetchDirectJobResearch(canonical, { ...fixtures, request: async () => response('', 403) })
    expect(denied).toMatchObject({ status: 'blocked', accessFailure: 'unreadable' })
    const generic = 'https://jobs.example.org/positions/engineer'
    const genericLogin = await fetchDirectJobResearch(generic, { ...fixtures, request: async () => response('', 302, { location: 'https://jobs.example.org/login' }) })
    expect(genericLogin).toMatchObject({ status: 'blocked', accessFailure: 'unreadable' })
  })
  it.each([
    [404, 'removed'], [410, 'removed'], [500, 'server-error'], [503, 'server-error'], [429, 'unsafe'], [451, 'unsafe'],
  ] as const)('does not classify HTTP %s as a benign indexed fallback', async (status, accessFailure) => {
    const run = await fetchDirectJobResearch(canonical, { ...fixtures, request: async () => response('', status) })
    expect(run).toMatchObject({ accessFailure, findings: [] })
    expect(['none', 'blocked']).toContain(run.status)
  })
  it.each([
    ['different host', 'https://other.example.org/jobs/view/4464025097/'],
    ['HTTP login', 'http://www.linkedin.com/login'],
    ['different role', 'https://www.linkedin.com/jobs/view/9999999999/'],
    ['unsafe query', `${canonical}?trackingId=untrusted`],
    ['invalid redirect', 'https://%'],
    ['loop', canonical],
  ])('tags %s redirects unsafe, never as a login fallback', async (_, location) => {
    const run = await fetchDirectJobResearch(canonical, { ...fixtures, request: async () => response('', 302, { location }) })
    expect(run).toMatchObject({ status: 'blocked', accessFailure: 'unsafe' })
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
