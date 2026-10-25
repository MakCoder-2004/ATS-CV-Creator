import React, { FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { KeyRound } from 'lucide-react'
import type { WorkbenchAPI } from '../shared/appearance'
import type { ResearchSearchKeyStatus } from '../shared/research-search-settings'
import './TavilyKeyCard.css'

export type TavilyKeyCardClient = Pick<WorkbenchAPI,
  'getResearchSearchKeyStatus' | 'saveResearchSearchKey' | 'removeResearchSearchKey' | 'revealResearchSearchKey' | 'copyResearchSearchKey'>

interface Props { client?: TavilyKeyCardClient; modelContext?: string }
const defaultClient = () => window.workbench
const STORAGE_FAILURE = 'Search key storage failed. The existing key was not replaced.'

export function TavilyKeySummary({ status, loadFailed }: { status: ResearchSearchKeyStatus | null; loadFailed: boolean }) {
  const summary = !status ? loadFailed ? 'Local key status unavailable. Reopen Settings to retry.' : 'Checking local key storage…'
    : status.message === STORAGE_FAILURE
      ? 'Local key storage could not be checked. An existing key may still be saved. Reopen Settings to retry; no key was replaced.'
      : status.configured && !status.storageAvailable
        ? 'A local encrypted key is stored, but device encryption is unavailable. Reveal and copy are unavailable; you can still remove it.'
        : status.storageAvailable ? status.configured ? 'A Tavily key is saved on this device.' : 'No Tavily key is saved on this device.'
          : 'Secure local key storage is unavailable. A Tavily key cannot be saved here.'
  return <p className="settings-helper tavily-summary" role="status">{summary}</p>
}

export function TavilyKeyCard({ client, modelContext = '' }: Props) {
  const api = client ?? defaultClient()
  const [status, setStatus] = useState<ResearchSearchKeyStatus | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [typedVisible, setTypedVisible] = useState(false)
  const [revealed, setRevealed] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [revealPending, setRevealPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const keyRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const revokeRef = useRef<HTMLButtonElement>(null)
  const focusIntent = useRef<'key' | 'replace' | 'revoke' | null>(null)
  const generation = useRef(0)
  const revealedRef = useRef('')

  function clearReveal() { generation.current++; revealedRef.current = ''; setRevealed('') }
  function hideReveal() { clearReveal(); setRevealPending(false); setBusy(false) }
  useLayoutEffect(() => {
    clearReveal()
    if (revealPending) { setRevealPending(false); setBusy(false) }
  }, [modelContext])
  useEffect(() => {
    let active = true
    api.getResearchSearchKeyStatus().then(value => { if (active) setStatus(value) })
      .catch(() => { if (active) { setLoadFailed(true); setError('Tavily key status could not be loaded. Reopen Settings to retry.') } })
    return () => { active = false; generation.current++; revealedRef.current = '' }
  }, [api])
  useEffect(() => { if (confirm) cancelRef.current?.focus() }, [confirm])
  useLayoutEffect(() => {
    const intent = focusIntent.current
    if (!intent) return
    const target = intent === 'key' ? keyRef.current : intent === 'replace' ? replaceRef.current : revokeRef.current
    if (target) { target.focus(); focusIntent.current = null }
  }, [replacing, status, confirm])

  function startReplacing() {
    clearReveal(); setRevealPending(false); setConfirm(false); focusIntent.current = 'key'; setReplacing(true); setTypedVisible(false); setKeyInput(''); setError(''); setNotice('')
  }
  function cancelReplacing() {
    focusIntent.current = 'replace'; setKeyInput(''); setTypedVisible(false); setReplacing(false); setError(''); setNotice('')
  }
  async function save(event: FormEvent) {
    event.preventDefault(); clearReveal(); setBusy(true); setError(''); setNotice('')
    try {
      const saved = await api.saveResearchSearchKey(keyInput)
      focusIntent.current = 'replace'; setStatus(saved); setKeyInput(''); setTypedVisible(false); setReplacing(false); setConfirm(false)
      setNotice('Tavily key saved on this device. No search was started.')
    } catch { setError('Tavily key was not saved. Check the key and device encryption, then try again.') }
    finally { setBusy(false) }
  }
  async function reveal() {
    const request = ++generation.current; setBusy(true); setRevealPending(true); setError(''); setNotice('')
    try {
      const result = await api.revealResearchSearchKey()
      if (generation.current === request) { revealedRef.current = result.key; setRevealed(result.key) }
    } catch { if (generation.current === request) setError('The saved key could not be revealed. Check device encryption and try again.') }
    finally { if (generation.current === request) { setRevealPending(false); setBusy(false) } }
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
      focusIntent.current = 'key'; setStatus(removed); setKeyInput(''); setTypedVisible(false); setConfirm(false)
      setNotice('Local Tavily key removed. Revoke it in your Tavily account if needed.')
    } catch { setError('Local Tavily key could not be removed. Try again.') }
    finally { setBusy(false) }
  }
  const known = !!status && !loadFailed && status.message !== STORAGE_FAILURE
  const configured = known && status.configured
  const storageAvailable = known && status.storageAvailable
  const editing = !configured || replacing
  return <section className="settings-block tavily-key-card" aria-labelledby="tavily-key-title">
    <div className="settings-block-heading"><span className="settings-block-icon"><KeyRound size={18} aria-hidden="true" /></span><div><h2 id="tavily-key-title">Tavily search key</h2><p>Separate from your Pi model sign-in.</p></div></div>
    <TavilyKeySummary status={status} loadFailed={loadFailed} />
    <form className="profile-form tavily-form" onSubmit={event => void save(event)}>
      <label className="form-field" htmlFor="tavily-key">Tavily API key
        <input ref={keyRef} id="tavily-key" type={editing ? typedVisible ? 'text' : 'password' : revealed ? 'text' : 'password'}
          value={editing ? keyInput : revealed} placeholder={!editing && !revealed ? '••••••••••••••••' : undefined}
          readOnly={!editing} onChange={event => setKeyInput(event.target.value)}
          autoComplete="off" autoCapitalize="off" spellCheck={false} minLength={12} maxLength={512} required={editing}
          disabled={busy || !known || (editing && !storageAvailable)} aria-describedby="tavily-key-mode tavily-key-help" />
      </label>
      <p className="settings-helper" id="tavily-key-mode">{!known ? 'Key status is unknown. Reopen Settings before changing a key.' : configured ? replacing ? 'Enter a replacement here. Cancel keeps the saved key.' : 'Saved on this device. Replace to enter a new key in this field.' : 'Enter a key to save on this device.'}</p>
      {configured && !replacing ? <>
        <div className="tavily-actions">
          {revealed || revealPending ? <button className="secondary-button" type="button" onClick={hideReveal}>Hide</button> : <button className="secondary-button" type="button" disabled={busy || !storageAvailable} onClick={() => void reveal()}>Reveal</button>}
          <button className="secondary-button" type="button" disabled={busy || !storageAvailable} onClick={() => void copy()}>Copy</button>
          <button ref={replaceRef} className="secondary-button" type="button" disabled={busy || !storageAvailable} onClick={startReplacing}>Replace</button>
          {!confirm && <button ref={revokeRef} className="secondary-button tavily-danger" type="button" disabled={busy} onClick={() => setConfirm(true)}>Revoke locally</button>}
        </div>
        <p className="settings-helper">Copied key stays on your clipboard and may be read by other apps until replaced.</p>
        {confirm && <div className="tavily-confirm" role="group" aria-labelledby="tavily-confirm-title" aria-describedby="tavily-confirm-description">
          <h3 id="tavily-confirm-title">Remove the local key?</h3>
          <p id="tavily-confirm-description">This removes the key from this device only. It does not revoke it in your Tavily account.</p>
          <div className="tavily-actions"><button ref={cancelRef} className="secondary-button" type="button" disabled={busy} onClick={() => { focusIntent.current = 'revoke'; setConfirm(false) }}>Cancel</button><button className="secondary-button tavily-danger" type="button" disabled={busy} onClick={() => void revokeLocally()}>{busy ? 'Removing…' : 'Remove local key'}</button></div>
        </div>}
      </> : <div className="tavily-actions">
        <button className="primary-button" type="submit" disabled={busy || !storageAvailable || keyInput.length < 12}>{busy ? 'Saving…' : replacing ? 'Save replacement key' : 'Save Tavily key'}</button>
        {replacing && <><button className="secondary-button" type="button" disabled={busy} onClick={() => setTypedVisible(value => !value)}>{typedVisible ? 'Hide typed key' : 'Show typed key'}</button><button className="secondary-button" type="button" disabled={busy} onClick={cancelReplacing}>Cancel replacement</button></>}
        {!configured && keyInput && <button className="secondary-button" type="button" onClick={() => setTypedVisible(value => !value)}>{typedVisible ? 'Hide typed key' : 'Show typed key'}</button>}
      </div>}
      <p className="settings-helper" id="tavily-key-help">Create and manage your own Tavily account. Saving makes no search request. The encrypted key stays outside workspace backups.</p>
    </form>
    <p className="settings-helper tavily-privacy">A later search may send a public role title, posting host and job ID, or verified employer domain to Tavily. Tavily may share the public query with other search-index providers and receive network metadata. No profile data is sent. Search requires a separate action and is not started here.</p>
    {error && <p className="profile-message error" role="alert">{error}</p>}{notice && <p className="profile-message success" role="status">{notice}</p>}
  </section>
}
