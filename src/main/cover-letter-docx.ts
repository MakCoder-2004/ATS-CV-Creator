import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx'
import { canonicalCoverLetterSchema } from '../shared/cover-letter-document'

export async function renderCoverLetterDocx(input: unknown): Promise<Buffer> {
  const letter = canonicalCoverLetterSchema.parse(input)
  const contact = [letter.contact.email, letter.contact.phone, letter.contact.location].filter((value): value is string => Boolean(value)).join(' · ')
  const paragraphs = [
    new Paragraph({ children: [new TextRun({ text: letter.name, bold: true, size: 30 })], alignment: AlignmentType.CENTER, spacing: { after: 40 }, keepNext: true }),
    ...(contact ? [new Paragraph({ text: contact, alignment: AlignmentType.CENTER, spacing: { after: 100 }, keepNext: true })] : []),
    new Paragraph({ text: letter.date, spacing: { before: 220, after: 80 }, keepNext: true }),
    new Paragraph({ children: [new TextRun({ text: `RE: ${letter.subject}`, bold: true })], spacing: { after: 100 }, keepNext: true }),
    new Paragraph({ text: letter.greeting, spacing: { after: 100 }, keepNext: true }),
    ...letter.paragraphs.map(text => new Paragraph({ text, spacing: { after: 120, line: 276 } })),
    new Paragraph({ text: 'Sincerely,', spacing: { before: 40, after: 100 }, keepNext: true }),
    new Paragraph({ text: letter.signature }),
  ]
  const doc = new Document({
    creator: 'CV Tailor', title: `${letter.name} - Cover Letter`,
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1152, right: 1152, bottom: 1152, left: 1152 } } }, children: paragraphs }],
    styles: { default: { document: { run: { font: 'Lato', size: 22, color: '000000' }, paragraph: { spacing: { line: 264 } } } } },
  })
  return Packer.toBuffer(doc)
}
