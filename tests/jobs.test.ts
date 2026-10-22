import { afterEach, expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import Database from 'better-sqlite3'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'
import { analysisBudgetValues } from '../src/shared/posting-analysis'
import { normalizePostingUrl, samePostingSource } from '../src/shared/posting-identity'

const directories: string[] = []

test('posting source identity removes known tracking only and preserves role-bearing URL differences', () => {
  expect(normalizePostingUrl('https://EXAMPLE.test/jobs/42?utm_source=mail&team=platform#details')).toBe('https://example.test/jobs/42?team=platform')
  expect(normalizePostingUrl('https://example.test/jobs/42?team=platform')).not.toBe(normalizePostingUrl('https://example.test/jobs/42?team=security'))
  expect(normalizePostingUrl('https://example.test/jobs/42?a=1&b=2')).not.toBe(normalizePostingUrl('https://example.test/jobs/42?b=2&a=1'))
  expect(samePostingSource({ submittedUrl: 'https://jobs.lever.co/board/role?utm_campaign=x', finalUrl: 'https://jobs.lever.co/board/role' }, { submittedUrl: 'https://jobs.lever.co/board/role?utm_medium=email', finalUrl: 'https://jobs.lever.co/board/role' })).toBe(true)
  expect(samePostingSource({ submittedUrl: 'https://jobs.lever.co/board/role-a', finalUrl: 'https://jobs.lever.co/board/role-a', sourceIdentity: 'lever:board/role-b' }, { submittedUrl: 'https://jobs.lever.co/board/role-b', finalUrl: 'https://jobs.lever.co/board/role-b', sourceIdentity: 'lever:board/role-a' })).toBe(false)
  expect(samePostingSource({ submittedUrl: 'https://jobs.lever.co/board/role-a', finalUrl: 'https://jobs.lever.co/board/apply', sourceIdentity: 'lever:board/role-a' }, { submittedUrl: 'https://jobs.lever.co/board/role-b', finalUrl: 'https://jobs.lever.co/board/apply', sourceIdentity: 'lever:board/role-b' })).toBe(false)
  expect(normalizePostingUrl('http://example.test/jobs/42')).toBeNull()
})
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) })
function open() {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-jobs-'))
  directories.push(directory)
  return { directory, workbench: createWorkbench(directory) }
}
async function stageImportReview(api: ReturnType<typeof createWorkbench>['api'], token: string, input: { title: string; company: string; description: string; optionalDetails?: import('../src/shared/jobs').PostingOptionalDetails }, review: { completenessConfirmed: boolean; conflictResolutions: Record<string, string> }) {
  const state = await api.readPostingPreview(token)
  if (state.status !== 'ready' && state.status !== 'incomplete') throw new Error('Posting preview is no longer reviewable.')
  const edited = await api.updatePostingPreview(token, 0, { ...input, optionalDetails: input.optionalDetails ?? state.preview.optionalDetails })
  if (!edited.ok || edited.revision === undefined) throw new Error(edited.message ?? 'Posting preview edit failed.')
  const reviewed = await api.reviewPostingPreview(token, edited.revision, review)
  return { revision: edited.revision, reviewed }
}
async function acceptImport(api: ReturnType<typeof createWorkbench>['api'], token: string, input: { title: string; company: string; description: string; optionalDetails?: import('../src/shared/jobs').PostingOptionalDetails }, review: { completenessConfirmed: boolean; conflictResolutions: Record<string, string> }) {
  const staged = await stageImportReview(api, token, input, review)
  return api.acceptPostingImport(token, staged.revision)
}

test('changed exact-source refresh compares all three versions and explicitly accepts selected fields atomically', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-refresh-contract-'))
  directories.push(directory)
  const initialText = `Responsibilities\n${'Build dependable fictional platform services with collaboration and careful engineering. '.repeat(3)}\nRequirements\n• TypeScript and testing.`
  const refreshedText = `Responsibilities\n${'Build dependable fictional platform services with collaboration and careful engineering. '.repeat(3)}\nRequirements\n• TypeScript, testing, and accessibility.`
  let fetchCount = 0
  const requestedUrls: string[] = []
  const response = () => JSON.stringify({ id: 'refresh-role', text: 'Platform Engineer', company: 'Example Employer', descriptionPlain: ++fetchCount === 1 ? initialText : refreshedText })
  const wb = createWorkbench(directory, undefined, undefined, undefined, { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async url => { requestedUrls.push(url.href); return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(response()) } } })
  try {
    const first = await wb.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/refresh-role')
    const firstState = await readReady(wb.api, first.token)
    const saved = await acceptImport(wb.api, first.token, { title: firstState.preview.title, company: firstState.preview.company!, description: firstState.preview.description }, { completenessConfirmed: true, conflictResolutions: {} })
    if (!saved.ok) throw new Error(saved.error.message)
    const second = await wb.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/refresh-role?utm_source=refresh')
    const secondState = await readReady(wb.api, second.token)
    const stagedRefresh = await wb.api.updatePostingPreview(second.token, 0, { title: secondState.preview.title, company: secondState.preview.company ?? '', description: secondState.preview.description, optionalDetails: secondState.preview.optionalDetails })
    if (!stagedRefresh.ok || stagedRefresh.revision === undefined) throw new Error('Could not stage refreshed source for review.')
    expect(await wb.api.reviewPostingPreview(second.token, stagedRefresh.revision, { completenessConfirmed: true, conflictResolutions: {} })).toMatchObject({ ok: true })
    expect(await wb.api.listJobs()).toEqual([saved.value])
    const comparison = await wb.api.comparePostingRefresh(second.token, saved.value.id, saved.value.updatedAt, saved.value.revisions.at(-1)?.revision ?? 0)
    expect(comparison).toMatchObject({ ok: true, unchanged: false, previousSource: { description: initialText }, working: { description: initialText }, newSource: { description: refreshedText, submittedUrl: 'https://api.lever.co/v0/postings/example-board/refresh-role?utm_source=refresh' } })
    expect(requestedUrls[1]).toBe('https://api.lever.co/v0/postings/example-board/refresh-role')
    const database = new Database(join(directory, 'workbench.sqlite'))
    database.exec("CREATE TRIGGER refuse_refresh BEFORE UPDATE ON jobs BEGIN SELECT RAISE(ABORT, 'simulated refresh transaction failure'); END")
    expect(await wb.api.acceptPostingRefresh(second.token, stagedRefresh.revision, saved.value.id, saved.value.updatedAt, saved.value.revisions.at(-1)?.revision ?? 0, { title: 'source', company: 'working', description: 'working', optionalDetails: {} })).toMatchObject({ ok: false })
    expect(await wb.api.openJob(saved.value.id)).toEqual(saved.value)
    database.exec('DROP TRIGGER refuse_refresh'); database.close()
    const accepted = await wb.api.acceptPostingRefresh(second.token, stagedRefresh.revision, saved.value.id, saved.value.updatedAt, saved.value.revisions.at(-1)?.revision ?? 0, { title: 'source', company: 'working', description: 'working', optionalDetails: {} })
    expect(accepted).toMatchObject({ ok: true, value: { title: 'Platform Engineer', description: initialText, sourceSnapshot: { description: refreshedText, submittedUrl: 'https://api.lever.co/v0/postings/example-board/refresh-role?utm_source=refresh' }, sourceHistory: [{ description: initialText }], revisions: [{ revision: 1 }, { revision: 2, description: initialText }] } })
    if (!accepted.ok) throw new Error(accepted.error.message)
    expect(await wb.api.getAnalysisUsage()).toMatchObject({ attempts: 0 })
    const backup = wb.backup.createBackup()
    const backupJob = JSON.parse(JSON.parse(backup).tables.jobs.rows[0].data)
    expect(backupJob.sourceHistory[0].description).toBe(initialText)
    const unrelated = await wb.api.saveJob({ title: 'Unrelated', company: 'Other', description: 'Unrelated role.' })
    expect(unrelated.ok).toBe(true)
    const restore = wb.backup.previewRestore(backup)
    wb.backup.applyRestore(restore.token, safety => safety)
    expect(await wb.api.listJobs()).toHaveLength(1)
    expect(await wb.api.acceptPostingRefresh(second.token, stagedRefresh.revision, saved.value.id, saved.value.updatedAt, saved.value.revisions.at(-1)?.revision ?? 0, { title: 'source', company: 'working', description: 'source', optionalDetails: {} })).toMatchObject({ ok: false })
    const third = await wb.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/refresh-role')
    const thirdState = await readReady(wb.api, third.token)
    const thirdEdit = await wb.api.updatePostingPreview(third.token, 0, { title: thirdState.preview.title, company: thirdState.preview.company ?? '', description: thirdState.preview.description, optionalDetails: thirdState.preview.optionalDetails })
    if (!thirdEdit.ok || thirdEdit.revision === undefined) throw new Error('Could not stage unchanged source.')
    await wb.api.reviewPostingPreview(third.token, thirdEdit.revision, { completenessConfirmed: true, conflictResolutions: {} })
    const thirdComparison = await wb.api.comparePostingRefresh(third.token, saved.value.id, accepted.value.updatedAt, accepted.value.revisions.at(-1)?.revision ?? 0)
    expect(thirdComparison).toMatchObject({ ok: true, unchanged: true })
    const noOp = await wb.api.acceptPostingRefresh(third.token, thirdEdit.revision, saved.value.id, accepted.value.updatedAt, accepted.value.revisions.at(-1)?.revision ?? 0, { title: 'working', company: 'working', description: 'working', optionalDetails: {} })
    expect(noOp).toMatchObject({ ok: true, value: { updatedAt: accepted.value.updatedAt, revisions: [{ revision: 1 }, { revision: 2 }] } })
    const fourth = await wb.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/refresh-role')
    const fourthState = await readReady(wb.api, fourth.token)
    const fourthEdit = await wb.api.updatePostingPreview(fourth.token, 0, { title: fourthState.preview.title, company: fourthState.preview.company ?? '', description: fourthState.preview.description, optionalDetails: fourthState.preview.optionalDetails })
    if (!fourthEdit.ok || fourthEdit.revision === undefined) throw new Error('Could not stage concurrent refresh.')
    await wb.api.reviewPostingPreview(fourth.token, fourthEdit.revision, { completenessConfirmed: true, conflictResolutions: {} })
    const concurrent = await wb.api.saveJob({ id: saved.value.id, title: 'Platform Engineer', company: 'Example Employer', description: 'A newer local edit made while refresh was open.' })
    if (!concurrent.ok) throw new Error(concurrent.error.message)
    expect(await wb.api.comparePostingRefresh(fourth.token, saved.value.id, noOp.ok ? noOp.value.updatedAt : '', noOp.ok ? noOp.value.revisions.at(-1)?.revision ?? 0 : -1)).toMatchObject({ ok: false, message: expect.stringMatching(/changed/i) })
    expect(await wb.api.acceptPostingRefresh(fourth.token, fourthEdit.revision, saved.value.id, noOp.ok ? noOp.value.updatedAt : '', noOp.ok ? noOp.value.revisions.at(-1)?.revision ?? 0 : -1, { title: 'source', company: 'source', description: 'source', optionalDetails: {} })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    await wb.api.cancelPostingFetch(fourth.token)
    expect(await wb.api.acceptPostingRefresh(fourth.token, fourthEdit.revision, saved.value.id, concurrent.value.updatedAt, concurrent.value.revisions.at(-1)?.revision ?? 0, { title: 'source', company: 'source', description: 'source', optionalDetails: {} })).toMatchObject({ ok: false })
    expect(await wb.api.openJob(saved.value.id)).toEqual(concurrent.value)
    wb.close()
    const reopened = createWorkbench(directory)
    expect(await reopened.api.openJob(saved.value.id)).toEqual(concurrent.value)
    reopened.close()
  } finally { wb.close() }
}, 30_000)

