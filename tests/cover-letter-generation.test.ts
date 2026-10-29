import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { createWorkbench } from '../src/main/workbench'
import { AnalysisError, type AnalysisTransport } from '../src/main/posting-analysis'
import type { CoverLetterPurpose } from '../src/shared/cover-letter'
import type { PiModelRuntime } from '../src/main/pi-model'
import type { Api, Model } from '@earendil-works/pi-ai'
import { registerWorkspaceBackupRowSizer } from '../src/main/workspace-backup'

const model = { id: 'author/chat', provider: 'sample', name: 'Synthetic chat', api: 'openai-completions', baseUrl: 'https://example.invalid', input: ['text'], reasoning: true, contextWindow: 16384, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as Model<Api>
const validLetter = () => JSON.stringify({ paragraphs: [{ text: 'I use TypeScript.', citations: [{ ordinal: 1 }] }] })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const opened: ReturnType<typeof createWorkbench>[] = [], dirs: string[] = []
afterEach(() => { opened.splice(0).forEach(w => w.close()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })) })
async function fixture(purpose: CoverLetterPurpose = 'cv+cover-letter', letter: (input: Parameters<AnalysisTransport['generate']>[0]) => Promise<string> = async () => validLetter(), options: { pi?: boolean; beforeLetterAuth?: () => Promise<void>; cvResponse?: unknown; failCvOnce?: boolean; twoSources?: boolean; training?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'letter-generation-')); dirs.push(dir)
  const prompts: string[] = []
  const piCalls: Array<{ model: unknown; reasoning: unknown }> = []
  const transport: AnalysisTransport = { async generate(input) {
    const { prompt } = input; prompts.push(prompt)
    if (prompt.startsWith('Extract only explicit')) return JSON.stringify({ required: [], preferred: [], tools: ['Rust'], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) {
      const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 1, rationale: 'Saved skill.' })) })
    }
    if (prompt.startsWith('Write one cover letter')) return letter(input)
    if (options.failCvOnce) { options.failCvOnce = false; throw new AnalysisError('OFFLINE', 'Synthetic CV interruption.') }
    if (options.training) {
      const request = JSON.parse(prompt.slice(prompt.indexOf('{')))
      const skillIndex = request.selected.find((item: { category: string }) => item.category === 'skills').index
      return JSON.stringify({ education: [], experience: request.experienceGroups.map(({ indexes }: { indexes: number[] }) => ({ text: 'Practiced TypeScript exercises.', evidence: indexes, rationale: 'Saved training fact.' })), projects: [], skills: [{ name: 'TypeScript', evidence: [skillIndex], rationale: 'Saved skill.' }] })
    }
    return JSON.stringify(options.cvResponse ?? { education: [], experience: [], projects: [], skills: [{ name: 'TypeScript', evidence: [0], rationale: 'Saved skill.' }] })
  } }
  let lastLetterAuthCount = -1
  const runtime = {
    getProviders: () => [{ id: model.provider, getModels: () => [model] }], getPhysicalModel: () => model, getAvailable: async () => [model],
    getAuth: async () => { if (prompts.length >= 3 && prompts.length !== lastLetterAuthCount) { lastLetterAuthCount = prompts.length; await options.beforeLetterAuth?.() } return { source: 'synthetic' } },
    completeSimple: async (selected: unknown, context: { messages: Array<{ content: string }> }, request: { signal: AbortSignal; reasoning?: unknown }) => {
      piCalls.push({ model: selected, reasoning: request.reasoning })
      return { role: 'assistant', provider: model.provider, model: model.id, stopReason: 'stop', content: [{ type: 'text', text: await transport.generate({ model: model.id, prompt: context.messages.at(-1)!.content, signal: request.signal, responseSchema: {} as never }) }], usage: { output: 28 } }
    },
  } as unknown as PiModelRuntime
  const wb = options.pi ? createWorkbench(dir, undefined, undefined, undefined, runtime) : createWorkbench(dir, undefined, transport); opened.push(wb)
  if (options.pi) await wb.api.setPiModel({ reference: 'sample/author/chat', thinkingLevel: 'low' })
  await wb.api.saveContact({ fullName: 'PRIVATE_CANDIDATE', email: 'private@example.test' })
  await wb.api.saveSkill({ name: 'TypeScript', category: 'Programming' })
  if (options.twoSources) await wb.api.saveSkill({ name: 'Zebra', category: 'Programming' })
  if (options.training) expect((await wb.api.saveExperience({ kind: 'training', title: 'TypeScript trainee', organization: 'Learning group', description: 'Practiced TypeScript exercises.', factualItems: [{ text: 'Practiced TypeScript.' }] })).ok).toBe(true)
  const job = await wb.api.saveJob({ title: 'Developer', company: 'PRIVATE_COMPANY', description: 'Build services with Rust.', contacts: [{ id: randomUUID(), name: 'PRIVATE_SAVED_CONTACT', role: 'Recruiter', profileUrl: 'https://example.com/private-contact' }] })
  if (!job.ok) throw new Error(job.error.message)
  const preview = await wb.api.prepareOutboundConsent(job.value.id, purpose)
  if (!preview.ok) throw new Error(preview.message)
  expect((await wb.api.acceptOutboundConsent(preview.token, true, true)).ok).toBe(true)
  if (purpose !== 'cover-letter-only') expect((await wb.api.startAnalysis(preview.token)).status).toBe('complete')
  const rows = (table: string) => { const db = new Database(join(dir, 'workbench.sqlite')); try { return db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[] } finally { db.close() } }
  const mutate = (sql: string) => { const db = new Database(join(dir, 'workbench.sqlite')); registerWorkspaceBackupRowSizer(db); try { db.exec(sql) } finally { db.close() } }
  const replaceData = (table: string, data: unknown) => mutate(`UPDATE ${table} SET data='${JSON.stringify(data).replace(/'/g, "''")}'`)
  return { wb, dir, token: preview.token, jobId: job.value.id, prompts, piCalls, rows, mutate, replaceData, transport }
}

async function anotherParent(f: Awaited<ReturnType<typeof fixture>>, purpose: CoverLetterPurpose = 'cv+cover-letter', child = true) {
  const preview = await f.wb.api.prepareOutboundConsent(f.jobId, purpose)
  if (!preview.ok) throw new Error(preview.message)
  expect((await f.wb.api.acceptOutboundConsent(preview.token, true, true)).ok).toBe(true)
  expect((await f.wb.api.startAnalysis(preview.token)).status).toBe('complete')
  const cv = child ? (await f.wb.api.generateRequestedDocuments(preview.token)).cv : await f.wb.api.generateDraft(preview.token)
  expect(cv.ok).toBe(true)
  return cv.draft!.id
}

function persistBackupRows(f: Awaited<ReturnType<typeof fixture>>, backup: any, tables: string[]) {
  for (const table of tables) for (const row of backup.tables[table].rows) {
    f.mutate(`UPDATE ${table} SET data='${row.data.replace(/'/g, "''")}' WHERE id='${row.id}'`)
  }
}

for (const scenario of ['letters', 'cv-only', 'crash-gap'] as const) test(`bounded review stale A cannot select history after real completed B: ${scenario}`, async () => {
  const f = await fixture(scenario === 'letters' ? 'cv+cover-letter' : 'cv')
  const a = (await f.wb.api.generateRequestedDocuments(f.token)).cv.draft!.id
  const b = await anotherParent(f, scenario === 'cv-only' ? 'cv' : 'cv+cover-letter', scenario !== 'crash-gap')
  expect(a).not.toBe(b)
  expect(f.rows('generation_recovery').every(row => row.status === 'complete')).toBe(true)
  expect(await f.wb.api.getCoverLetterGenerationStatus(f.jobId)).toMatchObject({ originCvRevisionId: b, retryAvailable: true })
  const before = f.prompts.length
  expect(await f.wb.api.prepareCoverLetterRetry(f.jobId, a)).toMatchObject({ ok: false, message: expect.stringMatching(/stale|expected.*origin/i) })
  const retry = await acceptRetry(f, b)
  expect((await f.wb.api.generateCoverLetter(retry.token)).status).toBe('saved')
  expect(f.prompts.slice(before)).toEqual([expect.stringMatching(/^Write one cover letter/)])
})

