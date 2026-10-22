import React, { FormEvent, useEffect, useRef, useState } from 'react'
import { FolderOpen, Plus } from 'lucide-react'
import type { JobInput, JobRecord } from '../shared/jobs'
import type { DraftRevision } from '../shared/draft'
import './jobs.css'

type DraftLabel = 'No draft' | 'Needs review' | 'Earlier target' | 'Blocked' | 'Approved'

export function SavedJobs({ jobs, activeJob, onSaved, onOpened, onNavigate }: { jobs: JobRecord[]; activeJob: JobRecord | null; onSaved: (job: JobRecord) => void; onOpened: (job: JobRecord) => void; onNavigate: (page: 'Tailor CV') => void }) {
  const [input, setInput] = useState<JobInput>({ title: '', company: '', description: '' })
  const [editingId, setEditingId] = useState<string | undefined>()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [draftLabels, setDraftLabels] = useState<Record<string, DraftLabel>>({})
  const [captureMode, setCaptureMode] = useState<'manual' | 'link'>('manual')
  const [sourceUrl, setSourceUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchToken, setFetchToken] = useState<string>()
  const [preview, setPreview] = useState<import('../shared/posting-import').PostingPreview | null>(null)
  const [capturedPreview, setCapturedPreview] = useState<import('../shared/posting-import').PostingPreview | null>(null)
  const [discardIntent, setDiscardIntent] = useState<'close' | 'manual' | 'discard' | 'new' | 'open-existing' | null>(null)
  const [discardTargetJobId, setDiscardTargetJobId] = useState<string>()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const discardDialogRef = useRef<HTMLDialogElement>(null)
  const fetchOperationRef = useRef(0)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (dialogOpen && !dialog.open) { dialog.showModal(); requestAnimationFrame(() => titleRef.current?.focus()) }
    else if (!dialogOpen && dialog.open) dialog.close()
  }, [dialogOpen])

  useEffect(() => {
    const dialog = discardDialogRef.current
    if (!dialog) return
    if (discardIntent && !dialog.open) { dialog.showModal(); requestAnimationFrame(() => dialog.querySelector<HTMLButtonElement>('[data-discard-keep]')?.focus()) }
    else if (!discardIntent && dialog.open) dialog.close()
  }, [discardIntent])

  useEffect(() => {
    const firstInvalid = (['title', 'company', 'description'] as const).find(key => errors[key])
    if (firstInvalid) document.getElementById(`job-field-${firstInvalid}`)?.focus()
  }, [errors])

  useEffect(() => {
    if (!message || messageError || dialogOpen) return
    const timer = window.setTimeout(() => setMessage(''), 4000)
    return () => window.clearTimeout(timer)
  }, [message, messageError, dialogOpen])

  useEffect(() => {
    let current = true
    Promise.all(jobs.map(async job => {
      try {
        const draft: DraftRevision | null = await window.workbench.getDraft(job.id)
        const label: DraftLabel = !draft ? 'No draft' : draft.targetPostingUpdatedAt !== job.updatedAt ? 'Earlier target' : draft.approved ? 'Approved' : draft.status === 'blocked' ? 'Blocked' : 'Needs review'
        return [job.id, label] as const
      } catch { return [job.id, 'No draft' as DraftLabel] as const }
    })).then(entries => { if (current) setDraftLabels(Object.fromEntries(entries)) })
    return () => { current = false }
  }, [jobs])

  function previewWasEdited() { return !!preview && !!capturedPreview && (preview.title !== capturedPreview.title || preview.company !== capturedPreview.company || preview.description !== capturedPreview.description) }
  function discardFetchPreview() { fetchOperationRef.current++; if (fetchToken) void window.workbench.cancelPostingFetch(fetchToken); setFetching(false); setFetchToken(undefined); setPreview(null); setCapturedPreview(null) }
  function cancelDiscard() { setDiscardIntent(null); setDiscardTargetJobId(undefined) }
  function completeDiscard(intent: 'close' | 'manual' | 'discard' | 'new' | 'open-existing') {
    const targetJobId = intent === 'open-existing' ? discardTargetJobId : undefined
    discardFetchPreview(); cancelDiscard()
    if (intent === 'close') { setSourceUrl(''); setCaptureMode('manual'); setIntakeOpen(false); setErrors({}); setMessage(''); setMessageError(false) }
    else if (intent === 'manual') { setCaptureMode('manual'); setErrors({}) }
    else if (intent === 'new') { setSourceUrl(''); setCaptureMode('manual'); setIntakeOpen(true); setErrors({}); setMessage(''); setMessageError(false) }
    else if (intent === 'open-existing') { if (targetJobId) void openForTailoring(targetJobId); else { setMessage('The saved posting could not be opened. Choose it from Saved jobs.'); setMessageError(true) } }
    else { setMessage('Unsaved posting preview discarded.'); setMessageError(false) }
  }
  function requestDiscard(intent: 'close' | 'manual' | 'discard' | 'new') { if (previewWasEdited()) setDiscardIntent(intent); else completeDiscard(intent) }
  function openExisting(id: string) { if (previewWasEdited()) { setDiscardTargetJobId(id); setDiscardIntent('open-existing') } else void openForTailoring(id) }
  function closeDialog() { setDialogOpen(false); setErrors({}); setMessage(''); setMessageError(false) }
  function closeIntake() { requestDiscard('close') }
  async function fetchPosting() {
    const operation = ++fetchOperationRef.current
    setFetching(true); setPreview(null); setFetchToken(undefined); setMessage('Fetching one Lever job detail…'); setMessageError(false)
    try {
      const { token } = await window.workbench.startPostingFetch(sourceUrl)
      if (operation !== fetchOperationRef.current) { void window.workbench.cancelPostingFetch(token); return }
      setFetchToken(token)
      while (operation === fetchOperationRef.current) {
        const state = await window.workbench.readPostingPreview(token)
        if (operation !== fetchOperationRef.current) return
        if (state.status === 'fetching') { await new Promise(resolve => window.setTimeout(resolve, 150)); continue }
        if (state.status === 'ready' || state.status === 'incomplete') { setPreview(state.preview); setCapturedPreview(state.preview); setMessage(state.status === 'incomplete' ? 'The source is incomplete and needs review. Nothing has been saved.' : 'Temporary preview loaded; extraction cannot guarantee completeness. Nothing has been saved.'); setMessageError(state.status === 'incomplete'); break }
        if (state.status === 'cancelled') { setMessage('Fetch cancelled.'); setMessageError(false); break }
        setMessage(state.message); setMessageError(true); break
      }
    } catch (error) { if (operation === fetchOperationRef.current) { setMessage(error instanceof Error ? error.message : 'Fetch failed. Open the source or paste posting text instead.'); setMessageError(true) } }
    finally { if (operation === fetchOperationRef.current) setFetching(false) }
  }
  function newJob() {
    if (previewWasEdited()) { requestDiscard('new'); return }
    const hasUnfinishedEntry = !editingId && Object.values(input).some(value => value.trim())
    setEditingId(undefined)
    if (!hasUnfinishedEntry) setInput({ title: '', company: '', description: '' })
    discardFetchPreview(); setSourceUrl(''); setCaptureMode('manual')
    setErrors({}); setMessage(''); setMessageError(false); setDialogOpen(false); setIntakeOpen(true)
    requestAnimationFrame(() => titleRef.current?.focus())
  }
  async function loadForEdit(id: string) {
    setMessage(''); setMessageError(false)
    try {
      const job = await window.workbench.openJob(id)
      if (!job) { setMessage('This saved job is no longer available. Refresh the list and try again.'); setMessageError(true); return }
      closeIntake(); setEditingId(job.id); setInput({ title: job.title, company: job.company, description: job.description }); setErrors({}); onOpened(job); setDialogOpen(true)
    } catch { setMessage('The saved job could not be opened. Try again.'); setMessageError(true) }
  }
  async function openForTailoring(id: string) {
    setMessage(''); setMessageError(false)
    try {
      const job = await window.workbench.openJob(id)
      if (!job) { setMessage('This saved job is no longer available. Refresh the list and try again.'); setMessageError(true); return }
      onOpened(job); onNavigate('Tailor CV')
    } catch { setMessage('The saved job could not be opened. Try again.'); setMessageError(true) }
  }
  async function saveImportedPosting() {
    if (!fetchToken || !preview) return
    setBusy(true); setErrors({}); setMessage('Saving reviewed job posting…'); setMessageError(false)
    try {
      const result = await window.workbench.acceptPostingImport(fetchToken, { title: preview.title, company: preview.company ?? '', description: preview.description })
      if (!result.ok) { setMessage(result.error.message); setErrors(result.error.fieldErrors ?? {}); setMessageError(true); return }
      onSaved(result.value); setMessage('Job saved on this device.'); setMessageError(false); setIntakeOpen(false); setPreview(null); setCapturedPreview(null); setFetchToken(undefined)
    } catch { setMessage('The reviewed posting could not be saved. No partial job history was retained.'); setMessageError(true) }
    finally { setBusy(false) }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setErrors({}); setMessage(''); setMessageError(false); setBusy(true)
    try {
      const result = await window.workbench.saveJob({ ...input, id: editingId })
      if (!result.ok) {
        const fieldErrors = result.error.fieldErrors ?? {}
        setErrors(fieldErrors); setMessage(result.error.message); setMessageError(true)
        return
      }
      onSaved(result.value); setEditingId(result.value.id); setMessage('Job saved on this device.'); setMessageError(false); setDialogOpen(false); setIntakeOpen(false)
    } catch { setMessage('The job could not be saved. Check the fields and try again.'); setMessageError(true) }
    finally { setBusy(false) }
  }
  const sourceHostname = (() => { try { return new URL(sourceUrl).hostname } catch { return '' } })()
  const field = (key: keyof JobInput) => ({ value: input[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setInput(value => ({ ...value, [key]: event.target.value })); setErrors(value => ({ ...value, [key]: '' })) }, 'aria-invalid': !!errors[key], 'aria-describedby': errors[key] ? `job-${key}-error` : undefined })
  const renderFields = () => <div className="form-grid">
    <label>Job title<input id="job-field-title" ref={titleRef} required {...field('title')} />{errors.title && <span id="job-title-error" className="field-error">{errors.title}</span>}</label>
    <label>Company<input id="job-field-company" required {...field('company')} />{errors.company && <span id="job-company-error" className="field-error">{errors.company}</span>}</label>
    <label className="wide-field">Posting and requirements<textarea id="job-field-description" rows={9} required maxLength={30000} {...field('description')} />{errors.description && <span id="job-description-error" className="field-error">{errors.description}</span>}</label>
  </div>
  const editedJob = editingId ? jobs.find(job => job.id === editingId) : undefined
  const intakeVisible = intakeOpen || jobs.length === 0
  const sourceMatch = (() => { if (!preview) return undefined; try { const identity = new URL(preview.finalUrl).pathname; return jobs.find(job => job.sourceSnapshot?.sourceIdentity === identity) } catch { return undefined } })()
  const sourceMatchIsUnchanged = !!sourceMatch?.sourceSnapshot && sourceMatch.sourceSnapshot.title === capturedPreview?.title && sourceMatch.sourceSnapshot.company === capturedPreview?.company && sourceMatch.sourceSnapshot.description === capturedPreview?.description
  const renderIntake = (insideEmptyState = false) => <section className={`saved-jobs-intake${insideEmptyState ? ' is-inside-empty' : ''}`} aria-labelledby="posting-intake-title">
    <header className="saved-jobs-intake-heading"><div><p className="context">New job</p><h2 id="posting-intake-title">Add a job posting</h2></div>{jobs.length > 0 && <button type="button" className="secondary-button" onClick={closeIntake}>Cancel</button>}</header>
    <fieldset><legend>Choose how to add a posting</legend><div className="job-dialog-actions"><button type="button" className="secondary-button" aria-pressed={captureMode === 'link'} onClick={() => setCaptureMode('link')}>Import from link</button><button type="button" className="secondary-button" aria-pressed={captureMode === 'manual'} onClick={() => { if (fetching) discardFetchPreview(); if (previewWasEdited()) requestDiscard('manual'); else { setPreview(null); setCapturedPreview(null); setCaptureMode('manual') } }}>Paste posting text instead</button></div></fieldset>
    {captureMode === 'link' ? <section className="posting-link-entry" aria-label="Import from link"><label htmlFor="posting-source-url">Public Lever posting link</label><input id="posting-source-url" type="url" disabled={fetching} value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://jobs.lever.co/company/posting-id" /><p>{sourceHostname ? `Source hostname: ${sourceHostname}` : 'Paste a public HTTPS posting link.'} Supported source: named Lever job-detail links only. Fetch contacts the source and exposes your normal network address and request metadata. No profile or model data is sent.</p><div className="job-dialog-actions"><button type="button" className="primary-button" disabled={fetching || !sourceUrl.trim()} onClick={() => void fetchPosting()}>{fetching ? 'Fetching…' : 'Fetch posting'}</button>{fetching && <button type="button" className="secondary-button" disabled={!fetchToken} onClick={() => { discardFetchPreview(); setMessage('Fetch cancelled.'); setMessageError(false) }}>Cancel fetch</button>}<button type="button" className="secondary-button" disabled={fetching || !sourceUrl.trim()} onClick={() => void window.workbench.openPostingSource(sourceUrl).then(result => { setMessage(result.message); setMessageError(false) }).catch(error => { setMessage(String(error)); setMessageError(true) })}>Open original posting</button></div>{message && intakeVisible && <p className={`saved-jobs-message${messageError ? ' is-error' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p>}{preview && <section className="posting-import-preview" aria-label="Posting import preview"><h3>Temporary posting import preview</h3><p>Submitted: {preview.submittedUrl}</p><p>Fetched from: {preview.finalUrl}</p><div className="posting-preview-fields"><label>Job title<input value={preview.title} onChange={event => setPreview(value => value ? { ...value, title: event.target.value } : value)} /></label><label>Company<input value={preview.company ?? ''} placeholder="Enter the employer name" onChange={event => setPreview(value => value ? { ...value, company: event.target.value } : value)} /></label><label className="wide-field">Posting and requirements<textarea rows={12} value={preview.description} onChange={event => setPreview(value => value ? { ...value, description: event.target.value } : value)} /></label></div>{preview.notices.map(notice => <p role="status" key={notice}>{notice}</p>)}<p>Review and correct the complete posting before saving. Company names are not inferred when the source omits them. Saving does not contact the source or start model analysis.</p>{sourceMatch && <div className="saved-jobs-message" role="status">{sourceMatchIsUnchanged ? 'This exact posting is already saved.' : 'This source identity is already saved with different captured details. It will not be overwritten or duplicated.'}<div className="job-dialog-actions"><button type="button" className="secondary-button" onClick={() => openExisting(sourceMatch.id)}>Open existing</button></div></div>}<div className="job-dialog-actions"><button type="button" className="primary-button" disabled={busy || fetching || !!sourceMatch} onClick={() => void saveImportedPosting()}>{busy ? 'Saving…' : 'Save job'}</button>{!sourceMatch && <button type="button" className="secondary-button" disabled={busy} onClick={() => requestDiscard('discard')}>Discard preview</button>}</div></section>}</section> : <form className="job-dialog-form" onSubmit={event => void save(event)} noValidate>{renderFields()}<p className="job-form-guidance">Manual posting text has unknown source provenance and is saved on this device.</p>{message && intakeVisible && <p className={`saved-jobs-message${messageError ? ' is-error' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p>}<footer className="job-dialog-actions">{jobs.length > 0 && <button className="secondary-button" type="button" onClick={closeIntake}>Cancel</button>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save job'}</button></footer></form>}
  </section>

  return <div className="saved-jobs-page">
    <header className="saved-jobs-heading">
      <div><p className="context">Your applications</p><h1>Give every CV a clear target.</h1><p>Saved postings, drafts, and the evidence behind them.</p></div>
      <button className="primary-button" type="button" onClick={newJob}><Plus size={17} aria-hidden="true" /> New job</button>
    </header>
    {jobs.length > 0 && intakeOpen && renderIntake()}
    {jobs.length ? <section className="saved-jobs-table" aria-label="Saved jobs"><table><thead><tr><th scope="col">Posting</th><th scope="col">Draft status</th><th scope="col">Next action</th></tr></thead><tbody>
      {jobs.map(job => <tr className="saved-job-row" key={job.id} aria-current={activeJob?.id === job.id ? 'true' : undefined}>
        <td data-label="Posting"><div className="saved-job-description"><div className="saved-job-title"><strong>{job.title}</strong>{activeJob?.id === job.id && <span className="current-target">Current target</span>}</div><span>{job.company}</span><small>Updated {new Date(job.updatedAt).toLocaleDateString()}</small></div></td>
        <td data-label="Draft status"><span className={`draft-status${draftLabels[job.id] === 'Blocked' ? ' is-blocked' : draftLabels[job.id] === 'Approved' ? ' is-approved' : ''}`}>{draftLabels[job.id] ?? 'Checking…'}</span></td>
        <td data-label="Next action"><div className="saved-job-actions"><button className="secondary-button" type="button" aria-label={`Edit ${job.title} posting`} onClick={() => void loadForEdit(job.id)}>Edit</button><button className="text-button" type="button" onClick={() => void openForTailoring(job.id)}>Open posting</button></div></td>
      </tr>)}
    </tbody></table></section> : <section className="saved-jobs-empty"><FolderOpen size={32} aria-hidden="true" /><div><h2>Your first job starts here</h2><p>Save a posting to set a target for your tailored CV.</p></div>{renderIntake(true)}</section>}
    {jobs.length > 0 && <p className="jobs-history-note">Job postings and their draft revisions stay on this device.</p>}
    {!dialogOpen && !intakeOpen && message && jobs.length > 0 && <p className={`saved-jobs-message${messageError ? ' is-error' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p>}
    <dialog ref={discardDialogRef} className="job-dialog posting-discard-dialog" aria-labelledby="discard-preview-title" aria-describedby="discard-preview-description" onCancel={event => { event.preventDefault(); cancelDiscard() }} onClose={() => { if (discardIntent) cancelDiscard() }}>
      <header className="job-dialog-heading"><div><p className="context">Unsaved posting</p><h2 id="discard-preview-title">Discard your preview edits?</h2></div></header>
      <section className="job-dialog-form"><p id="discard-preview-description">Your unsaved title, company, and posting text corrections will be lost. Nothing has been saved.</p><div className="job-dialog-actions"><button type="button" data-discard-keep className="secondary-button" onClick={cancelDiscard}>Keep reviewing</button><button type="button" className="primary-button" onClick={() => discardIntent && completeDiscard(discardIntent)}>Discard edits</button></div></section>
    </dialog>
    {dialogOpen && editingId && <dialog ref={dialogRef} className="job-dialog" aria-labelledby="job-dialog-title" onCancel={event => { event.preventDefault(); closeDialog() }} onClose={() => setDialogOpen(false)}>
      <header className="job-dialog-heading"><div><p className="context">Saved job</p><h2 id="job-dialog-title">Edit job posting</h2></div><button type="button" className="icon-button" aria-label="Close job form" onClick={closeDialog}>×</button></header>
      <form className="job-dialog-form" onSubmit={event => void save(event)} noValidate>
        {renderFields()}
        {editedJob && <section className="posting-history" aria-label="Posting source and revision history">
          <h3>Posting versions</h3>
          <p><strong>Source snapshot:</strong> {editedJob.sourceSnapshot ? 'Captured source wording is retained.' : 'Unknown — this manual posting has no captured source snapshot.'}</p>
          {editedJob.sourceSnapshot && <pre>{editedJob.sourceSnapshot.description}</pre>}
          <p><strong>Working posting:</strong> The editable fields above are the accepted wording.</p>
          {editedJob.revisions.length > 0 ? <ol>{editedJob.revisions.map(revision => <li key={revision.revision}><h4>Revision {revision.revision} <span>· {revision.provenance === 'manual' ? 'Manual edit' : 'Legacy provenance unknown'}</span></h4><p>{revision.title} — {revision.company}</p><pre>{revision.description}</pre></li>)}</ol> : <p>No accepted revision history is available for this legacy posting.</p>}
        </section>}
        <p className="job-form-guidance">Job postings are saved on this device.</p>
        {message && <p className={`saved-jobs-message${messageError ? ' is-error' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p>}
        <footer className="job-dialog-actions"><button className="secondary-button" type="button" onClick={closeDialog}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></footer>
      </form>
    </dialog>}
  </div>
}