async function readReady(api: ReturnType<typeof createWorkbench>['api'], token: string) {
  let state = await api.readPostingPreview(token)
  for (let attempt = 0; attempt < 300 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); state = await api.readPostingPreview(token) }
  if (state.status !== 'ready' && state.status !== 'incomplete') throw new Error(state.status === 'failed' ? state.message : 'Posting preview is unavailable.')
  return { ...state, revision: 0 }
}

test('accepting refreshed requirements stales prior analysis without dispatching another model request', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-refresh-target-'))
  directories.push(directory)
  const oldText = `Responsibilities\n${'Maintain reliable fictional services with careful coordination and written operational plans. '.repeat(3)}\nRequirements\n• TypeScript and testing.`
  const newText = `${oldText}\n• Accessibility review.`
  let fetchCount = 0, modelCalls = 0
  const transport: AnalysisTransport = { async generate({ prompt }) {
    modelCalls++
    if (prompt.includes('Extract only explicit qualifications')) return JSON.stringify({ required: ['TypeScript'], preferred: [], tools: ['TypeScript'], responsibilities: ['Maintain services'], keywords: ['TypeScript'] })
    if (prompt.startsWith('Factual repair cycle')) return JSON.stringify({ corrections: [] })
    if (prompt.startsWith('Propose conservative replacement wording')) {
      const { sourcesByItem } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ items: sourcesByItem.map((sources: string[]) => ({ text: sources[0], rationale: 'Keeps the cited wording while reflecting the role.' })) })
    }
    const payload = JSON.parse(prompt.slice(prompt.indexOf('{')))
    if (prompt.startsWith('Score these numbered')) return JSON.stringify({ relevance: payload.items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Relevant saved skill.' })) })
    return JSON.stringify({ headline: 'Engineer', summary: { text: 'Engineer with saved technical skills.', evidence: [payload.selected[0].index], rationale: 'Selected profile evidence.' }, education: [], experience: [], projects: [], skills: payload.selected.filter((item: { category: string }) => item.category === 'skills').map((item: { index: number; text: string }) => ({ name: JSON.parse(item.text).name, evidence: [item.index], rationale: 'Saved skill.' })), certificates: [] })
  } }
  const wb = createWorkbench(directory, undefined, transport, undefined, { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => { const fetchNumber = ++fetchCount; return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ id: 'refresh-target', text: 'Platform Engineer', company: 'Example Employer', ...(fetchNumber >= 2 ? { datePosted: '2 days ago' } : {}), descriptionPlain: fetchNumber === 1 ? oldText : newText })) } } })
  try {
    await wb.api.saveSkill({ name: 'TypeScript', category: 'Programming' })
    const first = await wb.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/refresh-target')
    const firstState = await readReady(wb.api, first.token)
    const saved = await acceptImport(wb.api, first.token, { title: firstState.preview.title, company: firstState.preview.company!, description: firstState.preview.description }, { completenessConfirmed: true, conflictResolutions: {} })
    if (!saved.ok) throw new Error(saved.error.message)
    const usage = await wb.api.getAnalysisUsage()
    await wb.api.setAnalysisBudgets({ ...analysisBudgetValues(usage), minimumSpacingMs: 0, rateLimitWindowMs: 1000 })
    const consent = await wb.api.prepareOutboundConsent(saved.value.id)
    if (!consent.ok) throw new Error(consent.message)
    expect(await wb.api.acceptOutboundConsent(consent.token, true, true)).toMatchObject({ ok: true })
    expect(await wb.api.startAnalysis(consent.token)).toMatchObject({ status: 'complete' })
    const generated = await wb.api.generateDraft(consent.token)
    if (!generated.ok || !generated.draft) throw new Error('Could not generate a draft against the original posting.')
    expect((await wb.api.checkDraft(saved.value.id))?.passed).toBe(true)
    const canonical = await wb.api.getCanonicalDocument(saved.value.id)
    if (!canonical) throw new Error('Could not prepare the original canonical document.')
    const documentHash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
    await wb.api.saveDocumentFitReport(saved.value.id, { documentHash, targetPages: canonical.targetPages, actualPages: canonical.targetPages, extractedText: ['CV'], linkTargets: [], links: [], overflow: false, proposedCuts: [], measuredAt: new Date().toISOString() })
    expect(await wb.api.approveDraft(saved.value.id)).toMatchObject({ ok: true })
    expect(await wb.api.assertDraftExportable(saved.value.id)).toMatchObject({ ok: true })
    const earlierDraft = await wb.api.getDraft(saved.value.id)
    if (!earlierDraft) throw new Error('Approved draft disappeared.')
    const callsBeforeRefresh = modelCalls, attemptsBeforeRefresh = (await wb.api.getAnalysisUsage()).attempts
    const metadataFetch = await wb.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/refresh-target')
    const metadataState = await readReady(wb.api, metadataFetch.token)
    const metadataEdit = await wb.api.updatePostingPreview(metadataFetch.token, 0, { title: metadataState.preview.title, company: metadataState.preview.company!, description: metadataState.preview.description, optionalDetails: metadataState.preview.optionalDetails })
    if (!metadataEdit.ok || metadataEdit.revision === undefined) throw new Error('Could not stage metadata-only refresh.')
    await wb.api.reviewPostingPreview(metadataFetch.token, metadataEdit.revision, { completenessConfirmed: true, conflictResolutions: {} })
    const metadataAccepted = await wb.api.acceptPostingRefresh(metadataFetch.token, metadataEdit.revision, saved.value.id, saved.value.updatedAt, saved.value.revisions.at(-1)?.revision ?? 0, { title: 'working', company: 'working', description: 'working', optionalDetails: { postedDate: 'source' } })
    if (!metadataAccepted.ok) throw new Error(metadataAccepted.error.message)
    expect(metadataAccepted.value.updatedAt).toBe(saved.value.updatedAt)
    expect(metadataAccepted.value.optionalDetails.postedDate).toMatchObject({ value: '2 days ago', uncertainty: 'relative-date' })
    expect(await wb.api.getAnalysis(saved.value.id)).toMatchObject({ status: 'complete' })
    expect(await wb.api.getDraft(saved.value.id)).toMatchObject({ approved: true, targetPostingUpdatedAt: saved.value.updatedAt })
    expect(await wb.api.assertDraftExportable(saved.value.id)).toMatchObject({ ok: true })
    expect(modelCalls).toBe(callsBeforeRefresh)
    const requirementFetch = await wb.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/refresh-target')
    const requirementState = await readReady(wb.api, requirementFetch.token)
    const edit = await wb.api.updatePostingPreview(requirementFetch.token, 0, { title: requirementState.preview.title, company: requirementState.preview.company!, description: requirementState.preview.description, optionalDetails: requirementState.preview.optionalDetails })
    if (!edit.ok || edit.revision === undefined) throw new Error('Could not stage changed requirements.')
    await wb.api.reviewPostingPreview(requirementFetch.token, edit.revision, { completenessConfirmed: true, conflictResolutions: {} })
    const accepted = await wb.api.acceptPostingRefresh(requirementFetch.token, edit.revision, saved.value.id, metadataAccepted.value.updatedAt, metadataAccepted.value.revisions.at(-1)?.revision ?? 0, { title: 'working', company: 'working', description: 'source', optionalDetails: {} })
    if (!accepted.ok) throw new Error(accepted.error.message)
    expect(accepted.value.description).toContain('Accessibility review.')
    expect(await wb.api.getAnalysis(saved.value.id)).toMatchObject({ status: 'stale', targetPostingUpdatedAt: saved.value.updatedAt })
    expect(await wb.api.getDraft(saved.value.id)).toMatchObject({ id: earlierDraft.id, revision: earlierDraft.revision, content: earlierDraft.content, targetPostingUpdatedAt: earlierDraft.targetPostingUpdatedAt, approved: true, coverage: { stale: true } })
    expect(await wb.api.assertDraftExportable(saved.value.id)).toMatchObject({ ok: false, message: expect.stringMatching(/earlier job posting/i) })
    expect(modelCalls).toBe(callsBeforeRefresh)
    expect(await wb.api.getAnalysisUsage()).toMatchObject({ attempts: attemptsBeforeRefresh })
  } finally { wb.close() }
}, 30_000)

