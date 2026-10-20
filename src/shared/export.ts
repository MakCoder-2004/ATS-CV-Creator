import { linkSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

export function sanitizeFilenamePart(value: string): string {
  const cleaned = value.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/[.\s]+$/g, '').replace(/\s+/g, ' ').trim()
  return cleaned.replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i, '_$1').slice(0, 80) || 'CV'
}

export function pdfFilename(name: string, company: string, title: string): string {
  return `${sanitizeFilenamePart(name)} - ${sanitizeFilenamePart(company)} - ${sanitizeFilenamePart(title)}.pdf`
}

/** A hard-link commit is atomic and fails with EEXIST rather than clobbering an unapproved path. */
export function writePdfAtomically(destination: string, bytes: Uint8Array, overwriteApproved: boolean): void {
  const temporary = join(dirname(destination), `.${basename(destination)}.${process.pid}.${Date.now()}.tmp`)
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' })
    if (overwriteApproved) renameSync(temporary, destination)
    else {
      linkSync(temporary, destination)
      unlinkSync(temporary)
    }
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

/** PDF extractors split lines and sometimes combine adjacent runs; compare normalized text streams, not item boundaries. */
function normalizedPdfStream(extractedItems: string[]): string {
  return extractedItems.join('').normalize('NFC').replace(/\s+/gu, '').toLowerCase()
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
