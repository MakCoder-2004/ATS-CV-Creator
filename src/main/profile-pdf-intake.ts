import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

export const profilePdfLimits = Object.freeze({
  bytes: 15 * 1024 * 1024,
  pages: 30,
  codePoints: 500_000,
  minimumUsefulCharacters: 100,
  timeoutMs: 5_000
})

export type PdfSourcePage = { page: number; text: string; links: Array<{ label: string; url: string }> }
export type PdfIntake = { sha256: string; pages: PdfSourcePage[]; characterCount: number }
type WorkerResult = { ok: true; value: PdfIntake } | { ok: false; message: string }

/**
 * Parse captured bytes in a disposable worker. The wall deadline terminates the worker, including
 * synchronous parser work; a Promise.race on the renderer/main thread would not provide this bound.
 */
export async function extractProfilePdf(bytes: Uint8Array): Promise<PdfIntake> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > profilePdfLimits.bytes) {
    throw new Error('Choose a non-empty PDF smaller than 15 MiB.')
  }
  if (Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 5)).toString('latin1') !== '%PDF-') throw new Error('The selected file is not a PDF.')
  const packagedWorker = join(__dirname, 'profile-pdf-worker.cjs')
  const sourceWorker = join(process.cwd(), 'src', 'main', 'profile-pdf-worker.cjs')
  const worker = new Worker(existsSync(packagedWorker) ? packagedWorker : sourceWorker, { resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } })
  try {
    return await new Promise<PdfIntake>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PDF reading exceeded the 5 second limit. Choose a smaller or simpler file.')), profilePdfLimits.timeoutMs)
      const finish = (action: () => void) => { clearTimeout(timer); action() }
      worker.once('message', (result: WorkerResult) => finish(() => result.ok ? resolve(result.value) : reject(new Error(result.message))))
      worker.once('error', error => finish(() => reject(new Error(`PDF parser worker failed: ${error.message}`))))
      worker.once('exit', code => { if (code !== 0) finish(() => reject(new Error('PDF parser worker stopped unexpectedly.'))) })
      worker.postMessage(Buffer.from(bytes))
    })
  } finally {
    await worker.terminate()
  }
}
