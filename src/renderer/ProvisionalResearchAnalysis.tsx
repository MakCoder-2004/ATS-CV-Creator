import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { WorkbenchAPI } from '../shared/appearance'
import { volatileOutgoingSchema, type VolatileAnalysisPreview, type VolatileAnalysisProgress, type VolatileAnalysisResult } from '../shared/research-volatile-analysis'
import './provisional-research-analysis.css'

type AnalysisAPI = Pick<WorkbenchAPI, 'previewResearchAnalysis' | 'consentResearchAnalysis' | 'startResearchAnalysis' | 'cancelResearchAnalysis' | 'discardResearchAnalysis'>
type SourceAPI = Pick<WorkbenchAPI, 'openPostingSource'>
type Phase = 'idle' | 'inspecting' | 'preview' | 'authorizing' | 'authorized' | 'running' | 'complete' | 'cancelled' | 'uncertain' | 'error'
type Outgoing = ReturnType<typeof volatileOutgoingSchema.parse>
export type ProvisionalReviewState = { phase: Phase; preview?: VolatileAnalysisPreview; outgoing?: Outgoing; result?: VolatileAnalysisResult; reviewed: boolean; message: string }
export const PROVISIONAL_REVIEW_ACKNOWLEDGEMENT = 'I reviewed the displayed user message and understand a separate JSON-schema instruction is sent to Pi'

/** Called only by a visible source button; raw IPC errors are deliberately not exposed in the renderer. */
export function createSourceOpenHandler(api: SourceAPI, url: string, finding: string, report: (message: string, failed: boolean) => void) {
  return async () => {
    report(`Opening source for ${finding}…`, false)
    try {
      const result = await api.openPostingSource(url)
      report(result.ok ? `Opened source for ${finding} in your default browser.` : `Could not open source for ${finding}. Check the source address and try again; unsupported or unavailable sources cannot be opened.`, !result.ok)
    } catch {
      report(`Could not open source for ${finding}. Check the source address and try again; unsupported or unavailable sources cannot be opened.`, true)
    }
  }
}

export type ProvisionalResearchAnalysisProps = { researchToken: string; onClose(reason?: 'expired'): void; onStatus?: (status: Phase) => void; api?: AnalysisAPI }

