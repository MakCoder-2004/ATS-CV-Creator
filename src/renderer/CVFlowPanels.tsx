import { useState, type FormEvent, type RefObject } from 'react'
import { Check, CheckCircle2, Circle, LoaderCircle } from 'lucide-react'
import type { AnalysisResult, GenerationStep } from '../shared/posting-analysis'
import type { DraftRevision } from '../shared/draft'
import { describeSource, readableText } from './review-copy'

const progressSteps: Array<{ id: GenerationStep; label: string; detail: string }> = [
  { id: 'parse-posting', label: 'Parse posting', detail: 'Extract qualifications and keywords' },
  { id: 'score-evidence', label: 'Score evidence', detail: 'Match the role to your saved career facts' },
  { id: 'select-content', label: 'Select content', detail: 'Choose relevant experience and projects' },
  { id: 'tailor-paragraphs', label: 'Tailor paragraphs', detail: 'Write your headline, summary and descriptions' },
  { id: 'verify-claims', label: 'Verify claims', detail: 'Check wording against your saved sources' },
  { id: 'check-document', label: 'Check document', detail: 'Prepare your document and measure its page length' },
]

export function GenerationProgress({ analysis, measuring, onCancel, cancelling }: { analysis: AnalysisResult | null; measuring: boolean; onCancel: () => void; cancelling: boolean }) {
  const completed = new Set(analysis?.completedSteps ?? [])
  if (analysis?.analysis) completed.add('parse-posting')
  // PDF measurement is an actual Electron operation after backend generation, not a timed UI phase.
  const active = measuring ? 'check-document' : analysis?.generationStep
  if (measuring) for (const step of progressSteps.slice(0, -1)) completed.add(step.id)
  const current = progressSteps.find(step => step.id === active)
  return <section className="generation-progress" aria-labelledby="generation-progress-heading">
    <h2 id="generation-progress-heading">Making your experience relevant.</h2>
    <p>Your career facts, tailored to this role. New skills stay visible for review.</p>
    <ol>{progressSteps.map(step => {
      const done = completed.has(step.id) && step.id !== active
      const working = step.id === active
      return <li key={step.id} className={working ? 'is-active' : done ? 'is-complete' : ''}>
        {done ? <CheckCircle2 aria-hidden="true" /> : working ? <LoaderCircle className="generation-spinner" aria-hidden="true" /> : <Circle aria-hidden="true" />}
        <div><strong>{step.label}</strong><span>{done ? 'Completed' : working ? step.detail : 'Waiting'}</span></div>
      </li>
    })}</ol>
    <p role="status" aria-live="polite">{current ? `${current.label}: ${current.detail}.` : 'Preparing your authorized generation.'}{/retry|backoff|429|quota/i.test(analysis?.progress ?? '') ? ' The service is busy. Retrying within your saved limits.' : ''}</p>
    {!measuring && <button type="button" className="secondary-button" disabled={cancelling} onClick={onCancel}>Cancel generation</button>}
  </section>
}

export function SuggestedSkillReview({ draft, busy, onDecision }: { draft: DraftRevision; busy: boolean; onDecision: (id: string, decision: 'pending' | 'confirmed' | 'removed') => Promise<void> }) {
  const suggestions = draft.suggestedSkills ?? []
  if (!suggestions.length) return null
  const pending = suggestions.filter(skill => skill.status === 'pending').length
  return <section className="suggested-skill-review" aria-label="New skills to review">
    <header><div><span>Your decision</span><h2>{pending ? `${pending} new skill${pending === 1 ? '' : 's'} to review` : 'New skills reviewed'}</h2></div><span className="skill-review-count">{pending || <Check aria-hidden="true" />}</span></header>
    <p>These came from the posting, not your saved skills. Confirm only the skills you actually have.</p>
    {suggestions.map(skill => <article key={skill.id}>
      <h3>{skill.name}</h3><p className={skill.status === 'pending' ? 'skill-not-in-profile' : ''}>{skill.status === 'pending' ? 'Not in your profile' : skill.status === 'confirmed' ? 'Confirmed by you · this CV only' : 'Removed from this CV'}</p>
      {skill.status === 'pending' ? <div className="skill-decision-actions"><button className="secondary-button" type="button" aria-label={`Confirm ${skill.name}`} disabled={busy} onClick={() => void onDecision(skill.id, 'confirmed')}><Check size={15} aria-hidden="true" /> I have this skill</button><button className="secondary-button" type="button" aria-label={`Remove ${skill.name}`} disabled={busy} onClick={() => void onDecision(skill.id, 'removed')}>Remove</button></div> : <button type="button" className="inline-action" disabled={busy} onClick={() => void onDecision(skill.id, 'pending')}>Undo decision for {skill.name}</button>}
    </article>)}
    <p>Confirming adds the skill to this CV only. It does not update your profile or insert it into past experience.</p>
  </section>
}

