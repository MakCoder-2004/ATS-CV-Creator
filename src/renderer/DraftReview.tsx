import type { CanonicalDocument } from '../shared/document'
export function DraftDocument({ document, selectedId, onSelectEntry, approved = false }: { document: CanonicalDocument; selectedId?: string; onSelectEntry?: (id: string) => void; approved?: boolean }) {
  return <article className="paper paper--canonical" aria-label={approved ? 'Approved CV preview' : 'Draft CV preview'}>
    <header className="paper-header"><strong>{document.identity.name}</strong>{document.identity.headline && <span>{document.identity.headline}</span>}<span>{document.identity.contact.join(' · ')}</span><span>{document.identity.links.map(link => link.label).join(' · ')}</span></header>
    <div className="paper-rule" aria-hidden="true" />
    {document.sections.map(section => <section className="source-section" key={section.name}><h2>{section.name}</h2>
      {section.entries.map(entry => <div className="draft-paper-entry" key={entry.id}>
        {onSelectEntry ? <button type="button" id={`cv-review-${entry.id}`} className={`paper-entry-select${selectedId === entry.id ? ' is-selected' : ''}`} aria-label={`Review sources for ${entry.heading}`} aria-pressed={selectedId === entry.id} onClick={() => onSelectEntry(entry.id)}><span className="draft-locked-facts"><strong>{entry.heading}</strong>{entry.organization && <span>{entry.organization}</span>}{entry.dates && <time>{entry.dates}</time>}</span><span className="paper-paragraph">{entry.text}</span></button> : <><div className="draft-locked-facts"><strong>{entry.heading}</strong>{entry.organization && <span>{entry.organization}</span>}{entry.dates && <time>{entry.dates}</time>}</div><p>{entry.text}</p></>}
        {entry.links.map(link => <a key={link.url} href={link.url}>{link.label}</a>)}
      </div>)}
    </section>)}
  </article>
}
