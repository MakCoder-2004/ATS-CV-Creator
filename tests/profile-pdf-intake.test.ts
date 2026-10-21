import { expect, test } from 'vitest'
import { extractProfilePdf, profilePdfLimits } from '../src/main/profile-pdf-intake'

function makePdf(lines: string[]) {
  const objects: string[] = []
  const add = (value: string) => { objects.push(value); return objects.length }
  add('')
  const pages = add('')
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const refs: string[] = []
  for (const [index, line] of lines.entries()) {
    const commands = `BT /F1 12 Tf 1 0 0 1 40 ${740 - index * 20} Tm (${line.replace(/[()\\]/g, '\\$&')}) Tj ET`
    const content = add(`<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`)
    const page = add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`)
    refs.push(`${page} 0 R`)
  }
  objects[0] = `<< /Type /Catalog /Pages ${pages} 0 R >>`
  objects[pages - 1] = `<< /Type /Pages /Kids [${refs.join(' ')}] /Count ${refs.length} >>`
  let pdf = Buffer.from('%PDF-1.4\n')
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf = Buffer.concat([pdf, Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`)]) })
  const xref = pdf.length
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach(offset => { table += `${String(offset).padStart(10, '0')} 00000 n \n` })
  return Buffer.concat([pdf, Buffer.from(`${table}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)])
}


test('rejects non-PDF and over-limit bytes before parsing', async () => {
  await expect(extractProfilePdf(Buffer.from('DOCX'))).rejects.toThrow('not a PDF')
  await expect(extractProfilePdf(new Uint8Array(profilePdfLimits.bytes + 1))).rejects.toThrow('15 MiB')
})

test('extracts selectable text from a synthetic PDF and binds it to captured bytes', async () => {
  const bytes = makePdf(Array(5).fill('Ada Example | Software Engineer | ada@example.test'))
  const result = await extractProfilePdf(bytes)
  expect(result.pages).toHaveLength(5)
  expect(result.pages[0].text).toContain('Ada Example')
  expect(result.characterCount).toBeGreaterThan(100)
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(result.sha256).toBe((await extractProfilePdf(bytes)).sha256)
})

test('rejects PDFs beyond the accepted page ceiling', async () => {
  await expect(extractProfilePdf(makePdf(Array(31).fill('Synthetic selectable page content')))).rejects.toThrow('1–30 pages')
})

test('rejects blank/scanned-like PDFs instead of returning an empty profile source', async () => {
  await expect(extractProfilePdf(makePdf(['   ']))).rejects.toThrow('no usable selectable text')
})
