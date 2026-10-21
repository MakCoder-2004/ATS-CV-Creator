const { parentPort } = require('node:worker_threads')
const { createHash } = require('node:crypto')

parentPort.on('message', async bytes => {
  let loading
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 15 * 1024 * 1024) throw new Error('Choose a non-empty PDF smaller than 15 MiB.')
    const capturedBytes = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (capturedBytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('The selected file is not a PDF.')
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    loading = getDocument({ data: new Uint8Array(capturedBytes), useWorkerFetch: false, disableAutoFetch: true, stopAtErrors: true, verbosity: 0 })
    const document = await loading.promise
    if (document.numPages < 1 || document.numPages > 30) throw new Error('PDFs must contain 1–30 pages.')
    const pages = []
    let characterCount = 0
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent({ includeMarkedContent: false })
      const items = content.items.filter(item => typeof item.str === 'string' && Array.isArray(item.transform) && typeof item.width === 'number' && typeof item.height === 'number')
      const text = items.map(item => item.str).join(' ').replace(/[\t\u00a0]+/g, ' ').replace(/ {2,}/g, ' ').trim()
      const links = (await page.getAnnotations({ intent: 'display' })).flatMap(annotation => {
        if (annotation.subtype !== 'Link' || typeof annotation.url !== 'string' || !/^https?:\/\//i.test(annotation.url)) return []
        const [x0, y0, x1, y1] = annotation.rect
        const label = items.filter(item => item.transform[4] + item.width > x0 && item.transform[4] < x1 && item.transform[5] + item.height > y0 && item.transform[5] < y1).map(item => item.str.trim()).filter(Boolean).join(' ')
        return label ? [{ label, url: annotation.url }] : []
      })
      characterCount += [...text].length
      if (characterCount > 500_000) throw new Error('PDF text exceeds the 500,000 character limit.')
      pages.push({ page: pageNumber, text, links })
    }
    if (pages.reduce((sum, page) => sum + [...page.text].filter(character => !/\s/u.test(character)).length, 0) < 100) throw new Error('This PDF has no usable selectable text. Scanned PDFs and OCR are not supported.')
    parentPort.postMessage({ ok: true, value: { sha256: createHash('sha256').update(capturedBytes).digest('hex'), pages, characterCount } })
  } catch (error) {
    const message = error instanceof Error && /password|encrypted/i.test(error.message)
      ? 'Encrypted PDFs are not supported. Save an unprotected text PDF and try again.'
      : error instanceof Error && /^(Choose|The selected|PDFs must|PDF text exceeds|This PDF has no usable)/.test(error.message)
        ? error.message
        : 'This PDF could not be read. It may be malformed, encrypted, or unsupported.'
    parentPort.postMessage({ ok: false, message })
  } finally {
    if (loading) await loading.destroy().catch(() => {})
  }
})
