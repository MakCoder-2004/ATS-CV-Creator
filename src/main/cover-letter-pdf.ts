import type { CanonicalCoverLetter } from '../shared/cover-letter-document'

const normalize = (value: string) => value.normalize('NFC').replace(/\s+/gu, ' ').trim()
export async function inspectCoverLetterPdf(bytes: Uint8Array) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  try {
    const pdf = await loading.promise
    if (pdf.numPages !== 1) throw new Error('The cover letter must fit on exactly one Letter page.')
    const page = await pdf.getPage(1)
    if (Math.abs(page.view[2] - page.view[0] - 612) > 1 || Math.abs(page.view[3] - page.view[1] - 792) > 1) throw new Error('The compiled letter does not use US Letter page geometry.')
    const content = await page.getTextContent()
    const extractedText = content.items.filter((item): item is typeof item & { str: string } => 'str' in item && typeof item.str === 'string').map(item => item.str).filter(Boolean)
    if (!extractedText.length) throw new Error('The cover letter has no selectable text.')
    return { actualPages: 1 as const, pageWidth: page.view[2] - page.view[0], pageHeight: page.view[3] - page.view[1], extractedText }
  } finally { await loading.destroy() }
}

export function assertCoverLetterPdfContent(letter: CanonicalCoverLetter, inspected: Awaited<ReturnType<typeof inspectCoverLetterPdf>>) {
  const actual = normalize(inspected.extractedText.join(' '))
  const ordered = [letter.name, ...[letter.contact.email, letter.contact.phone, letter.contact.location].filter((value): value is string => Boolean(value)), letter.date, `RE: ${letter.subject}`, letter.greeting, ...letter.paragraphs, 'Sincerely,', letter.signature].map(normalize)
  let cursor = 0
  for (const field of ordered) {
    const index = actual.indexOf(field, cursor)
    if (!field || index < 0) throw new Error('The compiled letter text or reading order does not match the canonical letter.')
    cursor = index + field.length
  }
}
