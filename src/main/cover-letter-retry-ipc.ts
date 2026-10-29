import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { WorkbenchStorageAPI } from '../shared/appearance'
import { coverLetterGenerationStatusSchema, coverLetterOutcomeSchema } from '../shared/cover-letter'
import { outboundConsentPreviewSchema } from '../shared/outbound-consent-contract'
import { uuidSchema } from '../shared/profile'

type RetryActions = Pick<WorkbenchStorageAPI, 'prepareCoverLetterRetry' | 'generateCoverLetter' | 'getCoverLetterGenerationStatus'>

export function registerCoverLetterRetryIpc(
  ipc: Pick<IpcMain, 'handle'>,
  provider: RetryActions | (() => RetryActions),
  trusted: (event: IpcMainInvokeEvent) => void,
): void {
  const currentApi = () => typeof provider === 'function' ? provider() : provider
  ipc.handle('cover-letter:retry:preview', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 2) throw new Error('Expected saved job and originating CV revision IDs')
    const jobId = uuidSchema.parse(args[0]), cvRevisionId = uuidSchema.parse(args[1])
    return outboundConsentPreviewSchema.parse(await currentApi().prepareCoverLetterRetry(jobId, cvRevisionId))
  })
  ipc.handle('cover-letter:generate', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected fresh letter-only consent token')
    const token = uuidSchema.parse(args[0])
    return coverLetterOutcomeSchema.parse(await currentApi().generateCoverLetter(token))
  })
  ipc.handle('cover-letter:generation:status', async (event, ...args: unknown[]) => {
    trusted(event)
    if (args.length !== 1) throw new Error('Expected saved job ID')
    const jobId = uuidSchema.parse(args[0])
    return coverLetterGenerationStatusSchema.parse(await currentApi().getCoverLetterGenerationStatus(jobId))
  })
}
