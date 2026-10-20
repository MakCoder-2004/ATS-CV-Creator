export function sanitizeFilenamePart(value: string): string {
  const cleaned = value.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/[.\s]+$/g, '').replace(/\s+/g, ' ').trim()
  return cleaned.replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i, '_$1').slice(0, 80) || 'CV'
}

export function pdfFilename(name: string, company: string, title: string): string {
  return `${sanitizeFilenamePart(name)} - ${sanitizeFilenamePart(company)} - ${sanitizeFilenamePart(title)}.pdf`
}

/** PDF extractors split lines and sometimes combine adjacent runs; compare normalized text streams, not item boundaries. */
function normalizedPdfStream(extractedItems: string[]): string {
  return extractedItems.join('').normalize('NFC').replace(/\s+/gu, '').toLowerCase()
}

export function containsAllPdfContent(extractedItems: string[], expectedParts: string[]): boolean {
  const stream = normalizedPdfStream(extractedItems)
  return expectedParts.every(part => {
    const expected = part.normalize('NFC').replace(/\s+/gu, '').toLowerCase()
    return !expected || stream.includes(expected)
  })
}

export function containsPdfTextInOrder(extractedItems: string[], expectedParts: string[]): boolean {
  const stream = normalizedPdfStream(extractedItems)
  let offset = 0
  for (const part of expectedParts) {
    const expected = part.normalize('NFC').replace(/\s+/gu, '').toLowerCase()
    if (!expected) continue
    const found = stream.indexOf(expected, offset)
    if (found < 0) return false
    offset = found + expected.length
  }
  return true
}
