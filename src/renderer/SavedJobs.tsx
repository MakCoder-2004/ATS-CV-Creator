import React, { FormEvent, useEffect, useRef, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { JobContact, JobInput, JobRecord, JobSaveInput } from '../shared/jobs'
import type { DraftRevision } from '../shared/draft'
import './jobs.css'

type DraftLabel = 'No draft' | 'Needs review' | 'Earlier target' | 'Blocked' | 'Approved'
type FormValues = JobInput
const emptyForm = (): FormValues => ({ title: '', company: '', description: '' })
export function temporaryDirectNotice(notice: string) { return notice }
const newContact = (): JobContact => ({ id: crypto.randomUUID(), name: '', role: '', profileUrl: null })

export function SavedJobs({ jobs, activeJob, onSaved, onOpened, onDeleted, onNavigate }: { jobs: JobRecord[]; activeJob: JobRecord | null; onSaved: (job: JobRecord) => void; onOpened: (job: JobRecord) => void; onDeleted: (jobIds: string[]) => Promise<void>; onNavigate: (page: 'Tailor CV') => void }) {
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string>()
  const [form, setForm] = useState<FormValues>(emptyForm)
  const [contacts, setContacts] = useState<JobContact[]>([])
  const [editingRecord, setEditingRecord] = useState<JobRecord>()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [labels, setLabels] = useState<Record<string, DraftLabel>>({})
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [deleting, setDeleting] = useState<JobRecord[]>([])
  const [deleteToken, setDeleteToken] = useState<string>()
  const [deleteMessage, setDeleteMessage] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [needsDeletionReview, setNeedsDeletionReview] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const deletionReturnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let current = true
    Promise.all(jobs.map(async job => {
      try {
        const draft: DraftRevision | null = await window.workbench.getDraft(job.id)
        const label: DraftLabel = !draft ? 'No draft' : draft.targetPostingUpdatedAt !== job.updatedAt ? 'Earlier target' : draft.approved ? 'Approved' : draft.status === 'blocked' ? 'Blocked' : 'Needs review'
        return [job.id, label] as const
      } catch { return [job.id, 'No draft' as DraftLabel] as const }
    })).then(entries => { if (current) setLabels(Object.fromEntries(entries)) })
    return () => { current = false }
  }, [jobs])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (deleting.length > 0 && !dialog.open) { dialog.showModal(); requestAnimationFrame(() => cancelRef.current?.focus()) }
    else if (deleting.length === 0 && dialog.open) {
      dialog.close()
      requestAnimationFrame(() => {
        const target = deletionReturnFocus.current
        if (target?.isConnected && !target.hasAttribute('disabled')) target.focus()
        else (document.querySelector<HTMLInputElement>('.saved-job-row input[type="checkbox"]') ?? headingRef.current)?.focus()
      })
    }
  }, [deleting.length])

  function beginNew() {
    setEditingId(undefined); setEditingRecord(undefined); setForm(emptyForm()); setContacts([]); setErrors({}); setMessage(''); setMessageError(false); setFormOpen(true)
  }
  async function beginEdit(id: string) {
    setMessage(''); setMessageError(false)
    try {
      const job = await window.workbench.openJob(id)
      if (!job) { setMessage('This saved job is no longer available. Refresh the list and try again.'); setMessageError(true); return }
      setEditingId(id); setEditingRecord(job); setForm({ title: job.title, company: job.company, description: job.description }); setContacts(job.contacts); setErrors({}); setFormOpen(true)
    } catch { setMessage('The saved job could not be opened. Try again.'); setMessageError(true) }
  }
  async function openJob(id: string) {
    try {
      const job = await window.workbench.openJob(id)
      if (!job) { setMessage('This saved job is no longer available. Refresh the list and try again.'); setMessageError(true); return }
      onOpened(job); onNavigate('Tailor CV')
    } catch { setMessage('The saved job could not be opened. Try again.'); setMessageError(true) }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setErrors({}); setMessage(''); setMessageError(false)
    const input: JobSaveInput = { ...form, ...(editingId ? { id: editingId } : {}), contacts }
    try {
      const result = await window.workbench.saveJob(input)
      if (!result.ok) { setErrors(result.error.fieldErrors ?? {}); setMessage(result.error.message); setMessageError(true); return }
      onSaved(result.value); setEditingRecord(result.value); setEditingId(result.value.id); setMessage('Job saved on this device.'); setMessageError(false); setFormOpen(false)
    } catch { setMessage('The job could not be saved. Check the fields and try again.'); setMessageError(true) }
    finally { setBusy(false) }
  }
  async function previewDelete(selection: JobRecord[]) {
    if (!selection.length) return
    setNeedsDeletionReview(false)
    deletionReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setDeleteMessage('Checking the selected jobs…'); setDeleting(selection)
    try {
      const preview = await window.workbench.previewJobDeletion(selection.map(job => job.id))
      if (!preview.ok || !preview.token || !preview.jobs?.length) { setDeleting([]); setMessage(preview.message); setMessageError(true); return }
      const jobCount = preview.jobs.length, draftCount = preview.draftCount ?? preview.jobs.reduce((total, job) => total + job.draftCount, 0)
      setDeleteToken(preview.token); setDeleteMessage(`${preview.jobs.map(job => `${job.title} at ${job.company}: ${job.draftCount} draft${job.draftCount === 1 ? '' : 's'}`).join(' | ')}. ${jobCount} ${jobCount === 1 ? 'job' : 'jobs'} and ${draftCount} ${draftCount === 1 ? 'draft' : 'drafts'} will be deleted, along with local generation history. Profile facts and exported files stay untouched. Older backups may retain these records. This cannot be undone from the workspace.`)
    } catch (error) { setDeleting([]); setMessage(error instanceof Error ? error.message : 'The selected job could not be checked.'); setMessageError(true) }
  }
  async function executeDelete() {
    if (!deleting.length || !deleteToken || deleteBusy) return
    setDeleteBusy(true)
    try {
      const ids = deleting.map(job => job.id)
      const result = await window.workbench.executeJobDeletion(deleteToken, ids)
      if (!result.ok) { setDeleting([]); setDeleteToken(undefined); setMessage(result.message); setMessageError(true); setNeedsDeletionReview(true); return }
      setDeleting([]); setDeleteToken(undefined); setSelectedIds(current => current.filter(id => !ids.includes(id))); setMessage(result.message); setMessageError(false); await onDeleted(ids)
    } catch (error) { setDeleteMessage(error instanceof Error ? error.message : 'Storage could not delete this job. Nothing was removed.') }
    finally { setDeleteBusy(false) }
  }

  const field = (key: 'title' | 'company' | 'description') => ({ value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setForm(value => ({ ...value, [key]: event.target.value })); setErrors(value => ({ ...value, [key]: '' })) }, 'aria-invalid': !!errors[key], 'aria-describedby': errors[key] ? `job-${key}-error` : undefined })
  const contactError = (index: number, field: 'name' | 'role' | 'profileUrl') => errors[`contacts.${index}.${field}`]
  const updateContact = (contact: JobContact, index: number, field: 'name' | 'role' | 'profileUrl', value: string | null) => {
    setContacts(rows => rows.map(row => row.id === contact.id ? { ...row, [field]: value } : row))
    setErrors(current => { const next = { ...current }; delete next[`contacts.${index}.${field}`]; return next })
  }
  const renderForm = () => <section className="saved-jobs-intake" aria-labelledby="posting-intake-title">
    <header className="saved-jobs-intake-heading"><div><p className="context">{editingId ? 'Edit saved job' : 'New job'}</p><h2 id="posting-intake-title">{editingId ? 'Edit the job posting' : 'Add a job posting'}</h2></div><button type="button" className="secondary-button" onClick={() => setFormOpen(false)}>Cancel</button></header>
    <form className="job-dialog-form" onSubmit={event => void save(event)} noValidate>
      <div className="form-grid">
        <label>Job title<input id="job-field-title" required maxLength={200} {...field('title')} />{errors.title && <span id="job-title-error" className="field-error">{errors.title}</span>}</label>
        <label>Company<input id="job-field-company" required maxLength={200} {...field('company')} />{errors.company && <span id="job-company-error" className="field-error">{errors.company}</span>}</label>
        <label className="wide-field">Full job posting<textarea id="job-field-description" rows={12} required {...field('description')} /><span className="field-hint">Enter the complete posting text manually. It is saved on this device.</span>{errors.description && <span id="job-description-error" className="field-error">{errors.description}</span>}</label>
        <fieldset className="wide-field job-contacts"><legend>Contacts (optional)</legend><p>These manually entered contacts belong to this saved job only. They are not used for CV tailoring. Profile links open only when you select the button.</p>
          {contacts.map((contact, index) => <div className="job-contact-fields" key={contact.id}>
            <label>Name<input maxLength={120} value={contact.name} aria-invalid={!!contactError(index, 'name')} aria-describedby={contactError(index, 'name') ? `contact-${contact.id}-name-error` : undefined} onChange={event => updateContact(contact, index, 'name', event.target.value)} />{contactError(index, 'name') && <span id={`contact-${contact.id}-name-error`} className="field-error">{contactError(index, 'name')}</span>}</label>
            <label>Role<input maxLength={80} placeholder="Recruiter, HR, or another role" value={contact.role} aria-invalid={!!contactError(index, 'role')} aria-describedby={contactError(index, 'role') ? `contact-${contact.id}-role-error` : undefined} onChange={event => updateContact(contact, index, 'role', event.target.value)} />{contactError(index, 'role') && <span id={`contact-${contact.id}-role-error`} className="field-error">{contactError(index, 'role')}</span>}</label>
            <label>Profile URL (HTTPS only)<input type="url" maxLength={2048} value={contact.profileUrl ?? ''} aria-invalid={!!contactError(index, 'profileUrl')} aria-describedby={contactError(index, 'profileUrl') ? `contact-${contact.id}-url-error` : undefined} onChange={event => updateContact(contact, index, 'profileUrl', event.target.value || null)} />{contactError(index, 'profileUrl') && <span id={`contact-${contact.id}-url-error`} className="field-error">{contactError(index, 'profileUrl')}</span>}</label>
            <button type="button" className="secondary-button" onClick={() => setContacts(rows => rows.filter(row => row.id !== contact.id))}>Remove contact</button>
          </div>)}
          <button type="button" className="secondary-button" disabled={contacts.length >= 20} onClick={() => setContacts(rows => [...rows, newContact()])}>Add contact</button>
          {editingRecord?.contacts.map(contact => contact.profileUrl && <p key={`open-${contact.id}`}><button type="button" className="secondary-button" onClick={() => void window.workbench.openContactProfile(contact.profileUrl!).then(result => { setMessage(result.message); setMessageError(false) }).catch(error => { setMessage(String(error)); setMessageError(true) })}>Open {contact.name || 'contact'} profile</button></p>)}
        </fieldset>
      </div>
      <p className="job-form-guidance">Previous posting snapshots and URL provenance, if any, remain read-only history. Editing contacts does not create a posting revision.</p>
      <footer className="job-dialog-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save job'}</button></footer>
      {message && formOpen && <p className={`saved-jobs-message${messageError ? ' is-error' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p>}
    </form>
    {editingRecord && <section className="posting-history" aria-label="Posting source and revision history"><h3>Posting history</h3>{editingRecord.sourceSnapshot ? <><p>Historical source snapshot — read-only</p><p>Source URL: <span className="inert-source-url">{editingRecord.sourceSnapshot.submittedUrl}</span></p><pre>{editingRecord.sourceSnapshot.description}</pre>{editingRecord.sourceHistory.map((snapshot, index) => <section key={`${snapshot.sourceIdentity}-${snapshot.capturedAt}`}><h4>Earlier source snapshot {index + 1}</h4><p>Source URL: <span className="inert-source-url">{snapshot.submittedUrl}</span></p><pre>{snapshot.description}</pre></section>)}</> : <p>Unknown — this manual posting has no captured source snapshot.</p>}{editingRecord.revisions.length > 0 && <ol>{editingRecord.revisions.map(revision => <li key={revision.revision}>Revision {revision.revision} · {new Date(revision.acceptedAt).toLocaleString()}: {revision.title} at {revision.company}</li>)}</ol>}</section>}
  </section>

  const intakeVisible = formOpen || jobs.length === 0
  const selectedJobs = jobs.filter(job => selectedIds.includes(job.id))
  return <div className="saved-jobs-page">
    <header className="saved-jobs-page-header"><div><p className="context">Your applications</p><h1 ref={headingRef} tabIndex={-1}>Give every CV a clear target.</h1><p>Saved postings, drafts, and the evidence behind them.</p></div><button type="button" className="primary-button" onClick={beginNew}>New job</button></header>
    {message && !formOpen && <p className={`saved-jobs-message${messageError ? ' is-error' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p>}
    {jobs.length > 0 && <div className="saved-jobs-selection"><label><input type="checkbox" aria-label="Select all saved jobs" checked={selectedJobs.length === jobs.length} onChange={() => setSelectedIds(selectedJobs.length === jobs.length ? [] : jobs.map(job => job.id))} /> Select all jobs shown</label><span>{selectedJobs.length} selected</span><button type="button" className="destructive-button" disabled={!selectedJobs.length} onClick={() => void previewDelete(selectedJobs)}>Delete {selectedJobs.length}</button>{needsDeletionReview && selectedJobs.length > 0 && <button type="button" className="secondary-button" onClick={() => void previewDelete(selectedJobs)}>Review selection again</button>}</div>}
    {intakeVisible && renderForm()}
    {jobs.length > 0 && <table className="saved-jobs-table"><thead><tr><th scope="col">Posting</th><th scope="col">Draft status</th><th scope="col">Next action</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id} className={`saved-job-row${activeJob?.id === job.id ? ' is-selected' : ''}`} aria-current={activeJob?.id === job.id ? 'true' : undefined}>
      <td data-label="Posting"><label className="saved-job-select"><input type="checkbox" aria-label={`Select ${job.title} at ${job.company}`} checked={selectedIds.includes(job.id)} onChange={() => setSelectedIds(current => current.includes(job.id) ? current.filter(id => id !== job.id) : [...current, job.id])} /></label><strong>{job.title}</strong><span>{job.company}</span>{job.contacts.length > 0 && <span>{job.contacts.length} manually saved contact{job.contacts.length === 1 ? '' : 's'}</span>}</td>
      <td data-label="Draft status">{labels[job.id] ?? 'No draft'}</td>
      <td data-label="Next action" className="saved-job-actions"><button type="button" className="primary-button" onClick={() => void openJob(job.id)}>Open posting</button><button type="button" className="secondary-button" aria-label={`Edit ${job.title} posting`} onClick={() => void beginEdit(job.id)}>Edit</button><button type="button" className="destructive-button" onClick={() => void previewDelete([job])}>Delete</button></td>
    </tr>)}</tbody></table>}
    {!jobs.length && !formOpen && <section className="saved-jobs-empty"><FolderOpen aria-hidden="true"/><h2>Your first job starts here</h2><p>Enter a job title, company, and the complete posting text to save a target for your CV.</p><button type="button" className="primary-button" onClick={beginNew}>Add a job posting</button></section>}
    <p className="saved-jobs-history-note">Saved posting history remains on this device. Historical source URLs are shown as read-only provenance; they are never fetched or opened from this page.</p>
    <dialog className="deletion-dialog" ref={dialogRef} aria-labelledby="delete-job-title" onCancel={event => { event.preventDefault(); setDeleting([]); setDeleteToken(undefined) }}>
      <h2 id="delete-job-title">{deleting.length > 1 ? `Delete ${deleting.length} saved jobs?` : 'Delete this saved job?'}</h2><p>{deleteMessage}</p><footer className="job-dialog-actions"><button type="button" className="secondary-button" ref={cancelRef} onClick={() => { setDeleting([]); setDeleteToken(undefined) }}>Cancel</button><button type="button" className="destructive-button" disabled={!deleteToken || deleteBusy} onClick={() => void executeDelete()}>{deleteBusy ? 'Deleting…' : `Delete ${deleting.length} ${deleting.length === 1 ? 'job' : 'jobs'}`}</button></footer>
    </dialog>
  </div>
}