test('saved jobs preserve original posting text, have stable IDs, and reopen after SQLite restart', async () => {
  const { directory, workbench } = open()
  const original = '\n  Responsibilities:\n- Build reliable systems.\n  Requirements: TypeScript.  \n'
  const saved = await workbench.api.saveJob({ title: 'Engineer', company: 'Fictional Co', description: original })
  expect(saved.ok).toBe(true)
  if (!saved.ok) throw Error(saved.error.message)
  expect(saved.value).toMatchObject({ title: 'Engineer', company: 'Fictional Co', description: original, provenance: 'manual', sourceSnapshot: null, revisions: [{ title: 'Engineer', company: 'Fictional Co', description: original, revision: 1, provenance: 'manual' }] })
  const id = saved.value.id
  expect(await workbench.api.listJobs()).toEqual([saved.value])
  workbench.close()

  const reopened = createWorkbench(directory)
  expect(await reopened.api.openJob(id)).toEqual(saved.value)
  expect(await reopened.api.listJobs()).toEqual([saved.value])
  reopened.close()
})

test('reviewed link imports save atomically with immutable source provenance and reopen offline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-reviewed-import-'))
  directories.push(directory)
  const calls: string[] = []
  const description = `Responsibilities\n${'The fictional engineering team builds reliable software and maintains dependable systems with careful collaboration. '.repeat(4)}\nRequirements\n• Build reliable services with the fictional team.`
  const responseBody = JSON.stringify({ id: 'review-save-1', text: 'Source Engineer', company: 'Example Source Co', descriptionPlain: description, lists: [{ text: 'Responsibilities', content: '<li>Build reliable services with the fictional team.</li>' }] })
  const imported = createWorkbench(directory, undefined, undefined, undefined, { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async url => { calls.push(url.href); return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(responseBody) } } })
  let importedClosed = false
  try {
    const { token } = await imported.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/review-save-1')
    let state = await imported.api.readPostingPreview(token)
    for (let attempt = 0; attempt < 300 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); state = await imported.api.readPostingPreview(token) }
    expect(state.status).toBe('ready')
    if (state.status !== 'ready') throw Error('Synthetic source was not ready')
    const reviewedDescription = `${state.preview.description}\nReviewed clarification: include the fictional on-call rotation.`
    const database = new Database(join(directory, 'workbench.sqlite'))
    database.exec("CREATE TRIGGER refuse_import BEFORE INSERT ON jobs BEGIN SELECT RAISE(ABORT, 'simulated import transaction failure'); END")
    const failedStage = await stageImportReview(imported.api, token, { title: 'Reviewed Engineer', company: 'Corrected Example Co', description: reviewedDescription }, { completenessConfirmed: true, conflictResolutions: {} })
    const failedAcceptance = await imported.api.acceptPostingImport(token, failedStage.revision)
    expect(failedAcceptance).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await imported.api.listJobs()).toEqual([])
    database.exec('DROP TRIGGER refuse_import')
    database.close()
    expect(await imported.api.acceptPostingImport(token, 0)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    const result = await imported.api.acceptPostingImport(token, failedStage.revision)
    expect(result).toMatchObject({ ok: true, value: { title: 'Reviewed Engineer', company: 'Corrected Example Co', provenance: 'imported', sourceSnapshot: { title: 'Source Engineer', company: 'Example Source Co', submittedUrl: 'https://api.lever.co/v0/postings/example-board/review-save-1', finalUrl: 'https://api.lever.co/v0/postings/example-board/review-save-1', extractionMethod: 'lever-json-v1', fieldOrigins: { title: 'user-correction', company: 'user-correction', description: 'user-correction' } }, revisions: [{ title: 'Reviewed Engineer', company: 'Corrected Example Co', revision: 1, provenance: 'imported' }] } })
    if (!result.ok) throw Error(result.error.message)
    expect(result.value.sourceSnapshot?.description).not.toBe(result.value.description)
    const backup = imported.backup.createBackup()
    expect(backup).toContain('Source Engineer')
    expect(backup).toContain(result.value.sourceSnapshot!.hashes.description)
    const unrelated = await imported.api.saveJob({ title: 'Another role', company: 'Fictional Co', description: 'Separate manual posting.' })
    expect(unrelated.ok).toBe(true)
    const restore = imported.backup.previewRestore(backup)
    imported.backup.applyRestore(restore.token, safety => safety)
    const repeatedFetch = await imported.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/review-save-1')
    let repeatedState = await imported.api.readPostingPreview(repeatedFetch.token)
    for (let attempt = 0; attempt < 300 && repeatedState.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); repeatedState = await imported.api.readPostingPreview(repeatedFetch.token) }
    if (repeatedState.status !== 'ready') throw Error('Repeated synthetic source was not ready')
    const repeated = await acceptImport(imported.api, repeatedFetch.token, { title: 'Reviewed Engineer', company: 'Corrected Example Co', description: reviewedDescription }, { completenessConfirmed: true, conflictResolutions: {} })
    expect(repeated).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: expect.stringMatching(/already saved|Open the existing/i) } })
    expect(await imported.api.listJobs()).toHaveLength(1)
    expect((await imported.api.getAnalysisUsage()).attempts).toBe(0)
    const id = result.value.id
    imported.close(); importedClosed = true
    const reopened = createWorkbench(directory)
    try {
      const restored = await reopened.api.openJob(id)
      expect(restored).toEqual(result.value)
      expect(restored?.sourceSnapshot?.hashes).toEqual(result.value.sourceSnapshot?.hashes)
      expect(restored?.sourceSnapshot?.description).toBe(state.preview.description)
      expect(restored?.description).toBe(reviewedDescription)
      expect(calls).toHaveLength(2)
    } finally { reopened.close() }
  } finally { if (!importedClosed) imported.close() }
}, 20_000)

