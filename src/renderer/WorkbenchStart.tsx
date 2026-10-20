import { useEffect, useRef, useState } from 'react'
import { BriefcaseBusiness, FileText, UserRound } from 'lucide-react'
import type { ExperienceSnapshot } from '../shared/experience'
import type { JobRecord } from '../shared/jobs'
import type { ProfileSnapshot } from '../shared/profile'
import type { OutboundConsentPreview } from '../shared/outbound-consent-contract'
import './workbench-start.css'

type LocalSources = { profile: ProfileSnapshot; evidence: ExperienceSnapshot }
type SourceEntry = { title: string; detail?: string }

function SourceSection({ title, entries }: { title: string; entries: SourceEntry[] }) {
  return <section className="source-section" aria-label={`${title} source preview`}>
    <h2>{title}</h2>
    {entries.length ? <>
      {entries.slice(0, 2).map((entry, index) => <div className="source-entry" key={`${title}-${index}`}><strong>{entry.title}</strong>{entry.detail && <span>{entry.detail}</span>}</div>)}
      {entries.length > 2 && <p className="source-more">{entries.length - 2} more {entries.length - 2 === 1 ? 'record' : 'records'} in My profile</p>}
    </> : <p className="source-unfilled">No {title.toLowerCase()} saved yet</p>}
  </section>
}

