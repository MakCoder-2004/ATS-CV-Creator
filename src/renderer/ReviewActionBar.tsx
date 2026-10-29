import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { CheckCircle2, Circle, FileCheck2, PanelRightOpen } from 'lucide-react'
import type { DocumentFitReport } from '../shared/document'
import type { DraftRevision } from '../shared/draft'

export function ReviewActionBar({ draft, targetCurrent, fit, fitBusy, busy, acknowledged, setAcknowledged, onCheck, onMeasure, onApprove, onOpenDetails, detailsOpen, acceptedCuts, setAcceptedCuts, onApplyCuts, feedback }:  {
  feedback?: string
  draft: DraftRevision; targetCurrent: boolean; fit: DocumentFitReport | null; fitBusy: boolean; busy: boolean
  acknowledged: boolean; setAcknowledged: Dispatch<SetStateAction<boolean>>
  onCheck: () => Promise<void>; onMeasure: () => Promise<void>; onApprove: () => Promise<void>
  onOpenDetails: (target?: 'sources' | 'skills') => void; detailsOpen: boolean
  acceptedCuts: string[]; setAcceptedCuts: Dispatch<SetStateAction<string[]>>; onApplyCuts: () => Promise<void>
}) {
  const ref = useRef<HTMLElement>(null)
  const issues = useRef<HTMLDetailsElement>(null)
  const findings = draft.checkReport?.findings.filter(finding => finding.code !== 'unconfirmed-skill') ?? []
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(() => element.closest<HTMLElement>('.review-stage')?.style.setProperty('--review-bar-height', `${element.getBoundingClientRect().height + 24}px`))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const pending = draft.suggestedSkills?.filter(skill => skill.status === 'pending').length ?? 0
  const passed = targetCurrent && !!draft.checkReport?.passed
  const fits = targetCurrent && !!fit && !fit.overflow
  const ready = passed && fits && !pending && acknowledged
  const next = !targetCurrent ? 'This wording targets an earlier posting. Review the current target before renewed checks and approval.' : pending ? `Review ${pending} new skill${pending === 1 ? '' : 's'} before approval.` : !passed ? 'Check your CV and resolve any issues before approval.' : !fit ? 'Check page length to see whether your updated CV fits.' : fit.overflow ? 'Your CV is too long. Review the page-fit suggestions.' : !acknowledged ? 'Read your CV, then confirm you reviewed its wording.' : 'Your CV is ready for your approval.'
  const status = (done: boolean, label: string) => <span className={`review-check-status${done ? ' is-complete' : ''}`}>{done ? <CheckCircle2 size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}{label}</span>
  return <><section ref={ref} className="review-action-bar" aria-label="Review checklist">
    <div className="review-bar-overview"><div><h2><FileCheck2 size={18} aria-hidden="true" />Finish reviewing</h2><p role="status">{fits ? 'Fits the selected target. ' : ''}{next}</p></div><div className="review-command-buttons"><button type="button" className="secondary-button" disabled={busy || fitBusy} onClick={() => void onCheck()}>Check CV for issues</button><button type="button" className="secondary-button" disabled={busy || fitBusy} onClick={() => void onMeasure()}>{fitBusy ? 'Measuring…' : 'Check page length'}</button><button type="button" className="primary-button" disabled={busy || fitBusy || !ready} onClick={() => void onApprove()}>{targetCurrent && draft.approved ? 'Continue to export' : 'Approve CV'}</button></div></div>
    <div className="review-bar-actions"><div className="review-checklist" aria-label="Review progress">{pending ? <button type="button" className="review-skill-link" onClick={() => onOpenDetails('skills')}>{status(false, `${pending} skills to review`)}</button> : status(true, 'Skills reviewed')}{!passed && findings.length ? <button type="button" className="review-issue-link" onClick={() => { if (issues.current) { issues.current.open = true; issues.current.querySelector('summary')?.focus() } }}>{status(false, 'Review issues')}</button> : status(passed, passed ? 'Checks passed' : 'Checks needed')}{status(fits, fitBusy ? 'Measuring page length…' : fit ? `${fit.actualPages} of ${fit.targetPages} page${fit.targetPages === 1 ? '' : 's'}${fit.overflow ? ' · too long' : ''}` : 'Page length needed')}</div><label className="review-acknowledgment"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I reviewed this CV and its wording.</label>{!detailsOpen && <button type="button" className="review-details-toggle" aria-label="Show review details" title="Show review details" onClick={() => onOpenDetails()}><PanelRightOpen size={18} aria-hidden="true" /></button>}</div>
    {feedback && <p className="review-bar-error" role="alert">{feedback}</p>}
  </section>
    {!!findings.length && <details ref={issues} className="review-page-suggestions" aria-label="Review issues"><summary>{findings.length} review issue{findings.length === 1 ? '' : 's'} to resolve</summary><ul>{findings.map((finding, index) => <li key={`${finding.code}-${index}`}>{finding.message} {finding.correction}</li>)}</ul><p>Select the affected wording to edit it, or use Add in a CV section to add a record.</p></details>}
    {fit?.overflow && <details className="review-page-suggestions"><summary>Review page-fit suggestions</summary><p>Nothing is removed automatically. Choose any content you want to leave out, or edit your CV to make it shorter.</p>{fit.proposedCuts.map(cut => <label key={cut.entryId}><input type="checkbox" checked={acceptedCuts.includes(cut.entryId)} onChange={event => setAcceptedCuts(value => event.target.checked ? [...value, cut.entryId] : value.filter(id => id !== cut.entryId))} />{cut.section} — {cut.label}</label>)}<button type="button" className="secondary-button" disabled={busy || fitBusy || !acceptedCuts.length} onClick={() => void onApplyCuts()}>Apply selected cuts</button></details>}
  </>
}
