import type { CanonicalCoverLetter } from '../shared/cover-letter-document'
import { coverLetterExportInputSchema, type CoverLetterArtifactAction, type CoverLetterExportInput, type CoverLetterExportResult } from '../shared/cover-letter-artifact'
import { captureLetterDestination, commitLetterDestination, LetterDestinationError } from './cover-letter-destination'

export interface TrustedLetterExportSnapshot {
  canonical: CanonicalCoverLetter
  /** Main-only private-DB/pure-canonical assertion. Synchronous, returns exactly undefined. */
  assertCurrent(): undefined
  createBytes(format: 'pdf' | 'docx'): Promise<Buffer>
}
export interface CoverLetterArtifactWorkspace {
  beginJobOperation(jobId: string, action: string): () => void
  captureCoverLetterExport(input: CoverLetterArtifactAction): Promise<TrustedLetterExportSnapshot>
}
export interface CoverLetterNativeDialogs {
  chooseDestination(format: 'pdf' | 'docx'): Promise<{ canceled: boolean; filePath?: string }>
  confirmOverwrite(format: 'pdf' | 'docx'): Promise<boolean>
}

export function createCoverLetterArtifactController(workspace: CoverLetterArtifactWorkspace, dialogs: CoverLetterNativeDialogs) {
  return {
    async exportCoverLetter(input: CoverLetterExportInput): Promise<CoverLetterExportResult> {
      const parsed = coverLetterExportInputSchema.safeParse(input)
      if (!parsed.success) return { ok: false, cancelled: false, message: 'Expected only current job, letter and output format.' }
      const { jobId, letterId, format } = parsed.data, label = format === 'pdf' ? 'PDF' : 'editable DOCX'
      let release: (() => void) | undefined
      try {
        release = workspace.beginJobOperation(jobId, 'Cover-letter export')
        const snapshot = await workspace.captureCoverLetterExport({ jobId, letterId })
        snapshot.assertCurrent()
        const destination = await dialogs.chooseDestination(format)
        snapshot.assertCurrent()
        if (destination.canceled || !destination.filePath) return { ok: false, cancelled: true, message: `Cover-letter ${label} export cancelled.` }
        // Capture only a native-chosen path, before asking whether to replace its exact bytes.
        const capture = captureLetterDestination(destination.filePath)
        const overwriteApproved = capture.exists ? await dialogs.confirmOverwrite(format) : false
        snapshot.assertCurrent()
        if (capture.exists && !overwriteApproved) return { ok: false, cancelled: true, message: 'Cover-letter export cancelled. The existing file was kept.' }
        const bytes = await snapshot.createBytes(format)
        snapshot.assertCurrent()
        // No await between the last document assertion, destination comparison and file commit.
        commitLetterDestination(capture, bytes, { overwriteApproved, beforeCommit: snapshot.assertCurrent })
        return { ok: true, cancelled: false, message: format === 'pdf' ? 'Cover-letter PDF saved.' : 'Editable cover-letter DOCX saved. Word may reflow; the measured PDF is authoritative.' }
      } catch (error) {
        const message = error instanceof LetterDestinationError && error.code === 'DESTINATION_CHANGED'
          ? 'The destination changed after selection. No cover-letter file was saved; choose a destination again.'
          : 'The current approved cover letter could not be exported. No success was reported. Review its current sources, approval, page fit and destination, then try again.'
        return { ok: false, cancelled: false, message }
      } finally { release?.() }
    },
  }
}
