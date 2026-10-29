import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { WorkbenchStorageAPI } from '../shared/appearance'
import { coverLetterGenerationStatusSchema, coverLetterOutcomeSchema } from '../shared/cover-letter'
import { outboundConsentPreviewSchema } from '../shared/outbound-consent-contract'
import { uuidSchema } from '../shared/profile'

export function registerCoverLetterRetryIpc(
  ipc: Pick<IpcMain, 'handle'>,
  api: Pick<WorkbenchStorageAPI, 'prepareCoverLetterRetry' | 'generateCoverLetter' | 'getCoverLetterGenerationStatus'>,
  trusted: (event: IpcMainInvokeEvent) => void,
): void {
  ipc.handle('cover-letter:retry:preview', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 2) throw new Error('Expected saved job and originating CV revision IDs')
    return outboundConsentPreviewSchema.parse(await api.prepareCoverLetterRetry(uuidSchema.parse(args[0]), uuidSchema.parse(args[1])))
  })
  ipc.handle('cover-letter:generate', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected fresh letter-only consent token')
    return coverLetterOutcomeSchema.parse(await api.generateCoverLetter(uuidSchema.parse(args[0])))
  })
  ipc.handle('cover-letter:generation:status', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected saved job ID')
    return coverLetterGenerationStatusSchema.parse(await api.getCoverLetterGenerationStatus(uuidSchema.parse(args[0])))
  })
}
