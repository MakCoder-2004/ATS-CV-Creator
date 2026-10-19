import React, { FormEvent, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BriefcaseBusiness, FileText, LayoutPanelLeft, Moon, Settings2, Sun, UserRound } from 'lucide-react'
import type { Appearance } from '../shared/appearance'
import type { ContactInput, ProfileSnapshot, SkillInput, SkillRecord } from '../shared/profile'
import type { JobInput, JobRecord } from '../shared/jobs'
import './style.css'

type Page = 'Tailor CV' | 'Saved jobs' | 'My profile' | 'Settings'
const pages = [
  { label: 'Tailor CV', icon: FileText },
  { label: 'Saved jobs', icon: BriefcaseBusiness },
  { label: 'My profile', icon: UserRound },
  { label: 'Settings', icon: Settings2 }
] as const
const profileSections = ['Personal', 'Skills', 'Experience', 'Projects', 'Education', 'Certificates', 'Summary', 'Languages', 'Extras'] as const
type ProfileSection = typeof profileSections[number]
type LinkRow = { key: number; label: string; url: string }
const skillCategories = ['Technical', 'Tools', 'Domain', 'Languages', 'Leadership', 'Other']
const proficiencyLabels: Record<string, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', expert: 'Expert' }

function ProfileEditor() {
  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [contactEdit, setContactEdit] = useState(false)
  const [activeSection, setActiveSection] = useState<ProfileSection>('Personal')
  const nextLinkKey = useRef(0)
  const [links, setLinks] = useState<LinkRow[]>([])
  const [skillEditId, setSkillEditId] = useState<string | undefined>()
  const [contact, setContact] = useState<ContactInput>({ fullName: '', headline: '', email: '', phone: '', location: '', links: [] })
  const [skill, setSkill] = useState<SkillInput>({ name: '', category: skillCategories[0] })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [mutationError, setMutationError] = useState('')
  const [notice, setNotice] = useState('')

  function loadLinks(items: Array<string | { label: string; url: string }>) {
    setLinks(items.map(item => ({ key: ++nextLinkKey.current, label: typeof item === 'string' ? item : item.label, url: typeof item === 'string' ? item : item.url })))
  }
  function changeLink(key: number, field: 'label' | 'url', value: string) {
    setLinks(current => current.map(link => link.key === key ? { ...link, [field]: value } : link))
    setFieldErrors({})
  }
  async function reload() {
    setLoading(true)
    try {
      const value = await window.workbench.getProfile()
      setSnapshot(value)
      if (value.contact) {
        setContact({ ...value.contact })
        loadLinks(value.contact.links ?? [])
      } else {
        setContact({ fullName: '', headline: '', email: '', phone: '', location: '', links: [] })
        setLinks([])
      }
      setMutationError('')
    } catch {
      setMutationError('Your profile could not be loaded. Try again.')
    } finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [])

  function updateContact(field: keyof ContactInput, value: string) {
    setContact(current => ({ ...current, [field]: value }))
    setFieldErrors(current => ({ ...current, [field]: '' }))
  }
  async function saveContact(event: FormEvent) {
    event.preventDefault()
    setFieldErrors({}); setMutationError(''); setNotice('')
    const input: ContactInput = {
      fullName: contact.fullName,
      ...(contact.headline?.trim() ? { headline: contact.headline } : {}),
      ...(contact.email?.trim() ? { email: contact.email } : {}),
      ...(contact.phone?.trim() ? { phone: contact.phone } : {}),
      ...(contact.location?.trim() ? { location: contact.location } : {}),
      links: links.map(({ label, url }) => ({ label, url }))
    }
    try {
      const result = await window.workbench.saveContact({ ...input, id: snapshot?.contact?.id })
      if (!result.ok) { setFieldErrors(result.error.fieldErrors ?? {}); setMutationError(result.error.message); return }
      setSnapshot(result.value); setContactEdit(false); setNotice('Contact details saved')
    } catch { setMutationError('Contact details could not be saved. Check the fields and try again.') }
  }
  function beginContactEdit() {
    if (snapshot?.contact) {
      setContact({ ...snapshot.contact })
      loadLinks(snapshot.contact.links ?? [])
    }
    setContactEdit(true); setNotice(''); setFieldErrors({})
  }
  async function deleteContact() {
    if (!snapshot?.contact || !window.confirm('Delete your contact details? This cannot be undone.')) return
    try {
      const result = await window.workbench.deleteContact(snapshot.contact.id)
      if (!result.ok) { setMutationError(result.error.message); return }
      setSnapshot(result.value); setContact({ fullName: '', headline: '', email: '', phone: '', location: '', links: [] }); setLinks([]); setNotice('Contact details deleted')
    } catch { setMutationError('Contact details could not be deleted. Try again.') }
  }
  function updateSkill(field: keyof SkillInput, value: string) {
    setSkill(current => ({ ...current, [field]: field === 'years' ? (value === '' ? undefined : Number(value)) : field === 'proficiency' && !value ? undefined : value }))
    setFieldErrors(current => ({ ...current, [field]: '' }))
  }
  function editSkill(item: SkillRecord) {
    setSkillEditId(item.id)
    setSkill({ name: item.name, category: item.category, proficiency: item.proficiency, years: item.years })
    setNotice(''); setFieldErrors({})
  }
  function resetSkill() { setSkillEditId(undefined); setSkill({ name: '', category: skillCategories[0] }); setFieldErrors({}) }
  async function saveSkill(event: FormEvent) {
    event.preventDefault(); setFieldErrors({}); setMutationError(''); setNotice('')
    try {
      const result = await window.workbench.saveSkill({ ...skill, id: skillEditId })
      if (!result.ok) { setFieldErrors(result.error.fieldErrors ?? {}); setMutationError(result.error.message); return }
      setSnapshot(result.value); resetSkill(); setNotice(skillEditId ? 'Skill updated' : 'Skill added')
    } catch { setMutationError('Skill could not be saved. Check the fields and try again.') }
  }
  async function deleteSkill(item: SkillRecord) {
    if (!window.confirm(`Delete ${item.name}? This cannot be undone.`)) return
    try {
      const result = await window.workbench.deleteSkill(item.id)
      if (!result.ok) { setMutationError(result.error.message); return }
      setSnapshot(result.value); setNotice(`${item.name} deleted`)
    } catch { setMutationError('Skill could not be deleted. Try again.') }
  }

  const categories = [...new Set([...(snapshot?.skills ?? []).map(item => item.category), ...skillCategories])]
  if (loading) return <section className="profile-panel" role="status">Loading your local profile…</section>
  return <div className="profile-layout">
    <div className="profile-summary"><span className="profile-avatar"><UserRound size={22} aria-hidden="true" /></span><div><strong>{snapshot?.contact?.fullName ?? 'Start your profile'}</strong><p>{snapshot?.contact?.headline ?? 'Your career facts, organized by section.'}</p></div><span className="profile-local-label">Saved on this device</span></div>
    <nav className="profile-sections" aria-label="Profile sections">{profileSections.map(section => <button key={section} type="button" aria-current={activeSection === section ? 'page' : undefined} onClick={() => { setActiveSection(section); setMutationError(''); setNotice(''); setFieldErrors({}) }}>{section}{section !== 'Personal' && section !== 'Skills' && <span className="profile-upcoming">Soon</span>}</button>)}</nav>
    {activeSection === 'Personal' && <section className="profile-panel" aria-labelledby="contact-heading">
      <div className="panel-heading"><div><span className="context">Identity</span><h2 id="contact-heading">Contact details</h2><p>Keep the details you want available when preparing your CV.</p></div>
        {!contactEdit && snapshot?.contact && <button className="secondary-button" type="button" onClick={beginContactEdit}>Edit contact details</button>}
      </div>
      {snapshot?.contact && !contactEdit ? <div className="contact-summary">
        <h3>{snapshot.contact.fullName}</h3>{snapshot.contact.headline && <p>{snapshot.contact.headline}</p>}
        <dl>{snapshot.contact.email && <div><dt>Email</dt><dd>{snapshot.contact.email}</dd></div>}{snapshot.contact.phone && <div><dt>Phone</dt><dd>{snapshot.contact.phone}</dd></div>}{snapshot.contact.location && <div><dt>Location</dt><dd>{snapshot.contact.location}</dd></div>}{snapshot.contact.links?.map((link, index) => <div key={`${link.url}-${index}`}><dt>{link.label}</dt><dd>{link.url}</dd></div>)}</dl>
        <button className="text-button destructive" type="button" onClick={() => void deleteContact()}>Delete contact details</button>
      </div> : <form className="profile-form" onSubmit={event => void saveContact(event)} noValidate>
        <div className="form-grid">
          <label>Full name<input autoComplete="name" value={contact.fullName} onChange={event => updateContact('fullName', event.target.value)} aria-invalid={!!fieldErrors.fullName} aria-describedby={fieldErrors.fullName ? 'contact-fullName-error' : undefined} />{fieldErrors.fullName && <span className="field-error" id="contact-fullName-error">{fieldErrors.fullName}</span>}</label>
          <label>Professional headline<input value={contact.headline ?? ''} onChange={event => updateContact('headline', event.target.value)} aria-invalid={!!fieldErrors.headline} aria-describedby={fieldErrors.headline ? 'contact-headline-error' : undefined} />{fieldErrors.headline && <span className="field-error" id="contact-headline-error">{fieldErrors.headline}</span>}</label>
          <label>Email<input type="email" autoComplete="email" value={contact.email ?? ''} onChange={event => updateContact('email', event.target.value)} aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? 'contact-email-error' : undefined} />{fieldErrors.email && <span className="field-error" id="contact-email-error">{fieldErrors.email}</span>}</label>
          <label>Phone<input type="tel" autoComplete="tel" value={contact.phone ?? ''} onChange={event => updateContact('phone', event.target.value)} aria-invalid={!!fieldErrors.phone} aria-describedby={fieldErrors.phone ? 'contact-phone-error' : undefined} />{fieldErrors.phone && <span className="field-error" id="contact-phone-error">{fieldErrors.phone}</span>}</label>
          <label>Location<input autoComplete="address-level2" value={contact.location ?? ''} onChange={event => updateContact('location', event.target.value)} aria-invalid={!!fieldErrors.location} aria-describedby={fieldErrors.location ? 'contact-location-error' : undefined} />{fieldErrors.location && <span className="field-error" id="contact-location-error">{fieldErrors.location}</span>}</label>
        </div>
        <div className="links-editor"><div className="links-heading"><div><h3>Links</h3><p>Name the destinations you want to keep with your contact details.</p></div><button className="secondary-button" type="button" disabled={links.length >= 20} onClick={() => { setLinks(current => [...current, { key: ++nextLinkKey.current, label: '', url: '' }]); setFieldErrors({}) }}>Add link</button></div>
          {fieldErrors.links && <p className="field-error" role="alert">{fieldErrors.links}</p>}
          {links.map((link, index) => {
            const labelError = fieldErrors[`links.${index}.label`]
            const urlError = fieldErrors[`links.${index}.url`]
            return <div className="link-row" key={link.key}>
              <label>Link name {index + 1}<input value={link.label} onChange={event => changeLink(link.key, 'label', event.target.value)} aria-invalid={!!labelError} aria-describedby={labelError ? `link-label-error-${link.key}` : undefined} />{labelError && <span className="field-error" id={`link-label-error-${link.key}`}>{labelError}</span>}</label>
              <label>Link URL {index + 1}<input type="url" inputMode="url" value={link.url} onChange={event => changeLink(link.key, 'url', event.target.value)} aria-invalid={!!urlError} aria-describedby={urlError ? `link-url-error-${link.key}` : undefined} />{urlError && <span className="field-error" id={`link-url-error-${link.key}`}>{urlError}</span>}</label>
              <button className="text-button destructive" type="button" aria-label={`Remove ${link.label.trim() || `link ${index + 1}`}`} onClick={() => { setLinks(current => current.filter(item => item.key !== link.key)); setFieldErrors({}) }}>Remove</button>
            </div>
          })}
        </div>
        <div className="form-actions"><button className="primary-button" type="submit">Save contact details</button>{snapshot?.contact && <button className="secondary-button" type="button" onClick={() => { setContactEdit(false); setFieldErrors({}) }}>Cancel</button>}</div>
      </form>}
    </section>}
    {activeSection === 'Skills' && <section className="profile-panel" aria-labelledby="skills-heading">
      <div className="panel-heading"><div><span className="context">Evidence</span><h2 id="skills-heading">Skills</h2><p>Record skills by category. Proficiency and years are optional self-reported details.</p></div></div>
      <form className="profile-form skill-form" onSubmit={event => void saveSkill(event)} noValidate>
        <div className="form-grid skill-grid">
          <label>Skill name<input value={skill.name} onChange={event => updateSkill('name', event.target.value)} aria-invalid={!!fieldErrors.name} aria-describedby={fieldErrors.name ? 'skill-name-error' : undefined} />{fieldErrors.name && <span className="field-error" id="skill-name-error">{fieldErrors.name}</span>}</label>
          <label>Skill category<select value={skill.category} onChange={event => updateSkill('category', event.target.value)} aria-invalid={!!fieldErrors.category} aria-describedby={fieldErrors.category ? 'skill-category-error' : undefined}>{categories.map(category => <option key={category}>{category}</option>)}</select>{fieldErrors.category && <span className="field-error" id="skill-category-error">{fieldErrors.category}</span>}</label>
          <label>Proficiency (optional)<select value={skill.proficiency ?? ''} onChange={event => updateSkill('proficiency', event.target.value)} aria-invalid={!!fieldErrors.proficiency} aria-describedby={fieldErrors.proficiency ? 'skill-proficiency-error' : undefined}><option value="">Not specified</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option><option value="expert">Expert</option></select>{fieldErrors.proficiency && <span className="field-error" id="skill-proficiency-error">{fieldErrors.proficiency}</span>}</label>
          <label>Years of experience (optional)<input type="number" min="0" max="80" step="1" value={skill.years ?? ''} onChange={event => updateSkill('years', event.target.value)} aria-invalid={!!fieldErrors.years} aria-describedby={fieldErrors.years ? 'skill-years-error' : undefined} />{fieldErrors.years && <span className="field-error" id="skill-years-error">{fieldErrors.years}</span>}</label>
        </div>
        <div className="form-actions"><button className="primary-button" type="submit">{skillEditId ? 'Save skill' : 'Add skill'}</button>{skillEditId && <button className="secondary-button" type="button" onClick={resetSkill}>Cancel</button>}</div>
      </form>
      {snapshot?.skills.length ? <ul className="skill-list">{snapshot.skills.map(item => <li key={item.id}>
        <div className="skill-copy"><h3>{item.name}</h3><span className="category-tag">{item.category}</span>{item.proficiency && <span>{proficiencyLabels[item.proficiency] ?? item.proficiency}</span>}{item.years != null && <span>{item.years} {item.years === 1 ? 'year' : 'years'}</span>}</div>
        <div className="skill-actions"><button className="text-button" type="button" onClick={() => editSkill(item)}>Edit {item.name}</button><button className="text-button destructive" type="button" aria-label={`Delete ${item.name}`} onClick={() => void deleteSkill(item)}>Delete</button></div>
      </li>)}</ul> : <p className="empty-skills">No skills added yet.</p>}
    </section>}
    {activeSection !== 'Personal' && activeSection !== 'Skills' && <section className="profile-panel profile-upcoming-panel" aria-labelledby="upcoming-heading"><span className="context">Planned profile section</span><h2 id="upcoming-heading">{activeSection}</h2><p>{activeSection} editing is coming later. For now, add contact details under Personal and skills under Skills. Nothing entered here will be saved until this section has a real editor.</p></section>}
    <p className="locality-note">Your profile is stored locally on this device. It is not synced or shared. Local storage does not guarantee that future cloud features will be anonymous.</p>
    {(mutationError || notice) && <p className={mutationError ? 'profile-message error' : 'profile-message success'} role={mutationError ? 'alert' : 'status'}>{mutationError || notice}{mutationError && <button className="text-button" type="button" onClick={() => void reload()}>Retry</button>}</p>}
  </div>
}

