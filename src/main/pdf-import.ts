import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pdfImportExtractionSchema, type PdfImportExtraction } from '../shared/pdf-import'

const MAX_BYTES = 15 * 1024 * 1024
const MAX_PAGES = 30

/** Extracts local PDF bytes only; callers must obtain the path through a main-process file dialog. */
export async function extractPdfImport(bytes: Uint8Array): Promise<PdfImportExtraction> {
  if (bytes.byteLength > MAX_BYTES) throw new Error('The selected PDF is larger than the 15 MB import limit.')
  if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('The selected file is not a supported PDF.')
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  let doc: Awaited<typeof loading.promise>
  try { doc = await loading.promise }
  catch { await loading.destroy(); throw new Error('The PDF could not be opened. It may be encrypted, malformed, or use unsupported encoding.') }
  try {
    if (doc.numPages > MAX_PAGES) throw new Error('The selected PDF has more than the 30-page import limit.')
    const source: PdfImportExtraction['source'] = []
    const links: PdfImportExtraction['links'] = []
    const issues: PdfImportExtraction['issues'] = []
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent({ includeMarkedContent: false })
      const items = content.items.filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number } => 'str' in item && Boolean(item.str.trim()))
      const visual = [...items].sort((a, b) => Math.abs(a.transform[5] - b.transform[5]) > 3 ? b.transform[5] - a.transform[5] : a.transform[4] - b.transform[4])
      if (items.some((item, index) => item !== visual[index])) issues.push({ code: 'reading-order', message: `Page ${pageNumber}: PDF text stream order differs from approximate visual order; review the extracted text.` })
      for (const item of visual) {
        if (/\uFFFD/.test(item.str)) issues.push({ code: 'glyph-replacement', message: `Page ${pageNumber}: replacement glyphs indicate text may have extracted incompletely.` })
        source.push({ page: pageNumber, text: item.str, x: item.transform[4], y: item.transform[5], width: item.width, height: item.height })
      }
      const annotations = await page.getAnnotations({ intent: 'display' })
      for (const annotation of annotations) {
        if (annotation.subtype !== 'Link') continue
        const target = typeof annotation.url === 'string' ? annotation.url : ''
        if (!target) { issues.push({ code: 'unmapped-link', message: `Page ${pageNumber}: an internal or unresolved link has no reviewable external URL.` }); continue }
        if (!/^https?:\/\//i.test(target)) issues.push({ code: 'unsafe-link', message: `Page ${pageNumber}: a non-HTTP(S) link needs correction before it can be used.` })
        const [x1, y1, x2, y2] = annotation.rect
        const matches = visual.filter(item => item.transform[4] <= x2 && item.transform[4] + item.width >= x1 && item.transform[5] <= y2 && item.transform[5] + item.height >= y1)
        const match = matches.length === 1 ? matches[0] : undefined
        links.push({ page: pageNumber, target, x: x1, y: y1, width: x2 - x1, height: y2 - y1, ...(match ? { label: match.str } : {}), mapped: Boolean(match) })
        if (!match) issues.push({ code: 'unmapped-link', message: `Page ${pageNumber}: a link target could not be unambiguously matched to visible text and needs review.` })
      }
    }
    if (!source.length) throw new Error('The PDF has no selectable text. OCR and scanned-image import are not supported.')
    return pdfImportExtractionSchema.parse({ source, links, issues, pageCount: doc.numPages })
  } finally { await loading.destroy() }
}
