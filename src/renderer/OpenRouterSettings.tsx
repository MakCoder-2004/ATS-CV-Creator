import React, { FormEvent, useEffect, useState } from 'react'
import { Copy, Eye, EyeOff, KeyRound, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { defaultOpenRouterModel, openRouterModelSchema, type OpenRouterSettings } from '../shared/openrouter-settings'
import { analysisBudgetValues, defaultAnalysisBudgets, type AnalysisBudgets, type AnalysisUsage } from '../shared/posting-analysis'

export function OpenRouterSettingsPanel() {
  const [settings, setSettings] = useState<OpenRouterSettings | null>(null)
  const [model, setModel] = useState(defaultOpenRouterModel)
  const [apiKey, setApiKey] = useState('')
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [replacingKey, setReplacingKey] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [budgets, setBudgets] = useState<AnalysisBudgets>(defaultAnalysisBudgets)
  const [usage, setUsage] = useState<AnalysisUsage | null>(null)
  useEffect(() => { window.workbench.getSettings().then(value => { setSettings(value.openRouter); setModel(value.openRouter.model) }).catch(() => setError('OpenRouter settings could not be loaded. Restart the app to retry.')); window.workbench.getAnalysisUsage().then(value => { setUsage(value); setBudgets(analysisBudgetValues(value)) }).catch(() => setError('Analysis budget settings could not be loaded. Restart the app to retry.')) }, [])
  useEffect(() => { if (!revealedKey) return; const timer = window.setTimeout(() => setRevealedKey(null), 30000); return () => window.clearTimeout(timer) }, [revealedKey])
  async function saveBudgets(event: FormEvent) {
    event.preventDefault()
    try { const saved = await window.workbench.setAnalysisBudgets(analysisBudgetValues(budgets)); setUsage(saved); setBudgets(saved); setError(''); setMessage('Analysis budgets saved locally. No provider request was sent.') }
    catch { setError('Analysis budgets were not saved. Check that limits are within the displayed ranges.'); setMessage('') }
  }
  function budgetField(key: keyof AnalysisBudgets, label: string, min: number, max: number, step = 1) {
    return <label className="form-field">{label}<input type="number" min={min} max={max} step={step} value={budgets[key]} onChange={event => setBudgets(current => ({ ...current, [key]: Number(event.target.value) }))} /></label>
  }
  async function saveFaithfulness(value: boolean) {
    try { const saved = await window.workbench.setFaithfulnessCheck(value); setSettings(saved.openRouter); setError(''); setMessage('Faithfulness preference saved locally. Existing unresolved findings are not waived.') }
    catch { setError('Faithfulness preference could not be saved. Try again.'); setMessage('') }
  }
  async function saveModel(event: FormEvent) {
    event.preventDefault()
    const parsed = openRouterModelSchema.safeParse(model)
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Enter an OpenRouter model ID.'); setMessage(''); return }
    setBusy(true)
    try { const saved = await window.workbench.setOpenRouterModel(parsed.data); setSettings(saved.openRouter); setModel(saved.openRouter.model); setError(''); setMessage('OpenRouter model saved. New runs will use it; review and authorize outgoing data again.') }
    catch { setError('Model could not be saved. Check the ID and try again.'); setMessage('') }
    finally { setBusy(false) }
  }
  async function saveKey(event: FormEvent) {
    event.preventDefault(); setMessage(''); setError(''); setBusy(true)
    try { const saved = await window.workbench.saveOpenRouterApiKey(apiKey); setSettings(saved.openRouter); setApiKey(''); setRevealedKey(null); setReplacingKey(false); setConfirmRevoke(false); setMessage('OpenRouter API key saved securely. No provider request was sent.') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'API key was not saved. Check secure storage and try again.') }
    finally { setBusy(false) }
  }
  async function revealKey() {
    if (revealedKey) { setRevealedKey(null); return }
    setBusy(true); setError('')
    try { setRevealedKey(await window.workbench.revealOpenRouterApiKey()) }
    catch { setError('The saved key could not be revealed. Check secure storage and try again.') }
    finally { setBusy(false) }
  }
  async function copyKey() {
    setBusy(true); setError('')
    try { await window.workbench.copyOpenRouterApiKey(); setMessage('Key copied to clipboard. Other apps can read it until you clear the clipboard.') }
    catch { setError('The saved key could not be copied. Check secure storage and try again.') }
    finally { setBusy(false) }
  }
  async function removeKey() {
    setBusy(true)
    try { const saved = await window.workbench.removeOpenRouterApiKey(); setSettings(saved.openRouter); setApiKey(''); setRevealedKey(null); setReplacingKey(false); setConfirmRevoke(false); setError(''); setMessage('Saved key removed from this device. It may still be valid in OpenRouter.') }
    catch { setError('The saved API key could not be removed. Try again.') }
    finally { setBusy(false) }
  }
  return <section className="settings-panel" aria-label="OpenRouter preferences">
    <div className="settings-grid">
      <section className="settings-block" aria-labelledby="model-heading">
        <div className="settings-block-heading"><span className="settings-block-icon"><Sparkles size={18} aria-hidden="true" /></span><div><h2 id="model-heading">Model preference</h2><p>Enter an OpenRouter model ID for future runs.</p></div></div>
        <form className="profile-form" onSubmit={event => void saveModel(event)}><label className="form-field">OpenRouter model ID<input value={model} onChange={event => setModel(event.target.value)} placeholder="minimax/minimax-m3.1-flash:free" spellCheck={false} autoCapitalize="off" autoComplete="off" required /></label><div className="form-actions"><button className="primary-button" type="submit" disabled={busy || !settings || model === settings.model}>Save model</button></div></form>
        <p className="settings-helper">Availability, pricing and JSON reliability vary by model. Saving a model sends no request.</p>
      </section>
      <section className="settings-block credential-panel" aria-labelledby="credential-heading">
        <div className="settings-block-heading"><span className="settings-block-icon"><KeyRound size={18} aria-hidden="true" /></span><div><h2 id="credential-heading">API key</h2><p>{settings?.credential.configured ? 'Encrypted on this device. Reveal it only when you need it.' : 'No OpenRouter API key is saved.'}</p></div></div>
        {!settings?.credential.secureStorageAvailable && <p className="secure-storage-error" role="alert">Secure storage is unavailable. A key cannot be saved; CV Tailor will not store it in plaintext.</p>}
        {settings?.credential.configured && <div className="saved-credential">
          <label className="form-field">Saved OpenRouter API key<input aria-label="Saved OpenRouter API key" type={revealedKey ? 'text' : 'password'} value={revealedKey ?? 'stored-openrouter-key'} readOnly autoComplete="off" spellCheck={false} /></label>
          <div className="saved-credential-actions"><button type="button" className="secondary-button" aria-pressed={!!revealedKey} disabled={busy || !settings.credential.secureStorageAvailable} onClick={() => void revealKey()}>{revealedKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}{revealedKey ? 'Hide key' : 'Reveal key'}</button><button type="button" className="secondary-button" disabled={busy || !settings.credential.secureStorageAvailable} onClick={() => void copyKey()}><Copy size={16} aria-hidden="true" />Copy key</button><button type="button" className="secondary-button" disabled={busy} onClick={() => { setReplacingKey(value => !value); setRevealedKey(null); setConfirmRevoke(false); setApiKey('') }}>{replacingKey ? 'Cancel replacement' : 'Replace key'}</button><button type="button" className="secondary-button destructive" disabled={busy} onClick={() => { setConfirmRevoke(true); setRevealedKey(null); setReplacingKey(false); setApiKey('') }}><Trash2 size={16} aria-hidden="true" />Revoke local key</button></div>
          {confirmRevoke && <div className="credential-revoke-confirm" role="group" aria-label="Confirm local key removal"><p>Remove this key from CV Tailor? The token will still be valid in OpenRouter until you revoke it there.</p><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setConfirmRevoke(false)}>Cancel</button><button type="button" className="secondary-button destructive" disabled={busy} onClick={() => void removeKey()}>Revoke saved key</button></div></div>}
        </div>}
        {(!settings?.credential.configured || replacingKey) && <form className="profile-form" onSubmit={event => void saveKey(event)}><label className="form-field">{replacingKey ? 'New OpenRouter API key' : 'OpenRouter API key'}<input aria-label={replacingKey ? 'New OpenRouter API key' : 'OpenRouter API key'} type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} disabled={!settings?.credential.secureStorageAvailable || busy} /></label><div className="form-actions"><button className="primary-button" type="submit" disabled={busy || !settings?.credential.secureStorageAvailable || !apiKey.trim()}>{replacingKey ? 'Save replacement' : 'Save API key'}</button></div></form>}
      </section>
      <section className="settings-block faithfulness-panel" aria-labelledby="faithfulness-heading"><div className="settings-block-heading"><span className="settings-block-icon"><ShieldCheck size={18} aria-hidden="true" /></span><div><h2 id="faithfulness-heading">Optional faithfulness review</h2><p>One structured, batched second opinion compares rewritten wording with its cited minimized evidence.</p></div></div><div className="faithfulness-options"><label className="faithfulness-toggle"><input role="switch" aria-label="Enable optional faithfulness review for newly authorized runs" aria-describedby="faithfulness-helper" type="checkbox" checked={settings?.faithfulnessCheck ?? false} onChange={event => void saveFaithfulness(event.target.checked)} /><span>Enable for newly authorized runs</span></label><p className="settings-helper" id="faithfulness-helper">Findings remain blocking even if you later disable this option. An LLM check is not proof and does not replace your review; calls count against the same run and time budgets.</p></div></section>
    </div>
    <section className="settings-block" aria-labelledby="analysis-budget-heading"><div className="settings-block-heading"><div><h2 id="analysis-budget-heading">Analysis request budgets</h2><p>Local safeguards for future runs. These are not OpenRouter account limits.</p></div></div><form className="profile-form" onSubmit={event => void saveBudgets(event)}><div className="settings-grid">{budgetField('minimumSpacingMs', 'Minimum spacing (milliseconds)', 0, 60000, 100)}{budgetField('rateLimitAttempts', 'Attempts per rate window', 1, 100)}{budgetField('rateLimitWindowMs', 'Rate window (milliseconds)', 1000, 86400000, 1000)}{budgetField('configuredDailyLimit', 'Local daily attempt limit', 1, 10000)}{budgetField('runLimit', 'Attempts per run', 1, 100)}{budgetField('runTimeLimitMs', 'Run time limit (milliseconds)', 1000, 3600000, 1000)}</div><p className="settings-helper">Initial defaults: 5-second spacing, 12 attempts per 5 minutes, 50 locally observed attempts per Pacific day, and 12 attempts or 5 minutes per run.</p><button className="primary-button" type="submit">Save analysis budgets</button></form>{usage && <p role="status">Pacific day {usage.pacificDay}: {usage.attempts} locally observed attempts. Requests from other clients or keys are not visible; no authoritative quota is reported.</p>}</section>
    <p className="settings-disclosure">OpenRouter sends requests to third-party model providers; their data handling and prices vary by model. Redaction cannot guarantee anonymity. Check your chosen provider's terms before sending sensitive information. <a href="https://openrouter.ai/privacy" target="_blank" rel="noopener noreferrer">OpenRouter privacy policy</a>.</p>
    {error && <p className="profile-message error" role="alert">{error}</p>}{message && <p className="profile-message success" role="status">{message}</p>}
  </section>
}
