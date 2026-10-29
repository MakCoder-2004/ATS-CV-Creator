import { expect, test, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { registerCoverLetterRetryIpc } from '../src/main/cover-letter-retry-ipc'

function fixture() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const api = { prepareCoverLetterRetry: vi.fn(), generateCoverLetter: vi.fn(), getCoverLetterGenerationStatus: vi.fn() }
  const event = {} as IpcMainInvokeEvent
  const trusted = vi.fn((sender: IpcMainInvokeEvent) => { if (sender !== event) throw new Error('Untrusted sender') })
  registerCoverLetterRetryIpc({ handle: (channel, listener) => { handlers.set(channel, listener) } } as Pick<IpcMain, 'handle'>, api, trusted)
  return { handlers, api, event, trusted }
}

for (const [channel, count] of [['cover-letter:retry:preview', 2], ['cover-letter:generate', 1], ['cover-letter:generation:status', 1]] as const) {
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