/** Deliberate, one-use outgoing consent. No network call is made by construction or subscription. */
export function createProvisionalReviewSession(api: AnalysisAPI, researchToken: string, onStatus?: (status: Phase) => void) {
  let state: ProvisionalReviewState = { phase: 'idle', reviewed: false, message: '' }
  let generation = 0
  let closed = false
  let busy = false
  const listeners = new Set<() => void>()
  const tokens = new Set<string>()
  const set = (update: Partial<ProvisionalReviewState>) => {
    if (closed) return
    const oldPhase = state.phase
    state = { ...state, ...update }
    listeners.forEach(listener => listener())
    if (oldPhase !== state.phase) onStatus?.(state.phase)
  }
  const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The outgoing review could not continue. Start a new research run.'
  const discard = (token: string) => { void api.discardResearchAnalysis(token).catch(() => { /* May have expired or already been discarded. */ }) }
  const current = (request: number) => !closed && generation === request
  const acceptProgress = (progress: VolatileAnalysisProgress, preview: VolatileAnalysisPreview, outgoing: Outgoing) => {
    if (progress.status === 'complete' && progress.result) {
      const accepted = new Set(outgoing.roleEvidence.map(item => item.findingId))
      if (progress.result.researchRunId !== outgoing.researchRunId || progress.result.analysisScope !== preview.analysisScope ||
          progress.result.evidence.some(item => !accepted.has(item.findingId)) ||
          progress.result.requirements.some(item => item.findingIds.some(id => !accepted.has(id)))) {
        set({ phase: 'error', message: 'The result does not match the reviewed evidence. Discard it and begin a new research run.' })
        return
      }
      set({ phase: 'complete', result: progress.result, message: 'Analysis returned. Review each suggestion against its source.' })
    } else if (progress.status === 'cancelled' || progress.status === 'uncertain') {
      set({ phase: progress.status, message: progress.message || (progress.status === 'uncertain' ? 'The request outcome is uncertain. Do not retry this consent.' : 'Analysis cancelled.') })
    } else {
      set({ phase: 'uncertain', message: 'No final analysis was returned. A dispatched request may still incur charges. Do not retry this consent.' })
    }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    async inspect() {
      if (busy || state.phase !== 'idle' || closed) return
      busy = true
      const request = ++generation
      set({ phase: 'inspecting', message: 'Preparing the exact outgoing data…' })
      try {
        const preview = await api.previewResearchAnalysis(researchToken)
        tokens.add(preview.token)
        if (!current(request)) { discard(preview.token); return }
        // The exact outgoing user message is displayed without reserialization or alteration.
        const json = preview.outgoingText.slice(preview.outgoingText.indexOf('\n') + 1)
        const outgoing = volatileOutgoingSchema.parse(JSON.parse(json) as unknown)
        if (outgoing.analysisScope !== preview.analysisScope) throw new Error('The outgoing review did not match its analysis scope.')
        set({ phase: 'preview', preview, outgoing, reviewed: false, message: 'Inspect the complete outgoing text before authorizing.' })
      } catch (error) { if (current(request)) set({ phase: 'error', message: errorMessage(error) }) }
      finally { busy = false }
    },
    setReviewed(value: boolean) {
      if (state.phase === 'preview' && !closed) set({ reviewed: value })
    },
    async authorize() {
      if (busy || closed || state.phase !== 'preview' || !state.reviewed || !state.preview || !state.outgoing) return
      busy = true
      const request = ++generation
      const preview = state.preview
      set({ phase: 'authorizing', message: 'Recording authorization…' })
      try {
        const progress = await api.consentResearchAnalysis(preview.token, true)
        if (!current(request)) return
        if (progress.status !== 'consented') throw new Error('Authorization was not recorded. Discard this review and start again.')
        set({ phase: 'authorized', message: 'Authorized. Analysis has not started. Choose Generate analysis to send the reviewed data.' })
      } catch (error) { if (current(request)) set({ phase: 'error', message: errorMessage(error) }) }
      finally { busy = false }
    },
    async start() {
      if (busy || closed || state.phase !== 'authorized' || !state.preview || !state.outgoing) return
      busy = true
      const request = ++generation
      const { preview, outgoing } = state
      set({ phase: 'running', message: 'Preparing analysis. A provider request may be sent; cancellation may not prevent charges.' })
      try {
        const progress = await api.startResearchAnalysis(preview.token)
        if (current(request)) acceptProgress(progress, preview, outgoing)
      } catch (error) { if (current(request)) set({ phase: 'uncertain', message: `${errorMessage(error)} A provider request may have been sent and may incur charges. Do not retry this consent.` }) }
      finally { busy = false }
    },
    async cancel() {
      if (closed || !['preview', 'authorizing', 'authorized', 'running'].includes(state.phase)) return
      const token = state.preview?.token
      ++generation
      set({ phase: 'cancelled', reviewed: false, preview: undefined, outgoing: undefined, result: undefined, message: token ? 'Cancelling. A dispatched request may still incur charges.' : 'Closing outgoing review.' })
      if (!token) return
      try {
        const progress = await api.cancelResearchAnalysis(token)
        if (!closed && state.phase === 'cancelled') set({ message: progress.message || 'Cancelled. A dispatched request may still incur charges.' })
      } catch { if (!closed) set({ message: 'Cancellation could not be confirmed. A request may have been sent and may incur charges. Close to discard this review.' }) }
    },
    close() {
      if (closed) return
      const shouldCancel = ['authorizing', 'authorized', 'running'].includes(state.phase)
      const token = state.preview?.token
      closed = true
      ++generation
      // Keep cancellation ahead of discard for an in-flight request; late preview tokens are discarded separately.
      for (const value of tokens) {
        if (shouldCancel && value === token) void api.cancelResearchAnalysis(value).catch(() => {}).finally(() => discard(value))
        else discard(value)
      }
      state = { phase: 'cancelled', reviewed: false, message: 'Temporary research discarded.' }
      listeners.forEach(listener => listener())
      listeners.clear()
      tokens.clear()
    },
  }
}

