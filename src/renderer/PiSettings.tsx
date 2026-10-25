import React, { FormEvent, useEffect, useRef, useState } from 'react'
import { KeyRound, Sparkles } from 'lucide-react'
import type { ResearchSearchKeyStatus } from '../shared/research-search-settings'
import { PI_THINKING_LEVELS, type PiModelSelection } from '../shared/pi-model'
import { FieldSelect } from './controls/FieldSelect'

function ResearchSearchKeySettings() {
  const [status, setStatus] = useState<ResearchSearchKeyStatus | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const removeTrigger = useRef<HTMLButtonElement>(null)
  const cancelRemove = useRef<HTMLButtonElement>(null)
  const restoreRemoveFocus = useRef(false)

  useEffect(() => {
    let active = true
    window.workbench.getResearchSearchKeyStatus().then(value => { if (active) setStatus(value) })
      .catch(() => { if (active) { setLoadFailed(true); setError('Search key status could not be loaded. Reopen Settings to retry.') } })
    return () => { active = false }
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    try {
      const saved = await window.workbench.saveResearchSearchKey(key)
      setStatus(saved); setKey(''); setConfirmRemove(false)
      setMessage('Tavily key saved on this device. No search was started.')
    } catch { setError('Tavily key was not saved. Check the key and device encryption, then try again.') }
    finally { setBusy(false) }
  }

  async function remove() {
    setBusy(true); setError(''); setMessage('')
    try {
      const removed = await window.workbench.removeResearchSearchKey()
      setStatus(removed); setKey(''); setConfirmRemove(false)
      setMessage('Local Tavily key removed. Revoke it in your Tavily account if needed.')
    } catch { setError('Local Tavily key could not be removed. Try again.') }
    finally { setBusy(false) }
  }

  useEffect(() => {
    if (confirmRemove) cancelRemove.current?.focus()
    else if (restoreRemoveFocus.current) {
      restoreRemoveFocus.current = false
      window.requestAnimationFrame(() => removeTrigger.current?.focus())
    }
  }, [confirmRemove])

  function cancelRemoval() {
    restoreRemoveFocus.current = true
    setConfirmRemove(false)
  }

  return <section className="settings-block" aria-labelledby="research-key-heading">
    <div className="settings-block-heading"><span className="settings-block-icon"><KeyRound size={18} aria-hidden="true" /></span><div><h2 id="research-key-heading">Tavily search key</h2><p>Separate from your Pi model sign-in.</p></div></div>
    <p className="settings-helper pi-settings-helper" role="status">{status ? status.configured && !status.storageAvailable ? 'A local encrypted Tavily key is stored, but device encryption is unavailable. Searches cannot use it now; you can still remove it.' : status.storageAvailable ? status.configured ? 'A Tavily key is saved on this device.' : 'No Tavily key is saved on this device.' : 'Secure local key storage is unavailable. A Tavily key cannot be saved here.' : loadFailed ? 'Local key status is unavailable.' : 'Checking local key storage…'}</p>
    <form className="profile-form" onSubmit={event => void save(event)}>
      <label className="form-field">Tavily API key<input type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="new-password" autoCapitalize="off" spellCheck={false} minLength={12} maxLength={512} required disabled={busy || !status?.storageAvailable} aria-describedby="research-key-help" /></label>
      <p className="settings-helper pi-settings-helper" id="research-key-help">Create and manage your own free Researcher account with Tavily. Saving a key makes no search request and does not enable a paid plan. The encrypted key stays outside workspace backups.</p>
      <div className="form-actions"><button className="primary-button" type="submit" disabled={busy || !status?.storageAvailable || !key}>Save Tavily key</button></div>
    </form>
    {status?.configured && <div className="research-key-removal">{confirmRemove ? <><p className="settings-helper">Remove the local key? This will not revoke the key in your Tavily account.</p><div className="form-actions"><button ref={cancelRemove} className="secondary-button" type="button" disabled={busy} onClick={cancelRemoval}>Cancel</button><button className="secondary-button" type="button" disabled={busy} onClick={() => void remove()}>Remove local key</button></div></> : <button ref={removeTrigger} className="secondary-button" type="button" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove local key</button>}</div>}
    <p className="settings-helper pi-settings-helper">A later search may send the public role title, posting host and job ID, or a verified employer domain, to Tavily. Tavily may share queries with other search-index providers. No profile data goes into search queries. Search requires a separate action and is not started here.</p>
    {error && <p className="profile-message error" role="alert">{error}</p>}{message && <p className="profile-message success" role="status">{message}</p>}
  </section>
}

export function PiSettingsPanel() {
  const [selection, setSelection] = useState<PiModelSelection | null>(null)
  const [reference, setReference] = useState('')
  const [thinkingLevel, setThinkingLevel] = useState<(typeof PI_THINKING_LEVELS)[number]>('medium')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    window.workbench.getSettings().then(value => {
      setSelection(value.pi)
      setReference(value.pi ? `${value.pi.providerId}/${value.pi.modelId}` : '')
      if (value.pi) setThinkingLevel(value.pi.thinkingLevel)
      setLoaded(true)
    }).catch(() => setError('Pi settings could not be loaded. Restart the app to retry.'))
  }, [])

  async function saveModel(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const saved = await window.workbench.setPiModel({ reference, thinkingLevel })
      setSelection(saved.pi)
      setReference(saved.pi ? `${saved.pi.providerId}/${saved.pi.modelId}` : reference)
      setMessage('Pi model preference saved.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pi model preference was not saved. Check the model reference and try again.')
    } finally { setBusy(false) }
  }

  return <section className="settings-panel" aria-label="Pi preferences">
    <div className="settings-grid">
      <section className="settings-block" aria-labelledby="pi-model-heading">
        <div className="settings-block-heading"><span className="settings-block-icon"><Sparkles size={18} aria-hidden="true" /></span><div><h2 id="pi-model-heading">Pi model</h2><p>Choose a provider and model available in your Pi setup.</p></div></div>
        <p className="settings-helper pi-settings-helper">Sign in through Pi outside CV Tailor. There is no Pi key here.</p>
        {selection && <p className="settings-helper pi-settings-helper">Saved selection: <strong>{selection.providerId}/{selection.modelId}</strong> · {selection.thinkingLevel} thinking</p>}
        <form className="profile-form" onSubmit={event => void saveModel(event)}>
          <label className="form-field">Provider/model reference<input value={reference} onChange={event => setReference(event.target.value)} placeholder="provider/model" spellCheck={false} autoCapitalize="off" autoComplete="off" required aria-describedby="pi-reference-help" /></label>
          <p className="settings-helper pi-settings-helper" id="pi-reference-help">Enter the exact provider/model reference. Keep any slashes in either ID.</p>
          <FieldSelect label="Thinking level" id="pi-thinking-level" value={thinkingLevel} onValueChange={value => setThinkingLevel(value as (typeof PI_THINKING_LEVELS)[number])} options={PI_THINKING_LEVELS.map(level => ({ value: level, label: level }))} />
          <div className="form-actions"><button className="primary-button" type="submit" disabled={busy || !loaded || !reference.trim() || (reference === (selection ? `${selection.providerId}/${selection.modelId}` : '') && thinkingLevel === selection?.thinkingLevel)}>{busy ? 'Saving…' : 'Save Pi model'}</button></div>
        </form>
      </section>
      <ResearchSearchKeySettings />
    </div>
    {error && <p className="profile-message error" role="alert">{error}</p>}{message && <p className="profile-message success" role="status">{message}</p>}
  </section>
}
