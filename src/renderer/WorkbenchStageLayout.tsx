import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { FileText } from 'lucide-react'
import type { RegenerationProposal, RegenerationTarget } from '../shared/regeneration'
import type { JobRecord } from '../shared/jobs'
import type { OutboundPayload } from '../shared/outbound-consent'
import type { OutboundConsentPreview } from '../shared/outbound-consent-contract'
import type { CanonicalDocument, DocumentFitReport } from '../shared/document'
import type { DraftRevision } from '../shared/draft'
import type { GenerationRecovery } from '../shared/posting-analysis'
import type { ExperienceSnapshot } from '../shared/experience'
import type { ProfileSnapshot } from '../shared/profile'
import { DraftDocument } from './DraftReview'
import { SelectedReview } from './SelectedReview'
import { describeSource, readableText } from './review-copy'

export type WorkbenchSources = { profile: ProfileSnapshot; evidence: ExperienceSnapshot }
type Phase = 1 | 2 | 3 | 4 | 5
type Section = 'education' | 'experience' | 'projects' | 'skills' | 'certificates'

type Props = {
  activeJob: JobRecord | null
  onNavigate: (page: 'Saved jobs') => void
  error: string
  retry: () => void
  activePhase: Phase
  review: Extract<OutboundConsentPreview, { ok: true }> | null
  consentAccepted: boolean
  termsAcknowledged: boolean
  setTermsAcknowledged: Dispatch<SetStateAction<boolean>>
  consentError: string
  consentBusy: boolean
  analysis: Awaited<ReturnType<typeof window.workbench.getAnalysis>>
  recovery: GenerationRecovery | null
  recoveryBusy: boolean
  resumeSavedGeneration: (retryUncertain: boolean) => Promise<void>
  cancelSavedGeneration: () => Promise<void>
  draft: DraftRevision | null
  canonical: CanonicalDocument | null
  fitReport: DocumentFitReport | null
  fitBusy: boolean
  acceptedCuts: string[]
  setAcceptedCuts: Dispatch<SetStateAction<string[]>>
  draftBusy: boolean
  draftError: string
  pageTarget: 1 | 2
  setPageTarget: Dispatch<SetStateAction<1 | 2>>
  usage: Awaited<ReturnType<typeof window.workbench.getAnalysisUsage>> | null
  addSection: Section
  setAddSection: Dispatch<SetStateAction<Section>>
  addEvidence: string
  setAddEvidence: Dispatch<SetStateAction<string>>
  sources: WorkbenchSources | null
  outgoingProfileCounts: { label: string; count: number; unit: string }[]
  inspectOutgoing: () => Promise<void>
  cancelOutgoing: () => Promise<void>
  authorizeOutgoing: () => Promise<void>
  startAnalysis: () => Promise<void>
  generateDraft: () => Promise<void>
  cancelAnalysis: () => Promise<void>
  measurePageFit: () => Promise<void>
  applyPageCuts: () => Promise<void>
  addDraftItem: (event: FormEvent<HTMLFormElement>) => Promise<void>
  correctDraft: (section: Section, index: number, text: string, intent?: 'wording-only' | 'new-fact') => Promise<boolean>
  checkDraftNow: () => Promise<void>
  approveCurrentDraft: () => Promise<void>
  onProposalAccepted: (draft: DraftRevision, document: CanonicalDocument | null, fit: DocumentFitReport | null) => void
  exportDocx: () => Promise<void>
  docxBusy: boolean
}

function PhaseNavigation({ current }: { current: Phase }) {
  const phases = ['Job posting', 'Privacy', 'Create CV', 'Review CV', 'Save CV']
  return <nav className="tailoring-phase-nav" aria-label="Tailoring phases"><ol>{phases.map((phase, index) => <li key={phase} className={index + 1 < current ? 'is-complete' : undefined} aria-current={index + 1 === current ? 'step' : undefined}><span className="phase-number">{index + 1}</span><span className="phase-label">{phase}</span></li>)}</ol></nav>
}

