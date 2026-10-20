import { AlignmentType, Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import JSZip from 'jszip'
import type { CanonicalDocument } from '../shared/document'

/** Builds an editable, single-column Word document from the approved canonical version. */
export async function renderCanonicalDocx(document: CanonicalDocument): Promise<Buffer> {
  const paragraphs: Paragraph[] = [new Paragraph({ text: document.identity.name, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 40 } })]
  if (document.identity.headline) paragraphs.push(new Paragraph({ text: document.identity.headline, alignment: AlignmentType.CENTER, spacing: { after: 40 } }))
  if (document.identity.contact.length) paragraphs.push(new Paragraph({ text: document.identity.contact.join(' · '), alignment: AlignmentType.CENTER, spacing: { after: 40 } }))
  if (document.identity.links.length) paragraphs.push(new Paragraph({ children: document.identity.links.flatMap((link, index) => [...(index ? [new TextRun(' · ')] : []), new ExternalHyperlink({ link: link.url, children: [new TextRun({ text: link.label, style: 'Hyperlink' })] })]), alignment: AlignmentType.CENTER, spacing: { after: 120 } }))
  for (const section of document.sections) {
    paragraphs.push(new Paragraph({ text: section.name.toUpperCase(), heading: HeadingLevel.HEADING_1, border: { bottom: { color: '333333', space: 3, style: 'single', size: 4 } }, spacing: { before: 120, after: 60 }, keepNext: true }))
    for (const entry of section.entries) {
      paragraphs.push(new Paragraph({ children: [new TextRun({ text: entry.heading, bold: true }), ...(entry.dates ? [new TextRun({ text: `\t${entry.dates}` })] : [])], tabStops: [{ type: 'right', position: 9360 }], spacing: { after: 30 }, keepNext: Boolean(entry.organization || entry.text) }))
      if (entry.organization) paragraphs.push(new Paragraph({ text: entry.organization, spacing: { after: 30 }, keepNext: Boolean(entry.text) }))
      if (entry.text) paragraphs.push(new Paragraph({ text: entry.text, spacing: { after: 60 } }))
      if (entry.links.length) paragraphs.push(new Paragraph({ children: entry.links.flatMap((link, index) => [...(index ? [new TextRun(' · ')] : []), new ExternalHyperlink({ link: link.url, children: [new TextRun({ text: link.label, style: 'Hyperlink' })] })]), spacing: { after: 60 } }))
    }
  }
  const doc = new Document({ creator: 'CV Tailor', title: `${document.identity.name} - Tailored CV`, sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 794, right: 794, bottom: 794, left: 794 } } }, children: paragraphs }], styles: { default: { document: { run: { font: 'Arial', size: 22, color: '202838' }, paragraph: { spacing: { line: 276 } } }, title: { run: { font: 'Arial', size: 34, bold: true, color: '202838' }, paragraph: { alignment: AlignmentType.CENTER } }, heading1: { run: { font: 'Arial', size: 24, bold: true, color: '202838' } } } } })
  return Packer.toBuffer(doc)
}

export async function extractCanonicalDocx(buffer: Buffer): Promise<{ text: string[]; linkTargets: string[] }> {
  const zip = await JSZip.loadAsync(buffer)
  const xml = await zip.file('word/document.xml')?.async('string')
  const relationshipsXml = await zip.file('word/_rels/document.xml.rels')?.async('string')
  if (!xml || !relationshipsXml) throw new Error('DOCX is missing its document or relationship data.')
  const decodeXml = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const text = [...xml.matchAll(/<w:t(?: [^>]*)?>(.*?)<\/w:t>/g)].map(match => decodeXml(match[1]))
  const linkTargets = [...relationshipsXml.matchAll(/<Relationship\b[^>]*Type="[^"]*\/hyperlink"[^>]*Target="([^"]+)"/g)].map(match => decodeXml(match[1]))
  return { text, linkTargets }
}
