import { documentSectionNames, splitDocumentBullets, type CanonicalDocument } from '../shared/document'
import type { ReactNode } from 'react'
import type { DraftRevision } from '../shared/draft'

export function DraftDocument({ document, selectedId, onSelectEntry, approved = false, suggestedSkills = [], reviewTailoring = false }: { reviewTailoring?: boolean; document: CanonicalDocument; selectedId?: string; onSelectEntry?: (id: string) => void; approved?: boolean; suggestedSkills?: NonNullable<DraftRevision['suggestedSkills']> }) {
  const pending = onSelectEntry ? suggestedSkills.filter(skill => skill.status === 'pending') : []
  const sections = [...document.sections]
  if (pending.length && !sections.some(section => section.name === 'Skills')) { sections.push({ name: 'Skills', entries: [] }); sections.sort((a, b) => documentSectionNames.indexOf(a.name) - documentSectionNames.indexOf(b.name)) }
  const selectable = (id: string, label: string, content: ReactNode) => onSelectEntry ? <button type="button" id={`cv-review-${id}`} className={`paper-entry-select${selectedId === id ? ' is-selected' : ''}`} aria-label={`Review sources for ${label}`} aria-pressed={selectedId === id} onClick={() => onSelectEntry(id)}>{content}</button> : content
  return <article className="paper paper--canonical" aria-label={approved ? 'Approved CV preview' : 'Draft CV preview'}>
    <header className="paper-header"><strong>{document.identity.name}</strong>{document.identity.headline && (reviewTailoring ? selectable('tailoring-headline', 'target headline', <span className="paper-target-headline">{document.identity.headline}</span>) : <span className="paper-target-headline">{document.identity.headline}</span>)}<span>{document.identity.contact.join(' | ')}</span><span>{document.identity.links.map(link => link.label).join(' | ')}</span></header>
    {document.identity.summary && <section className="source-section paper-summary"><h2>Professional summary</h2>{selectable('tailoring-summary', 'professional summary', <span className="paper-paragraph">{document.identity.summary}</span>)}</section>}
    {sections.filter(section => section.entries.length || section.name === 'Skills' && pending.length).map(section => <section className={`source-section${section.name === 'Skills' ? ' paper-skills' : ''}`} key={section.name}><h2>{section.name === 'Skills' ? 'Technical skills' : section.name}</h2>
      {section.entries.map(entry => <div className="draft-paper-entry" key={entry.id}>
        {selectable(entry.id, entry.heading, <><span className="draft-locked-facts"><strong>{entry.heading}</strong>{entry.dates && <time>{entry.dates}</time>}</span>{entry.organization && <span className="paper-organization">{entry.organization}</span>}{entry.technologies?.length ? <span className="paper-project-tools">{entry.technologies.join(', ')}</span> : null}{entry.text && <span className="paper-bullets">{(entry.bullets ?? splitDocumentBullets(entry.text)).map((bullet, index) => <span className="paper-bullet" key={index}>{bullet}</span>)}</span>}</>)}
        {entry.links.map(link => <a key={link.url} href={link.url}>{link.label}</a>)}
      </div>)}
      {section.name === 'Skills' && pending.map(skill => <div className="paper-suggested-skill" key={skill.id}><strong>{skill.name}</strong><span>Not in your profile · confirm or remove</span></div>)}
    </section>)}
  </article>
}