function IncludedContent({ outgoing }: { outgoing: OutboundPayload }) {
  const groups = [
    { title: 'Experience and training', entries: outgoing.profile.experience.map(item => ({ heading: `${item.kind === 'training' ? 'Training' : 'Role'} · ${item.title} at ${item.organization}`, details: [item.description, ...item.evidence] })) },
    { title: 'Projects', entries: outgoing.profile.projects.map(item => ({ heading: item.name, details: [item.description, item.technologies.length ? `Technologies: ${item.technologies.join(', ')}` : '', ...item.evidence] })) },
    { title: 'Skills', entries: outgoing.profile.skills.map(item => ({ heading: item.name, details: [[item.category, item.proficiency, item.years === undefined ? '' : `${item.years} years`].filter(Boolean).join(' · ')] })) },
    { title: 'Education', entries: outgoing.profile.education.map(item => ({ heading: item.title, details: [[item.institution, item.field].filter(Boolean).join(' · '), item.description ?? ''] })) },
    { title: 'Certificates', entries: outgoing.profile.certificates.map(item => ({ heading: item.title, details: [item.issuer ?? '', item.description ?? ''] })) }
  ]
  return <details className="outbound-content-details"><summary>Read the included posting and profile details</summary><div className="outbound-content-list"><section><h3>Job posting</h3><article><h4>{outgoing.job.title}</h4><p>{outgoing.job.description}</p></article></section>{groups.filter(group => group.entries.length > 0).map(group => <section key={group.title}><h3>{group.title}</h3>{group.entries.map((entry, index) => <article key={`${group.title}-${index}`}><h4>{entry.heading}</h4>{entry.details.filter(Boolean).map((detail, detailIndex) => <p key={detailIndex}>{detail}</p>)}</article>)}</section>)}</div></details>
}

function sourceLabel(draft: DraftRevision, evidenceId: string, revision: number) {
  const evidence = draft.evidence.find(item => item.evidenceId === evidenceId && item.revision === revision)
  return describeSource(evidence?.snapshot).heading
}

function sourceOptions(sources: WorkbenchSources | null, draft: DraftRevision, section: Section) {
  const entries = [...(sources?.profile.education ?? []), ...(sources?.profile.certificates ?? []), ...(sources?.profile.skills ?? []), ...(sources?.evidence.experience.flatMap(item => [item, ...item.factualItems]) ?? []), ...(sources?.evidence.projects.flatMap(item => [item, ...item.factualItems, ...item.technologies]) ?? [])]
  return draft.evidence.filter(evidence => {
    const entry = entries.find(candidate => candidate.id === evidence.evidenceId)
    const type: Section = sources?.profile.skills.some(item => item.id === evidence.evidenceId) ? 'skills' : sources?.profile.education.some(item => item.id === evidence.evidenceId) ? 'education' : sources?.profile.certificates.some(item => item.id === evidence.evidenceId) ? 'certificates' : sources?.evidence.projects.some(item => item.id === evidence.evidenceId || item.factualItems.some(fact => fact.id === evidence.evidenceId) || item.technologies.some(fact => fact.id === evidence.evidenceId)) ? 'projects' : 'experience'
    return !!entry && type === section
  })
}

function EmptyDocument({ message }: { message: string }) {
  return <section className="document-area" aria-label="CV document"><div className="document-toolbar"><div className="document-toolbar-title"><FileText size={17} aria-hidden="true" /><strong>Tailored CV</strong><span className="document-stage">No draft yet</span></div></div><div className="paper-wrap"><div className="document-empty"><FileText aria-hidden="true" /><h2>Your tailored CV will appear here</h2><p>{message}</p></div></div></section>
}

