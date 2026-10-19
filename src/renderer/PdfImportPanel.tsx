import { useEffect, useRef, useState } from 'react'
import type { PdfImportField, PdfImportProposal, PdfImportSelection } from '../shared/pdf-import'
import './pdf-import.css'

type Selection = Extract<PdfImportSelection, { ok: true }>
type Proposal = Extract<PdfImportProposal, { ok: true }>
const categories = ['unmapped', 'contact', 'education', 'experience', 'project', 'certificate', 'skill'] as const
const fieldsByCategory: Record<PdfImportField['category'], PdfImportField['field'][]> = {
  unmapped: ['text', 'link'],
  contact: ['name', 'headline', 'email', 'phone', 'location', 'link'],
  education: ['title', 'name', 'organization', 'text', 'description', 'startDate', 'endDate'],
  experience: ['title', 'organization', 'description', 'startDate', 'endDate', 'text'],
  project: ['name', 'title', 'description', 'text', 'technology', 'link'],
  certificate: ['title', 'name', 'organization', 'description', 'startDate', 'link'],
  skill: ['name', 'title', 'category']
}
const fieldLabel: Partial<Record<PdfImportField['field'], string>> = { name: 'Name', title: 'Title', organization: 'Employer / institution / issuer', text: 'Evidence / field of study', description: 'Description', startDate: 'Start date / certificate year', endDate: 'End date', category: 'Skill category', technology: 'Project technology', link: 'Link target' }