test('bounded review coordinated retry origin and binding rewrite cannot replace actual B intent with valid A', async () => {
  const f = await fixture('cv')
  const a = (await f.wb.api.generateRequestedDocuments(f.token)).cv.draft!.id
  const b = await anotherParent(f)
  const retry = await acceptRetry(f, b)
  expect((await f.wb.api.generateCoverLetter(retry.token)).status).toBe('saved')
  const backup = JSON.parse(f.wb.backup.createBackup())
  const aParent = backup.tables.generation_recovery.rows.find((row: any) => JSON.parse(row.snapshot).identity.id === a)
  const opRow = backup.tables.cover_letter_operations.rows.at(-1)
  const operation = JSON.parse(opRow.data)
  operation.retryOrigin = { parentRunId: aParent.run_id, consentId: aParent.consent_id }
  operation.initialBinding.cvRevisionId = a
  opRow.data = JSON.stringify(operation)
  const letterRow = backup.tables.cover_letter_revisions.rows.at(-1)
  const letter = JSON.parse(letterRow.data)
  letter.cvRevisionId = a
  letterRow.data = JSON.stringify(letter)
  // Independently test already-persisted readiness and the untrusted restore boundary.
  persistBackupRows(f, backup, ['cover_letter_operations', 'cover_letter_revisions'])
  const liveCurrent = (await f.wb.api.checkCoverLetter(f.jobId)).ok
  let restoreAccepted = false
  try { f.wb.backup.previewRestore(JSON.stringify(backup)); restoreAccepted = true } catch (error) { expect(String(error)).toMatch(/cover_letter_operations/) }
  expect({ liveCurrent, restoreAccepted }).toEqual({ liveCurrent: false, restoreAccepted: false })
  expect((await f.wb.api.getCoverLetterGenerationStatus(f.jobId)).retryAvailable).toBe(false)
})

for (const purpose of ['initial', 'retry', 'stripped-initial', 'stripped-retry'] as const) test(`bounded review exact legacy skill-label downgrade stays non-current: ${purpose}`, async () => {
  const f = await fixture(purpose.includes('retry') ? 'cv' : 'cv+cover-letter')
  const initial = await f.wb.api.generateRequestedDocuments(f.token)
  if (purpose.includes('retry')) {
    const retry = await acceptRetry(f, initial.cv.draft!.id)
    expect((await f.wb.api.generateCoverLetter(retry.token)).status).toBe('saved')
  }
  const backup = JSON.parse(f.wb.backup.createBackup())
  const row = backup.tables.cover_letter_revisions.rows.at(-1)
  const letter = JSON.parse(row.data)
  expect(letter.bindings.sources[0].passage).toBe(JSON.stringify({ name: 'TypeScript', category: 'Programming' }))
  letter.bindings.sources[0].passage = `Saved ${letter.bindings.sources[0].heading} skill.`
  row.data = JSON.stringify(letter)
  if (purpose.startsWith('stripped')) {
    const opRow = backup.tables.cover_letter_operations.rows.at(-1)
    const operation = JSON.parse(opRow.data)
    delete operation.retryOrigin
    delete operation.initialBinding
    opRow.data = JSON.stringify(operation)
  }
  persistBackupRows(f, backup, ['cover_letter_operations', 'cover_letter_revisions'])
  const liveCurrent = (await f.wb.api.checkCoverLetter(f.jobId)).ok
  if (purpose === 'stripped-retry') {
    expect(() => f.wb.backup.previewRestore(JSON.stringify(backup))).toThrow(/cover_letter_operations/)
  } else {
    // Compatibility may retain the old label for reading, never as an issued current passage.
    const restore = f.wb.backup.previewRestore(JSON.stringify(backup))
    f.wb.backup.applyRestore(restore.token, text => text)
    expect((await f.wb.api.getCoverLetter(f.jobId))?.paragraphs[0].text).toBe('I use TypeScript.')
    const restoredCurrent = (await f.wb.api.checkCoverLetter(f.jobId)).ok
    expect({ liveCurrent, restoredCurrent }).toEqual({ liveCurrent: false, restoredCurrent: false })
    expect((await f.wb.api.approveCoverLetter(f.jobId)).ok).toBe(false)
  }
  expect(liveCurrent).toBe(false)
  expect((await f.wb.api.acknowledgeCoverLetterParagraph({ jobId: f.jobId, letterId: letter.id, paragraphId: letter.paragraphs[0].id, acknowledged: true })).ok).toBe(false)
})

test('legitimate multi-retry chain retains immutable origin, reviewed visible CV and frozen declared training metadata through restore', async () => {
  const f = await fixture('cv', undefined, { training: true })
  const initial = await f.wb.api.generateRequestedDocuments(f.token)
  expect(initial.cv).toMatchObject({ ok: true })
  const originId = initial.cv.draft!.id
  const role = (await f.wb.api.getExperience()).experience[0]
  const kinds = { [role.id]: 'training', [role.factualItems[0].id]: 'training' }
  expect((await f.wb.api.changeCvTitle({ jobId: f.jobId, draftId: originId, title: null })).ok).toBe(true)
  const visibleId = (await f.wb.api.getDraft(f.jobId))!.id
  expect(visibleId).not.toBe(originId)
  const cvs = f.rows('draft_revisions'), before = f.prompts.length
  for (let attempt = 0; attempt < 3; attempt++) {
    const retry = await acceptRetry(f, originId)
    expect((await f.wb.api.generateCoverLetter(retry.token)).status).toBe('saved')
    expect(await f.wb.api.getCoverLetterGenerationStatus(f.jobId)).toMatchObject({ originCvRevisionId: originId, status: 'saved', retryAvailable: true, experienceKinds: kinds })
    expect((await f.wb.api.getCoverLetter(f.jobId))?.cvRevisionId).toBe(originId)
  }
  expect(f.prompts.slice(before)).toEqual(Array(3).fill(expect.stringMatching(/^Write one cover letter/)))
  expect(f.rows('draft_revisions')).toEqual(cvs)
  const backup = f.wb.backup.createBackup()
  expect((await f.wb.api.saveExperience({ id: role.id, kind: 'employment', title: role.title, organization: role.organization, description: role.description, factualItems: role.factualItems.map(({ id, text }) => ({ id, text })) })).ok).toBe(true)
  expect(await f.wb.api.getCoverLetterGenerationStatus(f.jobId)).toMatchObject({ originCvRevisionId: originId, retryAvailable: false, experienceKinds: kinds })
  const restore = f.wb.backup.previewRestore(backup)
  f.wb.backup.applyRestore(restore.token, text => text)
  expect(await f.wb.api.getCoverLetterGenerationStatus(f.jobId)).toMatchObject({ originCvRevisionId: originId, status: 'saved', retryAvailable: true, experienceKinds: kinds })
  expect((await f.wb.api.checkCoverLetter(f.jobId)).ok).toBe(true)
  expect((await f.wb.api.getDraft(f.jobId))?.id).toBe(visibleId)
  expect(f.rows('outbound_consents').every(row => row.revoked === 1)).toBe(true)
})

