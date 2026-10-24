import React, { FormEvent, useEffect, useState } from 'react'
import { ShieldCheck, Sparkles } from 'lucide-react'
import { PI_THINKING_LEVELS, type PiModelSelection } from '../shared/pi-model'
import { FieldSelect } from './controls/FieldSelect'

export function OpenRouterSettingsPanel() {
  const [selection, setSelection] = useState<PiModelSelection | null>(null)
  const [reference, setReference] = useState('')
  const [thinkingLevel, setThinkingLevel] = useState<(typeof PI_THINKING_LEVELS)[number]>('medium')
  const [faithfulnessCheck, setFaithfulnessCheck] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    window.workbench.getSettings().then(value => {
      setSelection(value.pi)
      setReference(value.pi ? `${value.pi.providerId}/${value.pi.modelId}` : '')
      if (value.pi) setThinkingLevel(value.pi.thinkingLevel)
      setFaithfulnessCheck(value.openRouter.faithfulnessCheck)
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

  async function saveFaithfulness(value: boolean) {
    try {
      const saved = await window.workbench.setFaithfulnessCheck(value)
      setFaithfulnessCheck(saved.openRouter.faithfulnessCheck)
      setError('')
      setMessage('Faithfulness preference saved locally. Existing unresolved findings are not waived.')
    } catch { setError('Faithfulness preference could not be saved. Try again.'); setMessage('') }
  }

  return <section className="settings-panel" aria-label="Pi preferences">
    <div className="settings-grid">
      <section className="settings-block" aria-labelledby="pi-model-heading">
        <div className="settings-block-heading"><span className="settings-block-icon"><Sparkles size={18} aria-hidden="true" /></span><div><h2 id="pi-model-heading">Pi model</h2><p>Choose a provider and model available in your Pi setup.</p></div></div>
        {selection && <p className="settings-helper">Saved selection: <strong>{selection.providerId}/{selection.modelId}</strong> · {selection.thinkingLevel} thinking</p>}
        <form className="profile-form" onSubmit={event => void saveModel(event)}>
          <label className="form-field">Provider/model reference<input value={reference} onChange={event => setReference(event.target.value)} placeholder="provider/model" spellCheck={false} autoCapitalize="off" autoComplete="off" required aria-describedby="pi-reference-help" /></label>
          <p className="settings-helper" id="pi-reference-help">Enter the exact provider/model reference. Keep any slashes in either ID.</p>
          <FieldSelect label="Thinking level" id="pi-thinking-level" value={thinkingLevel} onValueChange={value => setThinkingLevel(value as (typeof PI_THINKING_LEVELS)[number])} options={PI_THINKING_LEVELS.map(level => ({ value: level, label: level }))} />
          <div className="form-actions"><button className="primary-button" type="submit" disabled={busy || !loaded || !reference.trim() || (reference === (selection ? `${selection.providerId}/${selection.modelId}` : '') && thinkingLevel === selection?.thinkingLevel)}>{busy ? 'Saving…' : 'Save Pi model'}</button></div>
        </form>
        <p className="settings-helper">If you are not signed in with a provider, sign in through Pi outside CV Tailor. CV Tailor does not collect or reveal provider credentials.</p>
      </section>
      <section className="settings-block" aria-labelledby="pi-auth-heading">
        <div className="settings-block-heading"><span className="settings-block-icon"><ShieldCheck size={18} aria-hidden="true" /></span><div><h2 id="pi-auth-heading">Provider sign-in</h2><p>Authentication is managed by Pi, not in CV Tailor.</p></div></div>
        <p className="settings-helper">If a provider requires sign-in, complete it in Pi outside CV Tailor, then return here. No API key or credential is entered, stored, copied, or revealed in this app.</p>
      </section>
      <section className="settings-block faithfulness-panel" aria-labelledby="faithfulness-heading"><div className="settings-block-heading"><span className="settings-block-icon"><ShieldCheck size={18} aria-hidden="true" /></span><div><h2 id="faithfulness-heading">Optional faithfulness review</h2><p>One structured, batched second opinion compares rewritten wording with its cited minimized evidence.</p></div></div><div className="faithfulness-options"><label className="faithfulness-toggle"><input role="switch" aria-label="Enable optional faithfulness review for newly authorized runs" aria-describedby="faithfulness-helper" type="checkbox" checked={faithfulnessCheck} onChange={event => void saveFaithfulness(event.target.checked)} /><span>Enable for newly authorized runs</span></label><p className="settings-helper" id="faithfulness-helper">Findings remain blocking even if you later disable this option. A model check is not proof and does not replace your review. Provider charges may apply.</p></div></section>
    </div>
    {error && <p className="profile-message error" role="alert">{error}</p>}{message && <p className="profile-message success" role="status">{message}</p>}
  </section>
}
