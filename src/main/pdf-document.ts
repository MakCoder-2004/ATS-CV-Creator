import { canonicalDocumentTextParts, type CanonicalDocument } from '../shared/document'
import { containsPdfTextInOrder } from '../shared/export'

/** Parse the actual compiled bytes, not an HTML estimate. Always release PDF.js resources. */
export async function inspectCompiledPdf(pdf: Uint8Array) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loading = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true })
  try {
    const document = await loading.promise
    const extractedText: string[] = [], linkTargets = new Set<string>(), links = new Map<string, { label: string; url: string }>()
    for (let pageNo = 1; pageNo <= document.numPages; pageNo++) {
      const page = await document.getPage(pageNo)
      if (Math.abs(page.view[2] - page.view[0] - 612) > 1 || Math.abs(page.view[3] - page.view[1] - 792) > 1) throw new Error('The compiled CV did not use the supplied Letter paper template.')
      const content = await page.getTextContent()
      const items = content.items.filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number } => 'str' in item && typeof item.str === 'string')
      extractedText.push(...items.flatMap(item => item.str.trim() ? [item.str.trim()] : []))
      for (const annotation of await page.getAnnotations({ intent: 'display' })) if (annotation.subtype === 'Link' && annotation.url) {
        linkTargets.add(annotation.url)
        const [x0, y0, x1, y1] = annotation.rect
        const label = items.filter(item => item.transform[4] + item.width > x0 && item.transform[4] < x1 && item.transform[5] + item.height > y0 && item.transform[5] < y1).map(item => item.str.trim()).filter(Boolean).join(' ')
        if (label) links.set(`${label}\u0000${annotation.url}`, { label, url: annotation.url })
      }
    }
    if (!document.numPages || !extractedText.length) throw new Error('The compiled CV has no measurable pages or selectable text.')
    return { actualPages: document.numPages, extractedText, linkTargets: [...linkTargets], links: [...links.values()] }
  } finally { await loading.destroy() }
}
export function assertCompiledContent(document: CanonicalDocument, pdf: Awaited<ReturnType<typeof inspectCompiledPdf>>) {
  if (!containsPdfTextInOrder(pdf.extractedText, canonicalDocumentTextParts(document))) throw new Error('The compiled PDF content or reading order did not match the reviewed CV. No file was saved.')
  const requiredLinks = [...document.identity.links, ...document.sections.filter(section => section.name !== 'Certificates').flatMap(section => section.entries.flatMap(entry => entry.links))].map(link => link.url)
  if (document.identity.email) requiredLinks.push(`mailto:${document.identity.email}`)
  const targets = new Set(pdf.linkTargets.map(url => new URL(url).href))
  if (requiredLinks.some(url => !targets.has(new URL(url).href))) throw new Error('A CV hyperlink did not survive local compilation. Check its address before exporting.')
}