for (const stage of ['preview-await', 'accept', 'dispatch'] as const) test(`retry source-intent change fences ${stage} even when the actual CV root is unchanged`, async () => {
  const f = await fixture('cv')
  const initial = await f.wb.api.generateRequestedDocuments(f.token)
  const cvId = initial.cv.draft!.id, before = f.prompts.length
  if (stage === 'preview-await') {
    const entered = deferred<void>(), release = deferred<void>()
    const prepare = f.wb.api.prepareOutboundConsent.bind(f.wb.api)
    f.wb.api.prepareOutboundConsent = async (...args) => { const preview = await prepare(...args); entered.resolve(); await release.promise; return preview }
    const work = f.wb.api.prepareCoverLetterRetry(f.jobId, cvId)
    await entered.promise
    f.wb.api.prepareOutboundConsent = prepare
    const newer = await acceptRetry(f, cvId)
    release.resolve()
    expect(await work).toMatchObject({ ok: false, message: expect.stringMatching(/intent.*changed/i) })
    expect((await f.wb.api.generateCoverLetter(newer.token)).status).toBe('saved')
  } else {
    const prior = await f.wb.api.prepareCoverLetterRetry(f.jobId, cvId)
    if (!prior.ok) throw new Error(prior.message)
    if (stage === 'dispatch') expect((await f.wb.api.acceptOutboundConsent(prior.token, true, true)).ok).toBe(true)
    const newer = await acceptRetry(f, cvId)
    if (stage === 'accept') expect(await f.wb.api.acceptOutboundConsent(prior.token, true, true)).toMatchObject({ ok: false, message: expect.stringMatching(/intent.*changed/i) })
    expect((await f.wb.api.generateCoverLetter(prior.token)).status).toBe('not-started')
    expect((await f.wb.api.generateCoverLetter(newer.token)).status).toBe('saved')
  }
  expect(f.prompts.slice(before)).toEqual([expect.stringMatching(/^Write one cover letter/)])
  expect(f.rows('draft_revisions')).toHaveLength(1)
})

test('legacy-label readability cannot hide a coordinated source ordinal rewrite', async () => {
  const f = await fixture('cv', undefined, { twoSources: true })
  const initial = await f.wb.api.generateRequestedDocuments(f.token)
  const retry = await acceptRetry(f, initial.cv.draft!.id)
  expect((await f.wb.api.generateCoverLetter(retry.token)).status).toBe('saved')
  const backup = JSON.parse(f.wb.backup.createBackup())
  const row = backup.tables.cover_letter_revisions.rows[0], letter = JSON.parse(row.data)
  letter.bindings.sources[0].passage = 'Saved TypeScript skill.'
  letter.bindings.sources[0].ordinal = 2
  letter.bindings.sources[1].ordinal = 1
  letter.paragraphs[0].citations[0].ordinal = 2
  row.data = JSON.stringify(letter)
  expect(() => f.wb.backup.previewRestore(JSON.stringify(backup))).toThrow(/cover_letter_revisions/)
  persistBackupRows(f, backup, ['cover_letter_revisions'])
  expect((await f.wb.api.checkCoverLetter(f.jobId)).ok).toBe(false)
})

test('fresh public retry after failed initial letter sends one letter and no CV or analysis, retaining reviewed CV', async () => {
  let calls = 0
  const f = await fixture('cv+cover-letter', async () => ++calls === 1 ? JSON.stringify({ paragraphs: [] }) : validLetter())
  const initial = await f.wb.api.generateRequestedDocuments(f.token)
  expect(initial.letter.status).toBe('failed')
  const originId = initial.cv.draft!.id
  const reviewed = await f.wb.api.decideSuggestedSkill({ jobId: f.jobId, draftId: originId, skillId: initial.cv.draft!.suggestedSkills![0].id, decision: 'removed' })
  expect(reviewed.ok).toBe(true)
  const cvBefore = f.rows('draft_revisions')
  const status = await f.wb.api.getCoverLetterGenerationStatus(f.jobId)
  expect(status).toMatchObject({ status: 'failed', originCvRevisionId: originId, retryAvailable: true })
  const preview = await f.wb.api.prepareCoverLetterRetry(f.jobId, originId)
  if (!preview.ok) throw new Error(preview.message)
  expect(preview.purpose).toBe('cover-letter-only')
  expect((await f.wb.api.generateCoverLetter(preview.token)).status).toBe('not-started')
  expect((await f.wb.api.acceptOutboundConsent(preview.token, true, true)).ok).toBe(true)
  expect(await f.wb.api.getCoverLetterGenerationStatus(f.jobId)).toMatchObject({ status: 'not-started', originCvRevisionId: originId })
  const before = f.prompts.length
  expect((await f.wb.api.generateCoverLetter(preview.token)).status).toBe('saved')
  expect(f.prompts.slice(before)).toHaveLength(1)
  expect(f.prompts[before]).toMatch(/^Write one cover letter/)
  expect(f.rows('draft_revisions')).toEqual(cvBefore)
  expect((await f.wb.api.generateCoverLetter(preview.token)).status).toBe('not-started')
  expect((await f.wb.api.generateCoverLetter(f.token)).status).toBe('not-started')
  expect((await f.wb.api.getCoverLetter(f.jobId))?.cvRevisionId).toBe(originId)
  expect((await f.wb.api.checkCoverLetter(f.jobId)).ok).toBe(true)
  expect(() => f.wb.backup.createBackup()).not.toThrow()
})

test('fresh Add Letter after explicit CV-only consent requires a new grant; origin survives absent child crash gap', async () => {
  const f = await fixture('cv')
  const initial = await f.wb.api.generateRequestedDocuments(f.token)
  expect(f.rows('cover_letter_operations')).toHaveLength(0)
  expect(await f.wb.api.getCoverLetterGenerationStatus(f.jobId)).toMatchObject({ status: 'not-requested', originCvRevisionId: initial.cv.draft!.id, retryAvailable: true })
  expect((await f.wb.api.generateCoverLetter(f.token)).status).toBe('not-started')
  const preview = await f.wb.api.prepareCoverLetterRetry(f.jobId, initial.cv.draft!.id)
  if (!preview.ok) throw new Error(preview.message)
  expect((await f.wb.api.acceptOutboundConsent(preview.token, true, true)).ok).toBe(true)
  expect((await f.wb.api.generateCoverLetter(preview.token)).status).toBe('saved')
  expect(f.prompts).toHaveLength(4)
})

async function acceptRetry(f: Awaited<ReturnType<typeof fixture>>, cvId: string) {
  const preview = await f.wb.api.prepareCoverLetterRetry(f.jobId, cvId)
  if (!preview.ok) throw new Error(preview.message)
  expect((await f.wb.api.acceptOutboundConsent(preview.token, true, true)).ok).toBe(true)
  return preview
}

test('retry refuses an unsettled physical attempt, including after cancellation, until actual settlement', async () => {
  const entered = deferred<void>(), settle = deferred<string>()
  let calls = 0
  const f = await fixture('cv+cover-letter', async () => { if (++calls === 1) { entered.resolve(); return settle.promise } return validLetter() })
  const initial = f.wb.api.generateRequestedDocuments(f.token)
  await entered.promise
  const cvId = (await f.wb.api.getDraft(f.jobId))!.id
  expect((await f.wb.api.prepareCoverLetterRetry(f.jobId, cvId)).ok).toBe(false)
  await f.wb.api.cancelOutboundConsent(f.token)
  expect((await f.wb.api.prepareCoverLetterRetry(f.jobId, cvId)).ok).toBe(false)
  settle.resolve(validLetter()); await initial
  // A settled cancelled attempt has no continuing physical lock.
  const firstRetry = await acceptRetry(f, cvId)
  expect((await f.wb.api.generateCoverLetter(firstRetry.token)).status).toBe('saved')
  expect(f.prompts.filter(p => p.startsWith('Extract only explicit'))).toHaveLength(1)
  expect(f.rows('draft_revisions')).toHaveLength(1)
})

test('uncertain initial request requires a fresh warned consent and old grant never replays', async () => {
  let calls = 0
  const f = await fixture('cv+cover-letter', async () => { if (++calls === 1) throw new Error('Provider disconnected after send'); return validLetter() })
  const initial = await f.wb.api.generateRequestedDocuments(f.token)
  expect(initial.letter.status).toBe('uncertain')
  const preview = await f.wb.api.prepareCoverLetterRetry(f.jobId, initial.cv.draft!.id)
  if (!preview.ok) throw new Error(preview.message)
  expect(preview.warning).toMatch(/may have completed.*charge/i)
  expect((await f.wb.api.acceptOutboundConsent(preview.token, true, true)).ok).toBe(true)
  expect((await f.wb.api.generateRequestedDocuments(f.token)).cv.ok).toBe(false)
  expect((await f.wb.api.generateDraft(preview.token)).ok).toBe(false)
  await expect(f.wb.api.startAnalysis(preview.token)).rejects.toThrow(/cover letter only/i)
  expect((await f.wb.api.regenerateDraft(preview.token, { kind: 'title' })).ok).toBe(false)
  expect((await f.wb.api.generateCoverLetter(preview.token)).status).toBe('saved')
  expect(f.prompts).toHaveLength(5)
  expect(f.rows('analysis_attempts')).toHaveLength(3)
  expect(f.rows('provider_attempt_outcomes')).toHaveLength(3)
})

