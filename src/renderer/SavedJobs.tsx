import React, { FormEvent, useState } from 'react'
import { Plus } from 'lucide-react'
import type { JobInput, JobRecord } from '../shared/jobs'
import './jobs.css'

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
  return <div className="jobs-layout jobs-redesign">
    <section className="profile-panel saved-job-list" aria-labelledby="saved-jobs-heading">
      <div className="jobs-list-heading"><div><span className="context">Your workspace</span><h2 id="saved-jobs-heading">Saved postings</h2><p>Reopen a posting to use its original text as job context.</p></div><span className="jobs-count" aria-label={`${jobs.length} saved postings`}>{jobs.length}</span></div>
      <button className="secondary-button jobs-new-button" type="button" onClick={newJob}>New posting</button>
      {jobs.length ? <ul>{jobs.map(job => <li key={job.id}><button type="button" aria-current={activeJob?.id === job.id ? 'page' : undefined} onClick={() => void open(job.id)}><strong>{job.title}</strong><span>{job.company}</span><small>Saved {new Date(job.updatedAt).toLocaleDateString()}</small></button></li>)}</ul> : <div className="jobs-empty"><span aria-hidden="true" className="jobs-empty-mark"><Plus size={18} /></span><strong>No saved postings</strong><p>Start with a job title, company, and the posting text you want to keep nearby.</p></div>}
    </section>
    <section className="profile-panel job-editor" aria-labelledby="job-editor-heading">
      <div className="jobs-editor-heading"><div><span className="context">{editingId ? 'Saved posting' : 'Posting details'}</span><h2 id="job-editor-heading">{editingId ? 'Edit job details' : 'Add a job posting'}</h2><p>Keep the source text locally. It provides job context, not candidate evidence.</p></div></div>
      <form className="profile-form" onSubmit={event => void save(event)} noValidate>
        <div className="form-grid jobs-form-grid">
          <label>Job title<input {...field('title')} />{errors.title && <span id="job-title-error" className="field-error">{errors.title}</span>}</label>
          <label>Company<input {...field('company')} />{errors.company && <span id="job-company-error" className="field-error">{errors.company}</span>}</label>
          <label className="wide-field">Job description and requirements<textarea rows={9} {...field('description')} />{errors.description && <span id="job-description-error" className="field-error">{errors.description}</span>}</label>
        </div>
        <div className="jobs-editor-footer"><span>Stored on this device</span><div className="form-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Update posting' : 'Save posting'}</button>{editingId && <button className="secondary-button" type="button" onClick={newJob}>New posting</button>}</div></div>
      </form>
      {message && <p className={hasErrors ? 'profile-message error' : 'profile-message success'} role={hasErrors ? 'alert' : 'status'}>{message}</p>}
    </section>
  </div>
}