export function ProvisionalResearchAnalysis({ researchToken, onClose, onStatus, api }: ProvisionalResearchAnalysisProps) {
  const statusRef = useRef(onStatus)
  statusRef.current = onStatus
  const session = useMemo(() => createProvisionalReviewSession(api ?? window.workbench, researchToken, status => statusRef.current?.(status)), [api, researchToken])
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  const returnFocus = useRef<HTMLElement | null>(null)
  const statusElement = useRef<HTMLParagraphElement>(null)
  const [sourceStatuses, setSourceStatuses] = useState<Record<string, { message: string; failed: boolean }>>({})
  const [openingSources, setOpeningSources] = useState<Set<string>>(() => new Set())
  useEffect(() => { if (state.phase === 'cancelled') statusElement.current?.focus() }, [state.phase])
  useEffect(() => {
    if (!state.preview) return
    const expiresAt = state.preview.expiresAt
    const expire = () => { if (Date.now() >= expiresAt) { session.close(); onClose('expired') } }
    const timer = window.setTimeout(expire, Math.max(0, expiresAt - Date.now()))
    document.addEventListener('visibilitychange', expire)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', expire) }
  }, [session, state.preview, onClose])
  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => session.close()
  }, [session])
  const close = () => {
    session.close()
    onClose()
    queueMicrotask(() => { if (returnFocus.current?.isConnected) returnFocus.current.focus() })
  }
  const { preview, outgoing, result } = state
  const sourceById = new Map(outgoing?.roleEvidence.map((item, index) => [item.findingId, { item, index: index + 1 }]) ?? [])
  return <section className="provisional-analysis" aria-labelledby="provisional-analysis-title">
    <header className="provisional-analysis-heading">
      <div><h2 id="provisional-analysis-title">Research analysis</h2><p>Temporary review of role evidence, separate from CV generation. Nothing here approves a posting or creates a CV.</p></div>
      <button className="secondary-button" type="button" onClick={close}>Discard and close</button>
    </header>
    <p ref={statusElement} tabIndex={-1} className="provisional-analysis-status" role={state.phase === 'error' || state.phase === 'uncertain' ? 'alert' : 'status'}>{state.message}</p>
    {state.phase === 'idle' && <button type="button" className="primary-button" onClick={() => void session.inspect()}>Inspect outgoing data</button>}
    {preview && outgoing && <>
      <p className="provisional-analysis-scope"><strong>{preview.analysisScope === 'provisional' ? 'Provisional analysis' : 'Full role evidence'}</strong> — {preview.analysisScope === 'provisional' ? 'Only reviewed partial role findings are available. This is not a full posting.' : 'Reviewed direct role evidence is available.'}</p>
      <p>{preview.notice}</p>
      <dl className="provisional-analysis-selection"><div><dt>Provider</dt><dd>{preview.selection.providerId}</dd></div><div><dt>Model</dt><dd>{preview.selection.modelId}</dd></div><div><dt>Thinking level</dt><dd>{preview.selection.thinkingLevel}</dd></div><div><dt>Review expires</dt><dd><time dateTime={new Date(preview.expiresAt).toISOString()}>{new Date(preview.expiresAt).toLocaleString()}</time></dd></div></dl>
      <p>A separate structured JSON-schema system instruction is also sent to the selected Pi provider. The text below is the exact outgoing user message, including selected role identity, source URLs, finding IDs and unknowns. No profile is included.</p>
      <h3>Exact outgoing data</h3>
      <pre aria-label="Exact outgoing analysis data" tabIndex={0} className="provisional-analysis-outgoing">{preview.outgoingText}</pre>
      <h3>Reviewed role sources</h3>
      <ol className="provisional-analysis-evidence">{outgoing.roleEvidence.map((item, index) => <li key={item.findingId} id={`research-finding-${index + 1}`}>
        <strong>Finding {index + 1}: {item.kind === 'indexed-role-claim' ? 'Indexed role claim (partial)' : `Direct role text (${item.completeness})`}</strong>
        <span>Source URL: {item.url}</span><span>Finding ID: {item.findingId}</span><button type="button" className="secondary-button" aria-label={`Open source for finding ${index + 1}`} disabled={openingSources.has(item.findingId)} onClick={() => {
          setOpeningSources(current => new Set(current).add(item.findingId))
          const handler = createSourceOpenHandler(window.workbench, item.url, `finding ${index + 1}`, (message, failed) => {
            setSourceStatuses(current => ({ ...current, [item.findingId]: { message, failed } }))
          })
          void handler().finally(() => setOpeningSources(current => { const next = new Set(current); next.delete(item.findingId); return next }))
        }}>{openingSources.has(item.findingId) ? 'Opening source…' : `Open source for finding ${index + 1}`}</button>{sourceStatuses[item.findingId] && <span role={sourceStatuses[item.findingId].failed ? 'alert' : 'status'}>{sourceStatuses[item.findingId].message}</span>}<blockquote>{item.text}</blockquote>
      </li>)}</ol>
      {outgoing.unknowns.length > 0 && <section aria-label="Unknowns"><h3>Still unknown</h3><ul>{outgoing.unknowns.map((text, index) => <li key={index}>{text}</li>)}</ul></section>}
      {state.phase === 'preview' && <div className="provisional-analysis-actions"><label className="provisional-analysis-check"><input type="checkbox" checked={state.reviewed} onChange={event => session.setReviewed(event.target.checked)} />{PROVISIONAL_REVIEW_ACKNOWLEDGEMENT}</label><button className="primary-button" type="button" disabled={!state.reviewed} onClick={() => void session.authorize()}>Authorize analysis</button><button className="secondary-button" type="button" onClick={() => void session.cancel()}>Cancel review</button></div>}
      {state.phase === 'authorized' && <div className="provisional-analysis-actions"><button type="button" className="primary-button" onClick={() => void session.start()}>Start analysis</button><button type="button" className="secondary-button" onClick={() => void session.cancel()}>Cancel analysis</button></div>}
      {['authorizing', 'running'].includes(state.phase) && <button type="button" className="secondary-button" onClick={() => void session.cancel()}>Cancel analysis</button>}
    </>}
    {result && state.phase === 'complete' && <section aria-label="Analysis suggestions" className="provisional-analysis-result">
      <h3>{result.analysisScope === 'provisional' ? 'Provisional role suggestions' : 'Role suggestions from reviewed evidence'}</h3>
      <p>Provider suggestions need human review against the linked role findings. They are not verified qualifications, an ATS score or permission to generate or export a CV.</p>
      {result.requirements.length ? <ul>{result.requirements.map((requirement, index) => <li key={index}><strong>{requirement.category}</strong><p>{requirement.text}</p><span>Review source {requirement.findingIds.map((id, linkIndex) => { const source = sourceById.get(id); return source ? <React.Fragment key={id}>{linkIndex > 0 ? ', ' : ''}<a href={`#research-finding-${source.index}`}>finding {source.index}</a></React.Fragment> : null })}</span></li>)}</ul> : <p>No role requirements could be supported by the reviewed findings.</p>}
      {result.unknowns.length > 0 && <section><h4>Still unknown</h4><ul>{result.unknowns.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
      <p><strong>Human review required.</strong> This temporary analysis is not a saved full posting or a CV draft.</p>
    </section>}
  </section>
}
