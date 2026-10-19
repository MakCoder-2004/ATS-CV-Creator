import React, { FormEvent, useEffect, useState } from 'react'
import { KeyRound, Sparkles } from 'lucide-react'
import { geminiModels, type GeminiModel, type GeminiSettings } from '../shared/gemini-settings'
import { FieldSelect } from './controls/FieldSelect'

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
    catch { setError('The saved API key could not be removed. Try again.') }
  }
  return <section className="settings-panel" aria-label="Gemini preferences">
    <div className="settings-grid">
      <section className="settings-block" aria-labelledby="model-heading">
        <div className="settings-block-heading"><span className="settings-block-icon"><Sparkles size={18} aria-hidden="true" /></span><div><h2 id="model-heading">Model preference</h2><p>Choose the Gemini model for future operations.</p></div></div>
        <FieldSelect id="gemini-model" label="Gemini model" value={settings?.model ?? 'gemini-3.6-flash'} onValueChange={value => void saveModel(value as GeminiModel)} options={geminiModels.map(model => ({ value: model, label: model }))} />
        <p className="settings-helper">Changing the model or saving a key never sends a request.</p>
      </section>
      <section className="settings-block credential-panel" aria-labelledby="credential-heading">
        <div className="settings-block-heading"><span className="settings-block-icon"><KeyRound size={18} aria-hidden="true" /></span><div><h2 id="credential-heading">API key</h2><p>{settings?.credential.configured ? 'An encrypted key is saved on this device. Its value is never shown here.' : 'No API key is saved.'}</p></div></div>
        {!settings?.credential.secureStorageAvailable && <p className="secure-storage-error" role="alert">Secure storage is unavailable. A key cannot be saved; CV Tailor will not store it in plaintext.</p>}
        <form className="profile-form" onSubmit={event => void saveKey(event)}><label className="form-field">Gemini API key<input aria-label="Gemini API key" type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} disabled={!settings?.credential.secureStorageAvailable} /></label><div className="form-actions"><button className="primary-button" type="submit" disabled={!settings?.credential.secureStorageAvailable || !apiKey.trim()}>{settings?.credential.configured ? 'Replace API key' : 'Save API key'}</button>{settings?.credential.configured && <button className="secondary-button" type="button" onClick={() => void removeKey()}>Remove saved key</button>}</div></form>
      </section>
    </div>
    <p className="settings-disclosure">Gemini's free tier sends data to Google, which may use it under its unpaid-service terms. Do not submit personal, sensitive, or confidential information; storing a key locally does not make requests private. <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">Read Google's Gemini API terms</a>.</p>
    {error && <p className="profile-message error" role="alert">{error}</p>}{message && <p className="profile-message success" role="status">{message}</p>}
  </section>
}
