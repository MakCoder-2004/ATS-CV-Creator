import { documentSectionNames, documentSectionDisplayName, groupedDocumentSkills, skillGroupFor, skillGroups, splitDocumentBullets, type CanonicalDocument, type CanonicalDocumentEntry } from '../shared/document'
import type { ReactNode } from 'react'
import type { DraftRevision } from '../shared/draft'
import type { MutateDraftRecordInput } from '../shared/draft-records'
import { Plus } from 'lucide-react'

export function DraftDocument({ document, selectedId, onSelectEntry, onAddRecord, recordBusy = false, approved = false, suggestedSkills = [] }: { document: CanonicalDocument; selectedId?: string; onSelectEntry?: (id: string) => void; onAddRecord?: (section: MutateDraftRecordInput['section']) => void; recordBusy?: boolean; approved?: boolean; suggestedSkills?: NonNullable<DraftRevision['suggestedSkills']> }) {
  const pending = onSelectEntry ? suggestedSkills.filter(skill => skill.status === 'pending') : []
  const sections = document.sections.filter(section => section.name !== 'Certificates').map(section => ({ ...section, entries: section.entries }))
  if (pending.length && !sections.some(section => section.name === 'Skills')) { sections.push({ name: 'Skills', entries: [] }); sections.sort((a, b) => documentSectionNames.indexOf(a.name) - documentSectionNames.indexOf(b.name)) }
  if (onAddRecord) for (const name of ['Education', 'Experience', 'Projects', 'Skills'] as const) if (!sections.some(section => section.name === name)) sections.push({ name, entries: [] })
  sections.sort((a, b) => documentSectionNames.indexOf(a.name) - documentSectionNames.indexOf(b.name))
  const selectable = (id: string, label: string, content: ReactNode) => onSelectEntry ? <button type="button" id={`cv-review-${id}`} className={`paper-entry-select${selectedId === id ? ' is-selected' : ''}`} aria-label={`Review sources for ${label}`} aria-pressed={selectedId === id} onClick={() => onSelectEntry(id)}>{content}</button> : content
  const secondaryRow = (entry: CanonicalDocumentEntry) => {
    const row = <span className="paper-organization paper-secondary-row"><em>{entry.organization ? entry.heading : ''}</em>{entry.grade && <em className="paper-grade">{entry.grade}</em>}</span>
    return !entry.text && entry.grade ? selectable(entry.id, entry.heading, row) : row
  }
  return <article className={`paper paper--canonical paper--${document.style.pageSize.toLowerCase()} paper--${document.style.fontFamily.toLowerCase()}`} aria-label={approved ? 'Approved CV review layout' : 'Draft CV review layout'}>
    <header className="paper-header"><strong>{document.identity.name}</strong>{document.identity.contact.length > 0 && <span>{document.identity.contact.join(' | ')}</span>}{document.identity.links.length > 0 && <span>{document.identity.links.map(link => link.label).join(' | ')}</span>}</header>
    {sections.filter(section => onAddRecord || section.entries.length || section.name === 'Skills' && pending.length).map(section => <section className={`source-section${section.name === 'Skills' ? ' paper-skills' : ''}`} key={section.name}><div className="paper-section-heading"><h2>{documentSectionDisplayName(section.name)}</h2>{onAddRecord && section.name !== 'Certificates' && <button id={`add-record-${section.name.toLowerCase()}`} className="paper-add-record" type="button" disabled={recordBusy} onClick={() => onAddRecord(section.name.toLowerCase() as MutateDraftRecordInput['section'])}><Plus size={14} aria-hidden="true" />Add {section.name === 'Skills' ? 'skill' : section.name === 'Projects' ? 'project' : section.name.toLowerCase()}</button>}</div>{!section.entries.length && !(section.name === 'Skills' && pending.length) && onAddRecord && <p className="paper-section-empty">No {section.name.toLowerCase()} in this CV yet.</p>}
      {section.name === 'Skills' ? <Skills entries={section.entries} selectable={selectable} pending={pending} /> : section.entries.map(entry => <div className={`draft-paper-entry paper-entry--${section.name.toLowerCase()}`} key={entry.id}>
        <span className="draft-locked-facts"><span>{onSelectEntry ? <button className="paper-heading-select" type="button" aria-label={`Select ${entry.heading} record`} onClick={() => onSelectEntry(entry.id)}><strong>{section.name === 'Projects' ? entry.heading : entry.organization || entry.heading}</strong></button> : <strong>{section.name === 'Projects' ? entry.heading : entry.organization || entry.heading}</strong>}{section.name === 'Projects' && !!entry.technologies?.length && <span className="paper-project-tools"> | <em>{entry.technologies.join(', ')}</em></span>}</span><span className="paper-heading-meta">{entry.dates && <time>{entry.dates}</time>}{section.name === 'Projects' && entry.links.map(link => <a key={link.url} href={link.url}>{link.label}</a>)}</span></span>{section.name !== 'Projects' && (entry.organization || entry.grade) && secondaryRow(entry)}
        {entry.reviewItems?.length ? entry.reviewItems.map(item => selectable(item.id, entry.heading, <span className="paper-bullets">{item.bullets.map((bullet, index) => <span className="paper-bullet" key={index}>{bullet}</span>)}</span>)) : entry.text ? selectable(entry.id, entry.heading, <span className="paper-bullets">{(entry.bullets ?? splitDocumentBullets(entry.text)).map((bullet, index) => <span className="paper-bullet" key={index}>{bullet}</span>)}</span>) : null}
        {section.name !== 'Projects' && entry.links.map(link => <a key={link.url} href={link.url}>{link.label}</a>)}
      </div>)}
    </section>)}
  </article>
}

function Skills({ entries, selectable, pending }: { entries: CanonicalDocument['sections'][number]['entries']; selectable: (id: string, label: string, content: ReactNode) => ReactNode; pending: NonNullable<DraftRevision['suggestedSkills']> }) {
  const groups = groupedDocumentSkills(entries)
  return <>{skillGroups.map(group => {
    const items = groups.find(value => value.name === group)?.entries ?? []
    const suggestions = pending.filter(skill => skillGroupFor(skill.name) === group)
    if (!items.length && !suggestions.length) return null
    return <div className="paper-skill-group" key={group}><strong>{group}:</strong><div>{items.map((entry, index) => <span className="paper-skill-item" key={entry.id}>{selectable(entry.id, entry.heading, <span>{entry.heading}</span>)}{index < items.length - 1 || suggestions.length ? ', ' : ''}</span>)}{suggestions.map((skill, index) => <span className="paper-suggested-skill" key={skill.id}><strong>{skill.name}</strong><span>Not in your profile · confirm or remove</span>{index < suggestions.length - 1 ? ', ' : ''}</span>)}</div></div>
  })}</>
}