for (const change of ['profile', 'model', 'posting', 'origin', 'analysis'] as const) test(`retry preview refuses changed ${change} without dispatch`, async () => {
  const f = await fixture('cv', undefined, { pi: change === 'model' })
  const initial = await f.wb.api.generateRequestedDocuments(f.token)
  const before = f.prompts.length
  if (change === 'profile') await f.wb.api.saveSkill({ name: 'Python', category: 'Programming' })
  if (change === 'model') await f.wb.api.setPiModel({ reference: 'sample/author/chat', thinkingLevel: 'high' })
  if (change === 'posting') { const job = (await f.wb.api.openJob(f.jobId))!; expect((await f.wb.api.saveJob({ id: job.id, title: job.title, company: job.company, contacts: job.contacts, description: 'Changed posting.' })).ok).toBe(true) }
  if (change === 'origin') f.mutate("UPDATE generation_recovery SET snapshot=json_set(snapshot,'$.identity.id','00000000-0000-4000-8000-000000000000')")
  if (change === 'analysis') f.mutate("UPDATE generation_recovery SET snapshot=json_set(snapshot,'$.analysis.status','failed')")
  expect((await f.wb.api.prepareCoverLetterRetry(f.jobId, initial.cv.draft!.id)).ok).toBe(false)
  expect(f.prompts).toHaveLength(before)
})

test('missing optional child after a committed real CV uses the validated completed parent, not CV replay', async () => {
  const f = await fixture()
  const cv = await f.wb.api.generateDraft(f.token)
  expect(cv.ok).toBe(true)
  expect(f.rows('cover_letter_operations')).toHaveLength(0)
  f.wb.close(); opened.splice(opened.indexOf(f.wb), 1)
  const reopened = createWorkbench(f.dir, undefined, f.transport); opened.push(reopened)
  f.wb = reopened
  expect(await reopened.api.getCoverLetterGenerationStatus(f.jobId)).toMatchObject({ status: 'not-started', originCvRevisionId: cv.draft!.id, retryAvailable: true })
  const retry = await acceptRetry(f, cv.draft!.id)
  expect((await reopened.api.generateCoverLetter(retry.token)).status).toBe('saved')
  expect(f.prompts).toHaveLength(4)
  expect(f.rows('draft_revisions')).toHaveLength(1)
})

test('letter-only replacement preserves the local recipient but never sends recipient, draft-local prose, contact or IDs', async () => {
  const f = await fixture()
  const initial = await f.wb.api.generateRequestedDocuments(f.token)
  const prior = (await f.wb.api.getCoverLetter(f.jobId))!
  expect((await f.wb.api.editCoverLetter({ jobId: f.jobId, letterId: prior.id, recipient: 'LOCAL_RECIPIENT_SECRET', paragraphs: prior.paragraphs.map(p => ({ ...p, text: 'LOCAL_LETTER_SECRET' })) })).ok).toBe(true)
  const retry = await acceptRetry(f, initial.cv.draft!.id)
  const before = f.prompts.length
  const result = await f.wb.api.generateCoverLetter(retry.token)
  expect(result.status).toBe('saved')
  const letter = (await f.wb.api.getCoverLetter(f.jobId))!
  expect(letter.recipient).toBe('LOCAL_RECIPIENT_SECRET')
  expect(letter.acknowledgments).toEqual({})
  expect(letter.approved).toBe(false)
  for (const secret of ['LOCAL_RECIPIENT_SECRET', 'LOCAL_LETTER_SECRET', 'PRIVATE_CANDIDATE', 'private@example.test', 'PRIVATE_COMPANY', 'PRIVATE_SAVED_CONTACT', letter.cvRevisionId, letter.parentRunId, ...letter.bindings.sources.map(s => s.evidenceId)]) expect(f.prompts[before]).not.toContain(secret)
  expect(f.prompts.slice(before)).toHaveLength(1)
})

for (const change of ['purpose', 'scope', 'cancel', 'model', 'cv', 'capacity', 'origin', 'intent'] as const) test(`retry final post-auth ${change} fence sends zero requests`, async () => {
  const entered = deferred<void>(), settle = deferred<void>()
  let hold = false
  const f = await fixture('cv', undefined, { pi: true, beforeLetterAuth: async () => { if (hold) { entered.resolve(); await settle.promise } } })
  const initial = await f.wb.api.generateRequestedDocuments(f.token)
  const retry = await acceptRetry(f, initial.cv.draft!.id)
  const before = f.prompts.length
  hold = true
  const work = f.wb.api.generateCoverLetter(retry.token)
  await entered.promise
  if (change === 'purpose') f.mutate("UPDATE outbound_consents SET purpose='cv' WHERE purpose='cover-letter-only'")
  if (change === 'scope') await f.wb.api.saveSkill({ name: 'Python', category: 'Programming' })
  if (change === 'cancel') await f.wb.api.cancelOutboundConsent(retry.token)
  if (change === 'model') f.mutate("UPDATE settings SET value=json_set(value,'$.thinkingLevel','high') WHERE key='pi-model'")
  if (change === 'cv') expect((await f.wb.api.changeCvTitle({ jobId: f.jobId, draftId: initial.cv.draft!.id, title: null })).ok).toBe(true)
  if (change === 'capacity') f.mutate(`UPDATE cv_workspace_backup_state SET max_bytes=${(await f.wb.api.getWorkspaceBackupStatus()).bytes}`)
  if (change === 'origin') f.mutate("UPDATE cover_letter_operations SET data=json_remove(data,'$.retryOrigin')")
  if (change === 'intent') {
    const next = await f.wb.api.prepareOutboundConsent(f.jobId, 'cover-letter-only')
    if (!next.ok) throw new Error(next.message)
    expect((await f.wb.api.acceptOutboundConsent(next.token, true, true)).ok).toBe(true)
  }
  settle.resolve()
  expect((await work).status).not.toBe('saved')
  expect(f.prompts).toHaveLength(before)
  expect(await f.wb.api.getCoverLetter(f.jobId)).toBeNull()
}, 20_000)

for (const change of ['cancel', 'scope', 'capacity', 'intent'] as const) test(`retry duplicate and late ${change} response cannot save or replay`, async () => {
  const entered = deferred<void>(), settle = deferred<string>()
  const f = await fixture('cv', async () => { entered.resolve(); return settle.promise })
  const initial = await f.wb.api.generateRequestedDocuments(f.token)
  const retry = await acceptRetry(f, initial.cv.draft!.id)
  const cvBefore = f.rows('draft_revisions')
  const work = f.wb.api.generateCoverLetter(retry.token)
  await entered.promise
  expect(await f.wb.api.getCoverLetterGenerationStatus(f.jobId)).toMatchObject({ status: 'generating', retryAvailable: false })
  expect((await f.wb.api.generateCoverLetter(retry.token)).status).toBe('not-started')
  expect((await f.wb.api.prepareCoverLetterRetry(f.jobId, initial.cv.draft!.id)).ok).toBe(false)
  expect((await f.wb.api.previewJobDeletion([f.jobId])).ok).toBe(false)
  if (change === 'cancel') await f.wb.api.cancelOutboundConsent(retry.token)
  if (change === 'scope') await f.wb.api.saveSkill({ name: 'Python', category: 'Programming' })
  if (change === 'capacity') f.mutate(`UPDATE cv_workspace_backup_state SET max_bytes=${(await f.wb.api.getWorkspaceBackupStatus()).bytes + 10}`)
  if (change === 'intent') {
    const next = await f.wb.api.prepareOutboundConsent(f.jobId, 'cover-letter-only')
    if (!next.ok) throw new Error(next.message)
    expect((await f.wb.api.acceptOutboundConsent(next.token, true, true)).ok).toBe(true)
  }
  settle.resolve(validLetter())
  expect((await work).status).toBe(change === 'cancel' ? 'cancelled' : 'uncertain')
  expect(await f.wb.api.getCoverLetter(f.jobId)).toBeNull()
  expect(f.rows('draft_revisions')).toEqual(cvBefore)
  expect((await f.wb.api.generateCoverLetter(retry.token)).status).toBe('not-started')
  expect(f.prompts).toHaveLength(4)
})

