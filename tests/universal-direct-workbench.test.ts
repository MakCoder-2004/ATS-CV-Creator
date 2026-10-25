import { afterEach, expect, test } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import { normalizeJobResearchUrl } from '../src/shared/job-research'
import { samePostingSource } from '../src/shared/posting-identity'

const folders: string[] = []
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }) })
const selected = 'https://www.linkedin.com/jobs/search/?currentJobId=4464025097&utm_source=mail'
const canonical = 'https://www.linkedin.com/jobs/view/4464025097/'
const body = 'Responsibilities\n• Design synthetic systems with a team and document decisions.\n\nRequirements\n• TypeScript and testing for reliable synthetic systems. '.repeat(3)
function open(request: (url: URL) => { status: number; headers: Record<string, string>; body: Buffer }, transport?: { generate: (input: { prompt: string }) => Promise<string> }) {
  const folder = mkdtempSync(join(tmpdir(), 'cv-universal-direct-')); folders.push(folder)
  const requested: string[] = []
  const wb = createWorkbench(folder, undefined, transport, undefined, { research: {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async url => { requested.push(url.href); return request(url) },
    extract: async () => ({ outcome: 'full', title: 'Synthetic Engineer', employer: 'Fictional Employer', description: body }),
  } })
  return { wb, requested }
}
async function settled(wb: ReturnType<typeof createWorkbench>, token: string) {
  let state = await wb.api.readPostingPreview(token)
  for (let i = 0; i < 300 && state.status === 'fetching'; i++) { await new Promise(resolve => setTimeout(resolve, 10)); state = await wb.api.readPostingPreview(token) }
  return state
}
test('selected LinkedIn role follows direct full posting, review, durable source, explicit consent and current analysis run', async () => {
  let modelCalls = 0
  const { wb, requested } = open(() => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html><body>synthetic posting</body></html>') }), { async generate() { modelCalls++; return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: [], responsibilities: [], keywords: [] }) } })
  try {
    const { token } = await wb.api.startPostingFetch(selected)
    const state = await settled(wb, token)
    expect(requested).toEqual([canonical])
    expect(modelCalls).toBe(0)
    expect(state).toMatchObject({ status: 'ready', preview: { submittedUrl: canonical, finalUrl: canonical, title: 'Synthetic Engineer', company: 'Fictional Employer', extractionMethod: 'linkedin-public-html-v1' } })
    if (state.status !== 'ready') throw Error('Full direct source was not reviewable')
    expect(await wb.api.acceptPostingImport(token, 0)).toMatchObject({ ok: false })
    const corrected = await wb.api.updatePostingPreview(token, 0, { title: state.preview.title, company: state.preview.company!, description: `${body.trim()}\nReviewed clarification.`, optionalDetails: state.preview.optionalDetails })
    expect(corrected).toMatchObject({ ok: true, revision: 1 })
    expect(await wb.api.acceptPostingImport(token, 0)).toMatchObject({ ok: false })
    expect(await wb.api.reviewPostingPreview(token, 1, { completenessConfirmed: true, conflictResolutions: {} })).toMatchObject({ ok: true })
    const saved = await wb.api.acceptPostingImport(token, 1)
    if (!saved.ok) throw Error(saved.error.message)
    expect(saved.value.sourceSnapshot).toMatchObject({ sourceIdentity: `linkedin:${canonical}`, submittedUrl: canonical, extractionMethod: 'linkedin-public-html-v1', description: body.trim() })
    expect(saved.value.description).toContain('Reviewed clarification.')
    expect(samePostingSource(saved.value.sourceSnapshot!, { submittedUrl: selected, finalUrl: canonical })).toBe(true)
    expect(modelCalls).toBe(0)
    const backup = wb.backup.createBackup()
    expect(backup).toContain('linkedin-public-html-v1')
    const consent = await wb.api.prepareOutboundConsent(saved.value.id)
    if (!consent.ok) throw Error(consent.message)
    await expect(wb.api.startAnalysis(consent.token)).rejects.toThrow(/authorize/i)
    expect(modelCalls).toBe(0)
    expect(await wb.api.acceptOutboundConsent(consent.token, true, true)).toMatchObject({ ok: true })
    expect(await wb.api.startAnalysis(consent.token)).toMatchObject({ status: 'complete', jobId: saved.value.id, runId: expect.any(String), analysis: { required: ['TypeScript'] } })
    expect(modelCalls).toBe(1)
    const duplicate = await wb.api.startPostingFetch(canonical)
    expect(await settled(wb, duplicate.token)).toMatchObject({ status: 'ready' })
    expect(await wb.api.reviewPostingPreview(duplicate.token, 0, { completenessConfirmed: true, conflictResolutions: {} })).toMatchObject({ ok: true })
    expect(await wb.api.acceptPostingImport(duplicate.token, 0)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  } finally { wb.close() }
})
test('incomplete and blocked public sources cannot become a saved source, with no provider dispatch', async () => {
  for (const request of [
    () => ({ status: 307, headers: { location: 'https://www.linkedin.com/login' }, body: Buffer.alloc(0) }),
    () => ({ status: 403, headers: {}, body: Buffer.alloc(0) }),
  ]) {
    const { wb, requested } = open(request)
    try {
      const { token } = await wb.api.startPostingFetch(selected)
      expect(await settled(wb, token)).toMatchObject({ status: 'research-notice', message: expect.stringMatching(/nothing was saved/i) })
      expect(wb.api.takePostingResearchRun(token)).toMatchObject({ selected: { canonicalUrl: canonical }, status: 'blocked', findings: [] })
      expect(requested).toEqual([canonical])
      expect(await wb.api.listJobs()).toEqual([])
      expect(await wb.api.acceptPostingImport(token, 0)).toMatchObject({ ok: false })
    } finally { wb.close() }
  }
  expect(() => normalizeJobResearchUrl('https://www.linkedin.com/jobs/view/4464025097/?currentJobId=4464025098')).toThrow(/conflicting/i)
})
test('full text without a source employer remains an unsaveable research notice', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'cv-direct-employer-')); folders.push(folder)
  const wb = createWorkbench(folder, undefined, undefined, undefined, { research: {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>synthetic</html>') }),
    extract: async () => ({ outcome: 'full', title: 'Synthetic Engineer', employer: null, description: body }),
  } })
  try {
    const { token } = await wb.api.startPostingFetch(selected)
    expect(await settled(wb, token)).toMatchObject({ status: 'research-notice', message: expect.stringMatching(/saveable preview/i) })
    expect(wb.api.takePostingResearchRun(token)).toMatchObject({ status: 'full', findings: [{ completeness: 'full' }] })
    expect(await wb.api.reviewPostingPreview(token, 0, { completenessConfirmed: true, conflictResolutions: {} })).toMatchObject({ ok: false })
    expect(await wb.api.listJobs()).toEqual([])
  } finally { wb.close() }
})

