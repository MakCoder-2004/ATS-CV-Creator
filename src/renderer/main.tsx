import React, { FormEvent, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BriefcaseBusiness, FileText, LayoutPanelLeft, Moon, Settings2, Sun, UserRound } from 'lucide-react'
import type { Appearance } from '../shared/appearance'
import type { ContactInput, ProfileSnapshot, SkillInput, SkillRecord } from '../shared/profile'
import './style.css'

type Page = 'Tailor CV' | 'Saved jobs' | 'My profile' | 'Settings'
const pages = [
  { label: 'Tailor CV', icon: FileText },
  { label: 'Saved jobs', icon: BriefcaseBusiness },
  { label: 'My profile', icon: UserRound },
  { label: 'Settings', icon: Settings2 }
] as const
const skillCategories = ['Technical', 'Tools', 'Domain', 'Languages', 'Leadership', 'Other']
const proficiencyLabels: Record<string, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', expert: 'Expert' }

function ProfileEditor() {
  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [contactEdit, setContactEdit] = useState(false)
  const [skillEditId, setSkillEditId] = useState<string | undefined>()
  const [contact, setContact] = useState<ContactInput>({ fullName: '', headline: '', email: '', phone: '', location: '', links: [] })
  const [skill, setSkill] = useState<SkillInput>({ name: '', category: skillCategories[0] })
  const [linksText, setLinksText] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [mutationError, setMutationError] = useState('')
  const [notice, setNotice] = useState('')

  async function reload() {
    setLoading(true)
    try {
      const value = await window.workbench.getProfile()
      setSnapshot(value)
      if (value.contact) {
        setContact({ ...value.contact })
        setLinksText((value.contact.links ?? []).join('\n'))
      } else {
        setContact({ fullName: '', headline: '', email: '', phone: '', location: '', links: [] })
        setLinksText('')
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
      links: linksText.split('\n').map(link => link.trim()).filter(Boolean)
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
      setLinksText((snapshot.contact.links ?? []).join('\n'))
    }
    setContactEdit(true); setNotice(''); setFieldErrors({})
  }
  async function deleteContact() {
    if (!snapshot?.contact || !window.confirm('Delete your contact details? This cannot be undone.')) return
    try {
      const result = await window.workbench.deleteContact(snapshot.contact.id)
      if (!result.ok) { setMutationError(result.error.message); return }
      setSnapshot(result.value); setContact({ fullName: '', headline: '', email: '', phone: '', location: '', links: [] }); setLinksText(''); setNotice('Contact details deleted')
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
    <section className="profile-panel" aria-labelledby="contact-heading">
      <div className="panel-heading"><div><span className="context">Identity</span><h2 id="contact-heading">Contact details</h2><p>Keep the details you want available when preparing your CV.</p></div>
        {!contactEdit && snapshot?.contact && <button className="secondary-button" type="button" onClick={beginContactEdit}>Edit contact details</button>}
      </div>
      {snapshot?.contact && !contactEdit ? <div className="contact-summary">
        <h3>{snapshot.contact.fullName}</h3>{snapshot.contact.headline && <p>{snapshot.contact.headline}</p>}
        <dl>{snapshot.contact.email && <div><dt>Email</dt><dd>{snapshot.contact.email}</dd></div>}{snapshot.contact.phone && <div><dt>Phone</dt><dd>{snapshot.contact.phone}</dd></div>}{snapshot.contact.location && <div><dt>Location</dt><dd>{snapshot.contact.location}</dd></div>}{snapshot.contact.links?.map((link, index) => <div key={`${link}-${index}`}><dt>{index === 0 ? 'Links' : ''}</dt><dd>{link}</dd></div>)}</dl>
        <button className="text-button destructive" type="button" onClick={() => void deleteContact()}>Delete contact details</button>
      </div> : <form className="profile-form" onSubmit={event => void saveContact(event)} noValidate>
        <div className="form-grid">
          <label>Full name<input autoComplete="name" value={contact.fullName} onChange={event => updateContact('fullName', event.target.value)} aria-invalid={!!fieldErrors.fullName} aria-describedby={fieldErrors.fullName ? 'contact-fullName-error' : undefined} />{fieldErrors.fullName && <span className="field-error" id="contact-fullName-error">{fieldErrors.fullName}</span>}</label>
          <label>Professional headline<input value={contact.headline ?? ''} onChange={event => updateContact('headline', event.target.value)} aria-invalid={!!fieldErrors.headline} aria-describedby={fieldErrors.headline ? 'contact-headline-error' : undefined} />{fieldErrors.headline && <span className="field-error" id="contact-headline-error">{fieldErrors.headline}</span>}</label>
          <label>Email<input type="email" autoComplete="email" value={contact.email ?? ''} onChange={event => updateContact('email', event.target.value)} aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? 'contact-email-error' : undefined} />{fieldErrors.email && <span className="field-error" id="contact-email-error">{fieldErrors.email}</span>}</label>
          <label>Phone<input type="tel" autoComplete="tel" value={contact.phone ?? ''} onChange={event => updateContact('phone', event.target.value)} aria-invalid={!!fieldErrors.phone} aria-describedby={fieldErrors.phone ? 'contact-phone-error' : undefined} />{fieldErrors.phone && <span className="field-error" id="contact-phone-error">{fieldErrors.phone}</span>}</label>
          <label>Location<input autoComplete="address-level2" value={contact.location ?? ''} onChange={event => updateContact('location', event.target.value)} aria-invalid={!!fieldErrors.location} aria-describedby={fieldErrors.location ? 'contact-location-error' : undefined} />{fieldErrors.location && <span className="field-error" id="contact-location-error">{fieldErrors.location}</span>}</label>
          <label className="wide-field">Links <span className="optional">(one per line)</span><textarea rows={2} value={linksText} onChange={event => setLinksText(event.target.value)} aria-invalid={!!fieldErrors.links} aria-describedby={fieldErrors.links ? 'contact-links-error' : undefined} />{fieldErrors.links && <span className="field-error" id="contact-links-error">{fieldErrors.links}</span>}</label>
        </div>
        <div className="form-actions"><button className="primary-button" type="submit">Save contact details</button>{snapshot?.contact && <button className="secondary-button" type="button" onClick={() => { setContactEdit(false); setFieldErrors({}) }}>Cancel</button>}</div>
      </form>}
    </section>
    <section className="profile-panel" aria-labelledby="skills-heading">
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
    </section>
    <p className="locality-note">Your profile is stored locally on this device. It is not synced or shared. Local storage does not guarantee that future cloud features will be anonymous.</p>
    {(mutationError || notice) && <p className={mutationError ? 'profile-message error' : 'profile-message success'} role={mutationError ? 'alert' : 'status'}>{mutationError || notice}{mutationError && <button className="text-button" type="button" onClick={() => void reload()}>Retry</button>}</p>}
  </div>
}

function App() {
  const [appearance, setAppearance] = useState<Appearance>('light')
  const [page, setPage] = useState<Page>('Tailor CV')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  useEffect(() => {
    window.workbench.getSettings().then(settings => { setAppearance(settings.appearance); setReady(true) }).catch(() => setError('Could not open workspace settings. Restart the app to retry.'))
  }, [])
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
      <div className="sidebar-jobs"><div className="section-label">Saved postings <span>0</span></div><p>No saved jobs yet. Job creation is coming in the next release slice.</p></div>
      <div className="sidebar-bottom"><div className="storage-note">Personal workspace<br /><span>Saved on this device</span></div></div>
    </aside>
    <div className="workspace-main">
      <header className="header"><span className="breadcrumb">Workspace <span aria-hidden="true">/</span> {page}</span><div className="appearance" role="group" aria-label="Color appearance"><button type="button" aria-label="Use light mode" aria-pressed={appearance === 'light'} onClick={() => void changeAppearance('light')}><Sun size={16} aria-hidden="true" /> Light</button><button type="button" aria-label="Use dark mode" aria-pressed={appearance === 'dark'} onClick={() => void changeAppearance('dark')}><Moon size={16} aria-hidden="true" /> Dark</button></div></header>
      {error && <p role="alert" className="error">{error}</p>}
      <main id="content" tabIndex={-1}>
        <div className="title"><span className="context">Personal workspace</span><h1>{page === 'Tailor CV' ? 'Start with your experience' : page}</h1><p>{page === 'Tailor CV' ? 'Build your profile, then tailor a CV to a saved posting.' : page === 'Saved jobs' ? 'Your job postings and their drafts will live here.' : page === 'My profile' ? 'Keep the career facts that support your CV in one place.' : 'Choose how your workspace looks.'}</p></div>
        {page === 'Tailor CV' ? <div className="columns"><section className="document-area" aria-label="CV document"><div className="document-toolbar"><span>CV document</span><span>Not started</span></div><div className="paper-wrap"><article className="paper"><div className="paper-header"><strong>Your name</strong><span>Your CV begins here</span></div><div className="paper-rule" /><h2>Education</h2><div className="paper-line" /><h2>Experience</h2><div className="paper-line" /><h2>Projects</h2><div className="paper-line" /><h2>Skills</h2><div className="paper-line" /><h2>Certificates</h2><div className="paper-line" /><p className="paper-hint">Add your career facts in My profile.</p></article></div></section><aside className="inspector" aria-label="Evidence and coverage"><div className="inspector-tabs"><span>Evidence</span><span>Coverage</span></div><div className="inspector-content"><h2>Nothing to inspect yet</h2><p>Once a draft is generated, select a paragraph to see its supporting profile evidence here.</p><div className="inspector-divider" /><h2>Qualification gaps</h2><p>Job requirements without supporting experience will appear as advisory gaps, not invented claims.</p></div></aside></div> : page === 'My profile' ? <ProfileEditor /> : <div className="empty-panel"><h2>{page === 'Settings' ? 'Appearance' : 'No saved postings'}</h2><p>{page === 'Settings' ? 'Use the Light and Dark controls in the header. Your choice is saved locally and restored when you reopen the app.' : 'Saving postings is not available in this first installable slice. Your workspace is ready for the next steps.'}</p></div>}
      </main>
    </div>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
