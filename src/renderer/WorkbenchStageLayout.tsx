import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { FileText } from 'lucide-react'
import type { JobRecord } from '../shared/jobs'
import type { OutboundPayload } from '../shared/outbound-consent'
import type { OutboundConsentPreview } from '../shared/outbound-consent-contract'
import type { CanonicalDocument, DocumentFitReport } from '../shared/document'
import type { DraftRevision } from '../shared/draft'
import type { ExperienceSnapshot } from '../shared/experience'
import type { ProfileSnapshot } from '../shared/profile'
import { DraftDocument } from './DraftReview'

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
  correctDraft: (section: Section, index: number, text: string, intent?: 'wording-only' | 'new-fact') => Promise<void>
  checkDraftNow: () => Promise<void>
  approveCurrentDraft: () => Promise<void>
}

function PhaseNavigation({ current }: { current: Phase }) {
  const phases = ['Job posting', 'Outgoing data', 'Generate', 'Review evidence', 'Export']
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
  const snapshot = evidence?.snapshot as Record<string, unknown> | undefined
  const title = [snapshot?.title, snapshot?.name, snapshot?.label, snapshot?.text].find(value => typeof value === 'string')
  const organization = typeof snapshot?.organization === 'string' ? snapshot.organization : undefined
  const label = [typeof title === 'string' ? title : 'Saved evidence', organization].filter(Boolean).join(' · ')
  return `${label} · r${revision}`
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
  const { activeJob, onNavigate, error, retry, activePhase, review, consentAccepted, termsAcknowledged, setTermsAcknowledged, consentError, consentBusy, analysis, draft, canonical, fitReport, fitBusy, acceptedCuts, setAcceptedCuts, draftBusy, draftError, pageTarget, setPageTarget, usage, addSection, setAddSection, addEvidence, setAddEvidence, sources, outgoingProfileCounts, inspectOutgoing, cancelOutgoing, authorizeOutgoing, startAnalysis, generateDraft, cancelAnalysis, measurePageFit, applyPageCuts, addDraftItem, correctDraft, checkDraftNow, approveCurrentDraft } = props
  const outgoing = review?.outgoing as unknown as OutboundPayload | undefined
  const headings = ['Job posting', 'Outgoing data', 'Generate', 'Review your tailored CV', 'Export']
  const descriptions = ['Select the job posting this CV should address.', 'Review this bundle before authorizing.', 'Analyze the posting and create a source-linked draft.', draft?.approved ? 'This draft is approved.' : 'Review the wording and supporting evidence.', 'Export is not available in this version.']

  return <div className="cv-workbench-start">
    <header className="cv-workbench-heading">
      {activeJob && <div className="workbench-job-context"><span className="company-monogram" aria-hidden="true">{activeJob.company.slice(0, 1).toUpperCase()}</span><div><strong>{activeJob.title}</strong><span>{activeJob.company}</span></div></div>}
      <div><h1>{headings[activePhase - 1]}</h1>{descriptions[activePhase - 1] && <p>{descriptions[activePhase - 1]}</p>}</div>
    </header>

    <PhaseNavigation current={activePhase} />
    {activePhase === 1 && <section className="workbench-columns" aria-label="Tailoring workspace">
      <EmptyDocument message={activeJob ? 'Review the job posting and authorize a run before creating a draft.' : 'Choose a saved job to set the target before creating a draft.'} />
      <aside className="inspector" aria-label="Run review"><section className="job-stage" aria-labelledby="job-stage-heading">
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
        {analysis?.status === 'running' && <p role="status">{analysis.progress} Dispatched attempts: {analysis.attempts}.</p>}
        {analysis?.status === 'failed' && <p className="inspector-error" role="alert">{analysis.error ?? analysis.progress} Check the connection or Settings, then explicitly start a new authorized run.</p>}
        {analysis?.status === 'cancelled' && <p role="status">{analysis.progress}</p>}
        {usage && <details className="usage-details"><summary>Usage and retry limits · {usage.attempts} local attempt{usage.attempts === 1 ? '' : 's'}</summary><p>Pacific day {usage.pacificDay}. Maximum {usage.runLimit} per run with {usage.minimumSpacingMs / 1000}s spacing. {usage.warning}</p>{usage.attempts + usage.runLimit > usage.configuredDailyLimit && <p role="alert">This run could reach the local daily limit ({usage.configuredDailyLimit}); dispatch stops there. It is not a provider quota estimate.</p>}</details>}
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
        <div className="document-toolbar"><div className="document-toolbar-title"><FileText size={17} aria-hidden="true" /><strong>Tailored CV</strong><span className="document-stage">{draft.approved ? 'Approved' : draft.status === 'blocked' ? 'Review blocked' : 'Unverified · not approved'}</span></div><label className="page-target-control">Page target<select aria-label="Page target" value={pageTarget} onChange={event => setPageTarget(Number(event.target.value) as 1 | 2)}><option value={1}>One page</option><option value={2}>Two pages</option></select></label></div>
        <div className="paper-wrap">{canonical ? <DraftDocument document={canonical} /> : <p className="document-loading" role="status">Loading tailored CV…</p>}</div>
        <section className="page-fit-controls" aria-label="Actual PDF page fit"><p>Check the real A4 layout before approval.</p><button type="button" className="secondary-button" disabled={fitBusy} onClick={() => void measurePageFit()}>{fitBusy ? 'Measuring…' : 'Measure actual A4 page fit'}</button>{fitReport && <div role="status">Revision {canonical?.revision ?? draft.revision} · Electron PDF: {fitReport.actualPages} page{fitReport.actualPages === 1 ? '' : 's'}; target {fitReport.targetPages}. {fitReport.overflow ? 'Review the overflow before approval.' : 'Fits the selected target.'}{fitReport.overflow && fitReport.proposedCuts.map(cut => <label key={cut.entryId}><input type="checkbox" checked={acceptedCuts.includes(cut.entryId)} onChange={event => setAcceptedCuts(value => event.target.checked ? [...value, cut.entryId] : value.filter(id => id !== cut.entryId))} />Proposed cut: {cut.section} — {cut.label}</label>)}{fitReport.overflow && <button type="button" className="primary-button" disabled={!acceptedCuts.length} onClick={() => void applyPageCuts()}>Accept selected cuts and create new draft revision</button>}</div>}{draftError && <p className="inspector-error" role="alert">{draftError}</p>}</section>
      </section>
      <aside className="inspector" aria-label="Run review">
        <section className="review-inspector-panel" aria-label="Evidence and qualification coverage"><h2>Evidence &amp; coverage</h2>{draft.coverage ? <><p>{draft.coverage.label}</p><h3>Supported matches</h3>{draft.coverage.supportedMatches.length ? <ul>{draft.coverage.supportedMatches.map((match, index) => <li key={`${match.qualification}-${index}`}>{match.qualification} · {match.kind}, supported as “{match.matchedAs}” · {match.evidence.length} source{match.evidence.length === 1 ? '' : 's'}</li>)}</ul> : <p>No supported required/preferred matches found.</p>}<h3>Advisory gaps</h3>{draft.coverage.gaps.length ? <ul>{draft.coverage.gaps.map((gap, index) => <li key={`${gap.qualification}-${index}`}>{gap.qualification} · missing {gap.kind} qualification (advisory; does not block factual-valid partial-match drafts)</li>)}</ul> : <p>No explicit required/preferred gaps.</p>}<p className="future-note">Gaps never authorize invented experience. Keyword repair dispatch attempts: {draft.coverage.repairAttempts} (at most one repair cycle within the shared run budget). Factual checks rerun: {draft.coverage.factualChecksRerun ? 'yes' : 'no'}.</p></> : <p>Posting coverage is not available for this draft.</p>}</section>
        <section className="draft-inspector" aria-label="Source-linked draft"><h2>Draft · {draft.status === 'blocked' ? 'blocked by factual checks' : draft.approved ? 'approved' : 'unverified and unapproved'}</h2><p>{draft.progress} Dispatched requests: {draft.attempts}.</p>
          {draft.checkReport?.findings.some(finding => finding.itemPath === 'generation') && <form onSubmit={event => void addDraftItem(event)}><p>The invalid provider response was discarded. Add your own wording and cite one saved selected source revision.</p><label>Section<select aria-label="Correction section" value={addSection} onChange={event => setAddSection(event.target.value as Section)}>{(['education', 'experience', 'projects', 'skills', 'certificates'] as const).map(section => <option key={section} value={section}>{section}</option>)}</select></label><label>Saved evidence revision<select aria-label="Correction evidence" value={addEvidence} onChange={event => setAddEvidence(event.target.value)}><option value="">Choose selected source</option>{sourceOptions(sources, draft, addSection).map(item => <option key={item.evidenceId} value={item.evidenceId}>{sourceLabel(draft, item.evidenceId, item.revision)}</option>)}</select></label><label>Your correction<textarea name="local-correction" required maxLength={3000} /></label><button type="submit" disabled={draftBusy || !addEvidence}>Save local correction</button></form>}
          {draft.checkReport?.findings.map((finding, index) => { const match = /^(education|experience|projects|skills|certificates)\[(\d+)\]/.exec(finding.itemPath); if (!match) return <p role="alert" key={`${finding.code}-${index}`}>{finding.historical ? `Historical unresolved failure from draft ${finding.originDraftId} revision ${finding.originDraftRevision}; evidence ${finding.originEvidenceRevisionHash}. ` : ''}{finding.message} {finding.correction}</p>; const section = match[1] as Section; const itemIndex = Number(match[2]); const entry = draft.content[section][itemIndex]; const current = entry ? ('text' in entry ? entry.text : entry.name) : ''; return <form key={`${finding.code}-${index}`} role="alert" onSubmit={event => { event.preventDefault(); const value = new FormData(event.currentTarget).get('correction'); if (typeof value === 'string') void correctDraft(section, itemIndex, value) }}><p>{finding.historical ? `Historical unresolved failure from draft ${finding.originDraftId} revision ${finding.originDraftRevision}; evidence ${finding.originEvidenceRevisionHash}. ` : ''}{finding.message} {finding.correction}</p><label>Correct {section} draft wording<textarea name="correction" defaultValue={current} /></label><button type="submit" disabled={draftBusy}>Save correction and recheck</button></form>})}
          <div className="draft-edit-list">{(['education', 'experience', 'projects', 'skills', 'certificates'] as const).map(section => draft.content[section].map((item, index) => <details className="draft-edit-item" key={`${section}-${index}`}><summary>{section[0].toUpperCase() + section.slice(1)} · {'text' in item ? item.text.slice(0, 70) : item.name}</summary><form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); const text = data.get('wording'); if (typeof text === 'string') void correctDraft(section, index, text, data.get('editIntent') === 'new-fact' ? 'new-fact' : 'wording-only') }}><label>Edit wording<textarea name="wording" defaultValue={'text' in item ? item.text : item.name} /></label><label>Change type<select name="editIntent" defaultValue="wording-only"><option value="wording-only">Wording only</option><option value="new-fact">New or changed factual claim</option></select></label><button type="submit" disabled={draftBusy}>Save wording and recheck</button></form><small>Source revisions: {item.citations.map(citation => sourceLabel(draft, citation.evidenceId, citation.revision)).join(', ')}</small><p className="future-note">{item.rationale}</p></details>))}</div>
          <p>{draft.checkReport?.limitation ?? 'Automated checks are second opinions, not proof.'} Human review remains required. Citations do not prove faithfulness; review wording against its source.</p>{draftError && <p className="inspector-error" role="alert">{draftError}</p>}
          <div className="review-controls"><button type="button" className="secondary-button" disabled={draftBusy} onClick={() => void checkDraftNow()}>Check current draft and sources</button><button type="button" className="primary-button" disabled={draftBusy || !fitReport || fitReport.overflow || !draft.checkReport?.passed || draft.approved} onClick={() => void approveCurrentDraft()}>{draft.approved ? 'Approved for export' : 'Review and approve whole document'}</button></div>{draft.approved && <p className="export-not-ready">File export is not available in this version.</p>}
          <button type="button" className="secondary-button new-run-button" disabled={consentBusy || draftBusy} onClick={() => void inspectOutgoing()}>{consentBusy ? 'Preparing…' : 'New generation'}</button>
          {consentError && <p className="inspector-error" role="alert">{consentError}</p>}
        </section>
      </aside>
    </section>}
  </div>
}
