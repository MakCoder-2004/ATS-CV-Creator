import React, { FormEvent, useEffect, useRef, useState } from 'react'
import { KeyRound } from 'lucide-react'
import type { ResearchSearchKeyStatus } from '../shared/research-search-settings'
import './TavilyKeyCard.css'

export interface TavilyKeyCardClient {
  getResearchSearchKeyStatus(): Promise<ResearchSearchKeyStatus>
  saveResearchSearchKey(key: string): Promise<ResearchSearchKeyStatus>
  removeResearchSearchKey(): Promise<ResearchSearchKeyStatus>
  revealResearchSearchKey(): Promise<{ key: string }>
  copyResearchSearchKey(): Promise<{ ok: true; message: string }>
}

interface Props { client?: TavilyKeyCardClient }
const defaultClient = () => (window as unknown as { workbench: TavilyKeyCardClient }).workbench

export function TavilyKeyCard({ client }: Props) {
  const api = client ?? defaultClient()
  const [status, setStatus] = useState<ResearchSearchKeyStatus | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [revealed, setRevealed] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const cancelRef = useRef<HTMLButtonElement>(null)
  const revokeRef = useRef<HTMLButtonElement>(null)
  const generation = useRef(0)
  const revealedRef = useRef('')

  function clearReveal() { generation.current++; revealedRef.current = ''; setRevealed('') }
  useEffect(() => {
    let active = true
    api.getResearchSearchKeyStatus().then(value => { if (active) setStatus(value) })
      .catch(() => { if (active) setError('Tavily key status could not be loaded. Reopen Settings to retry.') })
    return () => { active = false; generation.current++; revealedRef.current = '' }
  }, [api])
  useEffect(() => { if (confirm) cancelRef.current?.focus() }, [confirm])

  async function save(event: FormEvent) {
    event.preventDefault(); clearReveal(); setBusy(true); setError(''); setNotice('')
    try {
      const saved = await api.saveResearchSearchKey(keyInput)
      setStatus(saved); setKeyInput(''); setConfirm(false)
      setNotice('Tavily key saved on this device. No search was started.')
    } catch { setError('Tavily key was not saved. Check the key and device encryption, then try again.') }
    finally { setBusy(false) }
  }
  async function reveal() {
    const request = ++generation.current; setBusy(true); setError(''); setNotice('')
    try {
      const result = await api.revealResearchSearchKey()
      if (generation.current === request) { revealedRef.current = result.key; setRevealed(result.key) }
    } catch { if (generation.current === request) setError('The saved key could not be revealed. Check device encryption and try again.') }
    finally { if (generation.current === request) setBusy(false) }
  }
  async function copy() {
    setBusy(true); setError(''); setNotice('')
    try { const result = await api.copyResearchSearchKey(); setNotice(result.message) }
    catch { setError('The saved key could not be copied. Check device encryption and try again.') }
    finally { setBusy(false) }
  }
  async function revokeLocally() {
    clearReveal(); setBusy(true); setError(''); setNotice('')
    try {
      const removed = await api.removeResearchSearchKey()
      setStatus(removed); setKeyInput(''); setConfirm(false)
      setNotice('Local Tavily key removed. Revoke it in your Tavily account if needed.')
    } catch { setError('Local Tavily key could not be removed. Try again.') }
    finally { setBusy(false) }
  }
  const configured = status?.configured === true
  const storageAvailable = status?.storageAvailable === true
  const summary = !status ? 'Checking local key storage…' : configured && !storageAvailable
    ? 'A local encrypted key is stored, but device encryption is unavailable. Reveal and copy are unavailable; you can still remove it.'
    : storageAvailable ? configured ? 'A Tavily key is saved on this device.' : 'No Tavily key is saved on this device.'
      : 'Secure local key storage is unavailable. A Tavily key cannot be saved here.'

  return <section className="settings-block tavily-key-card" aria-labelledby="tavily-key-title">
    <div className="settings-block-heading"><span className="settings-block-icon"><KeyRound size={18} aria-hidden="true" /></span><div><h2 id="tavily-key-title">Tavily search key</h2><p>Separate from your Pi model sign-in.</p></div></div>
    <p className="settings-helper tavily-summary" role="status">{summary}</p>
    {configured && <div className="tavily-saved-key">
      <label htmlFor="tavily-saved-value">Saved key</label>
      <input id="tavily-saved-value" type={revealed ? 'text' : 'password'} value={revealed || '••••••••••••••••'} readOnly autoComplete="off" aria-label="Saved Tavily key" />
      <div className="tavily-actions">
        {revealed ? <button className="secondary-button" type="button" disabled={busy} onClick={clearReveal}>Hide</button> : <button className="secondary-button" type="button" disabled={busy || !storageAvailable} onClick={() => void reveal()}>Reveal</button>}
        <button className="secondary-button" type="button" disabled={busy || !storageAvailable} onClick={() => void copy()}>Copy</button>
        {!confirm && <button ref={revokeRef} className="secondary-button tavily-danger" type="button" disabled={busy} onClick={() => setConfirm(true)}>Revoke locally</button>}
      </div>
      <p className="settings-helper">Copied key stays on your clipboard and may be read by other apps until replaced.</p>
      {confirm && <div className="tavily-confirm" role="alertdialog" aria-labelledby="tavily-confirm-title" aria-describedby="tavily-confirm-description" aria-modal="false">
        <h3 id="tavily-confirm-title">Remove the local key?</h3>
        <p id="tavily-confirm-description">This removes the key from this device only. It does not revoke it in your Tavily account.</p>
        <div className="tavily-actions"><button ref={cancelRef} className="secondary-button" type="button" disabled={busy} onClick={() => { setConfirm(false); requestAnimationFrame(() => revokeRef.current?.focus()) }}>Cancel</button><button className="secondary-button tavily-danger" type="button" disabled={busy} onClick={() => void revokeLocally()}>{busy ? 'Removing…' : 'Remove local key'}</button></div>
      </div>}
    </div>}
    <form className="profile-form tavily-form" onSubmit={event => void save(event)}>
      <label className="form-field" htmlFor="tavily-new-key">{configured ? 'New or replacement API key' : 'Tavily API key'}<input id="tavily-new-key" type="password" value={keyInput} onChange={event => setKeyInput(event.target.value)} autoComplete="new-password" autoCapitalize="off" spellCheck={false} minLength={12} maxLength={512} required disabled={busy || !storageAvailable} aria-describedby="tavily-key-help" /></label>
      <p className="settings-helper" id="tavily-key-help">Create and manage your own Tavily account. Saving makes no search request. The encrypted key stays outside workspace backups.</p>
      <div className="tavily-actions"><button className="primary-button" type="submit" disabled={busy || !storageAvailable || keyInput.length < 12}>{busy ? 'Saving…' : configured ? 'Save replacement key' : 'Save Tavily key'}</button></div>
    </form>
    <p className="settings-helper tavily-privacy">A later search may send a public role title, posting host and job ID, or verified employer domain to Tavily. No profile data goes into search queries. Search requires a separate action and is not started here.</p>
    {error && <p className="profile-message error" role="alert">{error}</p>}{notice && <p className="profile-message success" role="status">{notice}</p>}
  </section>
}