export function WorkbenchStart({ activeJob, jobCount, onNavigate }: { activeJob: JobRecord | null; jobCount: number; onNavigate: (page: 'My profile' | 'Saved jobs') => void }) {
  const [sources, setSources] = useState<LocalSources | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [review, setReview] = useState<Extract<OutboundConsentPreview, { ok: true }> | null>(null)
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [termsAcknowledged, setTermsAcknowledged] = useState(false)
  const [consentError, setConsentError] = useState('')
  const [consentBusy, setConsentBusy] = useState(false)
  const [analysis, setAnalysis] = useState<Awaited<ReturnType<typeof window.workbench.getAnalysis>>>(null)
  const [draft, setDraft] = useState<Awaited<ReturnType<typeof window.workbench.getDraft>>>(null)
  const [draftBusy, setDraftBusy] = useState(false)
  const [draftError, setDraftError] = useState('')
  const [pageTarget, setPageTarget] = useState<1 | 2>(1)
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof window.workbench.getAnalysisUsage>> | null>(null)
  const pendingToken = useRef<string | null>(null)
  const selectedJob = useRef(activeJob?.id)
  selectedJob.current = activeJob?.id
  useEffect(() => {
    setReview(null); setConsentAccepted(false); setTermsAcknowledged(false); setConsentError(''); setDraft(null); setDraftError(''); setDraftBusy(false)
    if (activeJob) {
      void window.workbench.getDraft(activeJob.id).then(setDraft).catch(() => setDraftError('Saved draft could not be opened offline.'))
      void window.workbench.getAnalysis(activeJob.id).then(value => { if (value) setAnalysis(value) }).catch(() => {})
    } else { setAnalysis(null) }
    return () => {
      const token = pendingToken.current
      pendingToken.current = null
      if (token) void window.workbench.cancelOutboundConsent(token).catch(() => {})
    }
  }, [activeJob?.id, activeJob?.updatedAt])

  async function inspectOutgoing() {
    if (!activeJob || consentBusy) return
    setConsentBusy(true); setConsentError('')
    try {
      const result = await window.workbench.prepareOutboundConsent(activeJob.id)
      if (selectedJob.current !== activeJob.id) {
        if (result.ok) void window.workbench.cancelOutboundConsent(result.token)
        return
      }
      if (!result.ok) { setConsentError(result.message); return }
      pendingToken.current = result.token
      setTermsAcknowledged(false); setConsentAccepted(false); setReview(result)
    } catch { setConsentError('Outgoing data could not be prepared. Try again.') }
    finally { setConsentBusy(false) }
  }
  async function startAnalysis() {
    const token = pendingToken.current
    if (!token || consentBusy || !consentAccepted) return
    setConsentBusy(true); setConsentError('')
    setAnalysis({ jobId: activeJob!.id, status: 'running', analysis: null, progress: 'Analyzing the authorized posting…', attempts: 0, cacheHit: false })
    try { setAnalysis(await window.workbench.startAnalysis(token)); setUsage(await window.workbench.getAnalysisUsage()) }
    catch (failure) { setConsentError(failure instanceof Error ? failure.message : 'Analysis could not start. Check Settings and try again.') }
    finally { setConsentBusy(false) }
  }
  async function generateDraft() {
    const token = pendingToken.current, jobId = activeJob?.id
    if (!token || !consentAccepted || draftBusy || !jobId) return
    setDraftBusy(true); setDraftError('')
    setAnalysis({ jobId, status: 'running', analysis: analysis?.analysis ?? null, progress: `Selecting content for a ${pageTarget}-page target…`, attempts: analysis?.attempts ?? 0, cacheHit: false })
    try {
      const result = await window.workbench.generateDraft(token, pageTarget)
      if (selectedJob.current !== jobId) return
      if (result.ok && result.draft && result.draft.jobId === jobId) setDraft(result.draft)
      else if (!result.ok) setDraftError(result.message)
      const latest = await window.workbench.getAnalysis(jobId)
      if (latest && selectedJob.current === jobId) setAnalysis(latest)
      if (selectedJob.current === jobId) setUsage(await window.workbench.getAnalysisUsage())
    } catch (failure) { if (selectedJob.current === jobId) setDraftError(failure instanceof Error ? failure.message : 'Draft generation failed.') }
    finally { if (selectedJob.current === jobId) setDraftBusy(false) }
  }
  async function cancelOutgoing() {
    const token = pendingToken.current
    if (!token || consentBusy) return
    setConsentBusy(true); setConsentError('')
    try {
      const result = await window.workbench.cancelOutboundConsent(token)
      if (!result.ok) { setConsentError(result.message); return }
      pendingToken.current = null
      setReview(null); setConsentAccepted(false); setTermsAcknowledged(false)
    } catch { setConsentError('This run could not be cancelled. Try again.') }
    finally { setConsentBusy(false) }
  }
  async function authorizeOutgoing() {
    const token = pendingToken.current
    if (!token || !termsAcknowledged || consentBusy) return
    setConsentBusy(true); setConsentError('')
    try {
      const result = await window.workbench.acceptOutboundConsent(token, true, true)
      if (!result.ok) { setConsentError(result.message); return }
      setConsentAccepted(true)
      setUsage(await window.workbench.getAnalysisUsage())
    } catch { setConsentError('Consent could not be saved. Review the data and try again.') }
    finally { setConsentBusy(false) }
  }
  useEffect(() => {
    if (!activeJob || analysis?.status !== 'running') return
    let mounted = true
    const poll = async () => {
      try {
        const latest = await window.workbench.getAnalysis(activeJob.id)
        if (mounted && latest) { setAnalysis(latest); if (latest.status !== 'running') setUsage(await window.workbench.getAnalysisUsage()) }
      } catch { /* The initiating request still reports its final state. */ }
    }
    const timer = window.setInterval(() => void poll(), 250)
    void poll()
    return () => { mounted = false; window.clearInterval(timer) }
  }, [activeJob?.id, analysis?.status])
  useEffect(() => {
    let mounted = true
    Promise.all([window.workbench.getProfile(), window.workbench.getExperience()])
      .then(([profile, evidence]) => { if (mounted) { setSources({ profile, evidence }); setError('') } })
      .catch(() => { if (mounted) setError('Your profile sources could not be loaded. Try again to see your workspace.') })
    return () => { mounted = false }
  }, [attempt])

  const profile = sources?.profile
  const evidence = sources?.evidence
  const education = (profile?.education ?? []).map(item => ({ title: item.title, detail: [item.institution, item.field].filter(Boolean).join(', ') }))
  const experience = (evidence?.experience ?? []).map(item => ({ title: item.title, detail: `${item.kind === 'training' ? 'Training at' : 'At'} ${item.organization}` }))
  const projects = (evidence?.projects ?? []).map(item => ({ title: item.name }))
  const skills = (profile?.skills ?? []).map(item => ({ title: item.name }))
  const certificates = (profile?.certificates ?? []).map(item => ({ title: item.title, detail: item.issuer }))
  const total = education.length + experience.length + projects.length + skills.length + certificates.length
  const sections = [
    { title: 'Education', entries: education },
    { title: 'Experience', entries: experience },
    { title: 'Projects', entries: projects },
    { title: 'Skills', entries: skills },
    { title: 'Certificates', entries: certificates }
  ]

  return <div className="cv-workbench-start">
    <section className="document-area" aria-label="CV document">
      <div className="document-toolbar"><div className="document-toolbar-title"><FileText size={17} aria-hidden="true" /><strong>Source outline</strong><span className="document-stage">No CV draft yet</span></div><span className="document-target">{activeJob ? `Target: ${activeJob.title} · ${activeJob.company}` : 'No job selected'}</span></div>
      <div className="paper-wrap">
        <div className="paper-context"><span>Layout reference</span><span>Five CV sections</span></div>
        <article className="paper" aria-label="White Arial CV source outline, not a generated draft">
          <header className="paper-header"><strong className={profile?.contact ? undefined : 'paper-placeholder'}>{profile?.contact?.fullName ?? 'Your name'}</strong><span className={profile?.contact?.headline ? undefined : 'paper-placeholder'}>{profile?.contact?.headline ?? 'Professional headline'}</span></header>
          <div className="paper-rule" aria-hidden="true" />
          {sections.map(section => <SourceSection key={section.title} {...section} />)}
        </article>
        <p className="paper-caption">Original profile facts only. This is not a draft, export preview, or page-fit check.</p>
      </div>
    </section>
    {draft && <section className="inspector draft-offline-review" aria-label="Saved source-linked draft"><h2>Saved draft · unverified and unapproved</h2><p>Available locally. Verification, approval, and export are not available yet.</p>{(['education', 'experience', 'projects', 'skills', 'certificates'] as const).map(section => <div key={section}><h3>{section[0].toUpperCase() + section.slice(1)}</h3>{draft.content[section].map((item, index) => <article key={`${section}-${index}`}><p>{'text' in item ? item.text : item.name}</p><small>Evidence revisions: {item.citations.map(citation => `${citation.evidenceId} · r${citation.revision}`).join(', ')}</small><p>{item.rationale}</p></article>)}</div>)}</section>}
    <aside className="inspector" aria-label="Workspace guide">
      <div className="inspector-heading"><h2>Prepare your workspace</h2><p>Two things anchor a tailored CV: what you have done and the role you are targeting.</p></div>
      {error ? <div className="inspector-error" role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={() => setAttempt(value => value + 1)}>Retry loading sources</button></div> : !sources ? <p className="inspector-loading" role="status">Reading your local profile…</p> : <ol className="prep-list">
        <li><span className="prep-index" aria-hidden="true">01</span><div className="prep-content"><div className="prep-label"><UserRound size={16} aria-hidden="true" /><h3>Your profile</h3></div><p>{total ? `${total} ${total === 1 ? 'record' : 'records'} across CV sections${profile?.contact ? ', with your name saved' : ''}.` : profile?.contact ? 'Your name is saved. Add experience or other CV facts next.' : 'Add your name and genuine career facts.'}</p><button type="button" className="prep-link" onClick={() => onNavigate('My profile')}>{total ? 'Review profile' : 'Build your profile'}</button></div></li>
        <li><span className="prep-index" aria-hidden="true">02</span><div className="prep-content"><div className="prep-label"><BriefcaseBusiness size={16} aria-hidden="true" /><h3>Target job</h3></div><p>{activeJob ? `${activeJob.title} at ${activeJob.company} is selected.` : jobCount ? `${jobCount} saved ${jobCount === 1 ? 'posting' : 'postings'}. Choose the role you want to target.` : 'Save a posting so you can return to its original requirements.'}</p><button type="button" className="prep-link" onClick={() => onNavigate('Saved jobs')}>{activeJob ? 'Change target' : jobCount ? 'Choose a saved job' : 'Save a job posting'}</button></div></li>
      </ol>}
      {activeJob && <div className="outbound-consent">
        <h3>Cloud data review</h3>
        <p>Inspect minimized posting and profile facts before deciding whether to authorize a run. Inspection alone sends nothing.</p>
        {!review && <button type="button" className="secondary-button" disabled={consentBusy} onClick={() => void inspectOutgoing()}>{consentBusy ? 'Preparing review…' : 'Inspect outgoing data'}</button>}
        {review && <section className="outbound-review" aria-label="Outgoing data review">
          <h4>Data that could be sent</h4>
          <p>Target: {review.jobTitle} at {review.jobCompany}. These names are displayed locally; inspect the data below for what is eligible to leave this device.</p>
          <pre aria-label="Eligible outgoing bundle">{JSON.stringify(review.outgoing, null, 2)}</pre>
          <p>{review.warning}</p>
          <p>{review.termsNotice} <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">Gemini API terms</a>.</p>
          {!consentAccepted ? <>
            <label className="outbound-ack"><input type="checkbox" checked={termsAcknowledged} onChange={event => setTermsAcknowledged(event.target.checked)} />I understand the Gemini free-tier data-use terms and have reviewed this exact bundle.</label>
            <div className="outbound-actions"><button type="button" className="primary-button" disabled={!termsAcknowledged || consentBusy} onClick={() => void authorizeOutgoing()}>Authorize this run</button><button type="button" className="secondary-button" disabled={consentBusy} onClick={() => void cancelOutgoing()}>Cancel review</button></div>
          </> : <><p role="status">Consent saved for this frozen bundle. Analysis requests are bounded and usage is a local observation, not provider quota.</p><button type="button" className="primary-button" disabled={consentBusy || analysis?.status === 'complete'} onClick={() => void startAnalysis()}>{consentBusy ? 'Analyzing…' : analysis?.status === 'complete' ? 'Analysis complete' : 'Analyze posting'}</button><button type="button" className="secondary-button" disabled={analysis?.status !== 'running'} onClick={() => void window.workbench.cancelAnalysis(activeJob.id).then(setAnalysis)}>Cancel analysis</button>{analysis?.status === 'running' && <p role="status">{analysis.progress} Dispatched attempts: {analysis.attempts}.</p>}{analysis?.status === 'failed' && <p className="inspector-error" role="alert">{analysis.error ?? analysis.progress} Check the connection or Settings, then explicitly start a new authorized run.</p>}{analysis?.status === 'cancelled' && <p role="status">{analysis.progress}</p>}{usage && <p>Pacific day {usage.pacificDay}: {usage.attempts} locally observed attempts; configured maximum {usage.runLimit} per run and {usage.minimumSpacingMs / 1000}s spacing. {usage.warning}</p>}{usage && usage.attempts + usage.runLimit > usage.configuredDailyLimit && <p role="alert">This run could reach the configured local daily attempt limit ({usage.configuredDailyLimit}); dispatch stops at that limit. It is not a provider quota estimate.</p>}{analysis?.analysis && <div aria-label="Posting analysis"><h4>Required qualifications</h4><ul>{analysis.analysis.required.map(item => <li key={item}>{item}</li>)}</ul><h4>Preferred qualifications</h4><ul>{analysis.analysis.preferred.map(item => <li key={item}>{item}</li>)}</ul><h4>Tools and responsibilities</h4><p>{[...analysis.analysis.tools, ...analysis.analysis.responsibilities].join(' · ')}</p><h4>Keywords</h4><p>{analysis.analysis.keywords.join(' · ')}</p></div>}{analysis?.status === 'complete' && <><label>Page target <select aria-label="Page target" value={pageTarget} onChange={event => setPageTarget(Number(event.target.value) as 1 | 2)}><option value={1}>One page</option><option value={2}>Two pages</option></select></label><button type="button" className="primary-button" disabled={draftBusy || !!draft} onClick={() => void generateDraft()}>{draftBusy ? 'Generating source-linked draft…' : draft ? 'Draft saved locally' : 'Generate tailored draft'}</button></>}{draftError && <p className="inspector-error" role="alert">{draftError}</p>}{draft && <section aria-label="Source-linked draft" className="draft-inspector"><h4>Draft · unverified and unapproved</h4><p>{draft.progress} Dispatched requests: {draft.attempts}.</p><p>No verification, approval, or export is available yet.</p>{(['education', 'experience', 'projects', 'skills', 'certificates'] as const).map(section => <div key={section}><h5>{section[0].toUpperCase() + section.slice(1)}</h5>{draft.content[section].map((item, index) => <article key={`${section}-${index}`}><p>{'text' in item ? item.text : item.name}</p><small>Source revision{item.citations.length === 1 ? '' : 's'}: {item.citations.map(citation => `${citation.evidenceId} · r${citation.revision}`).join(', ')}</small><p className="future-note">{item.rationale}</p></article>)}</div>)}</section>}<button type="button" className="secondary-button" disabled={consentBusy} onClick={() => void cancelOutgoing()}>Revoke this run</button></>}
        </section>}
        {consentError && <p className="inspector-error" role="alert">{consentError}</p>}
      </div>}
      <div className="inspector-future"><h3>Evidence &amp; coverage</h3><p>{draft ? 'This draft exposes its cited evidence and inclusion rationale. Automated verification is not implemented yet.' : 'A draft will expose paragraph and skill sources with inclusion rationale.'}</p><p className="future-note">Drafts remain unverified and unapproved. No export is available.</p></div>
    </aside>
  </div>
}
