import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { KeyRound } from 'lucide-react'
import type { WorkbenchAPI } from '../shared/appearance'
import type { ResearchSearchKeyStatus } from '../shared/research-search-settings'
import './TavilyKeyCard.css'

export type TavilyKeyCardClient = Pick<WorkbenchAPI,
  'getResearchSearchKeyStatus' | 'removeResearchSearchKey' | 'revealResearchSearchKey' | 'copyResearchSearchKey'>

interface Props { client?: TavilyKeyCardClient; modelContext?: string }
const defaultClient = () => window.workbench
const STORAGE_FAILURE = 'Search key storage failed. The existing key was not replaced.'

export function TavilyKeySummary({ status, loadFailed }: { status: ResearchSearchKeyStatus | null; loadFailed: boolean }) {
  const summary = !status ? loadFailed ? 'Local key status unavailable. Reopen Settings to retry.' : 'Checking local key storage…'
    : status.message === STORAGE_FAILURE
      ? 'Local key storage could not be checked. An existing key may still be saved. Reopen Settings to retry; no key was replaced.'
      : status.configured && !status.storageAvailable
        ? 'A local encrypted key is stored, but device encryption is unavailable. Reveal and copy are unavailable; you can still remove it.'
        : status.configured ? 'A Tavily key is saved on this device.' : 'No Tavily key is saved on this device.'
  return <p className="settings-helper tavily-summary" role="status">{summary}</p>
}

export function TavilyKeyCard({ client, modelContext = '' }: Props) {
  const api = client ?? defaultClient()
  const [status, setStatus] = useState<ResearchSearchKeyStatus | null>(null)
  const [revealed, setRevealed] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const cancelRef = useRef<HTMLButtonElement>(null)
  const removeRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusIntent = useRef<'remove' | 'heading' | null>(null)
  const generation = useRef(0)
  function hide() { generation.current++; setRevealed(''); setBusy(false) }
  useEffect(() => {
    let active = true
    api.getResearchSearchKeyStatus().then(value => { if (active) setStatus(value) })
      .catch(() => { if (active) { setLoadFailed(true); setError('Tavily key status could not be loaded. Reopen Settings to retry.') } })
    return () => { active = false; generation.current++ }
  }, [api])
  const known = !!status && !loadFailed && status.message !== STORAGE_FAILURE
  const configured = known && status.configured
  useLayoutEffect(() => {
    generation.current++
    setRevealed('')
    setBusy(false)
  }, [modelContext])
  useLayoutEffect(() => {
    const intent = focusIntent.current
    if (intent) {
      const target = intent === 'remove' ? removeRef.current : headingRef.current
      ;(target ?? headingRef.current)?.focus()
      focusIntent.current = null
    } else if (confirm) cancelRef.current?.focus()
  }, [confirm, configured, notice])
  async function reveal() {
    const request = ++generation.current; setBusy(true); setError(''); setNotice('')
    try { const result = await api.revealResearchSearchKey(); if (generation.current === request) setRevealed(result.key) }
    catch { if (generation.current === request) setError('The saved key could not be revealed. Check device encryption and try again.') }
    finally { if (generation.current === request) setBusy(false) }
  }
  async function copy() {
    setBusy(true); setError(''); setNotice('')
    try { const result = await api.copyResearchSearchKey(); setNotice(result.message) }
    catch { setError('The saved key could not be copied. Check device encryption and try again.') }
    finally { setBusy(false) }
  }
  async function remove() {
    hide(); setBusy(true); setError(''); setNotice('')
    try { const removed = await api.removeResearchSearchKey(); focusIntent.current = 'heading'; setStatus(removed); setConfirm(false); setNotice('Local Tavily key removed. Revoke it in your Tavily account if needed.') }
    catch { setError('Local Tavily key could not be removed. Try again.') }
    finally { setBusy(false) }
  }
  return <section className="settings-block tavily-key-card" aria-labelledby="tavily-key-title">
    <div className="settings-block-heading"><span className="settings-block-icon"><KeyRound size={18} aria-hidden="true" /></span><div><h2 ref={headingRef} id="tavily-key-title" tabIndex={-1}>Search retired</h2><p>Tavily search is no longer available in CV Tailor.</p></div></div>
    <p className="settings-helper">No credential is sent to search, and no standing model consent is stored.</p>
    <TavilyKeySummary status={status} loadFailed={loadFailed} />
    {configured && <div className="tavily-stored-key" aria-label="Stored Tavily key">
      <label className="form-field" htmlFor="tavily-key">Existing encrypted Tavily key
        <input id="tavily-key" type={revealed ? 'text' : 'password'} value={revealed || '••••••••••••••••'} readOnly autoComplete="off" aria-describedby="tavily-key-help" />
      </label>
      <p className="settings-helper" id="tavily-key-help">Stored on this device only. You can recover it or remove it locally.</p>
      <div className="tavily-actions">
        {revealed ? <button className="secondary-button" type="button" disabled={busy} onClick={hide}>Hide</button> : <button className="secondary-button" type="button" disabled={busy || !status?.storageAvailable} onClick={() => void reveal()}>Reveal</button>}
        <button className="secondary-button" type="button" disabled={busy || !status?.storageAvailable} onClick={() => void copy()}>Copy</button>
        {!confirm && <button ref={removeRef} className="secondary-button tavily-danger" type="button" disabled={busy} onClick={() => setConfirm(true)}>Remove local key</button>}
      </div>
      {confirm && <div className="tavily-confirm" role="group" aria-labelledby="tavily-confirm-title" aria-describedby="tavily-confirm-description">
        <h3 id="tavily-confirm-title">Remove the local key?</h3>
        <p id="tavily-confirm-description">This removes the encrypted key from this device only. It does not revoke the key in your Tavily account.</p>
        <div className="tavily-actions"><button ref={cancelRef} className="secondary-button" type="button" disabled={busy} onClick={() => { focusIntent.current = 'remove'; setConfirm(false) }}>Cancel</button><button className="secondary-button tavily-danger" type="button" disabled={busy} onClick={() => void remove()}>{busy ? 'Removing…' : 'Confirm removal'}</button></div>
      </div>}
      <p className="settings-helper">Copied key stays on your clipboard and may be read by other apps until replaced.</p>
    </div>}
    {error && <p className="profile-message error" role="alert">{error}</p>}{notice && <p className="profile-message success" role="status">{notice}</p>}
  </section>
}
