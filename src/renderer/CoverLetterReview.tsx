import { useRef, useState, useLayoutEffect } from 'react'
import type { CoverLetterRevision } from '../shared/cover-letter'
import type { CanonicalCoverLetter } from '../shared/cover-letter-document'
import { advanceReviewVisit, canBeginParagraphEdit, canBeginRecipientEdit, canSaveParagraphEdit, canSaveRecipientEdit } from './cover-letter-review-state'
import type { EditSession } from './cover-letter-review-state'
import './cover-letter-review.css'

export type CoverLetterCheckStatus = 'idle' | 'pending' | 'passed' | 'issues' | 'error'
export type CoverLetterFitStatus = 'idle' | 'pending' | 'passed' | 'issues' | 'error'
export type CoverLetterReadiness = { canApprove: boolean; reason?: string }
export type CoverLetterActionInput = { jobId: string; letterId: string }
export type CoverLetterParagraphEditInput = CoverLetterActionInput & { paragraphId: string; text: string }
export type CoverLetterRecipientInput = CoverLetterActionInput & { recipient: string | null }
type LocalState = { identity: string; paragraphId?: string; text?: string; recipient?: string; error?: string; pending?: boolean }

export type CoverLetterReviewProps = {
  jobId: string
  originatingCvRevisionId: string | null
  letter: CoverLetterRevision | null
  canonical: CanonicalCoverLetter | null
  checkStatus: CoverLetterCheckStatus
  fitStatus: CoverLetterFitStatus
  readiness: CoverLetterReadiness
  message?: string | null
  busy: boolean
  onSaveParagraph: (input: CoverLetterParagraphEditInput) => Promise<void>
  onSaveRecipient: (input: CoverLetterRecipientInput) => Promise<void>
  onAcknowledge: (input: CoverLetterActionInput & { paragraphId: string; acknowledged: true }) => Promise<void>
  onCheck: (input: CoverLetterActionInput) => Promise<void>
  onMeasureFit: (input: CoverLetterActionInput) => Promise<void>
  onApprove: (input: CoverLetterActionInput) => Promise<void>
}

const statusLabel: Record<CoverLetterCheckStatus, string> = {
  idle: 'Not checked', pending: 'Check pending', passed: 'No known issues', issues: 'Issues need review', error: 'Check failed',
}
const fitLabel: Record<CoverLetterFitStatus, string> = {
  idle: 'Not measured', pending: 'Fit check pending', passed: 'Fits one page', issues: 'Fit needs review', error: 'Fit check failed',
}

