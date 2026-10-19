import React, { FormEvent, useEffect, useRef, useState } from 'react'
import { UserRound } from 'lucide-react'
import type { ContactInput, ProfileEntry, ProfileEntryInput, ProfileSnapshot, SkillInput, SkillRecord } from '../shared/profile'
import { ExperienceEditor } from './ExperienceEditor'
import { FieldSelect } from './controls/FieldSelect'
import { MonthYearPicker } from './controls/MonthYearPicker'

type ProfileSection = 'Personal' | 'Skills' | 'Experience' | 'Projects' | 'Education' | 'Certificates' | 'Summary' | 'Languages' | 'Extras'
type LinkRow = { key: number; label: string; url: string }
const profileSections: ProfileSection[] = ['Personal', 'Skills', 'Experience', 'Projects', 'Education', 'Certificates', 'Summary', 'Languages', 'Extras']
const skillCategories = ['Technical', 'Tools', 'Domain', 'Languages', 'Leadership', 'Other']
const proficiencyLabels: Record<string, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', expert: 'Expert' }

export function ProfileEditor() {
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
    <nav className="profile-sections" aria-label="Profile sections">{profileSections.map(section => <button key={section} type="button" aria-current={activeSection === section ? 'page' : undefined} onClick={() => { setActiveSection(section); setMutationError(''); setNotice(''); setFieldErrors({}) }}>{section}</button>)}</nav>
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
          <FieldSelect id="skill-category" label="Skill category" value={skill.category} onValueChange={value => updateSkill('category', value)} options={categories.map(category => ({ value: category, label: category }))} error={fieldErrors.category} />
          <FieldSelect id="skill-proficiency" label="Proficiency (optional)" value={skill.proficiency ?? ''} onValueChange={value => updateSkill('proficiency', value)} options={[{ value: '', label: 'Not specified' }, ...(['beginner', 'intermediate', 'advanced', 'expert'] as const).map(value => ({ value, label: proficiencyLabels[value] }))]} error={fieldErrors.proficiency} />
          <label>Years of experience (optional)<input type="number" min="0" max="80" step="1" value={skill.years ?? ''} onChange={event => updateSkill('years', event.target.value)} aria-invalid={!!fieldErrors.years} aria-describedby={fieldErrors.years ? 'skill-years-error' : undefined} />{fieldErrors.years && <span className="field-error" id="skill-years-error">{fieldErrors.years}</span>}</label>
        </div>
        <div className="form-actions"><button className="primary-button" type="submit">{skillEditId ? 'Save skill' : 'Add skill'}</button>{skillEditId && <button className="secondary-button" type="button" onClick={resetSkill}>Cancel</button>}</div>
      </form>
      {snapshot?.skills.length ? <ul className="skill-list">{snapshot.skills.map(item => <li key={item.id}>
        <div className="skill-copy"><h3>{item.name}</h3><span className="category-tag">{item.category}</span>{item.proficiency && <span>{proficiencyLabels[item.proficiency] ?? item.proficiency}</span>}{item.years != null && <span>{item.years} {item.years === 1 ? 'year' : 'years'}</span>}</div>
        <div className="skill-actions"><button className="text-button" type="button" onClick={() => editSkill(item)}>Edit {item.name}</button><button className="text-button destructive" type="button" aria-label={`Delete ${item.name}`} onClick={() => void deleteSkill(item)}>Delete</button></div>
      </li>)}</ul> : <p className="empty-skills">No skills added yet.</p>}
    </section>}
    {(activeSection === 'Experience' || activeSection === 'Projects') && <ExperienceEditor key={activeSection} projects={activeSection === 'Projects'} />}
    {activeSection === 'Education' && <ProfileEntryEditor key="education" section="education" items={snapshot?.education ?? []} reload={reload} onError={setMutationError} onSuccess={setNotice} />}
    {activeSection === 'Certificates' && <ProfileEntryEditor key="certificates" section="certificates" items={snapshot?.certificates ?? []} reload={reload} onError={setMutationError} onSuccess={setNotice} />}
    {activeSection === 'Summary' && <ProfileEntryEditor key="summary" section="summary" items={snapshot?.summary ?? []} reload={reload} onError={setMutationError} onSuccess={setNotice} />}
    {activeSection === 'Languages' && <ProfileEntryEditor key="languages" section="languages" items={snapshot?.languages ?? []} reload={reload} onError={setMutationError} onSuccess={setNotice} />}
    {activeSection === 'Extras' && <ProfileEntryEditor key="extras" section="extras" items={snapshot?.extras ?? []} reload={reload} onError={setMutationError} onSuccess={setNotice} />}
    <p className="locality-note">Your profile is stored locally on this device. It is not synced or shared. Local storage does not guarantee that future cloud features will be anonymous.</p>
    {(mutationError || notice) && <p className={mutationError ? 'profile-message error' : 'profile-message success'} role={mutationError ? 'alert' : 'status'}>{mutationError || notice}{mutationError && <button className="text-button" type="button" onClick={() => void reload()}>Retry</button>}</p>}
  </div>
}

