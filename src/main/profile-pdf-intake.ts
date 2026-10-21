import { createHash } from 'node:crypto'

export const profilePdfLimits = Object.freeze({
  bytes: 15 * 1024 * 1024,
  pages: 30,
  codePoints: 500_000,
  minimumUsefulCharacters: 100,
  timeoutMs: 5_000
})

export type PdfSourcePage = { page: number; text: string; links: Array<{ label: string; url: string }> }
export type PdfIntake = { sha256: string; pages: PdfSourcePage[]; characterCount: number }

/** Extracts inert selectable text from captured PDF bytes. Never follows annotations or external resources. */
export async function extractProfilePdf(bytes: Uint8Array): Promise<PdfIntake> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > profilePdfLimits.bytes) {
    throw new Error('Choose a non-empty PDF smaller than 15 MiB.')
  }
  if (new TextDecoder('latin1').decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('The selected file is not a PDF.')

  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loading = getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, disableAutoFetch: true, stopAtErrors: true, verbosity: 0 })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('PDF reading exceeded the 5 second limit. Choose a smaller or simpler file.')), profilePdfLimits.timeoutMs) })
    const document = await Promise.race([loading.promise, timeout])
    if (document.numPages < 1 || document.numPages > profilePdfLimits.pages) throw new Error('PDFs must contain 1–30 pages.')
    const pages: PdfSourcePage[] = []
    let characterCount = 0
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await Promise.race([document.getPage(pageNumber), timeout])
      const content = await Promise.race([page.getTextContent({ includeMarkedContent: false }), timeout])
      const textItems = content.items.filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number } => 'str' in item && typeof item.str === 'string' && 'transform' in item && 'width' in item && 'height' in item)
      const text = textItems.map(item => item.str).join(' ').replace(/[\t\u00a0]+/g, ' ').replace(/ {2,}/g, ' ').trim()
      const links = (await Promise.race([page.getAnnotations({ intent: 'display' }), timeout])).flatMap(annotation => {
        if (annotation.subtype !== 'Link' || typeof annotation.url !== 'string' || !/^https?:\/\//i.test(annotation.url)) return []
        const [x0, y0, x1, y1] = annotation.rect
        const label = textItems.filter(item => item.transform[4] + item.width > x0 && item.transform[4] < x1 && item.transform[5] + item.height > y0 && item.transform[5] < y1).map(item => item.str.trim()).filter(Boolean).join(' ')
        return label ? [{ label, url: annotation.url }] : []
      })
      characterCount += [...text].length
      if (characterCount > profilePdfLimits.codePoints) throw new Error('PDF text exceeds the 500,000 character limit.')
      // Annotation targets are retained as inert source data and are never fetched or followed.
      pages.push({ page: pageNumber, text, links })
    }
    if (pages.reduce((sum, page) => sum + [...page.text].filter(character => !/\s/u.test(character)).length, 0) < profilePdfLimits.minimumUsefulCharacters) {
      throw new Error('This PDF has no usable selectable text. Scanned PDFs and OCR are not supported.')
    }
    return { sha256: createHash('sha256').update(bytes).digest('hex'), pages, characterCount }
  } catch (error) {
    if (error instanceof Error && /PasswordException|password|encrypted/i.test(error.message)) throw new Error('Encrypted PDFs are not supported. Save an unprotected text PDF and try again.')
    if (error instanceof Error && (/^(PDFs must|PDF text exceeds|PDF reading exceeded|This PDF has no usable)/.test(error.message))) throw error
    throw new Error('This PDF could not be read. It may be malformed, encrypted, or unsupported.')
  } finally {
    if (timer) clearTimeout(timer)
    await loading.destroy().catch(() => {})
  }
}
