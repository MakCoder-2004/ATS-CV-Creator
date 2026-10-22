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
  const dialogRef = useRef<HTMLDialogElement>(null)
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

  function closeDialog() { setDialogOpen(false); setErrors({}); setMessage(''); setMessageError(false) }
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
  const field = (key: keyof JobInput) => ({ value: input[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setInput(value => ({ ...value, [key]: event.target.value })); setErrors(value => ({ ...value, [key]: '' })) }, 'aria-invalid': !!errors[key], 'aria-describedby': errors[key] ? `job-${key}-error` : undefined })
  const renderFields = () => <div className="form-grid">
    <label>Job title<input id="job-field-title" ref={titleRef} required {...field('title')} />{errors.title && <span id="job-title-error" className="field-error">{errors.title}</span>}</label>
    <label>Company<input id="job-field-company" required {...field('company')} />{errors.company && <span id="job-company-error" className="field-error">{errors.company}</span>}</label>
    <label className="wide-field">Posting and requirements<textarea id="job-field-description" rows={9} required maxLength={200000} {...field('description')} /><span className="field-hint">Complete posting text is saved up to 200,000 characters and 1 MiB of UTF-8 text. Longer text is rejected without truncation.</span>{errors.description && <span id="job-description-error" className="field-error">{errors.description}</span>}</label>
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
        {renderFields()}
        {editingId && activeJob?.id === editingId && <section className="posting-history" aria-label="Posting source and revision history">
          <h3>Posting versions</h3>
          <p><strong>Source snapshot:</strong> {activeJob.sourceSnapshot ? 'Captured source wording is retained.' : 'Unknown — this manual posting has no captured source snapshot.'}</p>
          {activeJob.sourceSnapshot && <pre>{activeJob.sourceSnapshot.description}</pre>}
          <p><strong>Working posting:</strong> The editable fields above are the accepted wording.</p>
          {activeJob.revisions.length > 0 ? <ol>{activeJob.revisions.map(revision => <li key={revision.revision}><h4>Revision {revision.revision} <span>· {revision.provenance === 'manual' ? 'Manual edit' : 'Legacy provenance unknown'}</span></h4><p>{revision.title} — {revision.company}</p><pre>{revision.description}</pre></li>)}</ol> : <p>No accepted revision history is available for this legacy posting.</p>}
        </section>}
        <p className="job-form-guidance">Job postings are saved on this device.</p>
        {message && dialogOpen && <p className={`saved-jobs-message${messageError ? ' is-error' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p>}
        <footer className="job-dialog-actions"><button className="secondary-button" type="button" onClick={closeDialog}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Save job'}</button></footer>
      </form>
    </dialog>}
  </div>
}
