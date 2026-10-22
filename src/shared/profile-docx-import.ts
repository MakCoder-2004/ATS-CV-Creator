import { mapProfilePdfPages, type ProfilePdfProposalDraft } from './profile-pdf-import'

export type ProfileDocxParagraph = { text: string; links: Array<{ label: string; url: string }> }
export type ProfileDocxPage = { page: number; text: string; paragraphs: ProfileDocxParagraph[] }

/** Keep links beside their actual Word paragraph; ambiguous targets stay visible but unmapped. */
export function mapProfileDocxPages(pages: ProfileDocxPage[]): ProfilePdfProposalDraft {
  const sourcePassages = new Map<string, string[]>()
  const mapped = mapProfilePdfPages(pages.map(page => {
    const lines: string[] = []
    let activeSection = '', inProject = false, contactEvidence = false
    const paragraphs = page.paragraphs
    for (let index = 0; index < paragraphs.length; index++) {
      const paragraph = paragraphs[index]
      const text = paragraph.text.trim()
      if (!text && !paragraph.links.length) continue
      const header = text.match(/^([A-Z][A-Z ]{2,}):\s*(.*)$/)
      const key = header?.[1].trim().toLowerCase()
      if (key === 'project') {
        if (activeSection !== 'projects') lines.push('PROJECTS:')
        activeSection = 'projects'; inProject = true
      } else if (key && ['experience', 'employment', 'work experience', 'training', 'education', 'skills', 'technical skills', 'programming languages', 'tools', 'concepts', 'summary', 'certificates', 'spoken languages', 'languages'].includes(key)) {
        activeSection = key
        inProject = false
      } else if (key === 'projects') {
        activeSection = 'projects'; inProject = false
      }
      lines.push(text)
      if (!activeSection && (/(?:^|\b)NAME\s*:/i.test(text) || /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(text) || /^CONTACT LINK\s*:/i.test(text))) contactEvidence = true
      for (const link of paragraph.links) {
        const explicitContact = /^CONTACT LINK\s*:/i.test(text)
        const destination = `label=${link.label} | target=${link.url}`
        let marker: string
        if (explicitContact || (!activeSection && contactEvidence)) marker = `CONTACT LINK: ${link.label} | ${link.url}`
        else if (inProject) marker = `PROJECT LINK: ${link.label} | ${link.url}`
        else marker = `UNMAPPED LINK: DOCX hyperlink ${destination} | paragraph: ${text || '(empty paragraph)'}`
        lines.push(marker)
        if (marker.startsWith('CONTACT LINK:') || marker.startsWith('PROJECT LINK:')) {
          const passages = sourcePassages.get(marker) ?? []
          passages.push(`${text || '(empty paragraph)'} [hyperlink ${destination}]`)
          sourcePassages.set(marker, passages)
        }
      }
    }
    return { page: page.page, text: lines.join('\n'), links: [] }
  }))
  const used = new Map<string, number>()
  mapped.sources = mapped.sources.map(source => {
    const passages = sourcePassages.get(source.passage)
    if (!passages) return source
    const index = used.get(source.passage) ?? 0
    used.set(source.passage, index + 1)
    return { ...source, passage: passages[index] ?? source.passage }
  })
  return mapped
}
