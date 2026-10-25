import { AlignmentType, Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import JSZip from 'jszip'
import { documentSectionDisplayName, groupedDocumentSkills, visibleDocumentSections, splitDocumentBullets, type CanonicalDocument, type CanonicalDocumentEntry } from '../shared/document'

const hyperlinkRuns = (links: CanonicalDocumentEntry['links']) => links.flatMap((link, index) => [...(index ? [new TextRun(' · ')] : []), new ExternalHyperlink({ link: link.url, children: [new TextRun({ text: link.label, style: 'Hyperlink' })] })])
const hyperlinkParagraph = (links: CanonicalDocumentEntry['links'], alignment: 'center' | 'left' = 'left') => new Paragraph({ alignment, children: hyperlinkRuns(links), spacing: { after: 60 } })

/** Builds an editable, single-column Word document from the approved canonical version. */
export async function renderCanonicalDocx(document: CanonicalDocument): Promise<Buffer> {
  const paragraphs: Paragraph[] = [new Paragraph({ text: document.identity.name, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 40 }, keepNext: true })]
  if (document.identity.contact.length) paragraphs.push(new Paragraph({ text: document.identity.contact.join(' · '), alignment: AlignmentType.CENTER, spacing: { after: 40 }, keepNext: true }))
  if (document.identity.links.length) paragraphs.push(hyperlinkParagraph(document.identity.links, 'center'))
  for (const section of visibleDocumentSections(document)) {
    paragraphs.push(new Paragraph({ text: documentSectionDisplayName(section.name), heading: HeadingLevel.HEADING_1, border: { bottom: { color: '333333', space: 3, style: 'single', size: 4 } }, spacing: { before: 120, after: 60 }, keepNext: true }))
    if (section.name === 'Skills') {
      for (const group of groupedDocumentSkills(section.entries)) paragraphs.push(new Paragraph({ children: [new TextRun({ text: `${group.name}:`, bold: true }), new TextRun(` ${group.entries.map(entry => entry.heading).join(', ')}`)], spacing: { after: 60 } }))
      continue
    }
    for (const entry of section.entries) {
      paragraphs.push(new Paragraph({ children: [new TextRun({ text: section.name === 'Projects' ? entry.heading : entry.organization || entry.heading, bold: true }), ...(section.name === 'Projects' && entry.technologies?.length ? [new TextRun({ text: ` | ${entry.technologies.join(', ')}`, italics: true })] : []), ...(entry.dates ? [new TextRun({ text: `\t${entry.dates}` })] : []), ...(section.name === 'Projects' && entry.links.length ? [new TextRun(entry.dates ? ' · ' : '\t'), ...hyperlinkRuns(entry.links)] : [])], tabStops: [{ type: 'right', position: 10800 }], spacing: { after: 30 }, keepNext: true }))
      if (section.name !== 'Projects' && (entry.organization || entry.grade)) paragraphs.push(new Paragraph({ children: [new TextRun({ text: entry.organization ? entry.heading : '', italics: true }), ...(entry.grade ? [new TextRun({ text: `\t${entry.grade}`, italics: true })] : [])], tabStops: [{ type: 'right', position: 10800 }], spacing: { after: 30 }, keepNext: Boolean(entry.text || entry.bullets?.length) }))
      if (entry.descriptionFormat === 'paragraph') {
        if (entry.text) paragraphs.push(new Paragraph({ text: entry.text, spacing: { after: 60 } }))
      } else {
        const bullets = entry.bullets?.length ? entry.bullets : splitDocumentBullets(entry.text)
        for (const bullet of bullets) paragraphs.push(new Paragraph({ text: bullet, bullet: { level: 0 }, indent: { left: 360, hanging: 180 }, spacing: { after: 30 } }))
      }
      if (section.name !== 'Projects' && entry.links.length) paragraphs.push(hyperlinkParagraph(entry.links))
    }
  }
  const doc = new Document({
    creator: 'CV Tailor', title: `${document.identity.name} - Tailored CV`,
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } }, children: paragraphs }],
    styles: { default: { document: { run: { font: 'Lato', size: 22, color: '000000' }, paragraph: { spacing: { line: 264 } } }, title: { run: { font: 'Lato', size: 48, bold: true, color: '000000' }, paragraph: { alignment: AlignmentType.CENTER } }, heading1: { run: { font: 'Lato', size: 26, color: '000000' } } }
  } })
  return Packer.toBuffer(doc)
}

export async function extractCanonicalDocx(buffer: Buffer): Promise<{ text: string[]; links: { label: string; url: string }[]; linkTargets: string[] }> {
  const zip = await JSZip.loadAsync(buffer)
  const xml = await zip.file('word/document.xml')?.async('string')
  const relationshipsXml = await zip.file('word/_rels/document.xml.rels')?.async('string')
  if (!xml || !relationshipsXml) throw new Error('DOCX is missing its document or relationship data.')
  const decodeXml = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const text = [...xml.matchAll(/<w:t(?: [^>]*)?>(.*?)<\/w:t>/g)].map(match => decodeXml(match[1]))
  const relationships = new Map<string, string>()
  for (const match of relationshipsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const attributes = Object.fromEntries([...match[1].matchAll(/([\w:]+)="([^"]*)"/g)].map(attribute => [attribute[1], decodeXml(attribute[2])]))
    if (attributes.Type?.endsWith('/hyperlink') && attributes.Id && attributes.Target) relationships.set(attributes.Id, attributes.Target)
  }
  const links = [...xml.matchAll(/<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>/g)].flatMap(match => {
    const id = /r:id="([^"]+)"/.exec(match[1])?.[1], url = id ? relationships.get(id) : undefined
    const label = [...match[2].matchAll(/<w:t(?: [^>]*)?>(.*?)<\/w:t>/g)].map(textMatch => decodeXml(textMatch[1])).join('')
    return url && label ? [{ label, url }] : []
  })
  return { text, links, linkTargets: links.map(link => link.url) }
}