export function PdfImportPanel({ onApplied }: { onApplied: (message: string) => Promise<void> }) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [rows, setRows] = useState<PdfImportField[]>([])
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const activeToken = useRef<string | null>(null)
  useEffect(() => () => { if (activeToken.current) void window.workbench.cancelReferencePdf(activeToken.current).catch(() => {}) }, [])
  const change = (index: number, changes: Partial<PdfImportField>) => {
    setRows(current => current.map((row, item) => item === index ? { ...row, ...changes } : row))
    setProposal(null); setError('')
  }
  async function select() {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await window.workbench.selectReferencePdf()
      if (!result.ok) { if (!result.cancelled) setError(result.message); return }
      activeToken.current = result.token
      setSelection(result); setRows(result.preview.fields); setProposal(null)
    } catch { setError('The PDF could not be opened for review. Your profile was not changed.') }
    finally { setBusy(false) }
  }
  async function review() {
    if (!selection || busy) return
    setBusy(true); setError('')
    try {
      const result = await window.workbench.reviewReferencePdf(selection.token, { fields: rows, confirmed: true })
      if (result.ok) setProposal(result)
      else setError(result.message)
    } catch { setError('The corrected facts could not be validated. Review the fields and try again.') }
    finally { setBusy(false) }
  }
  async function cancel() {
    if (!selection || busy) return
    setBusy(true); setError('')
    try {
      const result = await window.workbench.cancelReferencePdf(selection.token)
      if (!result.ok) { setError(result.message); return }
      activeToken.current = null
      setSelection(null); setRows([]); setProposal(null); setMessage(result.message)
    } catch { setError('The PDF review could not be cancelled. Try again.') }
    finally { setBusy(false) }
  }
  async function apply() {
    if (!selection || !proposal || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await window.workbench.applyReferencePdf(selection.token)
      if (!result.ok) { setError(result.message); setProposal(null); return }
      activeToken.current = null
      setSelection(null); setRows([]); setProposal(null)
      await onApplied(result.message)
    } catch { setError('The import or profile refresh failed. Check your saved profile before trying again.') }
    finally { setBusy(false) }
  }

  return <section className="profile-panel pdf-import-panel" aria-label="Reference PDF import">
    <div className="panel-heading"><div><span className="context">One-time local extraction</span><h2>Review reference CV</h2><p>Choose a text PDF. Each fragment is untrusted until you correct its category and confirm it; the original PDF is never modified or sent to Gemini.</p></div>
      {!selection && <button className="secondary-button" type="button" disabled={busy} onClick={() => void select()}>{busy ? 'Extracting locally…' : 'Review reference PDF'}</button>}
    </div>
    {error && <p role="alert" className="pdf-import-error">{error}</p>}
    {message && <p role="status" className="pdf-import-notice">{message}</p>}
    {selection && <>
      {!proposal ? <section className="pdf-import-review" aria-label="Extracted PDF review">
        <p>{selection.preview.extraction.pageCount} PDF {selection.preview.extraction.pageCount === 1 ? 'page' : 'pages'} · {rows.length} text/link fragments. Map related fields to the same record number. Leave unreadable or irrelevant text unmapped; review each row even when excluding it. Missing information is not invented.</p>
        <p className="pdf-import-caution">PDF reading order, font glyphs and link labels can be wrong. Compare every date, contact detail, description, category and target with the original document.</p>
        {selection.preview.extraction.issues.length > 0 && <ul className="pdf-import-issues" aria-label="Extraction issues">{selection.preview.extraction.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}
        <ol className="pdf-import-fields" aria-label="Extracted fragments">{rows.map((row, index) => {
          const original = selection.preview.fields[index]
          const source = original.sourceIndexes[0] === undefined ? undefined : selection.preview.extraction.source[original.sourceIndexes[0]]
          return <li key={index}>
            <div className="pdf-import-source"><strong>{source ? `Page ${source.page} text` : 'PDF link target'}</strong><span>{original.value}</span><small>{row.confidence === 'suggested' ? 'Possible contact field' : row.confidence === 'unmapped' ? 'No category inferred' : 'Link mapping uncertain'} — verify against the PDF</small></div>
            <div className="pdf-import-controls">
              <label>Category<select value={row.category} onChange={event => { const category = event.target.value as PdfImportField['category']; change(index, { category, field: category === 'unmapped' ? original.field : fieldsByCategory[category][0], experienceKind: undefined }) }}>{categories.map(category => <option key={category} value={category}>{category === 'unmapped' ? 'Exclude / unmapped' : category[0].toUpperCase() + category.slice(1)}</option>)}</select></label>
              <label>Field<select value={row.field} onChange={event => change(index, { field: event.target.value as PdfImportField['field'] })}>{fieldsByCategory[row.category].map(field => <option key={field} value={field}>{fieldLabel[field] ?? field}</option>)}</select></label>
              {row.category !== 'unmapped' && row.category !== 'contact' && <label>Record number<input type="number" min="1" max="100" value={row.record} onChange={event => change(index, { record: Number(event.target.value) })} /></label>}
              {row.category === 'experience' && <label>Experience type<select value={row.experienceKind ?? ''} onChange={event => change(index, { experienceKind: event.target.value ? event.target.value as 'employment' | 'training' : undefined })}><option value="">Choose type</option><option value="employment">Employment</option><option value="training">Training</option></select></label>}
              <label className="pdf-import-value">Correct extracted text{row.field === 'description' || row.field === 'text' ? <textarea rows={2} value={row.value} onChange={event => change(index, { value: event.target.value })} /> : <input value={row.value} onChange={event => change(index, { value: event.target.value })} />}</label>
              {row.field === 'link' && row.category !== 'unmapped' && row.category !== 'certificate' && <label>Link label<input value={row.label ?? ''} onChange={event => change(index, { label: event.target.value })} /></label>}
              <label className="pdf-import-check"><input type="checkbox" checked={row.confirmed} onChange={event => change(index, { confirmed: event.target.checked })} />Reviewed</label>
            </div>
          </li>
        })}</ol>
        <div className="form-actions"><button type="button" className="primary-button" disabled={busy || rows.some(row => !row.confirmed)} onClick={() => void review()}>Review replacement effects</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void cancel()}>Cancel PDF review</button></div>
      </section> : <section className="pdf-import-effects" aria-label="Profile replacement effects">
        <h3>Confirm profile changes</h3><p>No extracted fact has been saved. Existing records not listed here remain unchanged. These confirmed facts will be added or explicitly replace contact fields through the same atomic profile contract as JSON replacement.</p>
        <ul>{proposal.effects.map((change, index) => <li key={index}><strong>{change.action}</strong> {change.category}: {change.label}</li>)}</ul>
        <div className="form-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void apply()}>Apply reviewed PDF facts</button><button type="button" className="secondary-button" disabled={busy} onClick={() => setProposal(null)}>Edit facts</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void cancel()}>Cancel PDF review</button></div>
      </section>}
    </>}
  </section>
}