test('retry not-started, cancelled and saved statuses reopen offline; restore revokes new grant and deletion owns new run', async () => {
  const f = await fixture('cv')
  const initial = await f.wb.api.generateRequestedDocuments(f.token)
  const retry = await acceptRetry(f, initial.cv.draft!.id)
  const accepted = f.rows('outbound_consents').at(-1)!
  const notStartedBackup = f.wb.backup.createBackup()
  f.wb.close(); opened.splice(opened.indexOf(f.wb), 1)
  const reopened = createWorkbench(f.dir, undefined, f.transport); opened.push(reopened); f.wb = reopened
  expect(await reopened.api.getCoverLetterGenerationStatus(f.jobId)).toMatchObject({ status: 'not-started', originCvRevisionId: initial.cv.draft!.id, retryAvailable: true })
  expect((await reopened.api.generateCoverLetter(retry.token)).status).toBe('not-started')
  const restore = reopened.backup.previewRestore(notStartedBackup)
  reopened.backup.applyRestore(restore.token, content => content)
  expect(await reopened.api.getCoverLetterGenerationStatus(f.jobId)).toMatchObject({ status: 'cancelled', retryAvailable: true })
  expect(f.rows('outbound_consents').every(row => row.revoked === 1)).toBe(true)
  const fresh = await acceptRetry(f, initial.cv.draft!.id)
  expect((await reopened.api.generateCoverLetter(fresh.token)).status).toBe('saved')
  const savedBackup = reopened.backup.createBackup()
  const savedRestore = reopened.backup.previewRestore(savedBackup)
  reopened.backup.applyRestore(savedRestore.token, content => content)
  expect(await reopened.api.getCoverLetterGenerationStatus(f.jobId)).toMatchObject({ status: 'saved', originCvRevisionId: initial.cv.draft!.id })
  expect((await reopened.api.checkCoverLetter(f.jobId)).ok).toBe(true)
  const unrelated = await reopened.api.saveJob({ title: 'Unrelated', company: 'Elsewhere', description: 'Other work.' })
  expect(unrelated.ok).toBe(true)
  const deletion = await reopened.api.previewJobDeletion([f.jobId])
  if (!deletion.ok || !deletion.token) throw new Error(deletion.message)
  expect((await reopened.api.executeJobDeletion(deletion.token, [f.jobId])).ok).toBe(true)
  expect(f.rows('cover_letter_operations')).toHaveLength(0)
  expect(f.rows('cover_letter_revisions')).toHaveLength(0)
  expect(f.rows('outbound_consents').find(row => row.run_id === accepted.run_id)).toBeUndefined()
  expect((await reopened.api.listJobs())).toHaveLength(1)
  expect((await reopened.api.getProfile()).skills).toHaveLength(1)
})

for (const tamper of ['stripped-origin', 'stripped-binding', 'forged-parent', 'forged-cv', 'ordinal', 'passage'] as const) test(`new retry ${tamper} cannot downgrade origin validation in restore or live read`, async () => {
  const f = await fixture('cv')
  const initial = await f.wb.api.generateRequestedDocuments(f.token)
  const retry = await acceptRetry(f, initial.cv.draft!.id)
  expect((await f.wb.api.generateCoverLetter(retry.token)).status).toBe('saved')
  const backup = JSON.parse(f.wb.backup.createBackup())
  const operation = JSON.parse(backup.tables.cover_letter_operations.rows[0].data)
  const letter = JSON.parse(backup.tables.cover_letter_revisions.rows[0].data)
  if (tamper === 'stripped-origin') delete operation.retryOrigin
  if (tamper === 'stripped-binding') delete operation.initialBinding
  if (tamper === 'forged-parent') operation.retryOrigin.parentRunId = randomUUID()
  if (tamper === 'forged-cv') operation.initialBinding.cvRevisionId = randomUUID()
  if (tamper === 'ordinal') { letter.bindings.sources[0].ordinal = 42; letter.paragraphs[0].citations[0].ordinal = 42 }
  if (tamper === 'passage') letter.bindings.sources[0].passage = 'Forged passage.'
  backup.tables.cover_letter_operations.rows[0].data = JSON.stringify(operation)
  backup.tables.cover_letter_revisions.rows[0].data = JSON.stringify(letter)
  expect(() => f.wb.backup.previewRestore(JSON.stringify(backup))).toThrow(/cover_letter_(operations|revisions)/)
  f.replaceData('cover_letter_operations', operation)
  f.replaceData('cover_letter_revisions', letter)
  expect((await f.wb.api.checkCoverLetter(f.jobId)).ok).toBe(false)
  if (!['ordinal', 'passage'].includes(tamper)) {
    expect((await f.wb.api.getCoverLetterGenerationStatus(f.jobId)).retryAvailable).toBe(false)
    expect((await f.wb.api.prepareCoverLetterRetry(f.jobId, initial.cv.draft!.id)).ok).toBe(false)
  }
})

test('uncertain letter-only attempt survives reopen and may only be replaced under another fresh warned grant', async () => {
  let calls = 0
  const f = await fixture('cv', async () => { if (++calls === 1) throw new Error('Lost response'); return validLetter() })
  const initial = await f.wb.api.generateRequestedDocuments(f.token)
  const retry = await acceptRetry(f, initial.cv.draft!.id)
  expect((await f.wb.api.generateCoverLetter(retry.token)).status).toBe('uncertain')
  f.wb.close(); opened.splice(opened.indexOf(f.wb), 1)
  const reopened = createWorkbench(f.dir, undefined, f.transport); opened.push(reopened); f.wb = reopened
  expect(await reopened.api.getCoverLetterGenerationStatus(f.jobId)).toMatchObject({ status: 'uncertain', originCvRevisionId: initial.cv.draft!.id, retryAvailable: true, warning: expect.stringMatching(/may have completed/) })
  expect((await reopened.api.generateCoverLetter(retry.token)).status).toBe('not-started')
  const next = await acceptRetry(f, initial.cv.draft!.id)
  expect(next.warning).toMatch(/may have completed/)
  expect((await reopened.api.generateCoverLetter(next.token)).status).toBe('saved')
  expect(f.prompts).toHaveLength(5)
  expect(f.rows('draft_revisions')).toHaveLength(1)
})

for (const change of ['source', 'visible-cv', 'cancel'] as const) test(`fresh retry preview ${change} cannot become stale authority`, async () => {
  const f = await fixture('cv')
  const initial = await f.wb.api.generateRequestedDocuments(f.token)
  const preview = await f.wb.api.prepareCoverLetterRetry(f.jobId, initial.cv.draft!.id)
  if (!preview.ok) throw new Error(preview.message)
  if (change === 'source') await f.wb.api.saveSkill({ name: 'Python', category: 'Programming' })
  if (change === 'visible-cv') expect((await f.wb.api.changeCvTitle({ jobId: f.jobId, draftId: initial.cv.draft!.id, title: null })).ok).toBe(true)
  if (change === 'cancel') expect((await f.wb.api.cancelOutboundConsent(preview.token)).ok).toBe(true)
  expect((await f.wb.api.acceptOutboundConsent(preview.token, true, true)).ok).toBe(false)
  expect((await f.wb.api.generateCoverLetter(preview.token)).status).toBe('not-started')
  expect(f.prompts).toHaveLength(3)
  expect(f.rows('cover_letter_operations')).toHaveLength(0)
})