export function TailoringInspector({ selection, draft, jobTitle, busy, headingRef, onReturn, onCorrect }: {
  selection: string; draft: DraftRevision; jobTitle: string; busy: boolean; headingRef: RefObject<HTMLHeadingElement | null>; onReturn: () => void
  onCorrect: (field: 'headline' | 'summary', text: string) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const suggestion = draft.suggestedSkills?.find(skill => `suggested-skills-${skill.id}` === selection)
  const isHeadline = selection === 'tailoring-headline'
  const paragraph = !isHeadline && !suggestion ? draft.tailoring?.summary : undefined
  const text = readableText(suggestion?.name ?? (isHeadline ? draft.tailoring?.headline : paragraph?.text) ?? '')
  const sources = paragraph?.citations.map(citation => describeSource(draft.evidence.find(item => item.evidenceId === citation.evidenceId && item.revision === citation.revision)?.snapshot)) ?? []
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = new FormData(event.currentTarget).get('wording')
    if (typeof value === 'string' && await onCorrect(isHeadline ? 'headline' : 'summary', value)) setEditing(false)
  }
  return <section className="review-inspector-panel" aria-label="Selected wording and sources">
    <h2 ref={headingRef} tabIndex={-1}>Review the wording</h2>
    <button className="secondary-button review-back-button" type="button" onClick={onReturn}>Back to selected wording</button>
    <div className="selected-review"><p className="selected-review-context">{suggestion ? 'Skill confirmed by you' : isHeadline ? 'Target headline' : 'Professional summary'}</p><h3>{suggestion ? suggestion.name : isHeadline ? 'A headline for this application' : 'Your summary'}</h3>
    {!suggestion && <blockquote>{text}</blockquote>}
    {suggestion ? <><p>You confirmed that you have this skill for this CV. It is not a saved profile fact and is not evidence that you used it in a previous role or project.</p><p>Posting term: {suggestion.postingTerm}</p></> : isHeadline ? <><div className="tailoring-source"><strong>Target role</strong><p>{jobTitle}</p></div><p>This headline describes the role you are targeting. Your historical employment titles, organizations and dates are unchanged.</p></> : <><h3>Supporting career facts</h3><ul className="source-list">{sources.map((source, index) => <li key={index}><strong>{source.heading}</strong><details><summary>Read source wording</summary><p>{source.detail}</p></details></li>)}</ul><p className="inclusion-note"><strong>Why it’s here</strong><br />{paragraph?.rationale}</p></>}
    {!suggestion && (!editing ? <button className="secondary-button" type="button" disabled={busy} onClick={() => setEditing(true)}>Edit wording</button> : <form className="selected-edit-form" onSubmit={event => void save(event)}><label>Wording for this CV<textarea name="wording" defaultValue={text} required maxLength={isHeadline ? 160 : 3000} /></label><p>Only rephrase saved facts here. Add new facts to My profile first.</p><div><button className="secondary-button" type="button" onClick={() => setEditing(false)}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>Save wording</button></div></form>)}
    </div>
  </section>
}
