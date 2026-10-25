import { canonicalDocumentSchema, groupedDocumentSkills, splitDocumentBullets, visibleDocumentSections, type CanonicalDocument, type CanonicalDocumentEntry } from './document'

/** All model/profile input is text, never executable TeX. Replacement is single-pass. */
export function escapeLatex(value: string): string {
  const symbols: Record<string, string> = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#', '%': '\\%', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}', '|': '\\textbar{}', '<': '\\textless{}', '>': '\\textgreater{}' }
  return value.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[\\{}$&#%_~^|<>]/g, character => symbols[character]).replace(/[\r\n\t]+/g, ' ')
}
function breakableUnderline(label: string): string {
  const graphemes = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(label)].map(part => part.segment)
  const chunks: string[] = []
  for (let start = 0; start < graphemes.length;) {
    let end = Math.min(start + 16, graphemes.length)
    if (end < graphemes.length) {
      for (let boundary = end; boundary > start + 8; boundary--) {
        if (/[\/._-]/u.test(graphemes[boundary - 1])) { end = boundary; break }
      }
    }
    chunks.push(graphemes.slice(start, end).join(''))
    start = end
  }
  return chunks.map(chunk => `\\underline{${escapeLatex(chunk)}}`).join('\\allowbreak')
}
function link(url: string, label: string, wrappable = false): string {
  if (!/^(?:https?:\/\/|mailto:)/i.test(url) || /[\s\u0000-\u001f\u007f\\{}]/u.test(url)) throw new Error('A CV link contains characters that cannot be safely compiled. Edit the link in My profile.')
  const target = escapeLatex(new URL(url).href).replaceAll('\\textasciitilde{}', '\\string~')
  return `\\href{${target}}{${wrappable ? breakableUnderline(label) : `\\underline{${escapeLatex(label)}}`}}`
}
const itemList = (entry: CanonicalDocumentEntry, includeLinks = true) => {
  if (!entry.reviewItems?.length || entry.reviewItems.every(item => (item.descriptionFormat ?? 'bullets') === (entry.descriptionFormat ?? 'bullets'))) {
    if (entry.descriptionFormat === 'paragraph') return entry.text ? `\\resumeParagraphStart\\small{${escapeLatex(entry.text)}}\\par${includeLinks && entry.links.length ? `\n${entry.links.map(value => link(value.url, value.label)).join(' \\quad ')}` : ''}` : ''
    const bullets = entry.bullets?.length ? entry.bullets : splitDocumentBullets(entry.text)
    const items = [...bullets.map(bullet => `    \\resumeItem{${escapeLatex(bullet)}}`), ...(includeLinks && entry.links.length ? [`    \\resumeItem{${entry.links.map(value => link(value.url, value.label)).join(' \\quad ')}}`] : [])]
    return items.length ? `\\resumeItemListStart\n${items.join('\n')}\n\\resumeItemListEnd` : ''
  }
  const renderDescription = (text: string, bullets: string[], format?: 'paragraph' | 'bullets') => {
    if (format === 'paragraph') return text ? `\\resumeParagraphStart\\small{${escapeLatex(text)}}\\par` : ''
    const items = bullets.map(bullet => `    \\resumeItem{${escapeLatex(bullet)}}`)
    return items.length ? `\\resumeItemListStart\n${items.join('\n')}\n\\resumeItemListEnd` : ''
  }
  const descriptions = entry.reviewItems?.length
    ? entry.reviewItems.map(item => renderDescription(item.text, item.bullets, item.descriptionFormat)).filter(Boolean)
    : [renderDescription(entry.text, entry.bullets?.length ? entry.bullets : splitDocumentBullets(entry.text), entry.descriptionFormat)].filter(Boolean)
  if (includeLinks && entry.links.length) descriptions.push(`\\resumeItemListStart\n    \\resumeItem{${entry.links.map(value => link(value.url, value.label)).join(' \\quad ')}}\n\\resumeItemListEnd`)
  return descriptions.join('\n')
}
/** File names and commands are application-owned; only macro argument text varies. */
export function renderLatexSections(input: CanonicalDocument): Record<'heading.tex' | 'education.tex' | 'experience.tex' | 'projects.tex' | 'skills.tex', string> {
  const document = canonicalDocumentSchema.parse(input)
  const contact: string[] = []
  if (document.identity.phone) contact.push(`\\seticon{faPhone} \\ \\small ${escapeLatex(document.identity.phone)}`)
  if (document.identity.email) contact.push(`\\href{mailto:${escapeLatex(document.identity.email)}}{\\seticon{faEnvelope} \\ \\underline{${escapeLatex(document.identity.email)}}}`)
  // Legacy fixtures/documents have only the contact list. New documents always carry typed fields.
  if (!document.identity.phone && !document.identity.email) contact.push(...document.identity.contact.map(value => `\\small ${escapeLatex(value)}`))
  for (const value of document.identity.links) {
    const host = new URL(value.url).hostname.toLowerCase()
    const icon = /(^|\.)linkedin\.com$/.test(host) ? 'faLinkedin' : /(^|\.)github\.com$/.test(host) ? 'faGithub' : 'faGlobe'
    contact.push(`\\seticon{${icon}} \\ ${link(value.url, value.label)}`)
  }
  const files = { 'heading.tex': `\\begin{center}\n    \\textbf{\\Huge \\scshape ${escapeLatex(document.identity.name)}} \\\\ \\vspace{1pt}\n    ${contact.join(' \\quad\n    ')}\n\\end{center}\n`, 'education.tex': '', 'experience.tex': '', 'projects.tex': '', 'skills.tex': '' }
  for (const section of visibleDocumentSections(document)) {
    if (section.name === 'Skills') {
      const groups = groupedDocumentSkills(section.entries).map(group => `        \\textbf{${group.name}}{: ${group.entries.map(entry => escapeLatex(entry.heading)).join(', ')}}`).join(' \\\\\n')
      files['skills.tex'] = `\\section{Technical Skills}\n\\begin{itemize}[leftmargin=0.15in, label={}]\n    \\small{\\item{\n${groups}\n    }}\n\\end{itemize}\n`
    } else {
      const entries = section.entries.map(entry => {
        const paragraphFormat = entry.descriptionFormat === 'paragraph' || entry.reviewItems?.some(item => item.descriptionFormat === 'paragraph')
        const projectRight = section.name === 'Projects'
          ? [escapeLatex(entry.dates ?? ''), ...entry.links.map(value => link(value.url, value.label))].filter(Boolean).join(' \\quad ')
          : ''
        const paragraphProjectRight = [escapeLatex(entry.dates ?? ''), ...entry.links.map(value => link(value.url, value.label, true))].filter(Boolean).join(' \\quad ')
        const projectMacro = entry.links.length ? paragraphFormat ? 'resumeParagraphLinkedProjectHeading' : 'resumeLinkedProjectHeading' : 'resumeProjectHeading'
        const heading = section.name === 'Projects'
          ? `\\${projectMacro}\n    {\\textbf{${escapeLatex(entry.heading)}}${entry.technologies?.length ? ` $|$ \\emph{${entry.technologies.map(escapeLatex).join(', ')}}` : ''}}{${paragraphFormat ? paragraphProjectRight : projectRight}}`
          : `\\resumeSubheading\n    {${escapeLatex(entry.organization || entry.heading)}}{${escapeLatex(entry.dates ?? '')}}\n    {${escapeLatex(entry.organization ? entry.heading : '')}}{${escapeLatex(entry.grade ?? '')}}`
        return `${heading}\n${itemList(entry, section.name !== 'Projects')}`
      }).join('\n\n')
      files[`${section.name.toLowerCase()}.tex` as 'education.tex' | 'experience.tex' | 'projects.tex'] = `\\section{${section.name}}\n\\resumeSubHeadingListStart\n\n${entries}\n\n\\resumeSubHeadingListEnd\n`
    }
  }
  return files
}