test('successful Pi letter-only retry keeps the exact original physical model and thinking effort', async () => {
  const f = await fixture('cv', undefined, { pi: true })
  const initial = await f.wb.api.generateRequestedDocuments(f.token)
  const before = f.piCalls.length
  const retry = await acceptRetry(f, initial.cv.draft!.id)
  expect((await f.wb.api.generateCoverLetter(retry.token)).status).toBe('saved')
  expect(f.piCalls.slice(before)).toEqual([{ model, reasoning: 'low' }])
  expect(f.prompts).toHaveLength(4)
  expect(f.rows('draft_revisions')).toHaveLength(1)
})

test('public opt-out preserves real CV pipeline and creates zero letter calls or rows', async () => {
  const f = await fixture('cv')
  const result = await f.wb.api.generateRequestedDocuments(f.token, 1)
  expect(result).toMatchObject({ cv: { ok: true, draft: { content: { skills: [{ name: 'TypeScript' }] } } }, letter: { status: 'not-requested' } })
  expect(f.prompts).toHaveLength(3)
  expect(f.rows('cover_letter_operations')).toHaveLength(0)
  expect(await f.wb.api.getCoverLetter(f.jobId)).toBeNull()
})

test('public opt-in saves one independent letter after real CV despite pending skill review', async () => {
  const f = await fixture()
  const result = await f.wb.api.generateRequestedDocuments(f.token, 1)
  expect(result.cv.ok).toBe(true)
  expect(result.cv.draft?.suggestedSkills).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Rust', status: 'pending' })]))
  expect(result.letter.status).toBe('saved')
  const saved = await f.wb.api.getCoverLetter(f.jobId)
  expect(saved).toMatchObject({ cvRevisionId: result.cv.draft?.id, paragraphs: [{ text: 'I use TypeScript.' }], approved: false, acknowledgments: {}, findings: [] })
  expect(saved?.bindings.sources[0]).toMatchObject({ category: 'skill', heading: 'TypeScript' })
  expect(saved?.fit).toBeUndefined()
  for (const secret of ['PRIVATE_CANDIDATE', 'private@example.test', 'PRIVATE_COMPANY', 'PRIVATE_SAVED_CONTACT', 'https://example.com/private-contact', saved!.bindings.sources[0].evidenceId, result.cv.draft!.id]) expect(f.prompts[3]).not.toContain(secret)
  expect(f.rows('cover_letter_operations')).toHaveLength(1)
  expect(f.rows('analysis_attempts')).toHaveLength(3)
  expect(f.rows('provider_attempt_outcomes')).toHaveLength(3)
  const again = await f.wb.api.generateRequestedDocuments(f.token, 1)
  expect(again.cv.ok).toBe(false)
  expect(f.prompts).toHaveLength(4)
  expect(f.rows('draft_revisions')).toHaveLength(1)
  const backup = JSON.parse(f.wb.backup.createBackup())
  expect(JSON.stringify(backup)).toContain('I use TypeScript.')
  const operationRow = backup.tables.cover_letter_operations.rows[0]
  const operation = JSON.parse(operationRow.data)
  expect(operation.initialBinding.cvRevisionId).toBe(result.cv.draft?.id)
  operation.initialBinding.cvRevisionId = randomUUID()
  operationRow.data = JSON.stringify(operation)
  expect(() => f.wb.backup.previewRestore(JSON.stringify(backup))).toThrow(/cover_letter_operations/)
})

for (const [name, response] of [
  ['foreign', { paragraphs: [{ text: 'I use TypeScript.', citations: [{ ordinal: 999 }] }] }],
  ['schema', { paragraphs: [{ text: 'I use TypeScript.', citations: [{ ordinal: 1 }], approved: true }] }],
  ['number', { paragraphs: [{ text: 'I have 42 years using TypeScript.', citations: [{ ordinal: 1 }] }] }],
  ['skill', { paragraphs: [{ text: 'I use Rust.', citations: [{ ordinal: 1 }] }] }],
] as const) test(`invalid ${name} letter never replaces or rolls back real CV`, async () => {
  const f = await fixture('cv+cover-letter', async () => JSON.stringify(response))
  const result = await f.wb.api.generateRequestedDocuments(f.token, 1)
  expect(result.cv).toMatchObject({ ok: true, draft: { content: { skills: [{ name: 'TypeScript' }] } } })
  expect(result.letter.status).toBe('failed')
  expect(await f.wb.api.getCoverLetter(f.jobId)).toBeNull()
  expect((await f.wb.api.getDraft(f.jobId))?.id).toBe(result.cv.draft?.id)
  expect(f.prompts).toHaveLength(4)
})

test('durable intent and committed CV exist before the physical letter request; ownership excludes duplicates through settlement', async () => {
  const entered = deferred<void>(), settle = deferred<string>()
  const f = await fixture('cv+cover-letter', async () => { entered.resolve(); return settle.promise })
  const resultPromise = f.wb.api.generateRequestedDocuments(f.token)
  await entered.promise
  expect(f.rows('cover_letter_operations')[0].status).toBe('dispatched')
  expect(await f.wb.api.getDraft(f.jobId)).not.toBeNull()
  expect(f.wb.hasActiveWork()).toBe(true)
  expect(() => f.wb.beginJobOperation(f.jobId, 'export')).toThrow(/active/i)
  expect((await f.wb.api.generateDraft(f.token)).ok).toBe(false)
  expect((await f.wb.api.generateRequestedDocuments(f.token)).cv.ok).toBe(false)
  await expect(f.wb.api.startAnalysis(f.token)).rejects.toThrow(/active/i)
  expect(() => f.wb.backup.createBackup()).toThrow(/active/i)
  await f.wb.api.cancelAnalysis(f.jobId)
  expect(f.wb.hasActiveWork()).toBe(true)
  expect((await f.wb.api.previewJobDeletion([f.jobId])).ok).toBe(false)
  settle.resolve(validLetter())
  const result = await resultPromise
  expect(result).toMatchObject({ cv: { ok: true }, letter: { status: 'cancelled' } })
  expect(await f.wb.api.getCoverLetter(f.jobId)).toBeNull()
  expect(f.rows('draft_revisions')).toHaveLength(1)
  expect(f.wb.hasActiveWork()).toBe(false)
})

test('changed profile while provider is unsettled discards late letter, never the CV', async () => {
  const entered = deferred<void>(), settle = deferred<string>()
  const f = await fixture('cv+cover-letter', async () => { entered.resolve(); return settle.promise })
  const work = f.wb.api.generateRequestedDocuments(f.token)
  await entered.promise
  await f.wb.api.saveSkill({ name: 'Python', category: 'Programming' })
  settle.resolve(validLetter())
  const result = await work
  expect(result).toMatchObject({ cv: { ok: true }, letter: { status: 'uncertain' } })
  expect(await f.wb.api.getCoverLetter(f.jobId)).toBeNull()
  expect((await f.wb.api.getDraft(f.jobId))?.id).toBe(result.cv.draft?.id)
  expect(f.prompts).toHaveLength(4)
})

for (const change of ['purpose', 'scope', 'cancel', 'model', 'cv', 'capacity'] as const) test(`physical post-auth ${change} fence sends zero letters and retains the CV`, async () => {
  const entered = deferred<void>(), settle = deferred<void>()
  const f = await fixture('cv+cover-letter', undefined, { pi: true, beforeLetterAuth: async () => { entered.resolve(); await settle.promise } })
  const work = f.wb.api.generateRequestedDocuments(f.token)
  await entered.promise
  expect(f.prompts).toHaveLength(3)
  expect(f.rows('cover_letter_operations')[0].status).toBe('prepared')
  if (change === 'purpose') f.mutate("UPDATE outbound_consents SET purpose='cv'")
  if (change === 'scope') await f.wb.api.saveSkill({ name: 'Python', category: 'Programming' })
  if (change === 'cancel') await f.wb.api.cancelOutboundConsent(f.token)
  if (change === 'model') {
    await expect(f.wb.api.setPiModel({ reference: 'sample/author/chat', thinkingLevel: 'high' })).rejects.toThrow(/current model request/i)
    f.mutate("UPDATE settings SET value=json_set(value,'$.thinkingLevel','high') WHERE key='pi-model'")
  }
  if (change === 'cv') { const current = await f.wb.api.getDraft(f.jobId); if (!current) throw new Error('No committed CV'); expect((await f.wb.api.changeCvTitle({ jobId: f.jobId, draftId: current.id, title: null })).ok).toBe(true) }
  if (change === 'capacity') f.mutate(`UPDATE cv_workspace_backup_state SET max_bytes=${(await f.wb.api.getWorkspaceBackupStatus()).bytes}`)
  settle.resolve()
  const result = await work
  expect(result.cv.ok).toBe(true)
  expect(result.letter.status).not.toBe('saved')
  expect(f.prompts).toHaveLength(3)
  expect(await f.wb.api.getCoverLetter(f.jobId)).toBeNull()
  expect(f.rows('draft_revisions').length).toBeGreaterThanOrEqual(1)
}, 20_000)

