const PDFDocument = require('pdfkit')

export function syntheticPdf(build: (document: InstanceType<typeof PDFDocument>) => void): Promise<Buffer> {
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
