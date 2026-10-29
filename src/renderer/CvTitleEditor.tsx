import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

export function CvTitleEditor({ title, onClose, onChange }: { title: string; onClose: () => void; onChange: (value: string | null) => Promise<boolean> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    element?.querySelector('input')?.focus()
    return () => { element?.close(); if (invoker?.isConnected) invoker.focus() }
  }, [])
  async function save(value: string | null) {
    if (busy) return
    setBusy(true); setError('')
    try { if (await onChange(value)) onClose(); else setError('The title could not be saved. Your entered text is unchanged.') }
    catch { setError('The title could not be saved. Your entered text is unchanged.') }
    finally { setBusy(false) }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = new FormData(event.currentTarget).get('cv-title')
    if (typeof value === 'string') void save(value)
  }
  return <dialog ref={dialog} className="draft-record-dialog" aria-labelledby={heading} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <header className="record-dialog-heading"><h2 id={heading}>Edit CV title</h2></header>
    <form className="record-editor-form" onSubmit={submit}>
      <p>This changes only this CV, not your profile or employment titles. Changes require renewed checks, page fit and approval.</p>
      <label className="record-field">CV title for this CV<input name="cv-title" defaultValue={title} required maxLength={100} disabled={busy} /></label>
      {error && <p role="alert">{error}</p>}
      <footer className="record-dialog-actions"><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="secondary-button" type="button" disabled={busy} onClick={() => void save(null)}>Remove CV title</button><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save CV title'}</button></footer>
    </form>
  </dialog>
}
