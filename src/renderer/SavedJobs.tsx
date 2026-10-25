import React, { FormEvent, useEffect, useRef, useState } from 'react'
import { FolderOpen, Plus } from 'lucide-react'
import type { JobDeletionPreview, JobInput, JobRecord, PostingRefreshChoice } from '../shared/jobs'
import type { PostingPreview } from '../shared/posting-import'
import { samePostingSource } from '../shared/posting-identity'
import type { DraftRevision } from '../shared/draft'

type ReadyDeletionPreview = JobDeletionPreview & { ok: true; token: string; jobs: NonNullable<JobDeletionPreview['jobs']> }
type DeletionFlow =
  | { kind: 'closed' }
  | { kind: 'previewing'; jobIds: string[] }
  | { kind: 'confirming'; jobIds: string[]; preview: ReadyDeletionPreview }
  | { kind: 'submitting'; jobIds: string[]; preview: ReadyDeletionPreview }
import './jobs.css'

type DraftLabel = 'No draft' | 'Needs review' | 'Earlier target' | 'Blocked' | 'Approved'
const defaultRefreshChoices = (): PostingRefreshChoice => ({ title: 'working', company: 'working', description: 'working', optionalDetails: {} })
const optionalPostingFields = [
  ['location', 'Location'], ['workArrangement', 'Work arrangement'], ['employmentType', 'Employment type'], ['compensation', 'Compensation'],
  ['language', 'Language'], ['postedDate', 'Posted date'], ['deadline', 'Deadline'], ['applicationUrl', 'Application URL']
] as const

