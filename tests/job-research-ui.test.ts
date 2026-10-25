import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JobResearchFindings, JobResearchReview } from '../src/renderer/JobResearchReview'
import type { JobResearchRun } from '../src/shared/job-research-schema'
import { buildJobResearchQuery } from '../src/shared/job-research-search-query'
import { SavedJobs } from '../src/renderer/SavedJobs'

describe('universal research intake', () => {
  it('offers an explicit research action and a separate manual posting route, without beginning research during render', () => {
    const html = renderToStaticMarkup(React.createElement(SavedJobs, { jobs: [], activeJob: null, onSaved: () => {}, onOpened: () => {}, onDeleted: async () => {}, onNavigate: () => {} }))
    expect(html).toContain('Import from link')
    expect(html).toContain('Posting and requirements')
    expect(html).toContain('Paste posting text instead')
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
  it('discloses the exact metadata query and blocks unusable host or role identifiers', () => {
    expect(buildJobResearchQuery({ host: 'jobs.example.org', roleId: '4464025097' })).toBe('job 4464025097 site:jobs.example.org')
    expect(buildJobResearchQuery({ host: 'jobs.example.org', roleId: null })).toBe('job site:jobs.example.org')
    expect(buildJobResearchQuery({ host: '', roleId: null })).toBeUndefined()
    expect(buildJobResearchQuery({ host: 'jobs.example.org', roleId: '' })).toBeUndefined()
  })
  it('does not search on mount, identifies the optional separate search, and does not claim analysis ran', () => {
    const html = renderToStaticMarkup(React.createElement(JobResearchReview, { url: 'https://www.linkedin.com/jobs/view/1234567890/' }))
    expect(html).toContain('Research indexed details')
    expect(html).toContain('Indexed search is a separate, optional decision')
    expect(html).not.toContain('Configure a free Tavily Researcher key in Settings')
    expect(html).not.toContain('Search query:')
    expect(html).not.toContain('Search indexed details')
    expect(html).not.toContain('Job saved')
    expect(html).not.toContain('Analysis complete')
  })
})
