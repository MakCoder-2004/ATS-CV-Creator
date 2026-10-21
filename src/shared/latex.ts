import { canonicalDocumentSchema, groupedDocumentSkills, splitDocumentBullets, visibleDocumentSections, type CanonicalDocument, type CanonicalDocumentEntry } from './document'

/** All model/profile input is text, never executable TeX. Replacement is single-pass. */
export function escapeLatex(value: string): string {
  const symbols: Record<string, string> = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#', '%': '\\%', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}', '|': '\\textbar{}', '<': '\\textless{}', '>': '\\textgreater{}' }
  return value.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[\\{}$&#%_~^|<>]/g, character => symbols[character]).replace(/[\r\n\t]+/g, ' ')
}
function link(url: string, label: string): string {
  if (!/^(?:https?:\/\/|mailto:)/i.test(url) || /[\s\u0000-\u001f\u007f\\{}]/u.test(url)) throw new Error('A CV link contains characters that cannot be safely compiled. Edit the link in My profile.')
  const target = escapeLatex(new URL(url).href).replaceAll('\\textasciitilde{}', '\\string~')
  return `\\href{${target}}{\\underline{${escapeLatex(label)}}}`
}
const itemList = (entry: CanonicalDocumentEntry, includeLinks = true) => {
  const bullets = entry.bullets?.length ? entry.bullets : splitDocumentBullets(entry.text)
  const items = [...bullets.map(bullet => `    \\resumeItem{${escapeLatex(bullet)}}`), ...(includeLinks && entry.links.length ? [`    \\resumeItem{${entry.links.map(value => link(value.url, value.label)).join(' \\quad ')}}`] : [])]
  return items.length ? `\\resumeItemListStart\n${items.join('\n')}\n\\resumeItemListEnd` : ''
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
        const projectRight = [escapeLatex(entry.dates ?? ''), ...entry.links.map(value => link(value.url, value.label))].filter(Boolean).join(' \\quad ')
        const heading = section.name === 'Projects'
          ? `\\${entry.links.length ? 'resumeLinkedProjectHeading' : 'resumeProjectHeading'}\n    {\\textbf{${escapeLatex(entry.heading)}}${entry.technologies?.length ? ` $|$ \\emph{${entry.technologies.map(escapeLatex).join(', ')}}` : ''}}{${projectRight}}`
          : `\\resumeSubheading\n    {${escapeLatex(entry.organization || entry.heading)}}{${escapeLatex(entry.dates ?? '')}}\n    {${escapeLatex(entry.organization ? entry.heading : '')}}{${escapeLatex(entry.grade ?? '')}}`
        return `${heading}\n${itemList(entry, section.name !== 'Projects')}`
      }).join('\n\n')
      files[`${section.name.toLowerCase()}.tex` as 'education.tex' | 'experience.tex' | 'projects.tex'] = `\\section{${section.name}}\n\\resumeSubHeadingListStart\n\n${entries}\n\n\\resumeSubHeadingListEnd\n`
    }
  }
  return files
}