test('synthetic exact-role JSON-LD is extracted by the real bounded worker', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'cv-direct-worker-')); folders.push(folder)
  const url = 'https://careers.fictional.org/jobs/role-4'
  const structuredDescription = `<h2>Responsibilities</h2><p>${body}</p><h2>Requirements</h2><p>${body}</p>`
  const html = `<html><head><link rel="canonical" href="${url}"><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', url, title: 'Synthetic Engineer', hiringOrganization: { name: 'Fictional Employer' }, description: structuredDescription })}</script></head><body>Exact synthetic role</body></html>`
  const wb = createWorkbench(folder, undefined, undefined, undefined, { research: { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(html) }) } })
  try {
    const { token } = await wb.api.startPostingFetch(url)
    expect(await settled(wb, token)).toMatchObject({ status: 'ready', preview: { title: 'Synthetic Engineer', company: 'Fictional Employer', extractionMethod: 'public-jsonld-v1' } })
  } finally { wb.close() }
})

test('generic JSON-LD direct URL saves only the same exact source and employer', async () => {
  const url = 'https://careers.fictional.org/jobs/role-4'
  const { wb, requested } = open(() => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>synthetic</html>') }))
  try {
    const { token } = await wb.api.startPostingFetch(url + '?utm_source=email')
    expect(await settled(wb, token)).toMatchObject({ status: 'ready', preview: { submittedUrl: url, extractionMethod: 'public-jsonld-v1' } })
    expect(requested).toEqual([url])
    expect(samePostingSource({ submittedUrl: url, finalUrl: url }, { submittedUrl: url + '/other', finalUrl: url + '/other' })).toBe(false)
  } finally { wb.close() }
})
