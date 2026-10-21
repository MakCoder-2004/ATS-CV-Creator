import type { Dispatch, FormEvent, RefObject, SetStateAction } from 'react'
import type { CanonicalDocument } from '../shared/document'
import type { DraftRevision } from '../shared/draft'
import { readableText } from './review-copy'

type Section = keyof DraftRevision['content']
type DraftItem = DraftRevision['content'][Section][number]
type Entry = CanonicalDocument['sections'][number]['entries'][number]
type Source = { heading: string; detail: string }

export function SelectedReview({ selection, item, entry, sources, draft, editing, setEditing, onSave, onImprove, onReturnToDocument, headingRef, busy }: {
  selection: { section: Section; index: number } | null
  item: DraftItem | null | undefined
  entry: Entry | undefined
  sources: Source[]
  draft: DraftRevision
  editing: boolean
  setEditing: Dispatch<SetStateAction<boolean>>
  onSave: (section: Section, index: number, text: string) => Promise<boolean>
  onImprove: (section: Section, index: number) => void
  onReturnToDocument: () => void
  headingRef: RefObject<HTMLHeadingElement | null>
  busy: boolean
}) {
  const coverage = draft.coverage
  const selectedText = item ? ('text' in item ? readableText(item.text) : readableText(item.name)) : ''
  const displayedText = readableText(entry?.text) || selectedText
  const heading = entry?.heading || (selection ? `${selection.section[0].toUpperCase()}${selection.section.slice(1)}` : '')
  const rationale = item ? readableText(item.rationale) : ''

  function saveWording(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selection) return
    const text = new FormData(event.currentTarget).get('wording')
    if (typeof text === 'string') void onSave(selection.section, selection.index, text).then(saved => { if (saved) setEditing(false) })
  }

  return <section className="review-inspector-panel" aria-label="Selected wording and sources">
    <h2 ref={headingRef} tabIndex={-1}>Review the wording</h2>
    {selection && <button type="button" className="secondary-button review-back-button" onClick={onReturnToDocument}>Back to selected wording</button>}
    {selection && item ? <div className="selected-review">
      <p className="selected-review-context">{selection.section[0].toUpperCase()}{selection.section.slice(1)}</p>
      <h3 aria-live="polite">{heading}</h3>
      {displayedText && displayedText !== heading && <blockquote>{displayedText}</blockquote>}
      <h3>Supporting career facts</h3>
      {sources.length ? <ul className="source-list">{sources.map((source, index) => <li key={`${item.citations[index]?.evidenceId}-${index}`}><strong>{source.heading}</strong>{source.detail && <details><summary>Read source wording</summary><p>{source.detail}</p></details>}</li>)}</ul> : <p>No saved source is linked. Check this wording before approval.</p>}
      {rationale && <p className="inclusion-note"><strong>Why it's here</strong><br />{rationale}</p>}
      {!editing ? <div className="selected-review-actions"><button className="secondary-button" type="button" onClick={() => setEditing(true)}>Edit wording</button><button className="secondary-button" type="button" disabled={busy} onClick={() => onImprove(selection.section, selection.index)}>Suggest different wording</button></div> : <form className="selected-edit-form" onSubmit={saveWording}><label>Wording for this CV<textarea key={`${draft.id}-${selection.section}-${selection.index}`} name="wording" defaultValue={selectedText} required maxLength={3000} /></label><p>Only rephrase saved facts here. Add new facts to My profile first.</p><div><button className="secondary-button" type="button" onClick={() => setEditing(false)}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>Save wording</button></div></form>}
    </div> : <p className="review-empty">Your CV is ready to review. Add saved career facts before approving it, or select wording on the page to inspect its sources.</p>}
    <details className="coverage-disclosure"><summary>How your experience matches this job</summary><p>Automated checks can miss mistakes. Read each statement alongside its saved career facts.</p>{coverage ? <div><p>{coverage.supportedMatches.length} supported match{coverage.supportedMatches.length === 1 ? '' : 'es'} · {coverage.gaps.length} gap{coverage.gaps.length === 1 ? '' : 's'}. Gaps are suggestions, not approval blockers.</p>{coverage.supportedMatches.length > 0 && <><h3>Supported matches</h3><ul>{coverage.supportedMatches.map((match, index) => <li key={`${match.qualification}-${index}`}>{match.qualification} — supported by saved facts</li>)}</ul></>}{coverage.gaps.length > 0 && <><h3>Qualifications to consider</h3><ul>{coverage.gaps.map((gap, index) => <li key={`${gap.qualification}-${index}`}>{gap.qualification} — not found in your saved facts</li>)}</ul></>}</div> : <p>Job comparison will appear after your CV is created.</p>}</details>
  </section>
}