test('a source-missing company can be supplied deliberately while incomplete posting text remains blocked', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-import-corrections-'))
  directories.push(directory)
  const body = JSON.stringify({ id: 'company-omitted', text: 'Source Engineer', descriptionPlain: `Responsibilities\n${'Build and maintain fictional software with a cross-functional example team. '.repeat(5)}\nRequirements\nCareful testing and documentation.`, lists: [{ text: 'Requirements', content: '<li>Careful testing and documentation.</li>' }] })
  const wb = createWorkbench(directory, undefined, undefined, undefined, { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(body) }) })
  try {
    const started = await wb.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/company-omitted')
    let state = await wb.api.readPostingPreview(started.token)
    for (let attempt = 0; attempt < 300 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); state = await wb.api.readPostingPreview(started.token) }
    expect(state).toMatchObject({ status: 'incomplete', preview: { company: null } })
    if (state.status !== 'incomplete') throw Error('Expected the source to omit its employer name')
    const blockedCorrection = await stageImportReview(wb.api, started.token, { title: state.preview.title, company: 'User-reviewed Example Employer', description: 'A replacement description cannot bypass incomplete source notices.' }, { completenessConfirmed: true, conflictResolutions: {} })
    expect(blockedCorrection.reviewed).toMatchObject({ ok: false })
    expect(await wb.api.acceptPostingImport(started.token, blockedCorrection.revision)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    const corrected = await wb.api.updatePostingPreview(started.token, blockedCorrection.revision, { title: state.preview.title, company: 'User-reviewed Example Employer', description: state.preview.description, optionalDetails: state.preview.optionalDetails })
    expect(corrected.ok).toBe(true)
    if (corrected.revision === undefined) throw Error('Corrected preview revision is missing.')
    expect(await wb.api.reviewPostingPreview(started.token, corrected.revision, { completenessConfirmed: true, conflictResolutions: {} })).toMatchObject({ ok: true })
    const accepted = await wb.api.acceptPostingImport(started.token, corrected.revision)
    if (!accepted.ok) throw new Error(`Company correction rejected: ${accepted.error.message}`)
    expect(accepted).toMatchObject({ ok: true, value: { company: 'User-reviewed Example Employer', sourceSnapshot: { company: null, hashes: { company: null }, fieldOrigins: { company: 'user-correction' } } } })
    expect(await wb.api.acceptPostingImport(started.token, blockedCorrection.revision)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  } finally { wb.close() }
})

test('conflicting source company values stay visible and require an explicit source-backed resolution', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-import-conflict-'))
  directories.push(directory)
  const body = readFileSync(join(process.cwd(), 'tests/fixtures/posting-import-feasibility/lever-conflicting-company.synthetic.json'))
  const wb = createWorkbench(directory, undefined, undefined, undefined, { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(body) }) })
  try {
    const started = await wb.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/company-conflict')
    let state = await wb.api.readPostingPreview(started.token)
    for (let attempt = 0; attempt < 300 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); state = await wb.api.readPostingPreview(started.token) }
    expect(state.status).toBe('incomplete')
    if (state.status !== 'incomplete') throw Error('Expected a source-conflict preview')
    expect(state.preview.conflicts).toEqual([
      { id: 'company', field: 'company', values: [{ value: 'Example Systems Ltd.', source: 'Company field' }, { value: 'Example Systems Incorporated', source: 'Company name field' }] },
      { id: 'location', field: 'location', values: [{ value: 'Remote', source: 'Lever categories.location/location' }, { value: 'On-site', source: 'Readable posting: location heading' }] },
      { id: 'compensation', field: 'compensation', values: [{ value: 'USD 80000 95000 year', source: 'Lever salaryRange/salaryDescription' }, { value: 'CAD 70,000 annually', source: 'Readable posting: compensation heading' }] },
      { id: 'postedDate', field: 'postedDate', values: [{ value: '2 days ago', source: 'Lever datePosted/createdAt' }, { value: 'yesterday', source: 'Readable posting: posted heading' }] }
    ])
    expect(state.preview.optionalDetails).toMatchObject({ location: { value: 'Remote', origin: 'source' }, compensation: { value: 'USD 80000 95000 year', origin: 'source' }, postedDate: { value: '2 days ago', uncertainty: 'relative-date' }, deadline: { value: '2026-11-30' }, applicationUrl: { value: 'https://jobs.lever.co/example-board/apply-id' }, language: { value: 'English' } })
    const input = { title: state.preview.title, company: 'Example Systems Incorporated', description: state.preview.description, optionalDetails: { ...state.preview.optionalDetails, location: { ...state.preview.optionalDetails.location, value: 'On-site', origin: 'source' as const, source: 'forged source context', uncertainty: 'relative-date' as const } } }
    const staged = await stageImportReview(wb.api, started.token, input, { completenessConfirmed: true, conflictResolutions: {} })
    expect(staged.reviewed).toMatchObject({ ok: false })
    expect(await wb.api.acceptPostingImport(started.token, staged.revision)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect((await wb.api.reviewPostingPreview(started.token, staged.revision, { completenessConfirmed: true, conflictResolutions: { company: 'A compromise employer' } })).ok).toBe(false)
    const mismatch = await wb.api.reviewPostingPreview(started.token, staged.revision, { completenessConfirmed: true, conflictResolutions: { company: 'Example Systems Incorporated', location: 'Remote' } })
    expect(mismatch.ok).toBe(false)
    const unresolved = await wb.api.reviewPostingPreview(started.token, staged.revision, { completenessConfirmed: true, conflictResolutions: { company: 'Example Systems Incorporated', location: 'On-site', compensation: 'USD 80000 95000 year', postedDate: '2 days ago' } })
    expect(unresolved.ok).toBe(true)
    const updatedAfterReview = await wb.api.updatePostingPreview(started.token, staged.revision, { ...input, description: `${input.description}\nReviewed clarification retained in working text.` })
    expect(updatedAfterReview.ok).toBe(true)
    expect(await wb.api.acceptPostingImport(started.token, staged.revision)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    if (updatedAfterReview.revision === undefined) throw Error('Updated edit revision is missing.')
    expect(await wb.api.reviewPostingPreview(started.token, updatedAfterReview.revision, { completenessConfirmed: true, conflictResolutions: { company: 'Example Systems Incorporated', location: 'On-site', compensation: 'USD 80000 95000 year', postedDate: '2 days ago' } })).toMatchObject({ ok: true })
    const accepted = await wb.api.acceptPostingImport(started.token, updatedAfterReview.revision)
    expect(accepted).toMatchObject({ ok: true, value: { company: 'Example Systems Incorporated', optionalDetails: { location: { value: 'On-site', origin: 'user-correction', source: 'Lever categories.location/location', uncertainty: 'none' }, postedDate: { value: '2 days ago', uncertainty: 'relative-date' } }, sourceSnapshot: { company: 'Example Systems Ltd.', optionalDetails: { location: { value: 'Remote', origin: 'source' }, compensation: { value: 'USD 80000 95000 year' } }, fieldOrigins: { company: 'user-correction' } } } })
    if (!accepted.ok) throw new Error('Resolved posting did not save.')
    const backup = wb.backup.createBackup()
    expect(JSON.parse(backup).version).toBe(3)
    const restore = wb.backup.previewRestore(backup)
    wb.backup.applyRestore(restore.token, value => value)
    const reopened = await wb.api.openJob(accepted.value.id)
    expect(reopened?.sourceSnapshot?.company).toBe('Example Systems Ltd.')
    expect(reopened?.sourceSnapshot?.optionalDetails).toEqual(accepted.value.sourceSnapshot?.optionalDetails)
    expect(reopened?.optionalDetails.postedDate).toMatchObject({ value: '2 days ago', uncertainty: 'relative-date' })
  } finally { wb.close() }
})

