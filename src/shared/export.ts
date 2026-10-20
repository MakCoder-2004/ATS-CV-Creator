export function sanitizeFilenamePart(value: string): string {
  const cleaned = value.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/[.\s]+$/g, '').replace(/\s+/g, ' ').trim()
  return cleaned.replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i, '_$1').slice(0, 80) || 'CV'
}

export function pdfFilename(name: string, company: string, title: string): string {
  return `${sanitizeFilenamePart(name)} - ${sanitizeFilenamePart(company)} - ${sanitizeFilenamePart(title)}.pdf`
}
