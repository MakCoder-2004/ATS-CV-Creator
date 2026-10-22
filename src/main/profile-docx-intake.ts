import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
export type DocxLink = { label: string; url: string }
export type DocxParagraph = { text: string; links: DocxLink[] }
export type DocxIntake = { sha256: string; pages: Array<{ page: number; text: string; links: []; paragraphs: DocxParagraph[] }>; characterCount: number }

export const profileDocxLimits = Object.freeze({ bytes: 15 * 1024 * 1024, entries: 100, expanded: 50 * 1024 * 1024, xmlPart: 20 * 1024 * 1024, codePoints: 500_000, timeoutMs: 5_000 })
type WorkerResult = { ok: true; value: DocxIntake } | { ok: false; message: string }

/** Parses captured DOCX bytes in a disposable resource-limited worker with a hard wall deadline. */
export async function extractProfileDocx(bytes: Uint8Array): Promise<DocxIntake> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > profileDocxLimits.bytes) throw new Error('Choose a non-empty DOCX smaller than 15 MiB.')
  if (Buffer.from(bytes.buffer, bytes.byteOffset, 4).toString('hex') !== '504b0304') throw new Error('The selected file is not a DOCX document.')
  const packagedWorker = join(__dirname, 'profile-docx-worker.cjs')
  const sourceWorker = join(process.cwd(), 'src', 'main', 'profile-docx-worker.cjs')
  const worker = new Worker(existsSync(packagedWorker) ? packagedWorker : sourceWorker, { resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } })
  try {
    return await new Promise<DocxIntake>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined, settled = false
      const finish = (action: () => void) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); action() }
      worker.on('message', (result: WorkerResult | { ready: true }) => {
        if ('ready' in result) { timer = setTimeout(() => finish(() => reject(new Error('DOCX reading exceeded the 5 second limit. Choose a smaller or simpler file.'))), profileDocxLimits.timeoutMs); worker.postMessage(Buffer.from(bytes)); return }
        finish(() => result.ok ? resolve(result.value) : reject(new Error(result.message)))
      })
      worker.once('error', error => finish(() => reject(new Error(`DOCX parser worker failed: ${error.message}`))))
      worker.once('exit', code => { if (code !== 0) finish(() => reject(new Error('DOCX parser worker stopped unexpectedly.'))) })
    })
  } finally { await worker.terminate() }
}
