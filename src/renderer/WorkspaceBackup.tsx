import React, { useEffect, useRef, useState } from 'react'
import { ArchiveRestore } from 'lucide-react'
import type { WorkspaceRestorePreview } from '../shared/appearance'

export function WorkspaceBackup({ onRestored }: { onRestored: () => Promise<void> }) {
  const [preview, setPreview] = useState<WorkspaceRestorePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (preview) dialog.current?.showModal()
    return () => { if (preview) dialog.current?.close() }
  }, [preview])
  useEffect(() => () => { if (preview) void window.workbench.cancelWorkspaceRestore(preview.token).catch(() => {}) }, [preview])

  async function exportBackup() {
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await window.workbench.exportWorkspaceBackup()
      if (result.ok) setMessage(result.message)
      else if (!result.cancelled) setError(result.message)
    } catch { setError('Workspace backup failed. Check the destination and try again.') }
    finally { setBusy(false) }
  }
  async function selectRestore() {
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await window.workbench.previewWorkspaceRestore()
      if (result.ok) setPreview(result.preview)
      else if (!result.cancelled) setError(result.message)
    } catch { setError('The backup could not be read or is incompatible. Your workspace was not changed.') }
    finally { setBusy(false) }
  }
  async function cancelRestore() {
    if (!preview) return
    const token = preview.token
    setPreview(null)
    try { await window.workbench.cancelWorkspaceRestore(token) } catch { /* The preview is discarded on error too. */ }
  }
  async function applyRestore() {
    if (!preview || busy) return
    setBusy(true); setError('')
    const token = preview.token
    try {
      const result = await window.workbench.applyWorkspaceRestore(token)
      if (!result.ok) { setError(result.message); return }
      setPreview(null)
      setMessage(result.message)
      try { await onRestored() }
      catch { setError('Workspace restored, but the screen could not refresh. Restart CV Tailor to view the restored data.') }
    } catch { setError('Restore failed. The current workspace was not replaced; check the safety backup and try again.') }
    finally { setBusy(false) }
  }
  return <section className="settings-block workspace-backup" aria-labelledby="workspace-backup-heading">
    <div className="settings-block-heading"><span className="settings-block-icon"><ArchiveRestore size={18} aria-hidden="true" /></span><div><h2 id="workspace-backup-heading">Workspace backup</h2><p>Keep a copy of your jobs, profile, CV drafts, evidence and preferences.</p></div></div>
    <p className="settings-helper">Backup files contain personal data. Store them securely. Pi credentials are not included; an older backup needs a new Pi model selection after restoring.</p>
    <div className="workspace-backup-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void exportBackup()}>Back up workspace</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void selectRestore()}>Restore workspace</button></div>
    {error && <p role="alert" className="profile-message error">{error}</p>}{message && <p role="status" className="profile-message success">{message}</p>}
    {preview && <dialog ref={dialog} className="job-dialog workspace-restore-dialog" aria-labelledby="workspace-restore-title" onCancel={event => { event.preventDefault(); if (!busy) void cancelRestore() }}>
      <div className="job-dialog-heading"><div><h2 id="workspace-restore-title">Replace workspace from backup?</h2><p>Review what will be replaced before you continue.</p></div></div>
      <div className="job-dialog-form"><p>This replaces the entire current workspace, not a merge. The selected file contains personal data. A verified safety backup of your current data will be saved before any replacement; store it securely. Pi credentials are not included. Restored model work will not resume automatically.</p>
        <ul aria-label="Workspace replacement effects">{preview.effects.map(effect => <li key={effect.label}>{effect.label}: {effect.current} now → {effect.replacement} after restore</li>)}</ul>
        {error && <p role="alert" className="profile-message error">{error}</p>}
        <div className="job-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void cancelRestore()}>Cancel restore</button><button type="button" className="primary-button" disabled={busy} onClick={() => void applyRestore()}>{busy ? 'Creating safety backup…' : 'Confirm workspace replacement'}</button></div>
      </div>
    </dialog>}
  </section>
}