test('missing essentials and teaser text can be repaired only with a reviewed complete structure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-import-essential-repair-'))
  directories.push(directory)
  const completeDescription = `Responsibilities\n${'Build reliable fictional software with careful collaboration and clear operational practices. '.repeat(4)}\n\nRequirements\n• Experience with testing.\n• Clear written communication.`
  const wb = createWorkbench(directory, undefined, undefined, undefined, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }], wait: async () => {}, now: (() => { let value = 50_000; return () => value += 2_000 })(),
    request: async url => {
      const id = url.pathname.split('/').at(-1)
      const content = id === 'missing-title' ? { company: 'Example Employer', descriptionPlain: completeDescription } : id === 'teaser-repair' ? { text: 'Synthetic Engineer', company: 'Example Employer', descriptionPlain: 'A short teaser.' } : { text: 'Synthetic Engineer', company: 'Example Employer' }
      return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ id, ...content })) }
    }
  })
  async function ready(token: string) {
    let state = await wb.api.readPostingPreview(token)
    for (let attempt = 0; attempt < 200 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); state = await wb.api.readPostingPreview(token) }
    if (state.status !== 'incomplete') throw new Error('Expected an incomplete source preview.')
    return state.preview
  }
  async function update(token: string, revision: number, input: { title: string; company: string; description: string; optionalDetails: import('../src/shared/jobs').PostingOptionalDetails }) {
    const updated = await wb.api.updatePostingPreview(token, revision, input)
    if (!updated.ok || updated.revision === undefined) throw new Error(updated.message ?? 'Preview update failed.')
    return updated.revision
  }
  try {
    const missingTitle = await wb.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/missing-title')
    const missingTitleSource = await ready(missingTitle.token)
    expect(missingTitleSource.title).toBe('')
    const titleEdit = await update(missingTitle.token, 0, { title: 'Reviewed Synthetic Engineer', company: missingTitleSource.company ?? '', description: missingTitleSource.description, optionalDetails: missingTitleSource.optionalDetails })
    expect(await wb.api.reviewPostingPreview(missingTitle.token, titleEdit, { completenessConfirmed: true, conflictResolutions: {} })).toMatchObject({ ok: true })
    const titleSaved = await wb.api.acceptPostingImport(missingTitle.token, titleEdit)
    expect(titleSaved).toMatchObject({ ok: true, value: { title: 'Reviewed Synthetic Engineer', sourceSnapshot: { title: '', fieldOrigins: { title: 'user-correction' } } } })
    if (!titleSaved.ok) throw new Error(titleSaved.error.message)

    const teaser = await wb.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/teaser-repair')
    const teaserSource = await ready(teaser.token)
    const unchanged = await update(teaser.token, 0, { title: teaserSource.title, company: teaserSource.company ?? '', description: teaserSource.description, optionalDetails: teaserSource.optionalDetails })
    expect(await wb.api.reviewPostingPreview(teaser.token, unchanged, { completenessConfirmed: true, conflictResolutions: {} })).toMatchObject({ ok: false })
    expect(await wb.api.acceptPostingImport(teaser.token, unchanged)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    const repaired = await update(teaser.token, unchanged, { title: teaserSource.title, company: teaserSource.company ?? '', description: completeDescription, optionalDetails: teaserSource.optionalDetails })
    expect(await wb.api.reviewPostingPreview(teaser.token, repaired, { completenessConfirmed: true, conflictResolutions: {} })).toMatchObject({ ok: true })
    const teaserSaved = await wb.api.acceptPostingImport(teaser.token, repaired)
    expect(teaserSaved).toMatchObject({ ok: true, value: { sourceSnapshot: { description: 'A short teaser.' }, description: completeDescription } })
    if (!teaserSaved.ok) throw new Error(teaserSaved.error.message)

    const missingDescription = await wb.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/missing-description')
    const missingDescriptionSource = await ready(missingDescription.token)
    expect(missingDescriptionSource.description).toBe('')
    const blankEdit = await update(missingDescription.token, 0, { title: missingDescriptionSource.title, company: missingDescriptionSource.company ?? '', description: '', optionalDetails: missingDescriptionSource.optionalDetails })
    expect(await wb.api.reviewPostingPreview(missingDescription.token, blankEdit, { completenessConfirmed: true, conflictResolutions: {} })).toMatchObject({ ok: false })
    const repairedDescription = await update(missingDescription.token, blankEdit, { title: missingDescriptionSource.title, company: missingDescriptionSource.company ?? '', description: completeDescription, optionalDetails: missingDescriptionSource.optionalDetails })
    expect(await wb.api.reviewPostingPreview(missingDescription.token, repairedDescription, { completenessConfirmed: true, conflictResolutions: {} })).toMatchObject({ ok: true })
    const descriptionSaved = await wb.api.acceptPostingImport(missingDescription.token, repairedDescription)
    expect(descriptionSaved).toMatchObject({ ok: true, value: { sourceSnapshot: { description: '' }, description: completeDescription } })
    if (!descriptionSaved.ok) throw new Error(descriptionSaved.error.message)

    const backup = wb.backup.createBackup()
    const restore = wb.backup.previewRestore(backup)
    wb.backup.applyRestore(restore.token, value => value)
    expect(await wb.api.openJob(titleSaved.value.id)).toMatchObject({ sourceSnapshot: { title: '', description: completeDescription }, title: 'Reviewed Synthetic Engineer' })
    expect(await wb.api.openJob(teaserSaved.value.id)).toMatchObject({ sourceSnapshot: { description: 'A short teaser.' }, description: completeDescription })
    expect(await wb.api.openJob(descriptionSaved.value.id)).toMatchObject({ sourceSnapshot: { description: '' }, description: completeDescription })
  } finally { wb.close() }
}, 30_000)

