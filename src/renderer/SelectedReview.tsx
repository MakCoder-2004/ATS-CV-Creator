import type { Dispatch, FormEvent, RefObject, SetStateAction } from 'react'
import type { CanonicalDocument } from '../shared/document'
import type { DraftRevision } from '../shared/draft'
import { readableText } from './review-copy'

type Section = keyof DraftRevision['content']
type DraftItem = DraftRevision['content'][Section][number]
type Entry = CanonicalDocument['sections'][number]['entries'][number]
type Source = { heading: string; detail: string }

export function SelectedReview({ selection, item, entry, sources, draft, editing, setEditing, onSave, onImprove, onEditRecord, onRemoveRecord, onReturnToDocument, headingRef, busy }: {
  selection: { section: Section; index: number } | null
  item: DraftItem | null | undefined
  entry: Entry | undefined
  sources: Source[]
  draft: DraftRevision
  editing: boolean
  setEditing: Dispatch<SetStateAction<boolean>>
  onSave: (section: Section, index: number, text: string) => Promise<boolean>
  onImprove: (section: Section, index: number) => void
  onEditRecord: (section: Section, index: number) => void
  onRemoveRecord: (section: Section, index: number) => void
  onReturnToDocument: () => void
  headingRef: RefObject<HTMLHeadingElement | null>
  busy: boolean
}) {
  const manual = item?.citations.some(citation => draft.evidence.find(source => source.evidenceId === citation.evidenceId && source.revision === citation.revision)?.provenance === 'manual')
  const selectedText = item ? ('text' in item ? readableText(item.text) : readableText(item.name)) : ''
  const displayedText = readableText(entry?.text) || selectedText
  const heading = entry?.heading || (selection ? `${selection.section[0].toUpperCase()}${selection.section.slice(1)}` : '')
  const rationale = item ? readableText(item.rationale) : ''
  const generationFailed = draft.checkReport?.findings.some(finding => finding.itemPath === 'generation') ?? false

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
      <div className="selected-record-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => onEditRecord(selection.section, selection.index)}>Edit record</button><button type="button" className="inline-action record-remove-link" disabled={busy} onClick={() => onRemoveRecord(selection.section, selection.index)}>Remove record</button></div>
      <h3>{manual ? 'Your manual career facts' : 'Supporting career facts'}</h3>
      {manual && <p>Added by you for this CV. This record is not saved in My profile.</p>}
      {sources.length ? <ul className="source-list">{sources.map((source, index) => <li key={`${item.citations[index]?.evidenceId}-${index}`}><strong>{source.heading}</strong>{source.detail && <details><summary>Read source wording</summary><p>{source.detail}</p></details>}</li>)}</ul> : <p>No saved source is linked. Check this wording before approval.</p>}
      {rationale && <p className="inclusion-note"><strong>Why it's here</strong><br />{rationale}</p>}
      {!editing ? <div className="selected-review-actions"><button className="secondary-button" type="button" onClick={() => setEditing(true)}>Edit wording</button><button className="secondary-button" type="button" disabled={busy} onClick={() => onImprove(selection.section, selection.index)}>Suggest different wording</button></div> : <form className="selected-edit-form" onSubmit={saveWording}><label>Wording for this CV<textarea key={`${draft.id}-${selection.section}-${selection.index}`} name="wording" defaultValue={selectedText} required maxLength={3000} /></label><p>Use this to rephrase existing facts. To change the record's facts or details, choose Edit record.</p><div><button className="secondary-button" type="button" onClick={() => setEditing(false)}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>Save wording</button></div></form>}
    </div> : generationFailed ? <p className="review-empty" role="status">The suggested wording could not be validated, so no CV wording was created. Review the issue under Checks &amp; options, then create another CV or add wording from saved career facts.</p> : <p className="review-empty">Your CV is ready to review. Add saved career facts before approving it, or select wording on the page to inspect its sources.</p>}
  </section>
}
