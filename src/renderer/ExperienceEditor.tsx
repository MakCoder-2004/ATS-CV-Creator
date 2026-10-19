import React, { FormEvent, useEffect, useState } from 'react'
import type { ExperienceInput, ExperienceRecord, ProjectInput, ProjectRecord } from '../shared/experience'

type NestedRow = { id?: string; revision?: number; text: string }

function NestedRows({ label, rows, onChange }: { label: string; rows: NestedRow[]; onChange: (rows: NestedRow[]) => void }) {
  return <fieldset className="nested-evidence"><legend>{label}</legend>{rows.map((row, index) => <div className="nested-evidence-row" key={row.id ?? `${label}-${index}`}><label>{label} {index + 1}<input value={row.text} onChange={event => onChange(rows.map((item, at) => at === index ? { ...item, text: event.target.value } : item))} /></label><button type="button" className="text-button" aria-label={`Move ${label} ${index + 1} up`} disabled={index === 0} onClick={() => { const next = [...rows]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next) }}>Move up</button><button type="button" className="text-button" aria-label={`Move ${label} ${index + 1} down`} disabled={index === rows.length - 1} onClick={() => { const next = [...rows]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; onChange(next) }}>Move down</button><button type="button" className="text-button destructive" aria-label={`Remove ${label} ${index + 1}`} onClick={() => onChange(rows.filter((_, at) => at !== index))}>Remove</button></div>)}<button type="button" className="secondary-button" onClick={() => onChange([...rows, { text: '' }])}>Add {label.toLowerCase()}</button></fieldset>
}