test('letter save capacity failure rolls back letter only, leaves consumed uncertainty and does not replay', async () => {
  const entered = deferred<void>(), settle = deferred<string>()
  const f = await fixture('cv+cover-letter', async () => { entered.resolve(); return settle.promise })
  const work = f.wb.api.generateRequestedDocuments(f.token)
  await entered.promise
  f.mutate(`UPDATE cv_workspace_backup_state SET max_bytes=${(await f.wb.api.getWorkspaceBackupStatus()).bytes + 10}`)
  settle.resolve(validLetter())
  const result = await work
  expect(result).toMatchObject({ cv: { ok: true }, letter: { status: 'uncertain' } })
  expect(f.rows('cover_letter_revisions')).toHaveLength(0)
  expect(f.rows('cover_letter_operations')[0].status).toBe('uncertain')
  expect((await f.wb.api.generateRequestedDocuments(f.token)).cv.ok).toBe(false)
  expect(f.prompts).toHaveLength(4)
})

test('provider failure is independent and no repair or retry is dispatched', async () => {
  const f = await fixture('cv+cover-letter', async () => { throw new Error('provider failure') })
  expect(await f.wb.api.generateRequestedDocuments(f.token)).toMatchObject({ cv: { ok: true }, letter: { status: 'uncertain' } })
  expect(f.prompts).toHaveLength(4)
  expect(f.rows('draft_revisions')).toHaveLength(1)
})

test('CV validation-failure empty branch cannot authorize a letter', async () => {
  const f = await fixture('cv+cover-letter', undefined, { cvResponse: { education: [], experience: [], projects: [], skills: [{ name: 'TypeScript', evidence: [999], rationale: 'Foreign.' }] } })
  const result = await f.wb.api.generateRequestedDocuments(f.token)
  expect(result.cv).toMatchObject({ ok: true, draft: { content: { skills: [] } } })
  expect(result.letter.status).toBe('not-started')
  expect(f.rows('cover_letter_operations')).toHaveLength(0)
  expect(f.prompts.some(p => p.startsWith('Write one cover letter'))).toBe(false)
})

test('letter-only purpose never authorizes the initial CV wrapper or legacy public CV path', async () => {
  const f = await fixture('cover-letter-only')
  expect((await f.wb.api.generateRequestedDocuments(f.token)).cv.ok).toBe(false)
  expect((await f.wb.api.generateDraft(f.token)).ok).toBe(false)
  await expect(f.wb.api.startAnalysis(f.token)).rejects.toThrow(/cover letter only/i)
  expect(f.prompts).toHaveLength(0)
})

test('old public CV path with opt-in consent remains strictly CV-only and cannot later be wrapped', async () => {
  const f = await fixture()
  expect((await f.wb.api.generateDraft(f.token)).ok).toBe(true)
  expect((await f.wb.api.generateRequestedDocuments(f.token)).cv.ok).toBe(false)
  expect(f.prompts).toHaveLength(3)
  expect(f.rows('cover_letter_operations')).toHaveLength(0)
})

test('generated letter reopens offline, restore revokes authority, and imported passages cannot piggyback on valid source IDs', async () => {
  const f = await fixture()
  const generated = await f.wb.api.generateRequestedDocuments(f.token)
  expect(generated.letter.status).toBe('saved')
  const letter = await f.wb.api.getCoverLetter(f.jobId)
  expect((await f.wb.api.checkCoverLetter(f.jobId)).ok).toBe(true)
  const backup = JSON.parse(f.wb.backup.createBackup())
  f.wb.close(); opened.splice(opened.indexOf(f.wb), 1)
  const reopened = createWorkbench(f.dir, undefined, { generate: async () => { throw new Error('Offline: no call allowed') } }); opened.push(reopened)
  expect(await reopened.api.getCoverLetter(f.jobId)).toEqual(letter)
  const row = backup.tables.cover_letter_revisions.rows[0]
  const forged = JSON.parse(row.data)
  forged.bindings.sources[0].passage = 'Invented private source passage attached to an otherwise genuine saved skill ID.'
  row.data = JSON.stringify(forged)
  expect(() => reopened.backup.previewRestore(JSON.stringify(backup))).toThrow(/cover_letter_revisions/)
  row.data = JSON.stringify(letter)
  const restore = reopened.backup.previewRestore(JSON.stringify(backup))
  reopened.backup.applyRestore(restore.token, content => content)
  expect((await reopened.api.checkCoverLetter(f.jobId)).ok).toBe(true)
  f.replaceData('cover_letter_revisions', forged)
  expect(await reopened.api.checkCoverLetter(f.jobId)).toMatchObject({ ok: false, message: expect.stringMatching(/source passage/) })
  expect((await reopened.api.generateRequestedDocuments(f.token)).cv.ok).toBe(false)
  expect((await reopened.api.getDraft(f.jobId))?.id).toBe(generated.cv.draft?.id)
})

test('local recipient and prior letter prose never enter a later generation request', async () => {
  const f = await fixture()
  await f.wb.api.generateRequestedDocuments(f.token)
  const letter = await f.wb.api.getCoverLetter(f.jobId)
  if (!letter) throw new Error('Missing generated letter')
  expect((await f.wb.api.editCoverLetter({ jobId: f.jobId, letterId: letter.id, recipient: 'PRIVATE_LOCAL_RECIPIENT', paragraphs: letter.paragraphs.map(p => ({ ...p, text: 'PRIVATE_LOCAL_LETTER_PROSE' })) })).ok).toBe(true)
  const preview = await f.wb.api.prepareOutboundConsent(f.jobId, 'cv+cover-letter')
  if (!preview.ok) throw new Error(preview.message)
  await f.wb.api.acceptOutboundConsent(preview.token, true, true)
  await f.wb.api.startAnalysis(preview.token)
  expect((await f.wb.api.generateRequestedDocuments(preview.token)).letter.status).toBe('saved')
  expect(f.prompts.join('\n')).not.toContain('PRIVATE_LOCAL_RECIPIENT')
  expect(f.prompts.join('\n')).not.toContain('PRIVATE_LOCAL_LETTER_PROSE')
})

test('CV v5 recovery of an originally opt-in run uses only the old CV path and never schedules a letter', async () => {
  const f = await fixture('cv+cover-letter', undefined, { failCvOnce: true })
  expect(await f.wb.api.generateRequestedDocuments(f.token)).toMatchObject({ cv: { ok: false }, letter: { status: 'not-started' } })
  const recovery = await f.wb.api.getGenerationRecovery(f.jobId)
  if (!recovery) throw new Error('Missing recovery fixture')
  f.wb.close(); opened.splice(opened.indexOf(f.wb), 1)
  const reopened = createWorkbench(f.dir, undefined, f.transport); opened.push(reopened)
  expect((await reopened.api.resumeGeneration(recovery.runId, 'retry-uncertain')).ok).toBe(true)
  expect(await reopened.api.getCoverLetter(f.jobId)).toBeNull()
  expect(f.rows('cover_letter_operations')).toHaveLength(0)
  expect(f.prompts.some(prompt => prompt.startsWith('Write one cover letter'))).toBe(false)
})