function ProfileEntryEditor({ section, items, reload, onError, onSuccess }: { section: ProfileEntryInput['section']; items: ProfileEntry[]; reload: () => Promise<void>; onError: (message: string) => void; onSuccess: (message: string) => void }) {
  const empty = (): ProfileEntryInput => ({ section, title: section === 'summary' ? 'Summary' : '', ...(section === 'summary' ? { description: '' } : {}) })
  const [form, setForm] = useState<ProfileEntryInput>(empty)
  const [editId, setEditId] = useState<string>()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const update = (key: keyof ProfileEntryInput, value: string) => setForm(old => ({ ...old, [key]: key === 'year' ? value ? Number(value) : undefined : value === '' ? undefined : value }))
  async function save(event: FormEvent) {
    event.preventDefault(); setErrors({}); onError(''); onSuccess('')
    try {
      const result = await window.workbench.saveProfileEntry({ ...form, id: editId })
      if (!result.ok) { setErrors(result.error.fieldErrors ?? {}); onError(result.error.message); return }
      setEditId(undefined); setForm(empty()); await reload(); onSuccess(`${section} saved`)
    } catch { onError(`The ${section} record could not be saved. Check the fields and try again.`) }
  }
  function edit(item: ProfileEntry) { const { id, revision, ...values } = item; setEditId(id); setForm(values); setErrors({}); onError(''); onSuccess('') }
  async function del(item: ProfileEntry) {
    if (!window.confirm(`Delete ${item.title}? This cannot be undone.`)) return
    try {
      const result = await window.workbench.deleteProfileEntry(item.id)
      if (!result.ok) { onError(result.error.message); return }
      await reload(); onSuccess(`${item.title} deleted`)
    } catch { onError(`${item.title} could not be deleted. Try again.`) }
  }
  const field = (key: keyof ProfileEntryInput, label: string, options: { type?: string; multiline?: boolean } = {}) => <label className="form-field" key={key}>{label}
    {options.multiline ? <textarea rows={4} value={String(form[key] ?? '')} onChange={event => update(key, event.target.value)} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${section}-${key}-error` : undefined} />
      : <input type={options.type ?? 'text'} value={String(form[key] ?? '')} onChange={event => update(key, event.target.value)} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${section}-${key}-error` : undefined} />}
    {errors[key] && <span className="field-error" id={`${section}-${key}-error`}>{errors[key]}</span>}
  </label>
  const localOnly = section === 'summary' || section === 'languages' || section === 'extras'
  return <section className="profile-panel profile-entry-editor" aria-labelledby="entry-heading">
    <div className="panel-heading"><div><h2 id="entry-heading">{section[0].toUpperCase() + section.slice(1)}</h2><p>{localOnly ? 'Saved in your profile, not included in CV output.' : 'Keep these profile facts accurate. Edits retain their earlier revisions.'}</p></div></div>
    <form className="profile-form profile-entry-form" onSubmit={event => void save(event)} noValidate>
      <div className="form-grid profile-entry-grid">
        {section === 'summary' ? <div className="wide-field">{field('description', 'Summary', { multiline: true })}</div> : <>
          <div className={section === 'languages' || section === 'extras' ? 'wide-field' : undefined}>{field('title', section === 'languages' ? 'Language' : section === 'extras' ? 'Name' : 'Title')}</div>
          {section === 'education' && <>
            {field('institution', 'Institution')}
            <div className="wide-field">{field('field', 'Degree or field')}</div>
            <MonthYearPicker id="education-start" label="Start date" value={form.startDate} onChange={value => update('startDate', value ?? '')} error={errors.startDate} />
            <MonthYearPicker id="education-end" label="End date" value={form.endDate} onChange={value => update('endDate', value ?? '')} error={errors.endDate} />
          </>}
          {section === 'certificates' && <>
            {field('issuer', 'Issuer')}
            <MonthYearPicker id="certificate-year" label="Year" yearOnly value={form.year?.toString()} onChange={value => update('year', value ?? '')} error={errors.year} />
            <div className="wide-field">{field('link', 'Certificate link', { type: 'url' })}</div>
          </>}
          {section === 'languages' && <div className="wide-field">{field('description', 'Proficiency (optional)')}</div>}
          {section === 'extras' && <div className="wide-field">{field('description', 'Details (optional)', { multiline: true })}</div>}
        </>}
      </div>
      <div className="form-actions"><button className="primary-button" type="submit">{editId ? 'Save changes' : `Add ${section}`}</button>{editId && <button className="secondary-button" type="button" onClick={() => { setEditId(undefined); setForm(empty()); setErrors({}) }}>Cancel</button>}</div>
    </form>
    {items.length ? <div className="evidence-records"><h3>Saved {section}</h3><ul className="skill-list">{items.map(item => <li key={item.id}>
      <div><h3>{item.title}</h3><div className="entry-meta">{item.institution && <span>{item.institution}</span>}{item.field && <span>{item.field}</span>}{item.issuer && <span>{item.issuer}</span>}{item.year && <span>{item.year}</span>}{item.startDate && <span>{item.startDate} – {item.endDate ?? 'Present'}</span>}</div>{item.description && <p className="entry-description">{item.description}</p>}</div>
      <div className="skill-actions"><button className="text-button" type="button" onClick={() => edit(item)}>Edit {item.title}</button><button className="text-button destructive" type="button" onClick={() => void del(item)}>Delete</button></div>
    </li>)}</ul></div> : <p className="empty-skills">No {section} added yet. Add your first record above.</p>}
  </section>
}
