import { expect, test, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { registerCoverLetterArtifactIpc } from '../src/main/cover-letter-artifact-ipc'

function fixture() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const api = { getCoverLetter: vi.fn(), getCoverLetterReadModel: vi.fn(), editCoverLetter: vi.fn(), setCoverLetterRecipient: vi.fn(), acknowledgeCoverLetterParagraph: vi.fn(), checkCoverLetter: vi.fn(), approveCoverLetter: vi.fn(), measureCoverLetter: vi.fn(), getCoverLetterPdf: vi.fn(), exportCoverLetter: vi.fn() }
  const event = {} as IpcMainInvokeEvent
  registerCoverLetterArtifactIpc({ handle: (channel, listener) => { handlers.set(channel, listener) } } as Pick<IpcMain, 'handle'>, api, sender => { if (sender !== event) throw new Error('Untrusted sender') })
  return { handlers, api, event }
}
const jobId = randomUUID(), letterId = randomUUID(), paragraphId = randomUUID(), action = { jobId, letterId }
const cases = [
  ['cover-letter:get', 'getCoverLetter', [jobId]],
  ['cover-letter:read-model', 'getCoverLetterReadModel', [jobId]],
  ['cover-letter:edit', 'editCoverLetter', [{ ...action, recipient: null, paragraphs: [{ id: paragraphId, text: 'Saved source.', citations: [{ ordinal: 1 }] }] }]],
  ['cover-letter:recipient', 'setCoverLetterRecipient', [{ ...action, recipient: 'Local Person' }]],
  ['cover-letter:paragraph:acknowledge', 'acknowledgeCoverLetterParagraph', [{ ...action, paragraphId, acknowledged: true }]],
  ['cover-letter:check', 'checkCoverLetter', [jobId]],
  ['cover-letter:approve', 'approveCoverLetter', [jobId, letterId]],
  ['cover-letter:measure', 'measureCoverLetter', [action]],
  ['cover-letter:pdf', 'getCoverLetterPdf', [action]],
  ['cover-letter:export', 'exportCoverLetter', [{ ...action, format: 'docx' }]],
] as const
for (const [channel, method, args] of cases) test(`${channel} enforces trusted sender, exact arity, strict input and result`, async () => {
  const f = fixture(), handler = f.handlers.get(channel)!
  await expect(handler({} as IpcMainInvokeEvent, ...args)).rejects.toThrow(/Untrusted/)
  await expect(handler(f.event, ...args, true)).rejects.toThrow(/arguments/)
  await expect(handler(f.event)).rejects.toThrow(/arguments/)
  await expect(handler(f.event, typeof args[0] === 'string' ? 'bad-id' : { ...args[0], report: { actualPages: 1 }, path: 'C:/forged.pdf', approved: true }, ...args.slice(1))).rejects.toThrow()
  expect(Object.values(f.api).every(fn => fn.mock.calls.length === 0)).toBe(true)
  f.api[method].mockResolvedValue({ ok: true, message: 'Forged extra authority.', arbitrary: true })
  await expect(handler(f.event, ...args)).rejects.toThrow()
  expect(f.api[method]).toHaveBeenCalledExactlyOnceWith(...args)
})