export function SavedJobs({ jobs, activeJob, onSaved, onOpened, onDeleted, onNavigate }: { jobs: JobRecord[]; activeJob: JobRecord | null; onSaved: (job: JobRecord) => void; onOpened: (job: JobRecord) => void; onDeleted: (jobIds: string[]) => Promise<void>; onNavigate: (page: 'Tailor CV') => void }) {
  const [input, setInput] = useState<JobInput>({ title: '', company: '', description: '' })
  const [editingId, setEditingId] = useState<string | undefined>()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [draftLabels, setDraftLabels] = useState<Record<string, DraftLabel>>({})
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([])
  const [deletionFlow, setDeletionFlow] = useState<DeletionFlow>({ kind: 'closed' })
  const [deletionError, setDeletionError] = useState('')
  const deletionSequence = useRef(0)
  const deleteSubmitBusy = useRef(false)
  const deletionDialogRef = useRef<HTMLDialogElement>(null)
  const deletionCancelRef = useRef<HTMLButtonElement>(null)
  const deletionReturnFocus = useRef<HTMLElement | null>(null)
  const restoreDeletionFocus = useRef(false)
  const deletionErrorRef = useRef<HTMLParagraphElement>(null)
  const pageHeadingRef = useRef<HTMLHeadingElement>(null)
  const [captureMode, setCaptureMode] = useState<'manual' | 'link'>('manual')
  const [sourceUrl, setSourceUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchToken, setFetchToken] = useState<string>()
  const [preview, setPreview] = useState<import('../shared/posting-import').PostingPreview | null>(null)
  const [capturedPreview, setCapturedPreview] = useState<import('../shared/posting-import').PostingPreview | null>(null)
  const [completenessConfirmed, setCompletenessConfirmed] = useState(false)
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, string>>({})
  const [refreshComparison, setRefreshComparison] = useState<{ ok: boolean; unchanged?: boolean; previousSource?: JobRecord['sourceSnapshot']; working?: JobInput; newSource?: PostingPreview; message?: string } | null>(null)
  const [refreshChoices, setRefreshChoices] = useState<PostingRefreshChoice>(defaultRefreshChoices)
  const [discardIntent, setDiscardIntent] = useState<'close' | 'manual' | 'discard' | 'new' | 'open-existing' | null>(null)
  const [discardTargetJobId, setDiscardTargetJobId] = useState<string>()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const discardDialogRef = useRef<HTMLDialogElement>(null)
  const fetchOperationRef = useRef(0)
  const editRevisionRef = useRef(0)
  const refreshComparisonKeyRef = useRef('')
  const editQueueRef = useRef<Promise<void>>(Promise.resolve())
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (dialogOpen && !dialog.open) { dialog.showModal(); requestAnimationFrame(() => titleRef.current?.focus()) }
    else if (!dialogOpen && dialog.open) dialog.close()
  }, [dialogOpen])

  useEffect(() => {
    const dialog = deletionDialogRef.current
    if (!dialog) return
    const shouldOpen = deletionFlow.kind === 'confirming' || deletionFlow.kind === 'submitting'
    if (shouldOpen && !dialog.open) { dialog.showModal(); requestAnimationFrame(() => deletionCancelRef.current?.focus()) }
    else if (!shouldOpen && dialog.open) {
      dialog.close()
      if (restoreDeletionFocus.current) requestAnimationFrame(() => {
        const target = deletionReturnFocus.current
        if (target?.isConnected) target.focus()
        else pageHeadingRef.current?.focus()
        restoreDeletionFocus.current = false
      })
    }
  }, [deletionFlow.kind])

  useEffect(() => {
    setSelectedJobIds(current => current.filter(id => jobs.some(job => job.id === id)))
  }, [jobs])

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

  function previewWasEdited() { return !!preview && !!capturedPreview && JSON.stringify(preview) !== JSON.stringify(capturedPreview) }
  function toggleSelectedJob(id: string) {
    deletionSequence.current++
    setDeletionError('')
    setDeletionFlow({ kind: 'closed' })
    setSelectedJobIds(current => current.includes(id) ? current.filter(selected => selected !== id) : [...current, id])
  }
  function toggleAllVisibleJobs() {
    deletionSequence.current++
    setDeletionError('')
    setDeletionFlow({ kind: 'closed' })
    setSelectedJobIds(current => current.length === jobs.length ? [] : jobs.map(job => job.id))
  }
  function reportDeletionError(message: string) {
    setDeletionError(message)
    requestAnimationFrame(() => deletionErrorRef.current?.focus())
  }
  function describeDeletionFailure(message: string) {
    const busyJob = jobs.find(job => message.includes(job.id))
    return busyJob && /stop /i.test(message)
      ? `${busyJob.title} at ${busyJob.company} is busy. ${message.replace(busyJob.id, `${busyJob.title} at ${busyJob.company}`)} Open Tailor CV and stop that operation, then review this selection again.`
      : message
  }
  async function previewDeletion(jobIds = selectedJobIds) {
    if (!jobIds.length || deletionFlow.kind === 'previewing' || deletionFlow.kind === 'submitting') return
    const sequence = ++deletionSequence.current
    deletionReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    restoreDeletionFocus.current = false
    setDeletionError('')
    setDeletionFlow({ kind: 'previewing', jobIds })
    try {
      const preview = await window.workbench.previewJobDeletion(jobIds)
      if (sequence !== deletionSequence.current) return
      if (!preview.ok || !preview.token || !preview.jobs) {
        setDeletionFlow({ kind: 'closed' }); reportDeletionError(describeDeletionFailure(preview.message)); return
      }
      setDeletionFlow({ kind: 'confirming', jobIds, preview: { ...preview, ok: true, token: preview.token, jobs: preview.jobs } })
    } catch (failure) {
      if (sequence === deletionSequence.current) { setDeletionFlow({ kind: 'closed' }); reportDeletionError(failure instanceof Error ? failure.message : 'The selection could not be checked. Retry the review.') }
    }
  }
  async function executeDeletion() {
    if (deletionFlow.kind !== 'confirming' || deleteSubmitBusy.current) return
    deleteSubmitBusy.current = true
    const { jobIds, preview } = deletionFlow
    setDeletionFlow({ kind: 'submitting', jobIds, preview })
    setDeletionError('')
    let result: Awaited<ReturnType<typeof window.workbench.executeJobDeletion>>
    try { result = await window.workbench.executeJobDeletion(preview.token, jobIds) }
    catch (failure) {
      setDeletionFlow({ kind: 'closed' })
      restoreDeletionFocus.current = false
      reportDeletionError(failure instanceof Error ? failure.message : 'Storage could not delete the selection. Nothing was removed. Retry after checking workspace storage.')
      deleteSubmitBusy.current = false
      return
    }
    if (!result.ok) {
      restoreDeletionFocus.current = false
      setDeletionFlow({ kind: 'closed' }); reportDeletionError(describeDeletionFailure(result.message))
      deleteSubmitBusy.current = false
      return
    }
    restoreDeletionFocus.current = false
    setDeletionFlow({ kind: 'closed' })
    setSelectedJobIds(current => current.filter(id => !jobIds.includes(id)))
    setMessage(result.message); setMessageError(false)
    try {
      await onDeleted(jobIds)
      requestAnimationFrame(() => (document.querySelector<HTMLInputElement>('.saved-job-row input[type="checkbox"]') ?? pageHeadingRef.current)?.focus())
    } catch { reportDeletionError('The selected jobs were deleted, but the saved-job list could not refresh. Restart CV Tailor to view the current list.') }
    finally { deleteSubmitBusy.current = false }
  }
  function closeDeletionDialog() {
    restoreDeletionFocus.current = true
    deletionSequence.current++
    setDeletionFlow({ kind: 'closed' })
  }
  const deletionPending = deletionFlow.kind === 'previewing' || deletionFlow.kind === 'submitting'
  const allVisibleSelected = jobs.length > 0 && selectedJobIds.length === jobs.length
  const someVisibleSelected = selectedJobIds.length > 0 && selectedJobIds.length < jobs.length
  function enqueuePreviewEdit(next: import('../shared/posting-import').PostingPreview) {
    setPreview(next); setCompletenessConfirmed(false)
    const token = fetchToken
    if (!token) return
    const expectedRevision = editRevisionRef.current++
    editQueueRef.current = editQueueRef.current.catch(() => {}).then(async () => {
      const result = await window.workbench.updatePostingPreview(token, expectedRevision, { title: next.title, company: next.company ?? '', description: next.description, optionalDetails: next.optionalDetails })
      if (!result.ok || result.revision !== expectedRevision + 1) {
        setMessage(result.message ?? 'The preview changed concurrently. Fetch it again before saving.'); setMessageError(true)
        throw new Error('Preview edit was not accepted.')
      }
    })
  }
  function selectConflictValue(field: import('../shared/posting-import').PostingFieldConflict['field'], value: string) {
    if (!preview) return
    const next = field === 'title' || field === 'company' ? { ...preview, [field]: value }
      : field === 'description' ? { ...preview, description: value }
      : { ...preview, optionalDetails: { ...preview.optionalDetails, [field]: { ...preview.optionalDetails[field], value, origin: 'user-correction' as const } } }
    setConflictResolutions(current => ({ ...current, [field]: value })); enqueuePreviewEdit(next)
  }
  function updateOptionalDetail(field: typeof optionalPostingFields[number][0], value: string) {
    if (!preview) return
    setConflictResolutions(current => { const next = { ...current }; delete next[field]; return next })
    const previous = preview.optionalDetails[field]
    enqueuePreviewEdit({ ...preview, optionalDetails: { ...preview.optionalDetails, [field]: { ...previous, value: value.trim() ? value : null, origin: value.trim() ? previous.value === value ? previous.origin : 'user-correction' : 'unknown' } } })
  }
  async function confirmPostingReview(checked: boolean) {
    if (!fetchToken) return
    if (!checked) { setCompletenessConfirmed(false); await editQueueRef.current.catch(() => {}); await window.workbench.reviewPostingPreview(fetchToken, editRevisionRef.current, { completenessConfirmed: false, conflictResolutions }); return }
    try {
      await editQueueRef.current
      const result = await window.workbench.reviewPostingPreview(fetchToken, editRevisionRef.current, { completenessConfirmed: true, conflictResolutions })
      if (!result.ok) { setCompletenessConfirmed(false); setMessage(result.message ?? 'Review the current posting before saving.'); setMessageError(true); return }
      setCompletenessConfirmed(true); setMessageError(false)
    } catch { setCompletenessConfirmed(false); setMessage('The preview edit was not accepted. Fetch it again before saving.'); setMessageError(true) }
  }
  function discardFetchPreview() { fetchOperationRef.current++; refreshComparisonKeyRef.current = ''; if (fetchToken) void window.workbench.cancelPostingFetch(fetchToken); setRefreshChoices(defaultRefreshChoices()); setFetching(false); setFetchToken(undefined); setPreview(null); setCapturedPreview(null); setCompletenessConfirmed(false); setConflictResolutions({}); editRevisionRef.current = 0; editQueueRef.current = Promise.resolve() }
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
    setRefreshChoices(defaultRefreshChoices()); setFetching(true); setPreview(null); setFetchToken(undefined); setMessage('Fetching one Lever job detail…'); setMessageError(false)
    try {
      const { token } = await window.workbench.startPostingFetch(sourceUrl)
      if (operation !== fetchOperationRef.current) { void window.workbench.cancelPostingFetch(token); return }
      setFetchToken(token)
      while (operation === fetchOperationRef.current) {
        const state = await window.workbench.readPostingPreview(token)
        if (operation !== fetchOperationRef.current) return
        if (state.status === 'fetching') { await new Promise(resolve => window.setTimeout(resolve, 150)); continue }
        if (state.status === 'ready' || state.status === 'incomplete') { setPreview(state.preview); setCapturedPreview(state.preview); setCompletenessConfirmed(false); setConflictResolutions({}); editRevisionRef.current = 0; editQueueRef.current = Promise.resolve(); setMessage(state.status === 'incomplete' ? 'The source is incomplete and needs review. Nothing has been saved.' : 'Temporary preview loaded; extraction cannot guarantee completeness. Nothing has been saved.'); setMessageError(state.status === 'incomplete'); break }
        if (state.status === 'cancelled') { setMessage('Fetch cancelled.'); setMessageError(false); break }
        setMessage(state.message); setMessageError(true); break
      }
    } catch (error) { if (operation === fetchOperationRef.current) { setMessage(error instanceof Error ? error.message : 'Fetch failed. Open the source or paste posting text instead.'); setMessageError(true) } }
    finally { if (operation === fetchOperationRef.current) setFetching(false) }
  }
  function newJob() {
    if (previewWasEdited()) { requestDiscard('new'); return }
    const hasUnfinishedEntry = !editingId && [input.title, input.company, input.description].some(value => value.trim())
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
  async function acceptRefreshedPosting() {
    if (!fetchToken || !preview || !sourceMatch) return
    setBusy(true); setMessage('Accepting selected posting changes…'); setMessageError(false)
    try {
      await editQueueRef.current
      const result = await window.workbench.acceptPostingRefresh(fetchToken, editRevisionRef.current, sourceMatch.id, sourceMatch.updatedAt, sourceMatch.revisions.at(-1)?.revision ?? 0, refreshChoices)
      if (!result.ok) { setMessage(result.error.message); setMessageError(true); return }
      onSaved(result.value); setMessage('Posting refresh accepted. No analysis or model request was started.'); setIntakeOpen(false); discardFetchPreview()
    } catch { setMessage('The refreshed posting could not be accepted. Your saved posting is unchanged.'); setMessageError(true) }
    finally { setBusy(false) }
  }
  async function saveImportedPosting() {
    if (!fetchToken || !preview) return
    setBusy(true); setErrors({}); setMessage('Saving reviewed job posting…'); setMessageError(false)
    try {
      await editQueueRef.current
      const result = await window.workbench.acceptPostingImport(fetchToken, editRevisionRef.current)
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
  const field = (key: 'title' | 'company' | 'description') => ({ value: input[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setInput(value => ({ ...value, [key]: event.target.value })); setErrors(value => ({ ...value, [key]: '' })) }, 'aria-invalid': !!errors[key], 'aria-describedby': errors[key] ? `job-${key}-error` : undefined })
  const renderFields = () => <div className="form-grid">
    <label>Job title<input id="job-field-title" ref={titleRef} required {...field('title')} />{errors.title && <span id="job-title-error" className="field-error">{errors.title}</span>}</label>
    <label>Company<input id="job-field-company" required {...field('company')} />{errors.company && <span id="job-company-error" className="field-error">{errors.company}</span>}</label>
    <label className="wide-field">Posting and requirements<textarea id="job-field-description" rows={9} required maxLength={400000} {...field('description')} aria-describedby={`job-description-help${errors.description ? ' job-description-error' : ''}`} /><span id="job-description-help" className="field-hint">Complete posting text is saved up to 200,000 characters and 1 MiB of UTF-8 text. Longer text is rejected without truncation.</span>{errors.description && <span id="job-description-error" className="field-error">{errors.description}</span>}</label>
  </div>
  const editedJob = editingId ? jobs.find(job => job.id === editingId) : undefined
  const intakeVisible = intakeOpen || jobs.length === 0
  const sourceMatch = (() => { if (!preview) return undefined; return jobs.find(job => job.sourceSnapshot && samePostingSource(job.sourceSnapshot, preview)) })()
  const sourceMatchIsUnchanged = !!refreshComparison?.ok && refreshComparison.unchanged
  const sourceMatchRevision = sourceMatch?.revisions.at(-1)?.revision ?? 0
  useEffect(() => {
    if (!preview || !fetchToken || !sourceMatch) { setRefreshComparison(null); return }
    const comparisonKey = `${fetchToken}:${sourceMatch.id}:${sourceMatch.updatedAt}:${sourceMatchRevision}`
    if (refreshComparisonKeyRef.current !== comparisonKey) { refreshComparisonKeyRef.current = comparisonKey; setRefreshChoices(defaultRefreshChoices()) }
    let current = true
    setRefreshComparison(null)
    window.workbench.comparePostingRefresh(fetchToken, sourceMatch.id, sourceMatch.updatedAt, sourceMatch.revisions.at(-1)?.revision ?? 0).then(result => { if (current) setRefreshComparison(result) }).catch(() => { if (current) setRefreshComparison({ ok: false, message: 'The saved posting could not be compared. Reopen it and try again.' }) })
    return () => { current = false }
  }, [preview, fetchToken, sourceMatch?.id, sourceMatch?.updatedAt, sourceMatchRevision])

  const renderIntake = (insideEmptyState = false) => <section className={`saved-jobs-intake${insideEmptyState ? ' is-inside-empty' : ''}`} aria-labelledby="posting-intake-title">
    <header className="saved-jobs-intake-heading"><div><p className="context">New job</p><h2 id="posting-intake-title">Add a job posting</h2></div>{jobs.length > 0 && <button type="button" className="secondary-button" onClick={closeIntake}>Cancel</button>}</header>
    <fieldset><legend>Choose how to add a posting</legend><div className="job-dialog-actions"><button type="button" className="secondary-button" aria-pressed={captureMode === 'link'} onClick={() => setCaptureMode('link')}>Import from link</button><button type="button" className="secondary-button" aria-pressed={captureMode === 'manual'} onClick={() => { if (fetching) discardFetchPreview(); if (previewWasEdited()) requestDiscard('manual'); else { setPreview(null); setCapturedPreview(null); setCaptureMode('manual') } }}>Paste posting text instead</button></div></fieldset>
    {captureMode === 'link' ? <section className="posting-link-entry" aria-label="Import from link"><label htmlFor="posting-source-url">Public Lever posting link</label><input id="posting-source-url" type="url" disabled={fetching} value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://jobs.lever.co/company/posting-id" /><p>{sourceHostname ? `Source hostname: ${sourceHostname}` : 'Paste a public HTTPS posting link.'} Supported links: named Lever-hosted pages and exact Lever posting-detail API URLs only. Fetch contacts the source and exposes your normal network address and request metadata. No profile or model data is sent.</p><div className="job-dialog-actions"><button type="button" className="primary-button" disabled={fetching || !sourceUrl.trim()} onClick={() => void fetchPosting()}>{fetching ? 'Fetching…' : 'Fetch posting'}</button>{fetching && <button type="button" className="secondary-button" disabled={!fetchToken} onClick={() => { discardFetchPreview(); setMessage('Fetch cancelled.'); setMessageError(false) }}>Cancel fetch</button>}<button type="button" className="secondary-button" disabled={fetching || !sourceUrl.trim()} onClick={() => void window.workbench.openPostingSource(sourceUrl).then(result => { setMessage(result.message); setMessageError(false) }).catch(error => { setMessage(String(error)); setMessageError(true) })}>Open original posting</button></div>{message && intakeVisible && <p className={`saved-jobs-message${messageError ? ' is-error' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p>}{preview && <section className="posting-import-preview" aria-label="Posting import preview"><h3>Temporary posting import preview</h3><p>Submitted: {preview.submittedUrl}</p><p>Fetched from: {preview.finalUrl}</p>{capturedPreview && <section className="posting-captured-source" aria-label="Captured source wording"><h4>Captured source wording (read-only)</h4><pre>{capturedPreview.description}</pre></section>}<div className="posting-preview-fields"><label>Job title<input value={preview.title} onChange={event => { if (preview) { setConflictResolutions(value => { const next = { ...value }; delete next.title; return next }); enqueuePreviewEdit({ ...preview, title: event.target.value }) } }} /></label><label>Company<input value={preview.company ?? ''} placeholder="Enter the employer name" onChange={event => { if (preview) { setConflictResolutions(value => { const next = { ...value }; delete next.company; return next }); enqueuePreviewEdit({ ...preview, company: event.target.value }) } }} />{capturedPreview?.company === null && <span className="field-help">The source did not provide an employer name. Any value you enter is your correction, not captured source text.</span>}</label><label className="wide-field">Posting and requirements<textarea rows={12} value={preview.description} onChange={event => { if (preview) enqueuePreviewEdit({ ...preview, description: event.target.value }) }} /><span className="field-help">Edits are your working wording; the captured source above remains unchanged.</span></label></div><fieldset className="posting-optional-details"><legend>Optional details — unknown unless the source provided a value</legend><div className="posting-preview-fields">{optionalPostingFields.map(([field, label]) => { const detail = preview.optionalDetails[field]; return <label key={field}>{label}<input value={detail.value ?? ''} placeholder="Unknown" onChange={event => updateOptionalDetail(field, event.target.value)} /><span className="field-help">{detail.origin === 'user-correction' ? `Your correction; captured source: ${capturedPreview?.optionalDetails[field].value ?? 'Unknown'}.` : detail.value === null ? 'Unknown — not provided by source.' : `Source: ${detail.source ?? detail.origin}${detail.uncertainty === 'relative-date' ? ' · Relative date; kept as written.' : ''}`}</span></label> })}</div></fieldset>{preview.conflicts.map(conflict => <fieldset className="posting-source-conflict" key={conflict.id}><legend>Conflicting {conflict.field} values — choose one source value</legend>{conflict.values.map(candidate => <label key={`${candidate.source}:${candidate.value}`}><input type="radio" name={`posting-conflict-${conflict.id}`} value={candidate.value} checked={conflictResolutions[conflict.id] === candidate.value} onChange={() => selectConflictValue(conflict.field, candidate.value)} /> {candidate.value} <span>Source: {candidate.source}</span></label>)}</fieldset>)}{preview.notices.map(notice => <p role="status" key={notice}>{notice}</p>)}<label className="posting-completeness-review"><input type="checkbox" checked={completenessConfirmed} onChange={event => void confirmPostingReview(event.target.checked)} /> I reviewed the full posting and corrected missing or partial content. I understand completeness cannot be guaranteed.</label><p>Extraction method: {preview.extractionMethod === 'lever-html-jsonld-v1' ? 'Lever-hosted structured data and readable page text' : preview.extractionMethod === 'lever-html-static-v1' ? 'Lever-hosted readable static text' : 'Lever posting detail data'}. Review and correct the complete posting before saving. Company names are not inferred when the source omits them. Saving does not contact the source or start model analysis.</p>{sourceMatch && <div className="saved-jobs-message" role="status">{!refreshComparison ? 'Checking the saved source against this refresh…' : !refreshComparison.ok ? refreshComparison.message : sourceMatchIsUnchanged ? 'This exact posting is already saved. No new revision is needed.' : 'This exact source has changed. Review the previous source, your current wording, and the new source before accepting anything.'}{refreshComparison?.ok && refreshComparison.unchanged && <div className="job-dialog-actions"><button type="button" className="secondary-button" onClick={() => openExisting(sourceMatch.id)}>Open existing</button></div>}{refreshComparison?.ok && !refreshComparison.unchanged && refreshComparison.previousSource && refreshComparison.working && refreshComparison.newSource && <section className="posting-refresh-comparison" aria-label="Refresh comparison"><h4>Review changes</h4><div className="posting-refresh-columns"><section aria-label="Previous source"><h5>Previous source</h5><p>{refreshComparison.previousSource.title} — {refreshComparison.previousSource.company}</p><dl>{optionalPostingFields.map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{refreshComparison.previousSource?.optionalDetails[field].value ?? 'Unknown'}</dd></div>)}</dl><pre>{refreshComparison.previousSource.description}</pre></section><section aria-label="Current working posting"><h5>Your current working posting</h5><p>{refreshComparison.working.title} — {refreshComparison.working.company}</p><dl>{optionalPostingFields.map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{refreshComparison.working?.optionalDetails?.[field]?.value ?? 'Unknown'}</dd></div>)}</dl><pre>{refreshComparison.working.description}</pre></section><section aria-label="New source"><h5>New source</h5><p>{refreshComparison.newSource.title} — {refreshComparison.newSource.company ?? 'Unknown company'}</p><dl>{optionalPostingFields.map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{refreshComparison.newSource?.optionalDetails[field].value ?? 'Unknown'}</dd></div>)}</dl><pre>{refreshComparison.newSource.description}</pre></section></div><fieldset><legend>Choose wording for the accepted working posting. Your current wording is kept by default.</legend>{(['title', 'company', 'description'] as const).map(field => <div className="posting-refresh-choice" key={field}><strong>{field === 'description' ? 'Posting text' : field === 'title' ? 'Job title' : 'Company'}</strong><label><input type="radio" name={`refresh-${field}`} checked={refreshChoices[field] === 'working'} onChange={() => setRefreshChoices(value => ({ ...value, [field]: 'working' }))} /> Keep current</label><label><input type="radio" name={`refresh-${field}`} checked={refreshChoices[field] === 'source'} onChange={() => setRefreshChoices(value => ({ ...value, [field]: 'source' }))} /> Use new source</label></div>)}{optionalPostingFields.map(([field, label]) => <div className="posting-refresh-choice" key={field}><strong>{label}</strong><label><input type="radio" name={`refresh-${field}`} checked={refreshChoices.optionalDetails[field] !== 'source'} onChange={() => setRefreshChoices(value => ({ ...value, optionalDetails: { ...value.optionalDetails, [field]: 'working' } }))} /> Keep current</label><label><input type="radio" name={`refresh-${field}`} checked={refreshChoices.optionalDetails[field] === 'source'} onChange={() => setRefreshChoices(value => ({ ...value, optionalDetails: { ...value.optionalDetails, [field]: 'source' } }))} /> Use new source</label></div>)}</fieldset><p>Only accepted changes to the job title, company, or posting text can make current targeting and CV approval stale. Refreshing never starts a model request.</p><button type="button" className="primary-button" disabled={busy || fetching || !completenessConfirmed || !preview.title.trim() || !preview.company?.trim() || !preview.description.trim() || preview.conflicts.some(conflict => !conflictResolutions[conflict.id])} onClick={() => void acceptRefreshedPosting()}>{busy ? 'Accepting…' : 'Accept selected changes'}</button></section>}</div>}<div className="job-dialog-actions"><button type="button" className="primary-button" disabled={busy || fetching || !!sourceMatch || !completenessConfirmed || !preview.title.trim() || !preview.company?.trim() || !preview.description.trim() || preview.conflicts.some(conflict => !conflictResolutions[conflict.id])} onClick={() => void saveImportedPosting()}>{busy ? 'Saving…' : 'Save job'}</button>{!sourceMatch && <button type="button" className="secondary-button" disabled={busy} onClick={() => requestDiscard('discard')}>Discard preview</button>}</div></section>}</section> : <form className="job-dialog-form" onSubmit={event => void save(event)} noValidate>{renderFields()}<p className="job-form-guidance">Manual posting text has unknown source provenance and is saved on this device.</p>{message && intakeVisible && <p className={`saved-jobs-message${messageError ? ' is-error' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p>}<footer className="job-dialog-actions">{jobs.length > 0 && <button className="secondary-button" type="button" onClick={closeIntake}>Cancel</button>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save job'}</button></footer></form>}
  </section>

  return <div className="saved-jobs-page">
    <header className="saved-jobs-heading">
      <div><p className="context">Your applications</p><h1 ref={pageHeadingRef} tabIndex={-1}>Give every CV a clear target.</h1><p>Saved postings, drafts, and the evidence behind them.</p></div>
      <button className="primary-button" type="button" onClick={newJob}><Plus size={17} aria-hidden="true" /> New job</button>
    </header>
    {jobs.length > 0 && <section className="saved-jobs-selection" aria-label="Saved job selection">
      <label><input type="checkbox" checked={allVisibleSelected} ref={element => { if (element) element.indeterminate = someVisibleSelected }} onChange={toggleAllVisibleJobs} aria-label="Select all saved jobs" /> Select all saved jobs</label>
      <span aria-live="polite">{selectedJobIds.length} selected</span>
      <button className="danger-button" type="button" disabled={!selectedJobIds.length || deletionPending} onClick={() => void previewDeletion()}>{deletionFlow.kind === 'previewing' ? 'Checking selection…' : `Delete${selectedJobIds.length ? ` ${selectedJobIds.length}` : ''}`}</button>
    </section>}
    {jobs.length > 0 && intakeOpen && renderIntake()}
    {jobs.length ? <section className="saved-jobs-table" aria-label="Saved jobs"><table><thead><tr><th scope="col">Posting</th><th scope="col">Draft status</th><th scope="col">Next action</th></tr></thead><tbody>
      {jobs.map(job => <tr className="saved-job-row" key={job.id} aria-current={activeJob?.id === job.id ? 'true' : undefined}>
        <td data-label="Posting"><div className="saved-job-posting-cell"><label className="saved-job-select"><input type="checkbox" checked={selectedJobIds.includes(job.id)} disabled={deletionPending} onChange={() => toggleSelectedJob(job.id)} aria-label={`Select ${job.title} at ${job.company}`} /></label><div className="saved-job-description"><div className="saved-job-title"><strong>{job.title}</strong>{activeJob?.id === job.id && <span className="current-target">Current target</span>}</div><span>{job.company}</span><small>Updated {new Date(job.updatedAt).toLocaleDateString()}</small></div></div></td>
        <td data-label="Draft status"><span className={`draft-status${draftLabels[job.id] === 'Blocked' ? ' is-blocked' : draftLabels[job.id] === 'Approved' ? ' is-approved' : ''}`}>{draftLabels[job.id] ?? 'Checking…'}</span></td>
        <td data-label="Next action"><div className="saved-job-actions"><button className="saved-job-action saved-job-action-primary" type="button" onClick={() => void openForTailoring(job.id)}>Open posting</button><button className="saved-job-action saved-job-action-secondary" type="button" aria-label={`Edit ${job.title} posting`} onClick={() => void loadForEdit(job.id)}>Edit</button><button className="saved-job-action saved-job-action-destructive" type="button" aria-label={`Delete ${job.title} posting`} disabled={deletionPending} onClick={() => { setSelectedJobIds([job.id]); void previewDeletion([job.id]) }}>Delete</button></div></td>
      </tr>)}
    </tbody></table></section> : <section className="saved-jobs-empty"><FolderOpen size={32} aria-hidden="true" /><div><h2>Your first job starts here</h2><p>Save a posting to set a target for your tailored CV.</p></div>{renderIntake(true)}</section>}
    {jobs.length > 0 && <p className="jobs-history-note">Job postings and their draft revisions stay on this device.</p>}
    {deletionError && <p ref={deletionErrorRef} tabIndex={-1} className="saved-jobs-message is-error" role="alert">{deletionError} {deletionError.includes('changed') || deletionError.includes('no longer') ? <button type="button" className="text-button" disabled={deletionPending || !selectedJobIds.length} onClick={() => void previewDeletion()}>Review selection again</button> : deletionError.includes('Stop ') ? <button type="button" className="text-button" onClick={() => onNavigate('Tailor CV')}>Open Tailor CV</button> : <button type="button" className="text-button" disabled={deletionPending || !selectedJobIds.length} onClick={() => void previewDeletion()}>Try again</button>}</p>}
    <dialog ref={deletionDialogRef} className="job-dialog deletion-dialog" aria-labelledby="job-deletion-title" aria-describedby="job-deletion-description" onCancel={event => { event.preventDefault(); if (deletionFlow.kind === 'confirming') closeDeletionDialog() }} onClose={() => { if (deletionFlow.kind === 'confirming') closeDeletionDialog() }}>
      {deletionFlow.kind === 'confirming' || deletionFlow.kind === 'submitting' ? <>
        <header className="job-dialog-heading"><div><p className="context">Delete saved jobs</p><h2 id="job-deletion-title">Delete {deletionFlow.jobIds.length === 1 ? 'this saved job?' : `${deletionFlow.jobIds.length} saved jobs?`}</h2></div></header>
        <section className="job-dialog-form"><p id="job-deletion-description">This permanently removes the selected job postings, their drafts, and local generation history. Profile facts and exported files stay untouched. Older backups may still contain these jobs. Older history without a job link may remain in this workspace and in new backups. This action cannot be undone from this workspace.</p>
          <div className="deletion-preview-list" aria-label="Jobs to delete"><ul>{deletionFlow.preview.jobs.map(job => <li key={job.id}><strong>{job.title}</strong><span>{job.company}</span><small>{job.draftCount} {job.draftCount === 1 ? 'draft' : 'drafts'}</small></li>)}</ul></div>
          <p className="deletion-counts">{deletionFlow.preview.jobs.length} {deletionFlow.preview.jobs.length === 1 ? 'job' : 'jobs'} and {deletionFlow.preview.draftCount ?? 0} {(deletionFlow.preview.draftCount ?? 0) === 1 ? 'draft' : 'drafts'} will be deleted.</p>
          <div className="job-dialog-actions"><button ref={deletionCancelRef} type="button" className="secondary-button" disabled={deletionFlow.kind === 'submitting'} onClick={closeDeletionDialog}>Cancel</button><button type="button" className="danger-button" disabled={deletionFlow.kind === 'submitting'} onClick={() => void executeDeletion()}>{deletionFlow.kind === 'submitting' ? 'Deleting…' : `Delete ${deletionFlow.jobIds.length} ${deletionFlow.jobIds.length === 1 ? 'job' : 'jobs'}`}</button></div>
        </section>
      </> : null}
    </dialog>
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
          {editedJob.sourceSnapshot && <>{editedJob.sourceHistory.length > 0 && <ol aria-label="Earlier posting source snapshots">{editedJob.sourceHistory.map((snapshot, index) => <li key={`${snapshot.capturedAt}-${index}`}><h4>Earlier source snapshot {index + 1}</h4><p>{snapshot.title} — {snapshot.company ?? 'Unknown company'}</p><pre>{snapshot.description}</pre><p>Captured {new Date(snapshot.capturedAt).toLocaleString()}</p></li>)}</ol>}<pre>{editedJob.sourceSnapshot.description}</pre>{editedJob.sourceSnapshot.conflicts.length > 0 && <section aria-label="Captured source disagreements"><h4>Captured source disagreements</h4><ul>{editedJob.sourceSnapshot.conflicts.map(conflict => <li key={conflict.id}><strong>{conflict.field}</strong>: {conflict.values.map(candidate => `${candidate.value} — ${candidate.source}`).join(' / ')}</li>)}</ul></section>}<dl aria-label="Captured source details">{optionalPostingFields.map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{editedJob.sourceSnapshot?.optionalDetails[field].value ?? 'Unknown'}</dd></div>)}</dl></>}
          <p><strong>Working posting:</strong> The editable fields above are the accepted wording.</p><dl aria-label="Accepted working details">{optionalPostingFields.map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{editedJob.optionalDetails[field].value ?? 'Unknown'}{editedJob.optionalDetails[field].origin === 'user-correction' ? ' · Your correction' : ''}</dd></div>)}</dl>
          {editedJob.revisions.length > 0 ? <ol>{editedJob.revisions.map(revision => <li key={revision.revision}><h4>Revision {revision.revision} <span>· {revision.provenance === 'manual' ? 'Manual edit' : 'Legacy provenance unknown'}</span></h4><p>{revision.title} — {revision.company}</p><pre>{revision.description}</pre><dl>{optionalPostingFields.map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{revision.optionalDetails[field].value ?? 'Unknown'}</dd></div>)}</dl></li>)}</ol> : <p>No accepted revision history is available for this legacy posting.</p>}
        </section>}
        <p className="job-form-guidance">Job postings are saved on this device.</p>
        {message && <p className={`saved-jobs-message${messageError ? ' is-error' : ''}`} role={messageError ? 'alert' : 'status'}>{message}</p>}
        <footer className="job-dialog-actions"><button className="secondary-button" type="button" onClick={closeDialog}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></footer>
      </form>
    </dialog>}
  </div>
}