test('hosted HTML imports keep source conflicts resolvable and persist their extraction route', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-import-html-route-'))
  directories.push(directory)
  const page = readFileSync(join(process.cwd(), 'tests/fixtures/posting-import-feasibility/lever-hosted-html-conflict.synthetic.html'))
  const wb = createWorkbench(directory, undefined, undefined, undefined, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async url => {
      if (url.hostname === 'jobs.lever.co' && url.pathname.endsWith('/removed-html')) return { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<main><h1>Past Engineer</h1><p class="company">Example Employer</p><p>This job is no longer available.</p><article class="posting">This job is no longer available.</article></main>') }
      if (url.hostname === 'jobs.lever.co') return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: page }
      return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ id: 'html-conflict', text: 'Synthetic Systems Engineer', company: 'Example Source Ltd.', descriptionPlain: `Responsibilities\n${'Build reliable fictional systems with a collaborative engineering team and clear documentation. '.repeat(4)}\nRequirements\nTesting and written communication.`, lists: [{ text: 'Requirements', content: '<li>Testing and written communication.</li>' }] })) }
    }
  })
  try {
    const started = await wb.api.startPostingFetch('https://jobs.lever.co/example-board/html-conflict')
    let state = await wb.api.readPostingPreview(started.token)
    for (let attempt = 0; attempt < 300 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); state = await wb.api.readPostingPreview(started.token) }
    expect(state.status).toBe('incomplete')
    if (state.status !== 'incomplete') throw new Error('Expected a reviewable HTML source conflict.')
    expect(state.preview.extractionMethod).toBe('lever-html-jsonld-v1')
    expect(state.preview.conflicts).toContainEqual({ id: 'company', field: 'company', values: [{ value: 'Example Source Ltd.', source: 'Lever JSON-LD hiringOrganization.name' }, { value: 'Example Readable Incorporated', source: 'Readable page company label' }] })
    expect(state.preview.description).toContain('Requirements')
    const htmlResolutions = Object.fromEntries(state.preview.conflicts.map(conflict => [conflict.id, conflict.field === 'company' ? 'Example Readable Incorporated' : conflict.field === 'description' ? state.preview.description : conflict.values[0].value]))
    const staged = await stageImportReview(wb.api, started.token, { title: state.preview.title, company: 'Example Readable Incorporated', description: state.preview.description, optionalDetails: state.preview.optionalDetails }, { completenessConfirmed: true, conflictResolutions: htmlResolutions })
    expect(staged.reviewed).toMatchObject({ ok: true })
    const accepted = await wb.api.acceptPostingImport(started.token, staged.revision)
    expect(accepted).toMatchObject({ ok: true, value: { company: 'Example Readable Incorporated', sourceSnapshot: { company: 'Example Source Ltd.', extractionMethod: 'lever-html-jsonld-v1', conflicts: [{ id: 'company' }] } } })
    if (!accepted.ok) throw new Error(accepted.error.message)
    const backup = wb.backup.createBackup()
    const restore = wb.backup.previewRestore(backup)
    wb.backup.applyRestore(restore.token, value => value)
    expect(await wb.api.openJob(accepted.value.id)).toMatchObject({ sourceSnapshot: { company: 'Example Source Ltd.', extractionMethod: 'lever-html-jsonld-v1', conflicts: accepted.value.sourceSnapshot?.conflicts } })
    const apiRoute = await wb.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/html-conflict')
    let apiState = await wb.api.readPostingPreview(apiRoute.token)
    for (let attempt = 0; attempt < 300 && apiState.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); apiState = await wb.api.readPostingPreview(apiRoute.token) }
    expect(apiState.status).toBe('ready')
    if (apiState.status !== 'ready') throw new Error('Expected the API route preview.')
    const duplicate = await acceptImport(wb.api, apiRoute.token, { title: apiState.preview.title, company: apiState.preview.company ?? '', description: apiState.preview.description, optionalDetails: apiState.preview.optionalDetails }, { completenessConfirmed: true, conflictResolutions: {} })
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: expect.stringMatching(/already saved|Open the existing/i) } })
    expect(await wb.api.listJobs()).toHaveLength(1)
    const removed = await wb.api.startPostingFetch('https://jobs.lever.co/example-board/removed-html')
    let removedState = await wb.api.readPostingPreview(removed.token)
    for (let attempt = 0; attempt < 300 && removedState.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); removedState = await wb.api.readPostingPreview(removed.token) }
    expect(removedState).toMatchObject({ status: 'failed', message: expect.stringMatching(/explicitly identifies.*removed/i) })
  } finally { wb.close() }
}, 25_000)

test('superseding a reviewed preview invalidates its revision-bound acceptance', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-import-supersede-review-'))
  directories.push(directory)
  const description = `Responsibilities\\n${'Build careful fictional software with a reliable team and clear operational practices. '.repeat(4)}\\nRequirements\\nTesting.`
  const body = JSON.stringify({ id: 'supersede-review', text: 'Synthetic Engineer', company: 'Example Employer', descriptionPlain: description })
  const wb = createWorkbench(directory, undefined, undefined, undefined, { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(body) }) })
  try {
    const first = await wb.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/supersede-review')
    let state = await wb.api.readPostingPreview(first.token)
    for (let attempt = 0; attempt < 300 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); state = await wb.api.readPostingPreview(first.token) }
    if (state.status !== 'ready') throw new Error('Expected first reviewable preview.')
    const staged = await stageImportReview(wb.api, first.token, { title: state.preview.title, company: state.preview.company!, description: state.preview.description }, { completenessConfirmed: true, conflictResolutions: {} })
    expect(staged.reviewed).toMatchObject({ ok: true })
    const second = await wb.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/supersede-review')
    expect(await wb.api.readPostingPreview(first.token)).toEqual({ status: 'cancelled' })
    expect(await wb.api.acceptPostingImport(first.token, staged.revision)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await wb.api.listJobs()).toEqual([])
    await wb.api.cancelPostingFetch(second.token)
  } finally { wb.close() }
})

test('listings and explicit removed-role responses fail distinctly from an unreachable 404', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-import-nonposting-'))
  directories.push(directory)
  const expiredDeadline = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const wb = createWorkbench(directory, undefined, undefined, undefined, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async url => {
      const id = url.pathname.split('/').at(-1)
      if (id === 'expired-deadline') return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ id, text: 'Expired Engineer', company: 'Example Employer', descriptionPlain: 'A complete-looking posting.', deadline: expiredDeadline })) }
      if (id === 'listing-response') return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify([{ id: 'role-a' }, { id: 'role-b' }])) }
      if (id === 'removed-response') return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ id, status: 'removed', text: 'Old Engineer' })) }
      return { status: 404, headers: { 'content-type': 'application/json' }, body: Buffer.from('{}') }
    }
  })
  try {
    for (const [id, expected] of [['listing-response', /listing or multiple roles/i], ['removed-response', /explicitly identifies.*removed/i], ['expired-deadline', /application deadline has passed/i], ['not-found', /does not confirm that the role was removed/i]] as const) {
      const started = await wb.api.startPostingFetch(`https://api.lever.co/v0/postings/example-board/${id}`)
      let state = await wb.api.readPostingPreview(started.token)
      for (let attempt = 0; attempt < 300 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); state = await wb.api.readPostingPreview(started.token) }
      expect(state.status).toBe('failed')
      if (state.status === 'failed') expect(state.message).toMatch(expected)
    }
    expect(await wb.api.listJobs()).toEqual([])
  } finally { wb.close() }
}, 20_000)

test('an incomplete teaser cannot be accepted by supplying missing fields alone', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-import-teaser-'))
  directories.push(directory)
  const body = JSON.stringify({ id: 'teaser', text: 'Source Engineer', descriptionPlain: 'A short teaser.' })
  const wb = createWorkbench(directory, undefined, undefined, undefined, { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(body) }) })
  try {
    const started = await wb.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/teaser')
    let state = await wb.api.readPostingPreview(started.token)
    for (let attempt = 0; attempt < 300 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); state = await wb.api.readPostingPreview(started.token) }
    expect(state).toMatchObject({ status: 'incomplete', preview: { company: null } })
    const staged = await stageImportReview(wb.api, started.token, { title: 'Engineer', company: 'User-reviewed Example', description: 'A complete posting description supplied by the caller cannot override source teaser warnings by itself.' }, { completenessConfirmed: true, conflictResolutions: {} })
    expect(staged.reviewed).toMatchObject({ ok: false })
    expect(await wb.api.acceptPostingImport(started.token, staged.revision)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await wb.api.listJobs()).toEqual([])
  } finally { wb.close() }
})

