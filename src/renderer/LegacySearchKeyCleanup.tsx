import React, { useEffect, useRef, useState } from 'react'
import type { WorkbenchAPI } from '../shared/appearance'
import type { ResearchSearchKeyStatus } from '../shared/research-search-settings'

export type LegacySearchKeyCleanupClient = Pick<WorkbenchAPI, 'getResearchSearchKeyStatus' | 'removeResearchSearchKey'>

interface Props { client?: LegacySearchKeyCleanupClient }
const STORAGE_FAILURE = 'Legacy search-key storage could not be checked. Any existing key was left unchanged.'
const defaultClient = () => window.workbench

export function LegacySearchKeyCleanup({ client }: Props) {
  const api = client ?? defaultClient()
  const [status, setStatus] = useState<ResearchSearchKeyStatus | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cancelRef = useRef<HTMLButtonElement>(null)
  const removeRef = useRef<HTMLButtonElement>(null)
  const restoreRemoveFocus = useRef(false)

  useEffect(() => {
    let active = true
    api.getResearchSearchKeyStatus()
      .then(value => { if (active) setStatus(value) })
      .catch(() => { if (active) setLoadFailed(true) })
    return () => { active = false }
  }, [api])

  useEffect(() => {
    if (confirm) cancelRef.current?.focus()
    else if (restoreRemoveFocus.current && status?.configured) {
      removeRef.current?.focus()
      restoreRemoveFocus.current = false
    }
  }, [confirm, status?.configured])

  async function remove() {
    setBusy(true)
    setError('')
    try {
      const removed = await api.removeResearchSearchKey()
      setStatus(removed)
      setConfirm(false)
    } catch {
      setError('The old encrypted key could not be removed from this device. It was not changed; try again.')
    } finally { setBusy(false) }
  }

  if (loadFailed || (status && status.message === STORAGE_FAILURE)) {
    return <p className="legacy-key-status" role="status">Old local search-key storage could not be checked. Any saved key was left unchanged.</p>
  }
  if (!status?.configured) return null

  return <section className="legacy-key-cleanup" aria-labelledby="legacy-key-heading">
    <h2 id="legacy-key-heading">Remove an old local search key</h2>
    <p role="status">An encrypted legacy key is saved on this device. Search is retired; the key is not used by CV Tailor.</p>
    <p>This removes only the encrypted local copy. It does not revoke the key in your Tavily account.</p>
    {!confirm && <button ref={removeRef} className="secondary-button destructive-button" type="button" disabled={busy} onClick={() => setConfirm(true)}>Remove local key</button>}
    {confirm && <div className="legacy-key-confirm" role="group" aria-labelledby="legacy-key-confirm-heading">
      <h3 id="legacy-key-confirm-heading">Remove the encrypted key from this device?</h3>
      <p>Your Tavily account key will remain active unless you revoke it with the provider.</p>
      <div className="form-actions">
        <button ref={cancelRef} className="secondary-button" type="button" disabled={busy} onClick={() => { restoreRemoveFocus.current = true; setConfirm(false) }}>Cancel</button>
        <button className="secondary-button destructive-button" type="button" disabled={busy} onClick={() => void remove()}>{busy ? 'Removing…' : 'Confirm removal'}</button>
      </div>
    </div>}
    {error && <p className="profile-message error" role="alert">{error}</p>}
  </section>
}
