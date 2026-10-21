import { documentSectionNames, splitDocumentBullets, type CanonicalDocument } from '../shared/document'
import type { ReactNode } from 'react'
import type { DraftRevision } from '../shared/draft'

type SkillGroup = 'Languages' | 'Technologies' | 'Concepts'

export function DraftDocument({ document, selectedId, onSelectEntry, approved = false, suggestedSkills = [] }: { document: CanonicalDocument; selectedId?: string; onSelectEntry?: (id: string) => void; approved?: boolean; suggestedSkills?: NonNullable<DraftRevision['suggestedSkills']> }) {
  const pending = onSelectEntry ? suggestedSkills.filter(skill => skill.status === 'pending') : []
  const sections = document.sections.filter(section => section.name !== 'Certificates').map(section => ({ ...section, entries: section.entries }))
  if (pending.length && !sections.some(section => section.name === 'Skills')) { sections.push({ name: 'Skills', entries: [] }); sections.sort((a, b) => documentSectionNames.indexOf(a.name) - documentSectionNames.indexOf(b.name)) }
  const selectable = (id: string, label: string, content: ReactNode) => onSelectEntry ? <button type="button" id={`cv-review-${id}`} className={`paper-entry-select${selectedId === id ? ' is-selected' : ''}`} aria-label={`Review sources for ${label}`} aria-pressed={selectedId === id} onClick={() => onSelectEntry(id)}>{content}</button> : content
  const style = document.style as typeof document.style & { fontFamily: string; pageSize: string }
  const identity = document.identity as typeof document.identity & { email?: string; phone?: string; location?: string; contact?: string[] }
  const contacts = [identity.email, identity.phone, identity.location].filter((value): value is string => !!value)
  return <article className={`paper paper--canonical paper--${style.pageSize.toLowerCase()} paper--${style.fontFamily.toLowerCase()}`} aria-label={approved ? 'Approved CV review layout' : 'Draft CV review layout'}>
    <header className="paper-header"><strong>{document.identity.name}</strong>{(contacts.length ? contacts : identity.contact ?? []).length > 0 && <span>{(contacts.length ? contacts : identity.contact ?? []).join(' | ')}</span>}{document.identity.links.length > 0 && <span>{document.identity.links.map(link => link.label).join(' | ')}</span>}</header>
    {sections.filter(section => section.entries.length || section.name === 'Skills' && pending.length).map(section => <section className={`source-section${section.name === 'Skills' ? ' paper-skills' : ''}`} key={section.name}><h2>{section.name === 'Skills' ? 'Skills' : section.name}</h2>
      {section.name === 'Skills' ? <Skills entries={section.entries} selectable={selectable} pending={pending} /> : section.entries.map(entry => <div className={`draft-paper-entry paper-entry--${section.name.toLowerCase()}`} key={entry.id}>
        {selectable(entry.id, entry.heading, <><span className="draft-locked-facts"><strong>{entry.heading}</strong>{entry.dates && <time>{entry.dates}</time>}</span>{entry.organization && <span className="paper-organization">{entry.organization}</span>}{section.name === 'Projects' && !!entry.technologies?.length && <span className="paper-project-tools"> | <em>{entry.technologies.join(', ')}</em></span>}{section.name !== 'Projects' && !!entry.technologies?.length && <span className="paper-project-tools"><em>{entry.technologies.join(', ')}</em></span>}{entry.text && <span className="paper-bullets">{(entry.bullets ?? splitDocumentBullets(entry.text)).map((bullet, index) => <span className="paper-bullet" key={index}>{bullet}</span>)}</span>}</>)}
        {entry.links.map(link => <a key={link.url} href={link.url}>{link.label}</a>)}
      </div>)}
    </section>)}
  </article>
}

function Skills({ entries, selectable, pending }: { entries: CanonicalDocument['sections'][number]['entries']; selectable: (id: string, label: string, content: ReactNode) => ReactNode; pending: NonNullable<DraftRevision['suggestedSkills']> }) {
  const groups: SkillGroup[] = ['Languages', 'Technologies', 'Concepts']
  const groupOf = (entry: CanonicalDocument['sections'][number]['entries'][number]): SkillGroup => {
    const value = (entry as typeof entry & { skillGroup?: SkillGroup }).skillGroup
    return groups.includes(value as SkillGroup) ? value as SkillGroup : 'Concepts'
  }
  return <>
    {groups.map(group => {
      const items = entries.filter(entry => groupOf(entry) === group)
      const suggestions = group === 'Concepts' ? pending : []
      if (!items.length && !suggestions.length) return null
      return <div className="paper-skill-group" key={group}><strong>{group}</strong><div>{items.map((entry, index) => <span className="paper-skill-item" key={entry.id}>{selectable(entry.id, entry.heading, <span>{entry.heading}</span>)}{index < items.length - 1 || suggestions.length ? ', ' : ''}</span>)}{suggestions.map((skill, index) => <span className="paper-suggested-skill" key={skill.id}><strong>{skill.name}</strong><span>Not in your profile · confirm or remove</span>{index < suggestions.length - 1 ? ', ' : ''}</span>)}</div></div>
    })}
  </>
}
