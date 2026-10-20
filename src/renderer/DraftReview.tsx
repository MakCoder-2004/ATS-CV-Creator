import type { DraftRevision } from '../shared/draft'

const sections = ['education', 'experience', 'projects', 'skills', 'certificates'] as const
const labels = { education: 'Education', experience: 'Experience', projects: 'Projects', skills: 'Skills', certificates: 'Certificates' } as const

function sourceLabel(draft: DraftRevision, section: typeof sections[number], citations: DraftRevision['content']['experience'][number]['citations']) {
  const ids = citations.map(item => item.evidenceId)
  if (section === 'experience') {
    const item = draft.lockedFields.experience.find(value => (value.sourceIds ?? [value.evidenceId]).some(id => ids.includes(id)))
    return item && <div className="draft-locked-facts"><strong>{item.title}</strong><span>{item.organization}</span><span>{[item.startDate, item.endDate].filter(Boolean).join(' – ')}</span></div>
  }
  if (section === 'education') {
    const item = draft.lockedFields.education.find(value => ids.includes(value.evidenceId))
    return item && <div className="draft-locked-facts"><strong>{item.title}</strong><span>{item.institution}</span><span>{[item.startDate, item.endDate].filter(Boolean).join(' – ')}</span></div>
  }
  if (section === 'projects') {
    const item = draft.lockedFields.projects.find(value => (value.sourceIds ?? [value.evidenceId]).some(id => ids.includes(id)))
    return item && <div className="draft-locked-facts"><strong>{item.name}</strong></div>
  }
  if (section === 'certificates') {
    const item = draft.lockedFields.certificates.find(value => ids.includes(value.evidenceId))
    return item && <div className="draft-locked-facts"><strong>{item.title}</strong><span>{[item.issuer, item.year].filter(Boolean).join(' · ')}</span></div>
  }
  return null
}

export function DraftDocument({ draft }: { draft: DraftRevision }) {
  return <article className="paper" aria-label="Unverified tailored CV draft">
    <header className="paper-header"><strong>{draft.lockedFields.fullName || 'Name not provided'}</strong>{draft.lockedFields.headline && <span>{draft.lockedFields.headline}</span>}</header>
    <div className="paper-rule" aria-hidden="true" />
    {sections.map(section => <section className="source-section" key={section}><h2>{labels[section]}</h2>
      {draft.content[section].map((item, index) => <div className="draft-paper-entry" key={`${section}-${index}`}>
        {sourceLabel(draft, section, item.citations)}
        <p>{'text' in item ? item.text : item.name}</p>
      </div>)}
    </section>)}
  </article>
}

export function DraftEvidenceReview({ draft }: { draft: DraftRevision }) {
  return <section className="inspector draft-offline-review" aria-label="Saved source-linked draft"><h2>Saved draft · unverified and unapproved</h2><p>Available locally. Verification, approval, and export are not available yet.</p>{sections.map(section => <div key={section}><h3>{labels[section]}</h3>{draft.content[section].map((item, index) => <article key={`${section}-${index}`}><p>{'text' in item ? item.text : item.name}</p><small>Evidence revisions: {item.citations.map(citation => `${citation.evidenceId} · r${citation.revision}`).join(', ')}</small><p>{item.rationale}</p></article>)}</div>)}</section>
}
