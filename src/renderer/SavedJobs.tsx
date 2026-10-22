import React, { FormEvent, useEffect, useRef, useState } from 'react'
import { FolderOpen, Plus } from 'lucide-react'
import type { JobInput, JobRecord } from '../shared/jobs'
import type { DraftRevision } from '../shared/draft'
import './jobs.css'

type DraftLabel = 'No draft' | 'Needs review' | 'Blocked' | 'Approved'

export function SavedJobs({ jobs, activeJob, onSaved, onOpened, onNavigate }: { jobs: JobRecord[]; activeJob: JobRecord | null; onSaved: (job: JobRecord) => void; onOpened: (job: JobRecord) => void; onNavigate: (page: 'Tailor CV') => void }) {
  const [input, setInput] = useState<JobInput>({ title: '', company: '', description: '' })
  const [editingId, setEditingId] = useState<string | undefined>()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draftLabels, setDraftLabels] = useState<Record<string, DraftLabel>>({})
  const [captureMode, setCaptureMode] = useState<'manual' | 'link'>('manual')
  const [sourceUrl, setSourceUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchToken, setFetchToken] = useState<string>()
  const [preview, setPreview] = useState<import('../shared/posting-import').PostingPreview | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const fetchOperationRef = useRef(0)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (dialogOpen && !dialog.open) { dialog.showModal(); requestAnimationFrame(() => titleRef.current?.focus()) }
    else if (!dialogOpen && dialog.open) dialog.close()
  }, [dialogOpen])

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
        const label: DraftLabel = !draft ? 'No draft' : draft.approved ? 'Approved' : draft.status === 'blocked' ? 'Blocked' : 'Needs review'
        return [job.id, label] as const
      } catch { return [job.id, 'No draft' as DraftLabel] as const }
    })).then(entries => { if (current) setDraftLabels(Object.fromEntries(entries)) })
    return () => { current = false }
  }, [jobs])

  function closeDialog() { fetchOperationRef.current++; if (fetchToken) void window.workbench.cancelPostingFetch(fetchToken); setFetching(false); setFetchToken(undefined); setPreview(null); setSourceUrl(''); setCaptureMode('manual'); setDialogOpen(false); setErrors({}); setMessage(''); setMessageError(false) }
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
        if (state.status === 'ready' || state.status === 'incomplete') { setPreview(state.preview); setMessage(state.status === 'incomplete' ? 'The source is incomplete and needs review. Nothing has been saved.' : 'Temporary preview loaded; extraction cannot guarantee completeness. Nothing has been saved.'); setMessageError(state.status === 'incomplete'); break }
        if (state.status === 'cancelled') { setMessage('Fetch cancelled.'); setMessageError(false); break }
        setMessage(state.message); setMessageError(true); break
      }
    } catch (error) { if (operation === fetchOperationRef.current) { setMessage(error instanceof Error ? error.message : 'Fetch failed. Open the source or paste posting text instead.'); setMessageError(true) } }
    finally { if (operation === fetchOperationRef.current) setFetching(false) }
  }
  function newJob() {
    const hasUnfinishedEntry = !editingId && Object.values(input).some(value => value.trim())
    setEditingId(undefined)
    if (!hasUnfinishedEntry) setInput({ title: '', company: '', description: '' })
    setErrors({}); setMessage(''); setMessageError(false); setDialogOpen(true)
  }
  async function loadForEdit(id: string) {
    setMessage(''); setMessageError(false)
    try {
      const job = await window.workbench.openJob(id)
      if (!job) { setMessage('This saved job is no longer available. Refresh the list and try again.'); setMessageError(true); return }
      setEditingId(job.id); setInput({ title: job.title, company: job.company, description: job.description }); setErrors({}); onOpened(job); setDialogOpen(true)
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
  async function save(event: FormEvent) {
    event.preventDefault(); setErrors({}); setMessage(''); setMessageError(false); setBusy(true)
    try {
      const result = await window.workbench.saveJob({ ...input, id: editingId })
      if (!result.ok) {
        const fieldErrors = result.error.fieldErrors ?? {}
        setErrors(fieldErrors); setMessage(result.error.message); setMessageError(true)
        return
      }
      onSaved(result.value); setEditingId(result.value.id); setMessage('Job saved on this device.'); setMessageError(false); setDialogOpen(false)
    } catch { setMessage('The job could not be saved. Check the fields and try again.'); setMessageError(true) }
    finally { setBusy(false) }
  }
  const sourceHostname = (() => { try { return new URL(sourceUrl).hostname } catch { return '' } })()
  const field = (key: keyof JobInput) => ({ value: input[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setInput(value => ({ ...value, [key]: event.target.value })); setErrors(value => ({ ...value, [key]: '' })) }, 'aria-invalid': !!errors[key], 'aria-describedby': errors[key] ? `job-${key}-error` : undefined })
  const renderFields = () => <div className="form-grid">
    <label>Job title<input id="job-field-title" ref={titleRef} required {...field('title')} />{errors.title && <span id="job-title-error" className="field-error">{errors.title}</span>}</label>
    <label>Company<input id="job-field-company" required {...field('company')} />{errors.company && <span id="job-company-error" className="field-error">{errors.company}</span>}</label>
    <label className="wide-field">Posting and requirements<textarea id="job-field-description" rows={9} required {...field('description')} />{errors.description && <span id="job-description-error" className="field-error">{errors.description}</span>}</label>
  </div>

  return <div className="saved-jobs-page">
    <header className="saved-jobs-heading">
      <div><p className="context">Your applications</p><h1>Give every CV a clear target.</h1><p>Saved postings, drafts, and the evidence behind them.</p></div>
      <button className="primary-button" type="button" onClick={newJob}><Plus size={17} aria-hidden="true" /> New job</button>
    </header>
    {jobs.length ? <section className="saved-jobs-table" aria-label="Saved jobs"><table><thead><tr><th scope="col">Posting</th><th scope="col">Draft status</th><th scope="col">Next action</th></tr></thead><tbody>
      {jobs.map(job => <tr className="saved-job-row" key={job.id} aria-current={activeJob?.id === job.id ? 'true' : undefined}>
        <td data-label="Posting"><div className="saved-job-description"><div className="saved-job-title"><strong>{job.title}</strong>{activeJob?.id === job.id && <span className="current-target">Current target</span>}</div><span>{job.company}</span><small>Updated {new Date(job.updatedAt).toLocaleDateString()}</small></div></td>
        <td data-label="Draft status"><span className={`draft-status${draftLabels[job.id] === 'Blocked' ? ' is-blocked' : draftLabels[job.id] === 'Approved' ? ' is-approved' : ''}`}>{draftLabels[job.id] ?? 'Checking…'}</span></td>
        <td data-label="Next action"><div className="saved-job-actions"><button className="secondary-button" type="button" aria-label={`Edit ${job.title} posting`} onClick={() => void loadForEdit(job.id)}>Edit</button><button className="text-button" type="button" onClick={() => void openForTailoring(job.id)}>Open posting</button></div></td>
      </tr>)}
    </tbody></table></section> : <section className="saved-jobs-empty"><FolderOpen size={32} aria-hidden="true" /><div><h2>Your first job starts here</h2><p>Save a posting to set a target for your tailored CV.</p></div>{!dialogOpen && <form className="job-dialog-form" onSubmit={event => void save(event)} noValidate>{renderFields()}<p className="job-form-guidance">Job postings are saved on this device.</p>{message && <p className={`saved-jobs-message${messageError ? ' is-error' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p>}<footer className="job-dialog-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save job'}</button></footer></form>}</section>}
    {jobs.length > 0 && <p className="jobs-history-note">Job postings and their draft revisions stay on this device.</p>}
    {!dialogOpen && message && jobs.length > 0 && <p className={`saved-jobs-message${messageError ? ' is-error' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p>}
    {(jobs.length > 0 || dialogOpen) && <dialog ref={dialogRef} className="job-dialog" aria-labelledby="job-dialog-title" onCancel={event => { event.preventDefault(); closeDialog() }} onClose={() => setDialogOpen(false)}>
      <header className="job-dialog-heading"><div><p className="context">{editingId ? 'Saved job' : 'New job'}</p><h2 id="job-dialog-title">{editingId ? 'Edit job posting' : 'Add a job posting'}</h2></div><button type="button" className="icon-button" aria-label="Close job form" onClick={closeDialog}>×</button></header>
      <form className="job-dialog-form" onSubmit={event => void save(event)} noValidate>
        {!editingId && <fieldset><legend>Choose how to add a posting</legend><div className="job-dialog-actions"><button type="button" className="secondary-button" aria-pressed={captureMode === 'link'} onClick={() => setCaptureMode('link')}>Import from link</button><button type="button" className="secondary-button" aria-pressed={captureMode === 'manual'} onClick={() => { fetchOperationRef.current++; if (fetchToken) void window.workbench.cancelPostingFetch(fetchToken); setFetching(false); setPreview(null); setCaptureMode('manual') }}>Paste posting text instead</button></div></fieldset>}
        {!editingId && captureMode === 'link' && <section aria-label="Import from link"><label htmlFor="posting-source-url">Public Lever posting link</label><input id="posting-source-url" type="url" disabled={fetching} value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://jobs.lever.co/company/posting-id" /><p>{sourceHostname ? `Source hostname: ${sourceHostname}` : 'Paste a public HTTPS posting link.'} Supported source: named Lever job-detail links only. Fetch contacts the source and exposes your normal network address and request metadata. No profile or model data is sent.</p><div className="job-dialog-actions"><button type="button" className="primary-button" disabled={fetching || !sourceUrl.trim()} onClick={() => void fetchPosting()}>{fetching ? 'Fetching…' : 'Fetch posting'}</button>{fetching && <button type="button" className="secondary-button" disabled={!fetchToken} onClick={() => { fetchOperationRef.current++; if (fetchToken) void window.workbench.cancelPostingFetch(fetchToken); setFetching(false); setPreview(null); setMessage('Fetch cancelled.'); setFetchToken(undefined) }}>Cancel fetch</button>}<button type="button" className="secondary-button" onClick={() => void window.workbench.openPostingSource(sourceUrl).catch(error => { setMessage(String(error)); setMessageError(true) })}>Open original posting</button></div>{message && dialogOpen && <p className={`saved-jobs-message${messageError ? ' is-error' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p>}{preview && <section aria-label="Posting import preview"><h3>Temporary posting import preview</h3><p>Submitted: {preview.submittedUrl}</p><p>Fetched from: {preview.finalUrl}</p><label>Job title<input readOnly value={preview.title} /></label><label>Company<input readOnly value={preview.company ?? 'Unknown — review required'} /></label><label>Complete posting text<textarea readOnly rows={12} value={preview.description} /></label>{preview.notices.map(notice => <p role="status" key={notice}>{notice}</p>)}<p>This is a temporary read-only preview. Saving is not available yet; use manual entry to create a saved job.</p></section>}</section>}
        {(captureMode === 'manual' || editingId) && renderFields()}
        {(captureMode === 'manual' || editingId) && <><p className="job-form-guidance">Job postings are saved on this device.</p>{message && dialogOpen && <p className={`saved-jobs-message${messageError ? ' is-error' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p>}<footer className="job-dialog-actions"><button className="secondary-button" type="button" onClick={closeDialog}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Save job'}</button></footer></>}
      </form>
    </dialog>}
  </div>
}
