import type { CanonicalDocument } from '../shared/document'
import type { DraftRevision } from '../shared/draft'

const labels = { education: 'Education', experience: 'Experience', projects: 'Projects', skills: 'Skills', certificates: 'Certificates' } as const

export function DraftDocument({ document }: { document: CanonicalDocument }) {
  return <article className="paper paper--canonical" aria-label="Unapproved canonical CV preview">
    <header className="paper-header"><strong>{document.identity.name}</strong>{document.identity.headline && <span>{document.identity.headline}</span>}<span>{document.identity.contact.join(' · ')}</span><span>{document.identity.links.map(link => link.label).join(' · ')}</span></header>
    <div className="paper-rule" aria-hidden="true" />
    {document.sections.map(section => <section className="source-section" key={section.name}><h2>{section.name}</h2>
      {section.entries.map(entry => <div className="draft-paper-entry" key={entry.id}>
        <div className="draft-locked-facts"><strong>{entry.heading}</strong>{entry.organization && <span>{entry.organization}</span>}{entry.dates && <time>{entry.dates}</time>}</div>
        <p>{entry.text}</p>
        {entry.links.map(link => <a key={link.url} href={link.url}>{link.label}</a>)}
      </div>)}
    </section>)}
  </article>
}

export function DraftEvidenceReview({ draft }: { draft: DraftRevision }) {
  return <section className="inspector draft-offline-review" aria-label="Saved source-linked draft"><h2>Saved draft · unverified and unapproved</h2><p>Available locally. Verification, approval, and export are not available yet.</p>{(['education', 'experience', 'projects', 'skills', 'certificates'] as const).map(section => <div key={section}><h3>{labels[section]}</h3>{draft.content[section].map((item, index) => <article key={`${section}-${index}`}><p>{'text' in item ? item.text : item.name}</p><small>Evidence revisions: {item.citations.map(citation => `${citation.evidenceId} · r${citation.revision}`).join(', ')}</small><p>{item.rationale}</p></article>)}</div>)}</section>
}