test('posting fetch previews run through the public application contract and stay ephemeral', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-safe-fetch-'))
  directories.push(directory)
  const calls: Array<{ url: string; address: string; headers: Readonly<Record<string, string>> }> = []
  const responseBody = JSON.stringify({ id: 'synthetic-123', text: 'Synthetic Platform Engineer', descriptionPlain: 'Build reliable example systems for the fictional organization. The person in this role will collaborate with a diverse team to deliver practical software improvements and maintain dependable systems over time.\nResponsibilities\nDesign safe interfaces.', descriptionBodyPlain: 'Responsibilities\nDesign safe interfaces.', lists: [{ text: 'Requirements', content: '<li>Experience with testing.</li>' }] })
  const options = { lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async (url: URL, address: { address: string }, _signal: AbortSignal, headers: Readonly<Record<string, string>>) => { calls.push({ url: url.href, address: address.address, headers }); return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(responseBody) } } }
  const workbench = createWorkbench(directory, undefined, undefined, undefined, options)
  let reopened: ReturnType<typeof createWorkbench> | undefined
  try {
    expect(await workbench.api.listJobs()).toEqual([])
    const started = await workbench.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/synthetic-123')
    let state = await workbench.api.readPostingPreview(started.token)
    for (let attempt = 0; attempt < 200 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); state = await workbench.api.readPostingPreview(started.token) }
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ url: 'https://api.lever.co/v0/postings/example-board/synthetic-123', address: '8.8.8.8', headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'CV-Tailor/1.0' } })
    expect(state).toMatchObject({ status: 'incomplete', preview: { title: 'Synthetic Platform Engineer', company: null, description: expect.stringContaining('• Experience with testing.') } })
    expect(await workbench.api.listJobs()).toEqual([])
    expect((await workbench.api.getAnalysisUsage()).attempts).toBe(0)
    workbench.close()
    reopened = createWorkbench(directory)
    expect(await reopened.api.listJobs()).toEqual([])
    expect(await reopened.api.readPostingPreview(started.token)).toEqual({ status: 'failed', message: 'This temporary preview is no longer available.' })
  } finally { workbench.close(); reopened?.close() }
})

test('posting fetch preserves the Lever opening and reconciles adversarial list sections in a bounded extraction', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-extraction-'))
  directories.push(directory)
  const items = Array.from({ length: 10 }, (_, item) => `Repeated synthetic requirement ${item} with supporting detail.`)
  const description = `${'Fictional contextual posting text. '.repeat(4_000)}\n${items.join('\n')}`
  const lists = Array.from({ length: 1_000 }, (_, group) => ({ text: `Section ${group}`, content: items.map(item => `<li>${item}</li>`).join('') }))
  const body = JSON.stringify({ id: 'extract-me', text: 'Synthetic Systems Engineer', company: 'Example Employer', descriptionPlain: description, opening: '<p>Opening detail preserved from the source.</p>', lists })
  const workbench = createWorkbench(directory, undefined, undefined, undefined, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(body) }),
    wait: async () => {}, now: () => Date.now()
  })
  try {
    const { token } = await workbench.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/extract-me')
    let state = await workbench.api.readPostingPreview(token)
    for (let attempt = 0; attempt < 100 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 5)); state = await workbench.api.readPostingPreview(token) }
    expect(state, JSON.stringify(state).slice(0, 500)).toMatchObject({ status: 'ready' })
    if (state.status === 'ready') {
      expect(state.preview.description).toContain('Opening detail preserved from the source.')
      expect(state.preview.description).toContain('• Repeated synthetic requirement 9 with supporting detail.')
      expect(state.preview.description.match(/• Repeated synthetic requirement /g)).toHaveLength(10)
    }
  } finally { workbench.close() }
})

test('posting fetch rejects unsupported links before contacting a source and cancels active reads', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-cancel-'))
  directories.push(directory)
  let requestStarted!: () => void
  let resolveLate!: (response: { status: number; headers: Record<string, string>; body: Buffer }) => void
  let dnsLookups = 0
  const startedRequest = new Promise<void>(resolve => { requestStarted = resolve })
  let apiWorkbench: ReturnType<typeof createWorkbench> | undefined
  try {
    apiWorkbench = createWorkbench(directory, undefined, undefined, undefined, {
      lookup: async () => { dnsLookups++; return [{ address: '8.8.4.4', family: 4 }] },
      request: async () => new Promise(resolve => { requestStarted(); resolveLate = resolve })
    })
    await expect(apiWorkbench.api.startPostingFetch('https://unknown.example/job')).rejects.toThrow(/Lever job-detail/)
    expect(dnsLookups).toBe(0)
    const active = await apiWorkbench.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/cancel-me')
    await startedRequest
    expect(await apiWorkbench.api.cancelPostingFetch(active.token)).toEqual({ ok: true })
    expect(await apiWorkbench.api.readPostingPreview(active.token)).toEqual({ status: 'cancelled' })
    expect(await apiWorkbench.api.acceptPostingImport(active.token, 0)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    resolveLate({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ id: 'cancel-me', text: 'Late response', company: 'Example', descriptionPlain: 'This response arrived only after cancellation.' })) })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await apiWorkbench.api.readPostingPreview(active.token)).toEqual({ status: 'cancelled' })
    expect(await apiWorkbench.api.listJobs()).toEqual([])
  } finally { apiWorkbench?.close() }
})

test('posting fetch cancellation interrupts pending DNS before opening a connection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-dns-cancel-'))
  directories.push(directory)
  let dnsStarted!: () => void, requests = 0
  const startedDns = new Promise<void>(resolve => { dnsStarted = resolve })
  const workbench = createWorkbench(directory, undefined, undefined, undefined, {
    lookup: async () => new Promise(() => { dnsStarted() }),
    request: async () => { requests++; return { status: 200, headers: {}, body: Buffer.alloc(0) } }
  })
  try {
    const { token } = await workbench.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/dns-cancel')
    await startedDns
    expect(await workbench.api.cancelPostingFetch(token)).toEqual({ ok: true })
    expect(await workbench.api.readPostingPreview(token)).toEqual({ status: 'cancelled' })
    expect(requests).toBe(0)
    expect(workbench.hasActiveWork()).toBe(false)
  } finally { workbench.close() }
})

test('posting fetch fails closed on mixed public/private DNS and redirect pivots', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-destinations-'))
  directories.push(directory)
  let blockedRequests = 0, dnsCalls = 0, redirectRequests = 0
  const workbench = createWorkbench(directory, undefined, undefined, undefined, {
    lookup: async () => { dnsCalls++; return [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] },
    request: async () => { blockedRequests++; return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.alloc(0) } },
    wait: async () => {}, now: () => Date.now()
  })
  try {
    const privateTarget = await workbench.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/private')
    let state = await workbench.api.readPostingPreview(privateTarget.token)
    for (let attempt = 0; attempt < 100 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 5)); state = await workbench.api.readPostingPreview(privateTarget.token) }
    expect(state).toMatchObject({ status: 'failed', message: expect.stringContaining('non-public') })
    expect(blockedRequests).toBe(0)

    const redirectDirectory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-redirect-'))
    directories.push(redirectDirectory)
    const redirectWork = createWorkbench(redirectDirectory, undefined, undefined, undefined, {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async () => { redirectRequests++; return { status: 302, headers: {}, location: 'https://evil.example/private', body: Buffer.alloc(0) } },
      wait: async () => {}, now: () => Date.now()
    })
    try {
      const pivot = await redirectWork.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/pivot')
      let pivotState = await redirectWork.api.readPostingPreview(pivot.token)
      for (let attempt = 0; attempt < 100 && pivotState.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 5)); pivotState = await redirectWork.api.readPostingPreview(pivot.token) }
      expect(pivotState).toMatchObject({ status: 'failed', message: expect.stringContaining('outside the approved') })
      expect(redirectRequests).toBe(1)
    } finally { redirectWork.close() }
    expect(dnsCalls).toBe(1)
    expect(await workbench.api.listJobs()).toEqual([])
  } finally { workbench.close() }
})

test('posting import retries one transient response and never saves on fetch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-retry-'))
  directories.push(directory)
  const attempts: number[] = [], waits: number[] = []
  const text = 'This synthetic role supports an example team by improving a fictional product, documenting operational decisions, and collaborating with colleagues across the organization. Responsibilities include maintaining services and writing clear technical documentation for internal users.'
  const body = JSON.stringify({ id: 'retry-me', text: 'Example Reliability Engineer', company: 'Synthetic Employer', descriptionPlain: `Responsibilities\n${text}`, lists: [{ text: 'Responsibilities', content: '<li>Maintain example services.</li>' }] })
  let workbench: ReturnType<typeof createWorkbench> | undefined
  try {
    workbench = createWorkbench(directory, undefined, undefined, undefined, {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async () => { attempts.push(attempts.length + 1); return attempts.length === 1 ? { status: 503, headers: {}, body: Buffer.alloc(0) } : { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(body) } },
      wait: async ms => { waits.push(ms) },
      now: () => Date.now()
    })
    const { token } = await workbench.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/retry-me')
    let state = await workbench.api.readPostingPreview(token)
    for (let attempt = 0; attempt < 100 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 5)); state = await workbench.api.readPostingPreview(token) }
    expect(attempts).toHaveLength(2)
    expect(waits).toContain(2_000)
    expect(state).toMatchObject({ status: 'ready', preview: { company: 'Synthetic Employer', description: expect.stringContaining('• Maintain example services.') } })
    const repeated = await workbench.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/retry-me')
    state = await workbench.api.readPostingPreview(repeated.token)
    for (let attempt = 0; attempt < 100 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 5)); state = await workbench.api.readPostingPreview(repeated.token) }
    expect(attempts).toHaveLength(3)
    expect(waits.some(ms => ms > 1_000 && ms < 2_000)).toBe(true)
    expect(await workbench.api.listJobs()).toEqual([])
    expect((await workbench.api.getAnalysisUsage()).attempts).toBe(0)
  } finally { workbench?.close() }
})

