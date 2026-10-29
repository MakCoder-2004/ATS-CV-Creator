import { expect, test, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { registerCoverLetterRetryIpc } from '../src/main/cover-letter-retry-ipc'
import { coverLetterGenerationStatusSchema, coverLetterOutcomeSchema } from '../src/shared/cover-letter'
import { outboundConsentPreviewSchema } from '../src/shared/outbound-consent-contract'
import { artifactFixture } from './helpers/cover-letter-artifact'

function fixture(dynamic = false) {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const api = { prepareCoverLetterRetry: vi.fn(), generateCoverLetter: vi.fn(), getCoverLetterGenerationStatus: vi.fn() }
  const event = {} as IpcMainInvokeEvent
  const trusted = vi.fn((sender: IpcMainInvokeEvent) => { if (sender !== event) throw new Error('Untrusted sender') })
  const provider = vi.fn(() => api)
  registerCoverLetterRetryIpc({ handle: (channel, listener) => { handlers.set(channel, listener) } } as Pick<IpcMain, 'handle'>, dynamic ? provider : api, trusted)
  return { handlers, api, event, trusted, provider }
}

async function registeredWorkspaceFixture() {
  const f = await artifactFixture(true)
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const event = {} as IpcMainInvokeEvent
  registerCoverLetterRetryIpc({ handle: (channel, listener) => { handlers.set(channel, listener) } } as Pick<IpcMain, 'handle'>, () => f.wb.api, sender => {
    if (sender !== event) throw new Error('Untrusted sender')
  })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(event, ...args)
  const restore = async () => {
    const initial = f.wb.api
    const preview = f.wb.backup.previewRestore(f.wb.backup.createBackup())
    f.wb.backup.applyRestore(preview.token, text => text)
    f.reopen()
    expect(f.wb.api).not.toBe(initial)
    await expect(initial.getCoverLetterGenerationStatus(f.jobId)).rejects.toThrow(/not open|closed/i)
    expect(await f.wb.api.getCoverLetterGenerationStatus(f.jobId)).toMatchObject({ originCvRevisionId: f.letter.cvRevisionId, retryAvailable: true })
  }
  return { ...f, get wb() { return f.wb }, invoke, restore }
}

test('registered status resolves the reopened workspace after verified restore', async () => {
  const f = await registeredWorkspaceFixture()
  try {
    const before = await f.invoke('cover-letter:generation:status', f.jobId)
    expect(before).toMatchObject({ status: 'saved', originCvRevisionId: f.letter.cvRevisionId, retryAvailable: true })
    await f.restore()
    expect(await f.invoke('cover-letter:generation:status', f.jobId)).toEqual(await f.wb.api.getCoverLetterGenerationStatus(f.jobId))
    expect(f.prompts.filter(prompt => prompt.startsWith('Write one cover letter'))).toHaveLength(1)
  } finally { f.cleanup() }
})

test('registered retry preview resolves current API and its receiver after verified restore', async () => {
  const f = await registeredWorkspaceFixture()
  try {
    expect(await f.invoke('cover-letter:retry:preview', f.jobId, f.letter.cvRevisionId)).toMatchObject({ ok: true, purpose: 'cover-letter-only' })
    await f.restore()
    const count = f.prompts.length, cv = await f.wb.api.getDraft(f.jobId)
    const preview = outboundConsentPreviewSchema.parse(await f.invoke('cover-letter:retry:preview', f.jobId, f.letter.cvRevisionId))
    expect(preview).toMatchObject({ ok: true, purpose: 'cover-letter-only' })
    if (!preview.ok) throw new Error(preview.message)
    expect((await f.wb.api.acceptOutboundConsent(preview.token, true, true)).ok).toBe(true)
    expect(f.prompts).toHaveLength(count)
    const outcome = coverLetterOutcomeSchema.parse(await f.invoke('cover-letter:generate', preview.token))
    if (outcome.status !== 'saved') throw new Error(JSON.stringify(outcome))
    expect(await f.invoke('cover-letter:generation:status', f.jobId)).toMatchObject({ status: 'saved', letterId: outcome.letter.id, originCvRevisionId: f.letter.cvRevisionId })
    expect(f.prompts.slice(count)).toEqual([expect.stringMatching(/^Write one cover letter/)])
    expect(await f.wb.api.getDraft(f.jobId)).toEqual(cv)
  } finally { f.cleanup() }
})

test('registered generation rejects restored tokens and writes exactly one fresh letter in the new database', async () => {
  const f = await registeredWorkspaceFixture()
  try {
    const old = outboundConsentPreviewSchema.parse(await f.invoke('cover-letter:retry:preview', f.jobId, f.letter.cvRevisionId))
    if (!old.ok) throw new Error(old.message)
    expect((await f.wb.api.acceptOutboundConsent(old.token, true, true)).ok).toBe(true)
    const oldUnaccepted = await f.wb.api.prepareCoverLetterRetry(f.jobId, f.letter.cvRevisionId)
    if (!oldUnaccepted.ok) throw new Error(oldUnaccepted.message)
    await f.restore()
    const before = JSON.parse(f.wb.backup.createBackup()).tables
    expect(before.outbound_consents.rows.every((row: { revoked: number }) => row.revoked === 1)).toBe(true)
    const count = f.prompts.length
    for (const token of [old.token, oldUnaccepted.token]) {
      expect((await f.wb.api.acceptOutboundConsent(token, true, true)).ok).toBe(false)
      expect(await f.invoke('cover-letter:generate', token)).toMatchObject({ status: 'not-started' })
    }
    expect(f.prompts).toHaveLength(count)
    // Prepare on the current API to isolate the registered generation handler from the preview handler.
    const fresh = await f.wb.api.prepareCoverLetterRetry(f.jobId, f.letter.cvRevisionId)
    if (!fresh.ok) throw new Error(fresh.message)
    expect(await f.invoke('cover-letter:generate', fresh.token)).toMatchObject({ status: 'not-started' })
    expect(f.prompts).toHaveLength(count)
    expect((await f.wb.api.acceptOutboundConsent(fresh.token, true, true)).ok).toBe(true)
    const outcome = coverLetterOutcomeSchema.parse(await f.invoke('cover-letter:generate', fresh.token))
    expect(outcome.status).toBe('saved')
    if (outcome.status !== 'saved') throw new Error(JSON.stringify(outcome))
    expect(outcome.letter).toMatchObject({ cvRevisionId: f.letter.cvRevisionId, bindings: f.letter.bindings, approved: false, acknowledgments: {} })
    expect(outcome.letter.operationId).not.toBe(f.letter.operationId)
    expect((await f.wb.api.getSettings()).pi).toEqual({ providerId: 'sample', modelId: 'synthetic', thinkingLevel: 'low' })
    expect(await f.wb.api.getCoverLetter(f.jobId)).toEqual(outcome.letter)
    expect(f.prompts.slice(count)).toEqual([expect.stringMatching(/^Write one cover letter/)])
    const after = JSON.parse(f.wb.backup.createBackup()).tables
    expect(after.cover_letter_revisions.rows).toHaveLength(before.cover_letter_revisions.rows.length + 1)
    for (const table of ['draft_revisions', 'posting_analysis_cache', 'analysis_run_state', 'analysis_attempts', 'profile_contact', 'profile_skills', 'profile_entries', 'evidence_revisions', 'profile_experience', 'profile_projects']) {
      expect(before[table]).toBeDefined()
      expect(after[table]).toEqual(before[table])
    }
    expect(await f.invoke('cover-letter:generate', fresh.token)).toMatchObject({ status: 'not-started' })
    expect(f.prompts).toHaveLength(count + 1)
    const status = coverLetterGenerationStatusSchema.parse(await f.wb.api.getCoverLetterGenerationStatus(f.jobId))
    expect(status).toMatchObject({ status: 'saved', letterId: outcome.letter.id, originCvRevisionId: f.letter.cvRevisionId })
    f.reopen()
    expect((await f.wb.api.getCoverLetter(f.jobId))?.id).toBe(outcome.letter.id)
  } finally { f.cleanup() }
})

for (const [channel, count] of [['cover-letter:retry:preview', 2], ['cover-letter:generate', 1], ['cover-letter:generation:status', 1]] as const) {
  test(`${channel} rejects untrusted, wrong-arity and malformed input before accessing the workspace provider`, async () => {
    const f = fixture(true), handler = f.handlers.get(channel)!, args = Array.from({ length: count }, () => randomUUID())
    f.provider.mockImplementation(() => { throw new Error('Workspace unavailable') })
    await expect(handler({} as IpcMainInvokeEvent, ...args)).rejects.toThrow(/Untrusted/)
    await expect(handler(f.event)).rejects.toThrow(/Expected/)
    await expect(handler(f.event, ...args, true)).rejects.toThrow(/Expected/)
    for (let index = 0; index < count; index++) {
      const invalid: unknown[] = [...args]; invalid[index] = 'bad'
      await expect(handler(f.event, ...invalid)).rejects.toThrow()
    }
    expect(f.provider).not.toHaveBeenCalled()
    expect(Object.values(f.api).every(method => method.mock.calls.length === 0)).toBe(true)
    await expect(handler(f.event, ...args)).rejects.toThrow('Workspace unavailable')
    expect(f.provider).toHaveBeenCalledTimes(1)
  })

  test(`${channel} checks sender, exact arity, strict IDs and strict return before crossing IPC`, async () => {
    const f = fixture(), handler = f.handlers.get(channel)!, args = Array.from({ length: count }, () => randomUUID())
    await expect(handler({} as IpcMainInvokeEvent, ...args)).rejects.toThrow(/Untrusted/)
    await expect(handler(f.event, ...args, true)).rejects.toThrow(/Expected/)
    await expect(handler(f.event)).rejects.toThrow(/Expected/)
    await expect(handler(f.event, 'bad', ...args.slice(1))).rejects.toThrow()
    expect(f.api.prepareCoverLetterRetry).not.toHaveBeenCalled()
    expect(f.api.generateCoverLetter).not.toHaveBeenCalled()
    expect(f.api.getCoverLetterGenerationStatus).not.toHaveBeenCalled()
    const method = channel === 'cover-letter:retry:preview' ? f.api.prepareCoverLetterRetry : channel === 'cover-letter:generate' ? f.api.generateCoverLetter : f.api.getCoverLetterGenerationStatus
    method.mockResolvedValue({ approved: true })
    await expect(handler(f.event, ...args)).rejects.toThrow()
    expect(method).toHaveBeenCalledExactlyOnceWith(...args)
  })
}