function SavedJobs({ jobs, activeJob, onSaved, onOpened }: { jobs: JobRecord[]; activeJob: JobRecord | null; onSaved: (job: JobRecord) => void; onOpened: (job: JobRecord) => void }) {
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

function App() {
  const [appearance, setAppearance] = useState<Appearance>('light')
  const [page, setPage] = useState<Page>('Tailor CV')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [activeJob, setActiveJob] = useState<JobRecord | null>(null)
  useEffect(() => {
    window.workbench.getSettings().then(settings => { setAppearance(settings.appearance); setReady(true) }).catch(() => setError('Could not open workspace settings. Restart the app to retry.'))
    window.workbench.listJobs().then(setJobs).catch(() => setError('Saved postings could not be loaded. Restart the app to retry.'))
  }, [])
  function keepJob(job: JobRecord) {
    setJobs(current => [job, ...current.filter(item => item.id !== job.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))])
    setActiveJob(job)
  }
  async function activateJob(id: string) {
    try { const job = await window.workbench.openJob(id); setActiveJob(job) }
    catch { setError('The selected saved posting could not be opened.') }
  }
  useEffect(() => { document.documentElement.dataset.appearance = appearance }, [appearance])
  async function changeAppearance(value: Appearance) {
    try { const saved = await window.workbench.setAppearance(value); setAppearance(saved.appearance); setError('') }
    catch { setError('Appearance could not be saved. Try again.') }
  }
  if (!ready && !error) return <div className="loading" role="status">Opening your workspace…</div>
  return <div className="workbench" data-ui-ready={ready ? 'true' : undefined}>
    <a className="skip" href="#content">Skip to content</a>
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="brand"><span className="brand-icon"><LayoutPanelLeft aria-hidden="true" size={20} /></span><div><strong>CV Tailor</strong><small>Your experience, supported.</small></div></div>
      <nav aria-label="Main navigation">{pages.map(({ label, icon: Icon }) => <button type="button" key={label} aria-current={page === label ? 'page' : undefined} onClick={() => setPage(label)}><Icon size={18} aria-hidden="true" />{label}</button>)}</nav>
      <div className="sidebar-jobs"><div className="section-label">Saved postings <span>{jobs.length}</span></div>{jobs.length ? <div className="sidebar-job-items">{jobs.map(job => <button type="button" key={job.id} aria-current={activeJob?.id === job.id ? 'true' : undefined} onClick={() => { setPage('Tailor CV'); void activateJob(job.id) }}>{job.title}<small>{job.company}</small></button>)}</div> : <p>No saved postings yet. Use Saved jobs to add your first target.</p>}</div>
      <div className="sidebar-bottom"><div className="storage-note">Personal workspace<br /><span>Saved on this device</span></div></div>
    </aside>
    <div className="workspace-main">
      <header className="header"><span className="breadcrumb">Workspace <span aria-hidden="true">/</span> {page}</span><div className="appearance" role="group" aria-label="Color appearance"><button type="button" aria-label="Use light mode" aria-pressed={appearance === 'light'} onClick={() => void changeAppearance('light')}><Sun size={16} aria-hidden="true" /> Light</button><button type="button" aria-label="Use dark mode" aria-pressed={appearance === 'dark'} onClick={() => void changeAppearance('dark')}><Moon size={16} aria-hidden="true" /> Dark</button></div></header>
      {error && <p role="alert" className="error">{error}</p>}
      <main id="content" tabIndex={-1}>
        <div className="title"><span className="context">Personal workspace</span><h1>{page === 'Tailor CV' ? 'Start with your experience' : page}</h1><p>{page === 'Tailor CV' ? 'Build your profile, then tailor a CV to a saved posting.' : page === 'Saved jobs' ? 'Your job postings and their drafts will live here.' : page === 'My profile' ? 'Keep the career facts that support your CV in one place.' : 'Choose how your workspace looks.'}</p></div>
        {page === 'Tailor CV' ? <div className="columns"><section className="document-area" aria-label="CV document"><div className="document-toolbar"><span>CV document</span><span>{activeJob ? `Target: ${activeJob.title} · ${activeJob.company}` : 'Not started'}</span></div><div className="paper-wrap"><article className="paper"><div className="paper-header"><strong>Your name</strong><span>Your CV begins here</span></div><div className="paper-rule" /><h2>Education</h2><div className="paper-line" /><h2>Experience</h2><div className="paper-line" /><h2>Projects</h2><div className="paper-line" /><h2>Skills</h2><div className="paper-line" /><h2>Certificates</h2><div className="paper-line" /><p className="paper-hint">Add your career facts in My profile.</p></article></div></section><aside className="inspector" aria-label="Evidence and coverage"><div className="inspector-tabs"><span>Evidence</span><span>Coverage</span></div><div className="inspector-content"><h2>Nothing to inspect yet</h2><p>Once a draft is generated, select a paragraph to see its supporting profile evidence here.</p><div className="inspector-divider" /><h2>Qualification gaps</h2><p>Job requirements without supporting experience will appear as advisory gaps, not invented claims.</p></div></aside></div> : page === 'My profile' ? <ProfileEditor /> : page === 'Saved jobs' ? <SavedJobs jobs={jobs} activeJob={activeJob} onSaved={keepJob} onOpened={keepJob} /> : <div className="empty-panel"><h2>Appearance</h2><p>Use the Light and Dark controls in the header. Your choice is saved locally and restored when you reopen the app.</p></div>}
      </main>
    </div>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