test('posting fetch enforces its response deadline through the public application contract', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-deadline-'))
  directories.push(directory)
  let requestStarted!: () => void
  const startedRequest = new Promise<void>(resolve => { requestStarted = resolve })
  vi.useFakeTimers()
  const workbench = createWorkbench(directory, undefined, undefined, undefined, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async () => new Promise(() => { requestStarted() }),
    wait: async () => {}, now: () => Date.now()
  })
  try {
    const { token } = await workbench.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/timeout')
    await startedRequest
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await workbench.api.readPostingPreview(token)).toMatchObject({ status: 'failed', message: expect.stringContaining('15 seconds') })
    expect(await workbench.api.listJobs()).toEqual([])
  } finally { workbench.close(); vi.useRealTimers() }
})

test('posting import does not retry permanent access denials', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-denied-'))
  directories.push(directory)
  let requests = 0
  const workbench = createWorkbench(directory, undefined, undefined, undefined, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async () => { requests++; return { status: 403, headers: {}, body: Buffer.alloc(0) } },
    wait: async () => {}, now: () => Date.now()
  })
  try {
    const { token } = await workbench.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/denied')
    let state = await workbench.api.readPostingPreview(token)
    for (let attempt = 0; attempt < 100 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 5)); state = await workbench.api.readPostingPreview(token) }
    expect(state).toMatchObject({ status: 'failed', message: expect.stringMatching(/denied or rate-limited/) })
    expect(requests).toBe(1)
  } finally { workbench.close() }
})

test('posting fetch cancellation interrupts a bounded Retry-After wait', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-backoff-'))
  directories.push(directory)
  let enterBackoff!: () => void
  const backoff = new Promise<void>(resolve => { enterBackoff = resolve })
  let requests = 0
  let workbench: ReturnType<typeof createWorkbench> | undefined
  try {
    workbench = createWorkbench(directory, undefined, undefined, undefined, {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async () => { requests++; return { status: 429, headers: { 'retry-after': '30' }, body: Buffer.alloc(0) } },
      wait: async (milliseconds, signal) => milliseconds === 30_000 ? new Promise(resolve => { enterBackoff(); signal.addEventListener('abort', () => resolve(), { once: true }) }) : undefined,
      now: () => Date.now()
    })
    const { token } = await workbench.api.startPostingFetch('https://api.lever.co/v0/postings/example-board/backoff')
    await backoff
    await workbench.api.cancelPostingFetch(token)
    expect(await workbench.api.readPostingPreview(token)).toEqual({ status: 'cancelled' })
    expect(requests).toBe(1)
  } finally { workbench?.close() }
})

test('posting import stops oversized compressed and decompressed bodies without a partial preview', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-fetch-bounds-'))
  directories.push(directory)
  const oversizedCompressed = Buffer.alloc(2 * 1024 * 1024 + 1)
  const oversizedExpanded = gzipSync(Buffer.alloc(8 * 1024 * 1024 + 1, 65))
  let requestCount = 0
  const workbench = createWorkbench(directory, undefined, undefined, undefined, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async url => { requestCount++; return { status: 200, headers: { 'content-type': 'application/json', 'content-encoding': url.pathname.endsWith('compressed') ? 'identity' : 'gzip' }, body: url.pathname.endsWith('compressed') ? oversizedCompressed : oversizedExpanded } },
    wait: async () => {}, now: () => Date.now()
  })
  try {
    for (const id of ['compressed', 'expanded']) {
      const { token } = await workbench.api.startPostingFetch(`https://jobs.lever.co/example-board/${id}`)
      let state = await workbench.api.readPostingPreview(token)
      for (let attempt = 0; attempt < 100 && state.status === 'fetching'; attempt++) { await new Promise(resolve => setTimeout(resolve, 5)); state = await workbench.api.readPostingPreview(token) }
      expect(state.status).toBe('failed')
      if (state.status === 'failed') expect(state.message).toMatch(/2 MiB|8 MiB/)
    }
    expect(requestCount).toBe(2)
    expect(await workbench.api.listJobs()).toEqual([])
  } finally { workbench.close() }
})

test('job validation is actionable and invalid records do not mutate storage', async () => {
  const { workbench } = open()
  const invalid = await workbench.api.saveJob({ title: '  ', company: '', description: '\n ' })
  expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { title: expect.any(String), company: expect.any(String), description: expect.any(String) } } })
  expect(await workbench.api.listJobs()).toEqual([])
  expect(await workbench.api.openJob('not-a-uuid')).toBeNull()
  const missing = await workbench.api.saveJob({ id: 'b28b5307-07dd-4e39-bc16-849c56b4c331', title: 'Engineer', company: 'Fictional Co', description: 'Build software.' })
  expect(missing).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  workbench.close()
})

test('opening another job returns only its posting and updating one keeps its identity', async () => {
  const { directory, workbench } = open()
  const first = await workbench.api.saveJob({ title: 'Engineer', company: 'Northwind', description: 'Design compiler tools.' })
  const second = await workbench.api.saveJob({ title: 'Analyst', company: 'Contoso', description: 'Review fictional datasets.' })
  if (!first.ok || !second.ok) throw Error('Fixture save failed')
  expect(await workbench.api.openJob(first.value.id)).toMatchObject({ title: 'Engineer', company: 'Northwind', description: 'Design compiler tools.' })
  expect(await workbench.api.openJob(second.value.id)).toMatchObject({ title: 'Analyst', company: 'Contoso', description: 'Review fictional datasets.' })
  const updated = await workbench.api.saveJob({ id: first.value.id, title: 'Senior Engineer', company: 'Northwind', description: 'Design compiler tools with a fictional team.' })
  expect(updated).toMatchObject({ ok: true, value: { id: first.value.id, createdAt: first.value.createdAt, title: 'Senior Engineer', revisions: [{ title: 'Engineer', revision: 1, provenance: 'manual' }, { title: 'Senior Engineer', revision: 2, provenance: 'manual' }] } })
  expect(await workbench.api.openJob(first.value.id)).toMatchObject({ revisions: [{ description: 'Design compiler tools.' }, { description: 'Design compiler tools with a fictional team.' }] })
  expect(await workbench.api.listJobs()).toHaveLength(2)
  expect(await workbench.api.openJob(second.value.id)).toEqual(second.value)
  workbench.close()
  const reopened = createWorkbench(directory)
  expect(await reopened.api.openJob(first.value.id)).toMatchObject({ id: first.value.id, createdAt: first.value.createdAt, description: 'Design compiler tools with a fictional team.', revisions: [{ description: 'Design compiler tools.' }, { description: 'Design compiler tools with a fictional team.' }] })
  reopened.close()
})

test('manual posting text remains within the established safe limit and rejects overflow without mutation', async () => {
  const { workbench } = open()
  const exact = await workbench.api.saveJob({ title: 'Engineer', company: 'Example', description: 'x'.repeat(30000) })
  expect(exact.ok).toBe(true)
  const oversized = await workbench.api.saveJob({ title: 'Engineer', company: 'Example', description: 'x'.repeat(30001) })
  expect(oversized).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { description: expect.any(String) } } })
  expect(await workbench.api.listJobs()).toHaveLength(1)
  if (!exact.ok) throw Error('exact-limit posting rejected')
  expect((await workbench.api.openJob(exact.value.id))?.description).toHaveLength(30000)
  workbench.close()
})