export function WorkbenchStageLayout(props: Props) {
  const { activeJob, onNavigate, error, retry, activePhase, review, consentAccepted, termsAcknowledged, setTermsAcknowledged, consentError, consentBusy, analysis, recovery, recoveryBusy, resumeSavedGeneration, cancelSavedGeneration, draft, canonical, fitReport, fitBusy, acceptedCuts, setAcceptedCuts, draftBusy, draftError, pageTarget, setPageTarget, usage, addSection, setAddSection, addEvidence, setAddEvidence, sources, outgoingProfileCounts, inspectOutgoing, cancelOutgoing, authorizeOutgoing, startAnalysis, generateDraft, cancelAnalysis, measurePageFit, applyPageCuts, addDraftItem, correctDraft, checkDraftNow, approveCurrentDraft, onProposalAccepted, exportDocx, docxBusy } = props
  const [exportMessage, setExportMessage] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const [regenTarget, setRegenTarget] = useState<RegenerationTarget>({ kind: 'section', section: 'experience' })
  const [regenPreview, setRegenPreview] = useState<Extract<OutboundConsentPreview, { ok: true }> | null>(null)
  const [regenTerms, setRegenTerms] = useState(false)
  const [regenBusy, setRegenBusy] = useState(false)
  const [regenMessage, setRegenMessage] = useState('')
  const [proposal, setProposal] = useState<RegenerationProposal | null>(null)
  const [selectedItem, setSelectedItem] = useState<{ section: Section; index: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [sectionToolsOpen, setSectionToolsOpen] = useState(false)
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null)
  async function prepareRegeneration(target?: RegenerationTarget) {
    if (!activeJob || !draft) return
    if (target) setRegenTarget(target)
    setRegenBusy(true); setRegenMessage('Preparing the information you can review before sharing…')
    try { const result = await window.workbench.prepareOutboundConsent(activeJob.id); if (!result.ok) { setRegenMessage(result.message); return }; setRegenPreview(result); setRegenTerms(false); setRegenMessage('') }
    catch { setRegenMessage('The outgoing-data preview could not be prepared. Try again.') } finally { setRegenBusy(false) }
  }
  async function cancelRegeneration() {
    if (!regenPreview) return
    await window.workbench.cancelOutboundConsent(regenPreview.token); setRegenPreview(null); setRegenTerms(false)
  }
  async function cancelActiveRegeneration() {
    if (!activeJob) return
    const result = await window.workbench.cancelAnalysis(activeJob.id)
    setRegenPreview(null); setRegenTerms(false)
    setRegenMessage(result.progress || 'Regeneration cancelled. The draft remains unchanged.')
  }
  async function runRegeneration() {
    if (!regenPreview || !regenTerms || regenBusy) return
    setRegenBusy(true); setRegenMessage('Creating a suggestion. Your CV is unchanged…')
    try { const authorized = await window.workbench.acceptOutboundConsent(regenPreview.token, true, true); if (!authorized.ok) { setRegenMessage(authorized.message); return }; const result = await window.workbench.regenerateDraft(regenPreview.token, regenTarget); if (!result.ok || !result.proposal) { setRegenMessage(result.message); return }; setProposal(result.proposal); setRegenMessage(result.message); setRegenPreview(null) }
    catch (failure) { setRegenMessage(failure instanceof Error ? failure.message : 'Regeneration failed safely; the current draft was preserved.') } finally { setRegenBusy(false) }
  }
  async function resolveProposal(decision: 'accept' | 'reject') {
    if (!activeJob || !proposal) return
    setRegenBusy(true)
    try {
      const result = await window.workbench.resolveRegenerationProposal(activeJob.id, proposal.id, decision)
      if (result.proposal) setProposal(result.proposal)
      setRegenMessage(decision === 'reject' && result.ok ? 'Suggestion discarded. Your CV is unchanged.' : decision === 'accept' && result.ok ? 'Suggestion added. Sources and page length were checked. Review your updated CV before approving.' : result.message)
      if (result.proposal?.status === 'accepted' && result.draft) {
        const [document, fit] = await Promise.all([window.workbench.getCanonicalDocument(activeJob.id), result.ok ? window.workbench.getDocumentFitReport(activeJob.id) : Promise.resolve(null)])
        setProposal(result.proposal); onProposalAccepted(result.draft, document, fit)
      }
    } catch (failure) { setRegenMessage(failure instanceof Error ? failure.message : 'The proposal could not be resolved.') } finally { setRegenBusy(false) }
  }
  useEffect(() => {
    let current = true
    setProposal(null); setRegenPreview(null); setRegenMessage(''); setSelectedItem(null); setEditing(false); setSectionToolsOpen(false)
    if (activeJob) void window.workbench.getRegenerationProposal(activeJob.id).then(value => { if (current) setProposal(value) }).catch(() => {})
    return () => { current = false }
  }, [activeJob?.id])
  useEffect(() => {
    if (!regenBusy || !activeJob) return
    let mounted = true
    const poll = async () => { const result = await window.workbench.getAnalysis(activeJob.id).catch(() => null); if (mounted && result?.status === 'running') setRegenMessage(result.progress) }
    const timer = window.setInterval(() => void poll(), 250); void poll()
    return () => { mounted = false; window.clearInterval(timer) }
  }, [activeJob?.id, regenBusy])
  const firstSection = (['experience', 'education', 'projects', 'skills', 'certificates'] as const).find(section => draft?.content[section].length)
  const activeSelection = selectedItem && draft?.content[selectedItem.section][selectedItem.index] ? selectedItem : firstSection ? { section: firstSection, index: 0 } : null
  const selectedDraftItem = activeSelection && draft?.content[activeSelection.section][activeSelection.index]
  const selectedId = activeSelection ? `${activeSelection.section}-${activeSelection.index}` : undefined
  const selectedEntry = canonical?.sections.flatMap(section => section.entries).find(entry => entry.id === selectedId)
  const selectedSources = selectedDraftItem?.citations.map(citation => {
    const evidence = draft?.evidence.find(item => item.evidenceId === citation.evidenceId && item.revision === citation.revision)
    return describeSource(evidence?.snapshot)
  }) ?? []
  const reviewHasError = /could not|failed|blocked|unavailable|stale|too long|issues? need attention|invalid|not approved|cannot|can't|error|choose a destination|no file was written/i.test(draftError)
  const outgoing = review?.outgoing as unknown as OutboundPayload | undefined
  const headings = ['Job posting', 'Your information', 'Create your CV', 'Review your CV', 'Save your CV']
  const descriptions = ['Select the job posting this CV should address.', 'See what will be shared before you choose to continue.', 'Create a CV using your saved career facts.', draft?.approved ? 'Your reviewed CV is approved.' : 'Read your CV, select wording to check its sources, and make changes.', 'Choose a PDF or editable Word file. Word may reflow differently from PDF.']

  return <div className="cv-workbench-start">
    <header className="cv-workbench-heading">
      {activeJob && <div className="workbench-job-context"><span className="company-monogram" aria-hidden="true">{activeJob.company.slice(0, 1).toUpperCase()}</span><div><strong>{activeJob.title}</strong><span>{activeJob.company}</span></div></div>}
      <div><h1>{headings[activePhase - 1]}</h1>{descriptions[activePhase - 1] && <p>{descriptions[activePhase - 1]}</p>}</div>
    </header>

    <PhaseNavigation current={activePhase} />
    {recovery && recovery.jobId === activeJob?.id && <section className="recovery-panel" aria-labelledby="generation-recovery-heading">
      <h2 id="generation-recovery-heading">Interrupted generation</h2>
      <p role={recovery.status === 'uncertain' ? 'alert' : 'status'}>{recovery.status === 'uncertain' ? 'A request may have been sent. Retrying may duplicate it and use another attempt.' : 'Your work is saved. No request will be sent until you choose to resume.'}</p>
      <div className="recovery-actions"><button className="primary-button" type="button" disabled={recoveryBusy} onClick={() => void resumeSavedGeneration(recovery.status === 'uncertain')}>{recoveryBusy ? 'Resuming…' : recovery.status === 'uncertain' ? 'Retry generation' : 'Resume generation'}</button><button className="secondary-button" type="button" disabled={recoveryBusy} onClick={() => void cancelSavedGeneration()}>Cancel run</button></div>
    </section>}
    {activePhase === 1 && <section className="workbench-columns" aria-label="Tailoring workspace">
      <EmptyDocument message={activeJob ? 'Review the job posting and authorize a run before creating a draft.' : 'Choose a saved job to set the target before creating a draft.'} />
      <aside className="inspector" aria-label="Run review">
        <section className="job-stage" aria-labelledby="job-stage-heading">
        {error && <div className="job-stage-error" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={retry}>Retry</button></div>}
        {activeJob ? <><header><h2 id="job-stage-heading">{activeJob.title}</h2><p>{activeJob.company}</p></header><div className="posting-text">{activeJob.description}</div><p className="job-stage-note">The posting sets the target. Your profile supplies the candidate facts.</p><div className="job-stage-actions"><button className="secondary-button" type="button" onClick={() => onNavigate('Saved jobs')}>Choose another job</button><button className="primary-button" type="button" disabled={consentBusy} onClick={() => void inspectOutgoing()}>{consentBusy ? 'Preparing…' : 'Inspect outgoing data'}</button></div></> : <><h2 id="job-stage-heading">Choose a posting first</h2><p>Open a saved job or add a new one.</p><button className="primary-button" type="button" onClick={() => onNavigate('Saved jobs')}>Open saved jobs</button></>}
      </section></aside>
    </section>}

    {(activePhase === 2 || activePhase === 3) && review && <section className={`outbound-review${activePhase === 3 ? ' analysis-phase' : ''}`} aria-label="Tailoring workflow">
      {activePhase === 3 && <EmptyDocument message="A draft will appear here after you generate it." />}
      {(() => { const ReviewBody = activePhase === 3 ? 'aside' : 'div'; return <ReviewBody className="outbound-review-body" aria-label={activePhase === 3 ? 'Run review' : undefined}>
      <header className="outbound-phase-heading"><h2>{activePhase === 2 ? 'Your data, before it leaves' : 'Ready to analyze this posting'}</h2></header>
      {activePhase === 2 && <>
        {outgoing && <section className="outbound-data-card" aria-labelledby="outgoing-included-heading"><h3 id="outgoing-included-heading">What OpenRouter receives</h3><dl className="outbound-category-list"><div><dt>Job posting</dt><dd>Title and full description</dd></div>{outgoingProfileCounts.length ? outgoingProfileCounts.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.count} {item.count === 1 ? item.unit : `${item.unit}s`}</dd></div>) : <div><dt>Profile details</dt><dd>None saved yet</dd></div>}<div><dt>OpenRouter model</dt><dd>{outgoing.model.name}</dd></div></dl></section>}
        {outgoing && <IncludedContent outgoing={outgoing} />}
        <aside className="outbound-privacy-notice" aria-label="Cloud processing notice"><p>OpenRouter routes requests to third-party providers. Check your chosen model's data policy before sending personal, sensitive or confidential information. Redaction cannot guarantee anonymity.</p><details><summary>Full privacy notice</summary><p>{review.warning} {review.termsNotice}</p><a href="https://openrouter.ai/privacy" target="_blank" rel="noopener noreferrer">OpenRouter privacy policy</a></details></aside>
        <label className="outbound-ack"><input type="checkbox" checked={termsAcknowledged} onChange={event => setTermsAcknowledged(event.target.checked)} />I reviewed what is sent and understand the privacy notice.</label>
        <div className="outbound-actions"><button className="secondary-button" type="button" disabled={consentBusy} onClick={() => void cancelOutgoing()}>Back to posting</button><button className="primary-button" type="button" disabled={!termsAcknowledged || consentBusy} onClick={() => void authorizeOutgoing()}>Authorize this run</button></div>
      </>}
      {activePhase === 3 && <>
        <p role="status" className="outbound-authorized-status">Consent saved for this frozen bundle. No provider request has been sent yet.</p>
        {analysis?.status !== 'complete' && <div className="analysis-actions"><button className="primary-button" type="button" disabled={consentBusy} onClick={() => void startAnalysis()}>{consentBusy ? 'Analyzing…' : 'Analyze posting'}</button>{analysis?.status === 'running' && <button className="secondary-button" type="button" disabled={consentBusy} onClick={() => void cancelAnalysis()}>Cancel analysis</button>}</div>}
        {analysis?.status === 'running' && <p role="status">{/retry|backoff|quota|429/i.test(analysis.progress) ? 'The service is busy. We will retry shortly within your saved limits. You can cancel.' : 'Working on your CV. You can cancel while this step is in progress.'}</p>}
        {analysis?.status === 'failed' && <p className="inspector-error" role="alert">{analysis.error ?? analysis.progress} Check the connection or Settings, then explicitly start a new authorized run.</p>}
        {analysis?.status === 'cancelled' && <p role="status">{analysis.progress}</p>}
        {usage && usage.attempts + usage.runLimit > usage.configuredDailyLimit && <p role="alert">You are close to your local usage limit. This step may pause; you can return to your saved work later.</p>}
        {analysis?.analysis && <div className="posting-analysis" aria-label="Posting analysis"><h3>Required qualifications</h3><ul>{analysis.analysis.required.map(item => <li key={item}>{item}</li>)}</ul><h3>Preferred qualifications</h3><ul>{analysis.analysis.preferred.map(item => <li key={item}>{item}</li>)}</ul><h3>Tools and responsibilities</h3><p>{[...analysis.analysis.tools, ...analysis.analysis.responsibilities].join(' · ')}</p><h3>Keywords</h3><p>{analysis.analysis.keywords.join(' · ')}</p></div>}
        {analysis?.status === 'complete' && <div className="generate-actions"><label>Page target<select aria-label="Page target" value={pageTarget} onChange={event => setPageTarget(Number(event.target.value) as 1 | 2)}><option value={1}>One page</option><option value={2}>Two pages</option></select></label><button className="primary-button" type="button" disabled={draftBusy || !!draft} onClick={() => void generateDraft()}>{draftBusy ? 'Generating…' : draft ? 'Draft saved locally' : 'Generate tailored draft'}</button></div>}
        {draftError && <p className="inspector-error" role="alert">{draftError}</p>}
        <button className="secondary-button revoke-run" type="button" disabled={consentBusy} onClick={() => void cancelOutgoing()}>Revoke this run</button>
      </>}
      {consentError && <p className="inspector-error" role="alert">{consentError}</p>}
      </ReviewBody>; })()}
    </section>}

    {activePhase >= 4 && draft && <section className="workbench-columns" aria-label="Tailoring workflow">
      <section className="document-area" aria-label="CV document">
        <div className="document-toolbar"><div className="document-toolbar-title"><FileText size={17} aria-hidden="true" /><strong>Tailored CV</strong><span className="document-stage">{draft.approved ? 'Approved' : draft.status === 'blocked' ? 'Needs changes' : 'Ready to review'}</span><span className="review-hint">Select wording to see its sources</span></div><label className="page-target-control">Page target<select aria-label="Page target" value={pageTarget} onChange={event => setPageTarget(Number(event.target.value) as 1 | 2)}><option value={1}>One page</option><option value={2}>Two pages</option></select></label></div>
        <div className="paper-wrap">{canonical ? <DraftDocument document={canonical} approved={draft.approved} selectedId={selectedId} onSelectEntry={id => { const match = /^(education|experience|projects|skills|certificates)-(\d+)$/.exec(id); if (match) { setSelectedItem({ section: match[1] as Section, index: Number(match[2]) }); setEditing(false); if (window.innerWidth <= 900) window.requestAnimationFrame(() => reviewHeadingRef.current?.focus()) } }} /> : <p className="document-loading" role="status">Loading tailored CV…</p>}</div>
        <section className="page-fit-controls" aria-label="Actual PDF page fit"><p>Check that this CV fits the page length you chose.</p><button type="button" className="secondary-button" disabled={fitBusy} onClick={() => void measurePageFit()}>{fitBusy ? 'Measuring…' : 'Check page length'}</button>{fitReport && <div role="status">Your CV uses {fitReport.actualPages} of {fitReport.targetPages} page{fitReport.targetPages === 1 ? '' : 's'}. {fitReport.overflow ? 'It is too long. Choose which suggested content to remove before approval.' : 'Fits the selected target.'}{fitReport.overflow && fitReport.proposedCuts.map(cut => <label key={cut.entryId}><input type="checkbox" checked={acceptedCuts.includes(cut.entryId)} onChange={event => setAcceptedCuts(value => event.target.checked ? [...value, cut.entryId] : value.filter(id => id !== cut.entryId))} />Proposed cut: {cut.section} — {cut.label}</label>)}{fitReport.overflow && <button type="button" className="primary-button" disabled={!acceptedCuts.length} onClick={() => void applyPageCuts()}>Apply selected cuts</button>}</div>}</section>
      </section>
      <aside className="inspector" aria-label="Run review">
        <SelectedReview selection={activeSelection} item={selectedDraftItem} entry={selectedEntry} sources={selectedSources} draft={draft} headingRef={reviewHeadingRef} onReturnToDocument={() => { if (selectedId) document.getElementById(`cv-review-${selectedId}`)?.focus() }} editing={editing} setEditing={setEditing} onSave={(section, index, text) => correctDraft(section, index, text)} onImprove={(section, index) => { setSectionToolsOpen(true); void prepareRegeneration({ kind: 'paragraph', section, index }) }} busy={draftBusy || regenBusy} />
        <section className="draft-inspector" aria-label="CV review"><h2>{draft.approved ? 'Ready to save' : draft.status === 'blocked' ? 'Changes needed' : 'Finish reviewing'}</h2><p>{draft.approved ? 'You approved this CV. Save it when you are ready.' : draft.status === 'blocked' ? 'Some wording needs attention before you can approve this CV.' : 'Check the wording and page length, then approve your CV.'}</p>
          <button type="button" className="secondary-button section-improve-toggle" aria-expanded={sectionToolsOpen} disabled={regenBusy} onClick={() => setSectionToolsOpen(open => !open)}>{sectionToolsOpen ? 'Hide section options' : 'Improve a whole section'}</button>
          {(sectionToolsOpen || regenPreview || proposal?.status === 'pending') && <section className="regeneration-controls" aria-label="Improve your CV"><h3>Suggest new wording</h3><p>Your current CV stays unchanged until you accept a suggestion.</p><label>Section<select aria-label="Regeneration section" value={regenTarget.section} onChange={event => { const section = event.target.value as Section; setRegenTarget(regenTarget.kind === 'paragraph' ? { kind: 'paragraph', section, index: 0 } : { kind: 'section', section }) }}>{(['education', 'experience', 'projects', 'skills', 'certificates'] as const).map(section => <option key={section} value={section}>{section}</option>)}</select></label><label>Scope<select aria-label="Regeneration scope" value={regenTarget.kind} onChange={event => setRegenTarget(event.target.value === 'section' ? { kind: 'section', section: regenTarget.section } : { kind: 'paragraph', section: regenTarget.section, index: 0 })}><option value="section">Whole section</option><option value="paragraph">One paragraph</option></select></label>{regenTarget.kind === 'paragraph' && <label>Paragraph<select aria-label="Regeneration paragraph" value={regenTarget.index} onChange={event => setRegenTarget({ ...regenTarget, kind: 'paragraph', index: Number(event.target.value) })}>{draft.content[regenTarget.section].map((item, index) => <option key={index} value={index}>{index + 1}. {readableText('text' in item ? item.text : item.name).slice(0, 70) || 'Saved wording'}</option>)}</select></label>}<button type="button" className="secondary-button" disabled={regenBusy || !draft.content[regenTarget.section].length} onClick={() => void prepareRegeneration()}>{regenBusy ? 'Preparing…' : `Review data for ${regenTarget.kind} regeneration`}</button>
            {regenPreview && <div className="regeneration-consent"><h4>What will be shared for this suggestion</h4><p>{regenPreview.warning}</p><p>{regenPreview.termsNotice}</p><IncludedContent outgoing={regenPreview.outgoing as unknown as OutboundPayload} /><label><input type="checkbox" checked={regenTerms} onChange={event => setRegenTerms(event.target.checked)} />I reviewed this bundle and understand the provider data-use notice.</label><div><button type="button" className="secondary-button" disabled={regenBusy} onClick={() => void cancelRegeneration()}>Cancel</button><button type="button" className="primary-button" disabled={regenBusy || !regenTerms} onClick={() => void runRegeneration()}>{regenBusy ? 'Regenerating…' : 'Authorize and propose'}</button>{regenBusy && <button type="button" className="secondary-button" onClick={() => void cancelActiveRegeneration()}>Cancel operation</button>}</div></div>}
            {proposal && <section className="proposal-comparison" aria-label="Compare suggestion"><h4>Compare wording</h4><p>{proposal.status === 'pending' ? 'Your CV will not change until you accept this suggestion.' : proposal.status === 'accepted' ? 'This wording has been added to your CV. Review it again before approval.' : 'Your CV was not changed.'}</p>{proposal.proposed.map((item, index) => { const prior = proposal.before?.[index]; const beforeText = typeof prior === 'string' ? prior : prior?.text ?? ''; return <article key={index}><h5>Current</h5><p>{readableText(beforeText) || 'Saved wording'}</p><h5>Suggested</h5><p>{readableText(item.text) || 'Suggested wording unavailable'}</p><p>Sources: {item.citations.map(citation => sourceLabel(draft, citation.evidenceId, citation.revision)).join('; ')}</p>{readableText(item.rationale) && <p>{readableText(item.rationale)}</p>}</article>})}{proposal.status === 'pending' && <div><button type="button" className="secondary-button" disabled={regenBusy} onClick={() => void resolveProposal('reject')}>Reject proposal</button><button type="button" className="primary-button" disabled={regenBusy} onClick={() => void resolveProposal('accept')}>Accept replacement and recheck</button></div>}</section>}
            {regenMessage && <p className="regeneration-status" role="status">{regenMessage}</p>}
          </section>}
          {!!draft.checkReport?.findings.length && <details className="review-findings"><summary>{draft.checkReport.findings.length} review issue{draft.checkReport.findings.length === 1 ? '' : 's'} to resolve</summary>
          {draft.checkReport.findings.some(finding => finding.itemPath === 'generation') && <form onSubmit={event => void addDraftItem(event)}><p>We couldn't use the suggested wording. Write your own text and choose a supporting career fact.</p><label>Section<select aria-label="Correction section" value={addSection} onChange={event => setAddSection(event.target.value as Section)}>{(['education', 'experience', 'projects', 'skills', 'certificates'] as const).map(section => <option key={section} value={section}>{section}</option>)}</select></label><label>Saved evidence revision<select aria-label="Correction evidence" value={addEvidence} onChange={event => setAddEvidence(event.target.value)}><option value="">Choose selected source</option>{sourceOptions(sources, draft, addSection).map(item => <option key={item.evidenceId} value={item.evidenceId}>{sourceLabel(draft, item.evidenceId, item.revision)}</option>)}</select></label><label>Your correction<textarea name="local-correction" required maxLength={3000} /></label><button type="submit" disabled={draftBusy || !addEvidence}>Save local correction</button></form>}
          {draft.checkReport?.findings.map((finding, index) => { if (finding.itemPath === 'generation') return null; const match = /^(education|experience|projects|skills|certificates)\[(\d+)\]/.exec(finding.itemPath); if (!match) return <p role="alert" key={`${finding.code}-${index}`}>{finding.message} {finding.correction}</p>; const section = match[1] as Section; const itemIndex = Number(match[2]); const entry = draft.content[section][itemIndex]; const current = entry ? ('text' in entry ? entry.text : entry.name) : ''; return <form key={`${finding.code}-${index}`} role="alert" onSubmit={event => { event.preventDefault(); const value = new FormData(event.currentTarget).get('correction'); if (typeof value === 'string') void correctDraft(section, itemIndex, value) }}><p>{finding.message} {finding.correction}</p><label>Correct {section} draft wording<textarea name="correction" defaultValue={readableText(current)} /></label><button type="submit" disabled={draftBusy}>Save wording and recheck</button></form>})}</details>}
          {draftError && <p className={`review-feedback${reviewHasError ? ' is-error' : ''}`} role={reviewHasError ? 'alert' : 'status'}>{draftError}</p>}
          <p className="review-limitation">Checks can miss mistakes. You make the final decision after reading your CV.</p>
          {!draft.approved && <p className="review-next-step">{!draft.checkReport?.passed ? 'Next: check your CV for issues.' : !fitReport ? 'Next: check the page length beneath your CV.' : fitReport.overflow ? 'Your CV is too long. Review the suggested cuts beneath the page.' : 'When the wording looks right, approve this CV.'}</p>}
          <div className="review-controls"><button type="button" className="secondary-button" disabled={draftBusy} onClick={() => void checkDraftNow()}>Check CV for issues</button><button type="button" className="primary-button" disabled={draftBusy || !fitReport || fitReport.overflow || !draft.checkReport?.passed || draft.approved} onClick={() => void approveCurrentDraft()}>{draft.approved ? 'Approved' : 'Approve CV'}</button></div>{draft.approved && <div className="export-actions"><button type="button" className="primary-button" disabled={exportBusy || docxBusy || !fitReport || fitReport.overflow} onClick={async () => { if (!activeJob) return; setExportBusy(true); setExportMessage(''); try { setExportMessage((await window.workbench.exportApprovedPdf(activeJob.id)).message) } catch { setExportMessage('PDF export failed. Check the destination and try again.') } finally { setExportBusy(false) } }}>{exportBusy ? 'Exporting…' : 'Export approved PDF'}</button><button type="button" className="secondary-button" disabled={exportBusy || docxBusy || !fitReport || fitReport.overflow} onClick={() => void exportDocx()}>{docxBusy ? 'Preparing DOCX…' : 'Export editable DOCX'}</button><p role="status" aria-live="polite">{exportMessage || 'Files are checked locally; no ATS service or model request is used. Word may reflow differently from PDF.'}</p></div>}

          <button type="button" className="secondary-button new-run-button" disabled={consentBusy || draftBusy} onClick={() => void inspectOutgoing()}>{consentBusy ? 'Preparing…' : 'Create another CV'}</button>
          {consentError && <p className="inspector-error" role="alert">{consentError}</p>}
        </section>
      </aside>
    </section>}
  </div>
}
