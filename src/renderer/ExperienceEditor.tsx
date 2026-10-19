import React, { FormEvent, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import type { ExperienceInput, ExperienceRecord, ProjectInput, ProjectRecord } from '../shared/experience'
import { FieldSelect } from './controls/FieldSelect'
import { MonthYearPicker } from './controls/MonthYearPicker'

type NestedRow = { key: string; id?: string; text: string }
type LinkRow = { key: string; label: string; url: string }
const newRow = (): NestedRow => ({ key: crypto.randomUUID(), text: '' })

function NestedRows({ label, rows, onChange }: { label: string; rows: NestedRow[]; onChange: (rows: NestedRow[]) => void }) {
  const update = (index: number, text: string) => onChange(rows.map((row, at) => at === index ? { ...row, text } : row))
  const move = (index: number, direction: -1 | 1) => {
    const next = [...rows]
    ;[next[index], next[index + direction]] = [next[index + direction], next[index]]
    onChange(next)
  }
  return <fieldset className="evidence-group">
    <legend>{label}</legend><div className="evidence-group-heading"><button className="secondary-button" type="button" onClick={() => onChange([...rows, newRow()])}>Add {label.toLowerCase()}</button></div>
    {rows.length ? <div className="evidence-rows">{rows.map((row, index) => <div className="evidence-row" key={row.key}>
      <label>{label} {index + 1}<input value={row.text} onChange={event => update(index, event.target.value)} /></label>
      <div className="evidence-row-actions">
        <button type="button" className="icon-button" aria-label={`Move ${label} ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp size={17} aria-hidden="true" /></button>
        <button type="button" className="icon-button" aria-label={`Move ${label} ${index + 1} down`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}><ChevronDown size={17} aria-hidden="true" /></button>
        <button type="button" className="icon-button destructive" aria-label={`Remove ${label} ${index + 1}`} onClick={() => onChange(rows.filter((_, at) => at !== index))}><Trash2 size={17} aria-hidden="true" /></button>
      </div>
    </div>)}</div> : <p className="evidence-empty">Add each item separately so its history stays attached when you reorder it.</p>}
  </fieldset>
}

export function ExperienceEditor({ projects }: { projects: boolean }) {
  const [data, setData] = useState<{ experience: ExperienceRecord[]; projects: ProjectRecord[] }>({ experience: [], projects: [] })
  const [editing, setEditing] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [nestedRows, setNestedRows] = useState<{ factualItems: NestedRow[]; technologies: NestedRow[] }>({ factualItems: [], technologies: [] })
  const [links, setLinks] = useState<LinkRow[]>([])
  const items = projects ? data.projects : data.experience
  const editingForm = editing !== undefined || Object.keys(fields).length > 0
  async function reload() { try { setData(await window.workbench.getExperience()); setError('') } catch { setError('Your experience and project evidence could not be loaded. Try again.') } finally { setLoading(false) } }
  useEffect(() => { void reload() }, [])
  function begin(item?: ExperienceRecord | ProjectRecord) {
    setEditing(item?.id)
    if (projects) {
      const project = item as ProjectRecord | undefined
      setFields({ name: project?.name ?? '', description: project?.description ?? '' })
      setNestedRows({ factualItems: (project?.factualItems ?? []).map(({ id, text }) => ({ key: id, id, text })), technologies: (project?.technologies ?? []).map(({ id, text }) => ({ key: id, id, text })) })
      setLinks((project?.links ?? []).map(link => ({ key: crypto.randomUUID(), ...link })))
    } else {
      const role = item as ExperienceRecord | undefined
      setFields({ kind: role?.kind ?? 'employment', title: role?.title ?? '', organization: role?.organization ?? '', startDate: role?.startDate ?? '', endDate: role?.endDate ?? '', description: role?.description ?? '' })
      setNestedRows({ factualItems: (role?.factualItems ?? []).map(({ id, text }) => ({ key: id, id, text })), technologies: [] })
      setLinks([])
    }
    setError(''); setNotice(''); setFieldErrors({})
  }
  function cancel() { setEditing(undefined); setFields({}); setNestedRows({ factualItems: [], technologies: [] }); setLinks([]); setFieldErrors({}) }
  const serialized = (rows: NestedRow[]) => rows.filter(row => row.text.trim()).map(({ id, text }) => ({ ...(id ? { id } : {}), text }))
  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice(''); setFieldErrors({})
    const input = projects ? {
      name: fields.name, description: fields.description,
      factualItems: serialized(nestedRows.factualItems), technologies: serialized(nestedRows.technologies),
      links: links.filter(link => link.label.trim() || link.url.trim()).map(({ label, url }) => ({ label, url }))
    } satisfies ProjectInput : {
      kind: fields.kind as 'employment' | 'training', title: fields.title, organization: fields.organization,
      startDate: fields.startDate || undefined, endDate: fields.endDate || undefined,
      description: fields.description, factualItems: serialized(nestedRows.factualItems)
    } satisfies ExperienceInput
    try {
      const result = projects ? await window.workbench.saveProject({ ...input as ProjectInput, id: editing }) : await window.workbench.saveExperience({ ...input as ExperienceInput, id: editing })
      if (!result.ok) { setError(result.error.message); setFieldErrors(result.error.fieldErrors ?? {}); return }
      setData(result.value); cancel(); setNotice(projects ? 'Project saved' : 'Experience saved')
    } catch { setError('Your changes could not be saved. Check the fields and try again.') }
  }
  async function remove(item: ExperienceRecord | ProjectRecord) {
    if (!window.confirm(`Delete ${projects ? (item as ProjectRecord).name : (item as ExperienceRecord).title}? This cannot be undone.`)) return
    const result = projects ? await window.workbench.deleteProject(item.id) : await window.workbench.deleteExperience(item.id)
    if (result.ok) { setData(result.value); setNotice('Record deleted') } else setError(result.error.message)
  }
  const field = (name: string, label: string, multiline = false) => <label className="form-field" key={name}>{label}
    {multiline ? <textarea rows={4} aria-invalid={!!fieldErrors[name]} aria-describedby={fieldErrors[name] ? `experience-${name}-error` : undefined} value={fields[name] ?? ''} onChange={event => setFields(current => ({ ...current, [name]: event.target.value }))} />
      : <input aria-invalid={!!fieldErrors[name]} aria-describedby={fieldErrors[name] ? `experience-${name}-error` : undefined} value={fields[name] ?? ''} onChange={event => setFields(current => ({ ...current, [name]: event.target.value }))} />}
    {fieldErrors[name] && <span className="field-error" id={`experience-${name}-error`}>{fieldErrors[name]}</span>}
  </label>
  if (loading) return <section className="profile-panel" role="status">Loading your local evidence…</section>
  return <section className="profile-panel evidence-editor" aria-labelledby="experience-heading">
    <div className="panel-heading"><div><h2 id="experience-heading">{projects ? 'Projects' : 'Experience'}</h2><p>{projects ? 'Keep the original project description and its supporting facts together.' : 'Keep employment and training distinct, with dates copied from your records.'}</p></div>{!editingForm && <button className="secondary-button" type="button" onClick={() => begin()}>Add {projects ? 'project' : 'role'}</button>}</div>
    {editingForm && <form className="profile-form" onSubmit={event => void save(event)} noValidate>
      <div className="form-grid evidence-form-grid">
        {projects ? <>
          <div className="wide-field">{field('name', 'Project name')}</div>
          <div className="wide-field">{field('description', 'Original project description', true)}</div>
          <NestedRows label="Factual items" rows={nestedRows.factualItems} onChange={rows => setNestedRows(current => ({ ...current, factualItems: rows }))} />
          <NestedRows label="Technology" rows={nestedRows.technologies} onChange={rows => setNestedRows(current => ({ ...current, technologies: rows }))} />
          <fieldset className="evidence-group wide-field"><legend>Project links</legend><div className="evidence-group-heading"><button className="secondary-button" type="button" onClick={() => setLinks(current => [...current, { key: crypto.randomUUID(), label: '', url: '' }])}>Add link</button></div>
            {links.length ? <div className="evidence-rows">{links.map((link, index) => <div className="project-link-row" key={link.key}>
              <label>Link name {index + 1}<input value={link.label} onChange={event => setLinks(current => current.map(row => row.key === link.key ? { ...row, label: event.target.value } : row))} aria-invalid={!!fieldErrors[`links.${index}.label`]} /></label>
              <label>Link URL {index + 1}<input type="url" value={link.url} onChange={event => setLinks(current => current.map(row => row.key === link.key ? { ...row, url: event.target.value } : row))} aria-invalid={!!fieldErrors[`links.${index}.url`]} /></label>
              <button className="icon-button destructive" type="button" aria-label={`Remove link ${index + 1}`} onClick={() => setLinks(current => current.filter(row => row.key !== link.key))}><Trash2 size={17} aria-hidden="true" /></button>
              {(fieldErrors[`links.${index}.label`] || fieldErrors[`links.${index}.url`]) && <span className="field-error wide-field" role="alert">{fieldErrors[`links.${index}.label`] || fieldErrors[`links.${index}.url`]}</span>}
            </div>)}</div> : <p className="evidence-empty">Add a named project link when you have one.</p>}
          </fieldset>
        </> : <>
          <div className="wide-field"><FieldSelect id="experience-kind" label="Record type" value={fields.kind ?? 'employment'} onValueChange={kind => setFields(current => ({ ...current, kind }))} options={[{ value: 'employment', label: 'Employment' }, { value: 'training', label: 'Training' }]} /></div>
          {field('title', 'Role or training title')}
          {field('organization', 'Company or institution')}
          <MonthYearPicker id="experience-start" label="Start date" value={fields.startDate} onChange={value => setFields(current => ({ ...current, startDate: value ?? '' }))} error={fieldErrors.startDate} />
          <MonthYearPicker id="experience-end" label="End date" value={fields.endDate} onChange={value => setFields(current => ({ ...current, endDate: value ?? '' }))} error={fieldErrors.endDate} />
          <div className="wide-field">{field('description', 'Original description', true)}</div>
          <div className="wide-field"><NestedRows label="Factual items" rows={nestedRows.factualItems} onChange={rows => setNestedRows(current => ({ ...current, factualItems: rows }))} /></div>
        </>}
      </div>
      <div className="form-actions"><button className="primary-button" type="submit">Save {projects ? 'project' : 'role'}</button><button className="secondary-button" type="button" onClick={cancel}>Cancel</button></div>
    </form>}
    {items.length ? <div className="evidence-records"><h3>Saved {projects ? 'projects' : 'roles'}</h3><ul className="skill-list">{items.map(item => <li key={item.id}><div className="skill-copy"><h3>{projects ? (item as ProjectRecord).name : (item as ExperienceRecord).title}</h3><span>{projects ? (item as ProjectRecord).description : `${(item as ExperienceRecord).kind === 'training' ? 'Training' : 'Employment'} · ${(item as ExperienceRecord).organization}`}</span><small>Revision {item.revision}</small></div><div className="skill-actions"><button className="text-button" type="button" onClick={() => begin(item)}>Edit</button><button className="text-button destructive" type="button" onClick={() => void remove(item)}>Delete</button></div></li>)}</ul></div> : <p className="empty-skills">No {projects ? 'projects' : 'experience'} added yet. Add a record to keep your original evidence available offline.</p>}
    {(error || notice) && <p className={error ? 'profile-message error' : 'profile-message success'} role={error ? 'alert' : 'status'}>{error || notice}{error && <button className="text-button" type="button" onClick={() => void reload()}>Retry</button>}</p>}
  </section>
}
