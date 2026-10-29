import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { WorkbenchAPI } from '../shared/appearance'
import { uuidSchema } from '../shared/profile'
import { coverLetterAcknowledgmentSchema, coverLetterActionResultSchema, coverLetterEditSchema, coverLetterRecipientSchema, coverLetterRevisionSchema } from '../shared/cover-letter'
import { coverLetterArtifactActionSchema, coverLetterExportInputSchema, coverLetterExportResultSchema, coverLetterPreviewResultSchema, coverLetterReadModelSchema } from '../shared/cover-letter-artifact'

type LetterActions = Pick<WorkbenchAPI, 'getCoverLetter' | 'getCoverLetterReadModel' | 'editCoverLetter' | 'setCoverLetterRecipient' | 'acknowledgeCoverLetterParagraph' | 'checkCoverLetter' | 'approveCoverLetter' | 'measureCoverLetter' | 'getCoverLetterPdf' | 'exportCoverLetter'>
export function registerCoverLetterArtifactIpc(ipc: Pick<IpcMain, 'handle'>, api: LetterActions, trusted: (event: IpcMainInvokeEvent) => void): void {
  function handle(channel: string, arity: number, action: (args: unknown[]) => Promise<unknown>) {
    ipc.handle(channel, async (event, ...args: unknown[]) => {
      trusted(event)
      if (args.length !== arity) throw new Error('Invalid cover-letter action arguments.')
      return action(args)
    })
  }
  handle('cover-letter:get', 1, async args => {
    const result = await api.getCoverLetter(uuidSchema.parse(args[0]))
    return result === null ? null : coverLetterRevisionSchema.parse(result)
  })
  handle('cover-letter:read-model', 1, async args => coverLetterReadModelSchema.parse(await api.getCoverLetterReadModel(uuidSchema.parse(args[0]))))
  handle('cover-letter:edit', 1, async args => coverLetterActionResultSchema.parse(await api.editCoverLetter(coverLetterEditSchema.parse(args[0]))))
  handle('cover-letter:recipient', 1, async args => coverLetterActionResultSchema.parse(await api.setCoverLetterRecipient(coverLetterRecipientSchema.parse(args[0]))))
  handle('cover-letter:paragraph:acknowledge', 1, async args => coverLetterActionResultSchema.parse(await api.acknowledgeCoverLetterParagraph(coverLetterAcknowledgmentSchema.parse(args[0]))))
  handle('cover-letter:check', 1, async args => coverLetterActionResultSchema.parse(await api.checkCoverLetter(uuidSchema.parse(args[0]))))
  handle('cover-letter:approve', 2, async args => coverLetterActionResultSchema.parse(await api.approveCoverLetter(uuidSchema.parse(args[0]), uuidSchema.parse(args[1]))))
  handle('cover-letter:measure', 1, async args => coverLetterActionResultSchema.parse(await api.measureCoverLetter(coverLetterArtifactActionSchema.parse(args[0]))))
  handle('cover-letter:pdf', 1, async args => coverLetterPreviewResultSchema.parse(await api.getCoverLetterPdf(coverLetterArtifactActionSchema.parse(args[0]))))
  handle('cover-letter:export', 1, async args => coverLetterExportResultSchema.parse(await api.exportCoverLetter(coverLetterExportInputSchema.parse(args[0]))))
}