export function CoverLetterReview(props: CoverLetterReviewProps) {
  const { jobId, originatingCvRevisionId, letter, canonical, readiness, busy } = props
  const identity = letter ? `${jobId}:${letter.id}:${letter.revision}:${originatingCvRevisionId ?? 'missing'}` : `${jobId}:missing:${originatingCvRevisionId ?? 'missing'}`
  const visit = useRef({ identity, epoch: 0 })
  visit.current = advanceReviewVisit(visit.current, identity)
  const visitKey = `${identity}@${visit.current.epoch}`
  const currentIdentity = useRef(visitKey)
  currentIdentity.current = visitKey
  const actionBarRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const bar = actionBarRef.current
    if (!bar || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const height = bar.getBoundingClientRect().height
      if (height) (bar.closest('.cover-letter-review') as HTMLElement | null)?.style.setProperty('--cover-letter-review-bar-height', `${Math.ceil(height)}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [])
  const [local, setLocal] = useState<LocalState | null>(null)
  const localState = local?.identity === visitKey ? local : null
  const [editingId, setEditingId] = useState<{ identity: string; paragraphId: string } | null>(null)
  const activeEdit = editingId?.identity === visitKey ? editingId.paragraphId : null
  const saveParagraphText = localState?.paragraphId === activeEdit ? localState.text : undefined
  const recipientDraft = localState?.recipient ?? letter?.recipient ?? ''
  const recipientSession = localState?.recipient !== undefined
  const recipientDirty = Boolean(letter && recipientSession && localState?.recipient?.trim() !== (letter.recipient ?? ''))
  const editSession: EditSession = activeEdit ? { kind: 'paragraph', paragraphId: activeEdit } : localState?.recipient !== undefined ? { kind: 'recipient' } : null
  const unsavedEdit = Boolean(activeEdit || recipientDirty)
  const pending = busy || Boolean(localState?.pending)
  const mismatch = Boolean(letter && (letter.jobId !== jobId || !originatingCvRevisionId || letter.cvRevisionId !== originatingCvRevisionId || !canonical || canonical.jobId !== jobId || canonical.sourceRevisionId !== letter.id || canonical.revision !== letter.revision || canonical.paragraphs.length !== letter.paragraphs.length || canonical.paragraphs.some((text, index) => text !== letter.paragraphs[index]?.text)))
  const boundLetter = letter && !mismatch ? letter : null
  const boundCanonical = boundLetter && canonical ? canonical : null
  const sourceByOrdinal = new Map((boundLetter?.bindings.sources ?? []).map(source => [source.ordinal, source]))
  const acknowledgedCount = boundLetter?.paragraphs.filter(paragraph => Boolean(boundLetter.acknowledgments[paragraph.id])).length ?? 0
  const actionInput = boundLetter ? { jobId, letterId: boundLetter.id } : null

  const saveParagraph = async (paragraphId: string, fallback: string) => {
    if (!actionInput || pending || !canSaveParagraphEdit(editSession, paragraphId) || recipientDirty) return
    const expectedIdentity = visitKey
    const text = local?.identity === expectedIdentity && local.paragraphId === paragraphId ? local.text ?? fallback : fallback
    setLocal({ identity: expectedIdentity, paragraphId, text, pending: true })
    try {
      await props.onSaveParagraph({ ...actionInput, paragraphId, text })
      if (currentIdentity.current === expectedIdentity) {
        setEditingId(null)
        setLocal(null)
      }
    } catch (error) {
      if (currentIdentity.current === expectedIdentity) setLocal({ identity: expectedIdentity, paragraphId, text, error: error instanceof Error ? error.message : 'The wording could not be saved. Your text is still here.' })
    }
  }

  const saveRecipient = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!actionInput || pending || !canSaveRecipientEdit(editSession)) return
    const expectedIdentity = visitKey
    const recipient = recipientDraft.trim() || null
    setLocal({ identity: expectedIdentity, recipient: recipientDraft, pending: true })
    try {
      await props.onSaveRecipient({ ...actionInput, recipient })
      if (currentIdentity.current === expectedIdentity) setLocal(null)
    } catch (error) {
      if (currentIdentity.current === expectedIdentity) setLocal({ identity: expectedIdentity, recipient: recipientDraft, error: error instanceof Error ? error.message : 'The recipient could not be saved. Your entry is still here.' })
    }
  }

  const invoke = async (callback: (input: CoverLetterActionInput) => Promise<void>) => {
    if (!actionInput || pending || unsavedEdit) return
    const expectedIdentity = visitKey
    if (currentIdentity.current !== expectedIdentity) return
    setLocal(previous => ({ ...(previous?.identity === expectedIdentity ? previous : { identity: expectedIdentity }), pending: true, error: undefined }))
    try {
      await callback(actionInput)
      if (currentIdentity.current === expectedIdentity) setLocal(previous => previous?.identity === expectedIdentity ? { ...previous, pending: false, error: undefined } : null)
    } catch (error) {
      if (currentIdentity.current === expectedIdentity) setLocal(previous => ({ ...(previous?.identity === expectedIdentity ? previous : { identity: expectedIdentity }), pending: false, error: error instanceof Error ? error.message : 'The requested review action could not be completed.' }))
    }
  }

  const acknowledge = async (paragraphId: string, letterId: string) => {
    const expectedIdentity = visitKey
    if (pending || unsavedEdit || currentIdentity.current !== expectedIdentity) return
    setLocal(previous => ({ ...(previous?.identity === expectedIdentity ? previous : { identity: expectedIdentity }), pending: true, error: undefined }))
    try {
      await props.onAcknowledge({ jobId, letterId, paragraphId, acknowledged: true })
      if (currentIdentity.current === expectedIdentity) setLocal(previous => previous?.identity === expectedIdentity ? { ...previous, pending: false, error: undefined } : null)
    } catch (error) {
      if (currentIdentity.current === expectedIdentity) setLocal(previous => ({ ...(previous?.identity === expectedIdentity ? previous : { identity: expectedIdentity }), pending: false, error: error instanceof Error ? error.message : 'The source acknowledgment could not be saved.' }))
    }
  }

  return <section className="cover-letter-review" aria-label="Cover letter review">
    <div className="cover-letter-review-status" aria-live="polite">
      <p>{props.message || (!letter ? 'No cover letter is available for this posting.' : mismatch ? 'This cover letter does not match the current cover letter revision or source.' : 'Review the current cover letter and its linked source passages.')}</p>
      {localState?.error && <p role="alert">{localState.error}</p>}
      {mismatch && <p role="status">This cover letter is out of date or its current document is unavailable. CV review remains separate.</p>}
      {boundLetter?.findings.map((finding, index) => <p className="cover-letter-finding" key={`${finding.code}-${index}`}>Issue to resolve: {finding.message}</p>)}
    </div>

    <div ref={actionBarRef} className="cover-letter-action-bar" aria-label="Cover letter actions">
      <p>Checks and approval apply only to this cover letter. Approval is a separate decision from CV approval.</p>
      {unsavedEdit && <p role="status">Save or cancel your current edit before running checks or approval. Unsaved changes are not checked.</p>}
      <div className="cover-letter-action-status" aria-live="polite"><span>Issues: {statusLabel[props.checkStatus]}</span><span>Page fit: {fitLabel[props.fitStatus]}</span>{readiness.reason && <span>{readiness.reason}</span>}</div>
      <div className="cover-letter-control-row">
        <button className="secondary-button" type="button" disabled={!actionInput || pending || mismatch || unsavedEdit || props.checkStatus === 'pending'} onClick={() => void invoke(props.onCheck)}>Check for issues</button>
        <button className="secondary-button" type="button" disabled={!actionInput || pending || mismatch || unsavedEdit || props.fitStatus === 'pending'} onClick={() => void invoke(props.onMeasureFit)}>Check one-page fit</button>
        <button className="primary-button" type="button" disabled={!actionInput || pending || mismatch || unsavedEdit || !readiness.canApprove} onClick={() => void invoke(props.onApprove)}>Approve cover letter</button>
      </div>
    </div>
    {boundLetter && boundCanonical ? <>
      <p className="cover-letter-layout-note">Structured review only. This layout is not the compiled PDF or a pagination check.</p>
      <article className="paper paper--letter paper--lato cover-letter-paper" aria-label="Cover letter structured review">
        <header className="cover-letter-paper-header">
          <strong>{boundCanonical.name}</strong>
          {boundCanonical.contact.email && <span>{boundCanonical.contact.email}</span>}
          {boundCanonical.contact.phone && <span>{boundCanonical.contact.phone}</span>}
          {boundCanonical.contact.location && <span>{boundCanonical.contact.location}</span>}
        </header>
        <p className="cover-letter-date">{boundCanonical.date}</p>
        <p className="cover-letter-subject"><strong>Re: </strong>{boundCanonical.subject}</p>
        <p className="cover-letter-greeting">{boundCanonical.greeting}</p>
        <div className="cover-letter-paragraphs">
          {boundLetter.paragraphs.map((paragraph, index) => {
            const isEditing = activeEdit === paragraph.id
            const text = isEditing && saveParagraphText !== undefined ? saveParagraphText : paragraph.text
            const sources = paragraph.citations.map(citation => sourceByOrdinal.get(citation.ordinal)).filter((source): source is NonNullable<typeof source> => Boolean(source))
            const acknowledged = Boolean(boundLetter.acknowledgments[paragraph.id])
            return <section className="cover-letter-paragraph-review" key={paragraph.id} aria-label={`Paragraph ${index + 1} review`}>
              {isEditing ? <form onSubmit={event => { event.preventDefault(); void saveParagraph(paragraph.id, paragraph.text) }}>
                <label htmlFor={`cover-letter-wording-${index}`}>Paragraph {index + 1} wording</label>
                <textarea id={`cover-letter-wording-${index}`} value={text} disabled={pending} onChange={event => setLocal({ identity: visitKey, paragraphId: paragraph.id, text: event.currentTarget.value })} />
                {localState?.error && localState.paragraphId === paragraph.id && <p role="alert">{localState.error}</p>}
                <div className="cover-letter-control-row"><button className="primary-button" type="submit" disabled={pending || !text.trim()}>Save wording</button><button className="secondary-button" type="button" disabled={pending} onClick={() => { setEditingId(null); setLocal(null) }}>Cancel editing</button></div>
              </form> : <>
                <p className="cover-letter-body-paragraph">{paragraph.text}</p>
                <div className="cover-letter-control-row"><button className="secondary-button" type="button" disabled={pending || recipientSession} onClick={() => { if (!canBeginParagraphEdit(editSession) || recipientDirty) return; setEditingId({ identity: visitKey, paragraphId: paragraph.id }); setLocal({ identity: visitKey, paragraphId: paragraph.id, text: paragraph.text }) }}>Edit paragraph {index + 1}</button>
                  {acknowledged ? <span className="cover-letter-acknowledged">Source reviewed</span> : <button className="secondary-button" type="button" disabled={pending || unsavedEdit} onClick={() => void acknowledge(paragraph.id, boundLetter.id)}>Acknowledge sources for paragraph {index + 1}</button>}</div>
              </>}
              <div className="cover-letter-sources" aria-label={`Sources for paragraph ${index + 1}`}>
                <h3>Source passages for paragraph {index + 1}</h3>
                {sources.length ? sources.map(source => <blockquote key={source.ordinal}><strong>{source.heading}</strong><p>{source.passage}</p></blockquote>) : <p>No current linked source passage is available.</p>}
              </div>
            </section>
          })}
        </div>
        <p className="cover-letter-closing">Sincerely,</p>
        <p className="cover-letter-signature">{boundCanonical.signature}</p>
      </article>
      <p className="cover-letter-limitation">Automated checks cannot prove semantic truth. A source acknowledgment records your decision; it does not prove that wording is accurate.</p>
      <form className="cover-letter-recipient-form" onSubmit={event => { void saveRecipient(event) }}>
        <label htmlFor="cover-letter-recipient">Recipient name (optional)</label>
        <input id="cover-letter-recipient" value={recipientDraft} disabled={pending || (!canBeginRecipientEdit(editSession) && editSession?.kind !== 'recipient')} onChange={event => setLocal({ identity: visitKey, recipient: event.currentTarget.value })} aria-describedby="cover-letter-recipient-help" />
        <p id="cover-letter-recipient-help">This name stays on this device and is not sent to Pi. No saved job contacts are selected automatically.</p>
        <div className="cover-letter-control-row"><button className="secondary-button" type="submit" disabled={pending || Boolean(activeEdit) || recipientDraft.trim() === (boundLetter.recipient ?? '')}>Save recipient</button>{recipientSession && <button className="secondary-button" type="button" disabled={pending} onClick={() => setLocal(null)}>Cancel recipient edit</button>}</div>
      </form>
      <p className="cover-letter-ack-count" role="status">{acknowledgedCount} of {boundLetter.paragraphs.length} paragraphs acknowledged</p>
    </> : <div className="cover-letter-unavailable" role="status"><h2>{letter ? 'Cover letter needs review' : 'No cover letter available'}</h2><p>{mismatch ? 'The available letter is stale or its current document does not match. Open the current letter again before reviewing. Your CV remains separate.' : props.message || 'The CV remains available for its independent review.'}</p></div>}

  </section>
}
