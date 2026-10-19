import React, { FormEvent, useState } from 'react'
import type { JobInput, JobRecord } from '../shared/jobs'

export function SavedJobs({ jobs, activeJob, onSaved, onOpened }: { jobs: JobRecord[]; activeJob: JobRecord | null; onSaved: (job: JobRecord) => void; onOpened: (job: JobRecord) => void }) {
  const [input, setInput] = useState<JobInput>({ title: '', company: '', description: '' })
  const [editingId, setEditingId] = useState<string | undefined>()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  function newJob() { setEditingId(undefined); setInput({ title: '', company: '', description: '' }); setErrors({}); setMessage('') }
  async function open(id: string) {
    setMessage('')
    try {
      const job = await window.workbench.openJob(id)
      if (!job) { setMessage('This saved posting is no longer available. Refresh the list and try again.'); return }
      setEditingId(job.id); setInput({ title: job.title, company: job.company, description: job.description }); onOpened(job)
    } catch { setMessage('The saved posting could not be opened. Try again.') }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setErrors({}); setMessage(''); setBusy(true)
    try {
      const result = await window.workbench.saveJob({ ...input, id: editingId })
      if (!result.ok) { setErrors(result.error.fieldErrors ?? {}); setMessage(result.error.message); return }
      onSaved(result.value); setEditingId(result.value.id); setMessage('Posting saved on this device.')
    } catch { setMessage('The posting could not be saved. Check the fields and try again.') }
    finally { setBusy(false) }
  }
  const field = (key: keyof JobInput) => ({ value: input[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setInput(value => ({ ...value, [key]: event.target.value })); setErrors(value => ({ ...value, [key]: '' })) }, 'aria-invalid': !!errors[key], 'aria-describedby': errors[key] ? `job-${key}-error` : undefined })
  const hasErrors = Object.values(errors).some(Boolean)
  return <div className="jobs-layout">
    <section className="profile-panel saved-job-list" aria-labelledby="saved-jobs-heading">
      <div className="panel-heading"><div><span className="context">Local history</span><h2 id="saved-jobs-heading">Saved postings</h2><p>Choose a posting to reopen its original text while offline.</p></div><button className="secondary-button" type="button" onClick={newJob}>New posting</button></div>
      {jobs.length ? <ul>{jobs.map(job => <li key={job.id}><button type="button" aria-current={activeJob?.id === job.id ? 'page' : undefined} onClick={() => void open(job.id)}><strong>{job.title}</strong><span>{job.company}</span><small>Saved {new Date(job.updatedAt).toLocaleDateString()}</small></button></li>)}</ul> : <p className="jobs-empty">No saved postings yet. Add a posting to keep its requirements available for this workspace.</p>}
    </section>
    <section className="profile-panel job-editor" aria-labelledby="job-editor-heading">
      <div className="panel-heading"><div><span className="context">{editingId ? 'Saved posting' : 'New target'}</span><h2 id="job-editor-heading">{editingId ? 'Job details' : 'Save a job posting'}</h2><p>The original text is stored locally as job context, not as candidate evidence.</p></div></div>
      <form className="profile-form" onSubmit={event => void save(event)} noValidate>
        <div className="form-grid">
          <label>Job title<input {...field('title')} />{errors.title && <span id="job-title-error" className="field-error">{errors.title}</span>}</label>
          <label>Company<input {...field('company')} />{errors.company && <span id="job-company-error" className="field-error">{errors.company}</span>}</label>
          <label className="wide-field">Job description and requirements<textarea rows={13} {...field('description')} />{errors.description && <span id="job-description-error" className="field-error">{errors.description}</span>}</label>
        </div>
        <div className="form-actions"><button className="primary-button" type="submit" disabled={busy}>{editingId ? 'Update posting' : 'Save posting'}</button>{editingId && <button className="secondary-button" type="button" onClick={newJob}>New posting</button>}</div>
      </form>
      {message && <p className={hasErrors ? 'profile-message error' : 'profile-message success'} role={hasErrors ? 'alert' : 'status'}>{message}</p>}
    </section>
  </div>
}