export function ExperienceEditor({ projects }: { projects: boolean }) {
  const [data, setData] = useState<{ experience: ExperienceRecord[]; projects: ProjectRecord[] }>({ experience: [], projects: [] })
  const [editing, setEditing] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [nestedRows, setNestedRows] = useState<Record<string, NestedRow[]>>({ factualItems: [], technologies: [] })
  const items = projects ? data.projects : data.experience
  async function reload() { try { setData(await window.workbench.getExperience()); setError('') } catch { setError('Your experience and project evidence could not be loaded. Try again.') } finally { setLoading(false) } }
  useEffect(() => { void reload() }, [])
  function begin(item?: ExperienceRecord | ProjectRecord) {
    setEditing(item?.id)
    if (projects) {
      const project = item as ProjectRecord | undefined
      setFields({ name: project?.name ?? '', description: project?.description ?? '', links: (project?.links ?? []).map(value => `${value.label} | ${value.url}`).join('\n') })
      setNestedRows({ factualItems: (project?.factualItems ?? []).map(({ id, revision, text }) => ({ id, revision, text })), technologies: (project?.technologies ?? []).map(({ id, revision, text }) => ({ id, revision, text })) })
    } else {
      const role = item as ExperienceRecord | undefined
      setFields({ kind: role?.kind ?? 'employment', title: role?.title ?? '', organization: role?.organization ?? '', startDate: role?.startDate ?? '', endDate: role?.endDate ?? '', description: role?.description ?? '' })
      setNestedRows({ factualItems: (role?.factualItems ?? []).map(({ id, revision, text }) => ({ id, revision, text })), technologies: [] })
    }
    setError(''); setNotice(''); setFieldErrors({})
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice(''); setFieldErrors({})
    const input = projects ? {
      name: fields.name, description: fields.description, factualItems: nestedRows.factualItems.filter(row => row.text.trim()).map(({ id, text }) => ({ ...(id ? { id } : {}), text })),
      technologies: nestedRows.technologies.filter(row => row.text.trim()).map(({ id, text }) => ({ ...(id ? { id } : {}), text })),
      links: (fields.links ?? '').split('\n').filter(Boolean).map(row => { const [label, ...url] = row.split('|'); return { label: label.trim(), url: url.join('|').trim() } })
    } satisfies ProjectInput : {
      kind: fields.kind as 'employment' | 'training', title: fields.title, organization: fields.organization, startDate: fields.startDate || undefined, endDate: fields.endDate || undefined,
      description: fields.description, factualItems: nestedRows.factualItems.filter(row => row.text.trim()).map(({ id, text }) => ({ ...(id ? { id } : {}), text }))
    } satisfies ExperienceInput
    try {
      const result = projects ? await window.workbench.saveProject({ ...input as ProjectInput, id: editing }) : await window.workbench.saveExperience({ ...input as ExperienceInput, id: editing })
      if (!result.ok) { setError(result.error.message); setFieldErrors(result.error.fieldErrors ?? {}); return }
      setData(result.value); setEditing(undefined); setNotice(projects ? 'Project saved' : 'Experience saved')
    } catch { setError('Your changes could not be saved. Check the fields and try again.') }
  }
  async function remove(item: ExperienceRecord | ProjectRecord) {
    if (!window.confirm(`Delete ${projects ? (item as ProjectRecord).name : (item as ExperienceRecord).title}? This cannot be undone.`)) return
    const result = projects ? await window.workbench.deleteProject(item.id) : await window.workbench.deleteExperience(item.id)
    if (result.ok) { setData(result.value); setNotice('Record deleted') } else setError(result.error.message)
  }
  const field = (name: string, label: string, multiline = false) => <label>{label}{multiline ? <textarea aria-invalid={!!fieldErrors[name]} value={fields[name] ?? ''} onChange={event => setFields(current => ({ ...current, [name]: event.target.value }))} /> : <input aria-invalid={!!fieldErrors[name]} value={fields[name] ?? ''} onChange={event => setFields(current => ({ ...current, [name]: event.target.value }))} />}{fieldErrors[name] && <span className="field-error">{fieldErrors[name]}</span>}</label>
  if (loading) return <section className="profile-panel" role="status">Loading your local evidence…</section>
  return <section className="profile-panel" aria-labelledby="experience-heading"><div className="panel-heading"><div><span className="context">Original evidence</span><h2 id="experience-heading">{projects ? 'Projects' : 'Experience'}</h2><p>{projects ? 'Keep project descriptions, factual items, technology and links.' : 'Employment and training remain separately labelled. Dates stay exactly as entered.'}</p></div>{!editing && <button className="secondary-button" type="button" onClick={() => begin()}>Add {projects ? 'project' : 'role'}</button>}</div>
    {editing !== undefined || (!editing && Object.keys(fields).length > 0) ? <form className="profile-form" onSubmit={event => void save(event)} noValidate><div className="form-grid">
      {projects ? <>{field('name', 'Project name')}{field('description', 'Original project description', true)}<NestedRows label="Factual items" rows={nestedRows.factualItems} onChange={rows => setNestedRows(current => ({ ...current, factualItems: rows }))} /> <NestedRows label="Technology" rows={nestedRows.technologies} onChange={rows => setNestedRows(current => ({ ...current, technologies: rows }))} />{field('links', 'Links (name | URL, one per line)', true)}</> : <><label>Record type<select value={fields.kind ?? 'employment'} onChange={event => setFields(current => ({ ...current, kind: event.target.value }))}><option value="employment">Employment</option><option value="training">Training</option></select></label>{field('title', 'Role or training title')}{field('organization', 'Company or institution')}{field('startDate', 'Start date (as entered)')}{field('endDate', 'End date (as entered)')}{field('description', 'Original description', true)}<NestedRows label="Factual items" rows={nestedRows.factualItems} onChange={rows => setNestedRows(current => ({ ...current, factualItems: rows }))} /></>}
    </div><div className="form-actions"><button className="primary-button" type="submit">Save {projects ? 'project' : 'role'}</button><button className="secondary-button" type="button" onClick={() => { setEditing(undefined); setFields({}) }}>Cancel</button></div></form> : null}
    {items.length ? <ul className="skill-list">{items.map(item => <li key={item.id}><div className="skill-copy"><h3>{projects ? (item as ProjectRecord).name : (item as ExperienceRecord).title}</h3><span>{projects ? (item as ProjectRecord).description : `${(item as ExperienceRecord).kind === 'training' ? 'Training' : 'Employment'} · ${(item as ExperienceRecord).organization}`}</span><small>Revision {item.revision}</small></div><div className="skill-actions"><button className="text-button" type="button" onClick={() => begin(item)}>Edit</button><button className="text-button destructive" type="button" onClick={() => void remove(item)}>Delete</button></div></li>)}</ul> : <p className="empty-skills">No {projects ? 'projects' : 'experience'} added yet. Add a record to keep your original evidence available offline.</p>}
    {(error || notice) && <p className={error ? 'profile-message error' : 'profile-message success'} role={error ? 'alert' : 'status'}>{error || notice}{error && <button className="text-button" type="button" onClick={() => void reload()}>Retry</button>}</p>}
  </section>
}
