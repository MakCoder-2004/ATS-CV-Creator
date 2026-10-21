import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { readableText } from './review-copy'
import { experienceInputSchema, projectInputSchema } from '../shared/experience'
import { profileEntryInputSchema, skillInputSchema } from '../shared/profile'
import type { DraftRecordDescriptor, MutateDraftRecordInput, MutateDraftRecordResult } from '../shared/draft-records'

export type RecordEditorTarget = { section: MutateDraftRecordInput['section']; operation: 'add' | 'update' | 'remove'; record?: DraftRecordDescriptor; draftId: string; revision: number }
const names = { education: 'education', experience: 'experience', projects: 'project', skills: 'skill' }

export function DraftRecordEditor({ target, onClose, onSave }: { target: RecordEditorTarget; onClose: () => void; onSave: (scope: 'cv-only' | 'profile', value?: unknown) => Promise<MutateDraftRecordResult> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const prefix = useId()
  const [scope, setScope] = useState<'cv-only' | 'profile'>('cv-only')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const value = (target.record?.value ?? {}) as Record<string, unknown>
  const [links, setLinks] = useState<Array<{ label: string; url: string }>>(() => Array.isArray(value.links) ? value.links as Array<{ label: string; url: string }> : [])
  const removing = target.operation === 'remove'
  const noun = names[target.section]
  const title = `${removing ? 'Remove' : target.operation === 'add' ? 'Add' : 'Edit'} ${noun}`
  useEffect(() => {
    const element = dialog.current
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    element?.querySelector<HTMLElement>(removing ? 'h2' : 'input:not([type=radio], [type=checkbox]), textarea, select')?.focus({ preventScroll: true })
    return () => {
      element?.close()
      const targetElement = invoker?.isConnected && invoker.getClientRects().length ? invoker : document.getElementById(`add-record-${target.section}`)
      targetElement?.focus()
    }
  }, [removing, target.section])
  const text = (key: string) => typeof value[key] === 'string' ? key === 'description' ? readableText(value[key]) : value[key] as string : ''
  const lines = (key: string) => Array.isArray(value[key]) ? (value[key] as Array<{ text: string }>).map(item => item.text).join('\n') : ''
  function field(label: string, key: string, options: { required?: boolean; multiline?: boolean; hint?: string; max?: number; type?: string; wide?: boolean } = {}) {
    const id = `${prefix}-${key}`
    const props = { id, name: key, defaultValue: text(key), required: options.required, maxLength: options.max ?? 240, 'aria-invalid': !!errors[key], 'aria-describedby': options.hint || errors[key] ? `${id}-help` : undefined }
    return <div className={`record-field${options.wide ? ' record-wide-field' : ''}`}><label htmlFor={id}>{label}</label>{options.multiline ? <textarea {...props} rows={5} /> : <input {...props} type={options.type ?? 'text'} />}{(options.hint || errors[key]) && <span id={`${id}-help`} className={errors[key] ? 'record-field-error' : 'record-field-hint'}>{errors[key] ?? options.hint}</span>}</div>
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const data = new FormData(event.currentTarget)
    const get = (key: string) => String(data.get(key) ?? '').trim()
    const optional = (key: string) => get(key) ? { [key]: get(key) } : {}
    const facts = (key: string) => get(key).split(/\n/).map(text => text.trim()).filter(Boolean).map(text => {
      const original = Array.isArray(value[key]) ? (value[key] as Array<{ id?: string; text: string }>).find(item => item.text === text) : undefined
      return { ...(original?.id ? { id: original.id } : {}), text }
    })
    let record: unknown
    if (!removing) {
      if (target.section === 'education') record = { section: 'education', ...(typeof value.issuer === 'string' ? { issuer: value.issuer } : {}), ...(typeof value.year === 'number' ? { year: value.year } : {}), title: get('title'), ...optional('institution'), ...optional('field'), ...optional('startDate'), ...optional('endDate'), ...optional('description'), ...optional('link') }
      if (target.section === 'experience') record = { kind: get('kind'), title: get('title'), organization: get('organization'), ...optional('startDate'), ...optional('endDate'), description: get('description'), factualItems: facts('factualItems') }
      if (target.section === 'projects') record = { name: get('name'), description: get('description'), factualItems: facts('factualItems'), technologies: facts('technologies'), links }
      if (target.section === 'skills') record = { name: get('name'), category: get('category'), ...optional('proficiency'), ...(get('years') ? { years: Number(get('years')) } : {}) }
      const schema = target.section === 'education' ? profileEntryInputSchema : target.section === 'experience' ? experienceInputSchema : target.section === 'projects' ? projectInputSchema : skillInputSchema
      const parsed = schema.safeParse(record)
      if (!parsed.success) {
        const next: Record<string, string> = {}
        for (const issue of parsed.error.issues) next[String(issue.path[0] ?? '_')] ??= issue.message
        setErrors(next); setMessage('Check the highlighted fields before saving.')
        const first = form.current?.querySelector<HTMLElement>(`[name="${Object.keys(next)[0]}"]`)
        first?.focus()
        return
      }
      record = parsed.data
    }
    setBusy(true); setMessage(''); setErrors({})
    try { const result = await onSave(scope, record); if (result.ok) onClose(); else { setMessage(result.message); setErrors(result.fieldErrors ?? {}) } }
    catch { setMessage('The record could not be saved. Your entries are still here; try again.') }
    finally { setBusy(false) }
  }
  const recordName = text('title') || text('name') || noun
  return <dialog ref={dialog} className="draft-record-dialog" aria-labelledby={`${prefix}-dialog-title`} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <header className="record-dialog-heading"><div><h2 id={`${prefix}-dialog-title`} tabIndex={-1}>{title}</h2><p>{removing ? 'Choose where to remove this record.' : 'These are your own career facts. No AI request is sent.'}</p></div><button type="button" className="icon-button" aria-label="Close record editor" disabled={busy} onClick={onClose}><X size={20} aria-hidden="true" /></button></header>
    <form ref={form} className="record-editor-form" onSubmit={event => void submit(event)}>
      {removing ? <p className="record-removal-name">Remove <strong>{recordName}</strong>?</p> : <div className="record-form-grid">
        {target.section === 'education' && <>{field('Degree', 'title', { required: true, max: 200, wide: true })}{field('Institution (optional)', 'institution', { max: 200 })}{field('Field of study (optional)', 'field', { max: 200 })}{field('Start date (optional)', 'startDate', { max: 7, hint: 'Use YYYY or YYYY-MM.' })}{field('End date (optional)', 'endDate', { max: 7, hint: 'Use YYYY or YYYY-MM.' })}{field('Details and grade (optional)', 'description', { multiline: true, max: 3000, wide: true, hint: 'One point per line. An explicit GPA or CGPA appears beneath the dates.' })}{field('Link (optional)', 'link', { type: 'url', max: 2048, wide: true })}</>}
        {target.section === 'experience' && <><label>Record type<select name="kind" required defaultValue={target.record && target.record.sourceRevision === undefined ? '' : text('kind') || 'employment'}>{target.record && target.record.sourceRevision === undefined && <option value="">Confirm record type</option>}<option value="employment">Employment</option><option value="training">Training</option></select></label>{field('Job title or role', 'title', { required: true })}{field('Organization', 'organization', { required: true, wide: true })}{field('Start date (optional)', 'startDate', { max: 80 })}{field('End date (optional)', 'endDate', { max: 80, hint: 'Leave blank for an ongoing role.' })}{field('Experience details', 'description', { required: true, multiline: true, max: 3000, wide: true, hint: 'One concise accomplishment per line. Include only work you actually did.' })}</>}
        {target.section === 'projects' && <>{field('Project name', 'name', { required: true, wide: true })}{field('Project details', 'description', { required: true, multiline: true, max: 3000, wide: true, hint: 'One concise point per line.' })}<div className="record-field record-wide-field"><label htmlFor={`${prefix}-technologies`}>Tools and technologies (optional)</label><textarea id={`${prefix}-technologies`} aria-describedby={`${prefix}-technologies-help`} name="technologies" rows={3} defaultValue={lines('technologies')} maxLength={3000} /><span id={`${prefix}-technologies-help`} className="record-field-hint">One tool per line. These appear beside the project name.</span></div><fieldset className="record-links record-wide-field"><legend>Project links (optional)</legend>{links.map((link, index) => <div className="record-link-row" key={index}><label>Link label<input value={link.label} required maxLength={2048} onChange={event => setLinks(values => values.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} /></label><label>URL<input type="url" value={link.url} required maxLength={2048} onChange={event => setLinks(values => values.map((item, i) => i === index ? { ...item, url: event.target.value } : item))} /></label><button type="button" className="secondary-button" aria-label={`Remove project link ${index + 1}`} onClick={() => setLinks(values => values.filter((_, i) => i !== index))}>Remove link</button></div>)}{errors.links && <p className="record-field-error">{errors.links}</p>}<button type="button" className="secondary-button" onClick={() => setLinks(values => [...values, { label: 'GitHub', url: '' }])} disabled={links.length >= 20}><Plus size={16} aria-hidden="true" />Add link</button><p className="record-field-hint">GitHub links display as github/repository-name in your CV.</p></fieldset></>}
        {target.section === 'skills' && <>{field('Skill name', 'name', { required: true, max: 160, wide: true })}<label>Category<select name="category" defaultValue={text('category') || 'Technologies'}>{!['Languages', 'Technologies', 'Concepts', ''].includes(text('category')) && <option>{text('category')}</option>}<option>Languages</option><option>Technologies</option><option>Concepts</option></select></label><label>Proficiency (optional)<select name="proficiency" defaultValue={text('proficiency')}><option value="">Not specified</option>{['beginner', 'intermediate', 'advanced', 'expert'].map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label><label>Years of use (optional)<input name="years" type="number" min={0} max={80} step="any" defaultValue={typeof value.years === 'number' ? value.years : ''} />{errors.years && <span className="record-field-error">{errors.years}</span>}</label></>}
        {(target.section === 'experience' || target.section === 'projects') && <details className="record-wide-field"><summary>Supporting career facts (optional)</summary><label>Additional source facts<textarea name="factualItems" defaultValue={lines('factualItems')} maxLength={10000} rows={3} /><span className="record-field-hint">One fact per line. These support your record but are not extra CV bullets.</span></label></details>}
      </div>}
      <fieldset className="record-save-scope"><legend>{removing ? 'Remove from' : 'Apply changes to'}</legend><label><input type="radio" name="save-scope" value="cv-only" checked={scope === 'cv-only'} onChange={() => setScope('cv-only')} /><span><strong>This CV only</strong><span>Your profile and other CVs stay unchanged.</span></span></label><label><input type="radio" name="save-scope" value="profile" checked={scope === 'profile'} onChange={() => setScope('profile')} /><span><strong>This CV and my profile</strong><span>{removing ? 'Also remove the saved profile record. Other CVs using it may need review.' : 'Save these career facts to My profile for future CVs. Other drafts may need review.'}</span></span></label></fieldset>
      {scope === 'profile' && <p className="record-scope-warning">{removing ? 'This also removes the record from My profile. It is not just a change to this CV.' : 'The details above become saved profile facts, not just tailored wording. Review them carefully.'}</p>}
      {!removing && <label className="record-declaration"><input type="checkbox" required />I confirm these details describe my own career facts.</label>}
      {message && <p className="record-field-error" role="alert">{message}</p>}
      <footer className="record-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className={removing ? 'secondary-button record-remove-button' : 'primary-button'} disabled={busy}>{busy ? 'Saving…' : removing ? scope === 'profile' ? 'Remove from CV and profile' : 'Remove from this CV' : scope === 'profile' ? 'Save to CV and profile' : 'Save to this CV'}</button></footer>
    </form>
  </dialog>
}
