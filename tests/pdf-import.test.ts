import { expect, test } from 'vitest'
import { extractPdfImport } from '../src/main/pdf-import'
import { confirmPdfImport } from '../src/shared/pdf-import'

const PDFDocument = require('pdfkit')

function syntheticPdf(build: (document: InstanceType<typeof PDFDocument>) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ autoFirstPage: false, compress: false })
    const chunks: Buffer[] = []
    document.on('data', (chunk: Buffer) => chunks.push(chunk))
    document.on('error', reject)
    document.on('end', () => resolve(Buffer.concat(chunks)))
    document.addPage()
    build(document)
    document.end()
  })
}

test('local synthetic PDF text and hyperlink targets remain reviewable without automatic confirmation', async () => {
  const pdf = await syntheticPdf(document => {
    document.fontSize(12).text('Example College', 70, 160)
    document.text('Ada Example', 70, 70)
    document.text('Portfolio site', 70, 210, { link: 'https://example.test/portfolio' })
  })
  const result = await extractPdfImport(pdf)
  expect(result.pageCount).toBe(1)
  expect(result.source.map(item => item.text).join(' ')).toContain('Ada Example')
  expect(result.source.map(item => item.text).join(' ')).toContain('Example College')
  expect(result.links).toEqual(expect.arrayContaining([expect.objectContaining({ target: 'https://example.test/portfolio', page: 1 })]))
  expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'reading-order' })]))
  expect(() => confirmPdfImport({ fields: [{ category: 'unmapped', field: 'text', value: 'Ada Example', sourceIndexes: [0], confidence: 'unmapped', confirmed: false }], confirmed: true })).toThrow(/confirm/i)
})

test('rejects unsupported input and enforces PDF size without leaking extracted text', async () => {
  await expect(extractPdfImport(new Uint8Array(Buffer.from('not a pdf')))).rejects.toThrow(/supported PDF/)
  await expect(extractPdfImport(new Uint8Array(15 * 1024 * 1024 + 1))).rejects.toThrow(/15 MB/)
})
