import React, { FormEvent, useEffect, useState } from 'react'
import { geminiModels, type GeminiModel, type GeminiSettings } from '../shared/gemini-settings'

export function GeminiSettingsPanel() {
  const [settings, setSettings] = useState<GeminiSettings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { window.workbench.getSettings().then(value => setSettings(value.gemini)).catch(() => setError('Gemini settings could not be loaded. Restart the app to retry.')) }, [])
  async function saveModel(value: GeminiModel) {
    try { const saved = await window.workbench.setGeminiModel(value); setSettings(saved.gemini); setError(''); setMessage('Model preference saved. No provider request was sent.') }
    catch { setError('Model preference could not be saved. Choose a supported Gemini model and try again.'); setMessage('') }
  }
  async function saveKey(event: FormEvent) {
    event.preventDefault(); setMessage(''); setError('')
    try { const saved = await window.workbench.saveGeminiApiKey(apiKey); setSettings(saved.gemini); setApiKey(''); setMessage('API key saved securely. No provider request was sent.') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'API key was not saved. Check secure storage and try again.') }
  }
  async function removeKey() {
    try { const saved = await window.workbench.removeGeminiApiKey(); setSettings(saved.gemini); setApiKey(''); setError(''); setMessage('Saved API key removed. No provider request was sent.') }
    catch { setError('The saved API key could not be removed. Try again.'); setMessage('') }
  }
  return <div className="settings-panel">
    <p>Choose the Gemini model for future operations. Saving settings never sends a provider request.</p>
    <label>Gemini model<select aria-label="Gemini model" value={settings?.model ?? 'gemini-3.6-flash'} onChange={event => void saveModel(event.target.value as GeminiModel)}>{geminiModels.map(model => <option key={model} value={model}>{model}</option>)}</select></label>
    <section className="credential-panel" aria-labelledby="credential-heading"><h3 id="credential-heading">Gemini API key</h3>
      {settings?.credential.configured ? <p role="status">An encrypted API key is saved on this device. Its value is never shown here.</p> : <p>No API key is saved.</p>}
      {!settings?.credential.secureStorageAvailable && <p className="privacy-warning" role="alert">Secure storage is unavailable. A key cannot be saved; CV Tailor will not store it in plaintext.</p>}
      <form className="profile-form" onSubmit={event => void saveKey(event)}><label>API key<input aria-label="Gemini API key" type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} disabled={!settings?.credential.secureStorageAvailable} /></label><div className="form-actions"><button className="primary-button" type="submit" disabled={!settings?.credential.secureStorageAvailable || !apiKey.trim()}>Save API key</button>{settings?.credential.configured && <button className="secondary-button" type="button" onClick={() => void removeKey()}>Remove saved API key</button>}</div></form>
    </section>
    <p className="privacy-warning">Privacy limitation: Gemini's free tier is a cloud service and Google may use submitted data under its free-tier terms, which restrict personal, sensitive, or confidential information. Local key storage does not make generation private or anonymous and does not establish compliance. Review the outgoing data and provider terms before any future generation.</p>
    {error && <p className="profile-message error" role="alert">{error}</p>}{message && <p className="profile-message success" role="status">{message}</p>}
  </div>
}