test('uncertain child is durable on reopen but never a permanent live deletion lock', async () => {
  const f = await fixture('cv+cover-letter', async () => { throw new Error('Uncertain provider') })
  expect((await f.wb.api.generateRequestedDocuments(f.token)).letter.status).toBe('uncertain')
  expect((await f.wb.api.previewJobDeletion([f.jobId])).ok).toBe(true)
  f.wb.close(); opened.splice(opened.indexOf(f.wb), 1)
  const reopened = createWorkbench(f.dir, undefined, { generate: async () => { throw new Error('No replay') } }); opened.push(reopened)
  expect((await reopened.api.previewJobDeletion([f.jobId])).ok).toBe(true)
  expect((await reopened.api.generateRequestedDocuments(f.token)).cv.ok).toBe(false)
})

for (const binding of ['stripped', 'rewritten'] as const) test(`review regression ${binding} binding cannot substitute a same-job title revision`, async () => {
  const f = await fixture()
  const generated = await f.wb.api.generateRequestedDocuments(f.token)
  expect(generated.letter.status).toBe('saved')
  const original = generated.cv.draft!
  const changed = await f.wb.api.changeCvTitle({ jobId: f.jobId, draftId: original.id, title: null })
  expect(changed.ok).toBe(true)
  const newer = (await f.wb.api.getDraft(f.jobId))!
  expect(newer.id).not.toBe(original.id)
  // Merely editing the current CV must not invalidate the actual originating revision.
  expect((await f.wb.api.checkCoverLetter(f.jobId)).ok).toBe(true)
  const backup = JSON.parse(f.wb.backup.createBackup())
  const operation = JSON.parse(backup.tables.cover_letter_operations.rows[0].data)
  const letter = JSON.parse(backup.tables.cover_letter_revisions.rows[0].data)
  if (binding === 'stripped') delete operation.initialBinding
  else operation.initialBinding.cvRevisionId = newer.id
  letter.cvRevisionId = newer.id
  backup.tables.cover_letter_operations.rows[0].data = JSON.stringify(operation)
  backup.tables.cover_letter_revisions.rows[0].data = JSON.stringify(letter)
  expect(() => f.wb.backup.previewRestore(JSON.stringify(backup))).toThrow(/cover_letter_(operations|revisions)/)
  // Exercise the independent current-readiness boundary even for already persisted wrong records.
  f.replaceData('cover_letter_operations', operation)
  f.replaceData('cover_letter_revisions', letter)
  expect(await f.wb.api.checkCoverLetter(f.jobId)).toMatchObject({ ok: false, message: expect.stringMatching(/origin|binding/i) })
  expect((await f.wb.api.approveCoverLetter(f.jobId)).ok).toBe(false)
  expect(f.prompts).toHaveLength(4)
})

for (const tamper of ['renumber', 'swap', 'passage'] as const) test(`review regression ${tamper} sources cannot forge issued ordinal mapping`, async () => {
  const f = await fixture('cv+cover-letter', undefined, { twoSources: true })
  const generated = await f.wb.api.generateRequestedDocuments(f.token)
  expect(generated.letter.status).toBe('saved')
  const backup = JSON.parse(f.wb.backup.createBackup())
  const letter = JSON.parse(backup.tables.cover_letter_revisions.rows[0].data)
  expect(letter.bindings.sources.map((s: { heading: string }) => s.heading)).toEqual(['TypeScript', 'Zebra'])
  if (tamper === 'renumber') { letter.bindings.sources[0].ordinal = 42; letter.paragraphs[0].citations[0].ordinal = 42 }
  if (tamper === 'swap') { letter.bindings.sources[0].ordinal = 2; letter.bindings.sources[1].ordinal = 1 }
  if (tamper === 'passage') letter.bindings.sources[0].passage = 'Invented passage attached to a genuine source ID.'
  backup.tables.cover_letter_revisions.rows[0].data = JSON.stringify(letter)
  expect(() => f.wb.backup.previewRestore(JSON.stringify(backup))).toThrow(/cover_letter_revisions/)
  f.replaceData('cover_letter_revisions', letter)
  expect(await f.wb.api.checkCoverLetter(f.jobId)).toMatchObject({ ok: false, message: expect.stringMatching(/ordinal|source passage/i) })
  expect((await f.wb.api.acknowledgeCoverLetterParagraph({ jobId: f.jobId, letterId: letter.id, paragraphId: letter.paragraphs[0].id, acknowledged: true })).ok).toBe(false)
  expect((await f.wb.api.approveCoverLetter(f.jobId)).ok).toBe(false)
  expect(f.prompts).toHaveLength(4)
})

test('review regression stripped optional metadata retains only the independently resolved genuine origin', async () => {
  const f = await fixture()
  const generated = await f.wb.api.generateRequestedDocuments(f.token)
  expect(generated.letter.status).toBe('saved')
  const backup = JSON.parse(f.wb.backup.createBackup())
  const operation = JSON.parse(backup.tables.cover_letter_operations.rows[0].data)
  delete operation.initialBinding
  backup.tables.cover_letter_operations.rows[0].data = JSON.stringify(operation)
  const restore = f.wb.backup.previewRestore(JSON.stringify(backup))
  f.wb.backup.applyRestore(restore.token, text => text)
  expect((await f.wb.api.checkCoverLetter(f.jobId)).ok).toBe(true)
  expect((await f.wb.api.getCoverLetter(f.jobId))?.cvRevisionId).toBe(generated.cv.draft!.id)
})

for (const tamper of ['unfinished-parent', 'empty-cv', 'generation-failure'] as const) test(`review regression ${tamper} cannot claim eligible committed origin`, async () => {
  const f = await fixture()
  expect((await f.wb.api.generateRequestedDocuments(f.token)).letter.status).toBe('saved')
  const backup = JSON.parse(f.wb.backup.createBackup())
  const operation = JSON.parse(backup.tables.cover_letter_operations.rows[0].data)
  delete operation.initialBinding
  backup.tables.cover_letter_operations.rows[0].data = JSON.stringify(operation)
  const cv = JSON.parse(backup.tables.draft_revisions.rows[0].data)
  if (tamper === 'unfinished-parent') backup.tables.generation_recovery.rows[0].status = 'cancelled'
  if (tamper === 'empty-cv') cv.content.skills = []
  if (tamper === 'generation-failure') cv.checkReport.findings.push({ code: 'schema', itemPath: 'generation', message: 'Invalid model output.', correction: 'Author locally.' })
  backup.tables.draft_revisions.rows[0].data = JSON.stringify(cv)
  expect(() => f.wb.backup.previewRestore(JSON.stringify(backup))).toThrow(/cover_letter_operations/)
  f.replaceData('cover_letter_operations', operation)
  f.replaceData('draft_revisions', cv)
  if (tamper === 'unfinished-parent') f.mutate("UPDATE generation_recovery SET status='cancelled'")
  expect((await f.wb.api.checkCoverLetter(f.jobId)).ok).toBe(false)
})

test('review regression missing parent provenance remains readable after restore but cannot be current or approved', async () => {
  const f = await fixture()
  expect((await f.wb.api.generateRequestedDocuments(f.token)).letter.status).toBe('saved')
  const backup = JSON.parse(f.wb.backup.createBackup())
  const operation = JSON.parse(backup.tables.cover_letter_operations.rows[0].data)
  delete operation.initialBinding
  backup.tables.cover_letter_operations.rows[0].data = JSON.stringify(operation)
  backup.tables.generation_recovery.rows = []
  const restore = f.wb.backup.previewRestore(JSON.stringify(backup))
  f.wb.backup.applyRestore(restore.token, text => text)
  const letter = (await f.wb.api.getCoverLetter(f.jobId))!
  expect(letter.paragraphs[0].text).toBe('I use TypeScript.')
  expect(letter.approved).toBe(false)
  expect(await f.wb.api.checkCoverLetter(f.jobId)).toMatchObject({ ok: false, message: expect.stringMatching(/origin.*unavailable|provenance/i) })
  expect((await f.wb.api.approveCoverLetter(f.jobId)).ok).toBe(false)
  expect((await f.wb.api.editCoverLetter({ jobId: f.jobId, letterId: letter.id, paragraphs: letter.paragraphs, recipient: null })).ok).toBe(false)
})
