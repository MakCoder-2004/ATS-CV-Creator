import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction, type ReactNode } from 'react'
import { FileText, CheckCircle2, Sparkles, BookOpen, ListChecks, BriefcaseBusiness } from 'lucide-react'
import { GenerationProgress, SuggestedSkillReview, TailoringInspector } from './CVFlowPanels'
import type { JobRecord } from '../shared/jobs'
import type { OutboundPayload } from '../shared/outbound-consent'
import type { OutboundConsentPreview } from '../shared/outbound-consent-contract'
import type { CanonicalDocument, DocumentFitReport } from '../shared/document'
import type { DraftRevision } from '../shared/draft'
import type { GenerationRecovery } from '../shared/posting-analysis'
import type { ExperienceSnapshot } from '../shared/experience'
import type { ProfileSnapshot } from '../shared/profile'
import { DraftDocument } from './DraftReview'
import { CvTitleEditor } from './CvTitleEditor'
import { PdfPreview } from './PdfPreview'
import { ReviewActionBar } from './ReviewActionBar'
import { ReviewContextPanel } from './ReviewContextPanel'
import { JobMatchReview } from './JobMatchReview'
import { DraftRecordEditor, type RecordEditorTarget } from './DraftRecordEditor'
import { listDraftRecords, type MutateDraftRecordInput, type MutateDraftRecordResult } from '../shared/draft-records'
import { SelectedReview } from './SelectedReview'
import { describeSource, readableText } from './review-copy'
import type { WorkbenchAPI } from '../shared/appearance'
import { CoverLetterRunOption } from './CoverLetterRunOption'
import { ApplicationDocumentSelector, type ApplicationDocument } from './ApplicationDocumentSelector'

export type WorkbenchSources = { profile: ProfileSnapshot; evidence: ExperienceSnapshot }
type Phase = 1 | 2 | 3 | 4 | 5
type Section = 'education' | 'experience' | 'projects' | 'skills' | 'certificates'

type Props = {
  api: WorkbenchAPI
  selectedDocument: ApplicationDocument
  selectDocument: (document: ApplicationDocument) => void
  letterStatus: string
  letterWorkspace: ReactNode
  letterGenerationStatus: string | null
  includeLetter: boolean
  setIncludeLetter: (included: boolean) => void
  letterOnly: boolean
  generateLetterOnly: () => Promise<void>
  mutateRecord: (input: Omit<MutateDraftRecordInput, 'jobId'>) => Promise<MutateDraftRecordResult>
  returnToReview: () => void
  renewDraftReview: () => Promise<boolean>
  decideSuggestedSkill: (id: string, decision: 'pending' | 'confirmed' | 'removed') => Promise<void>
  activeJob: JobRecord | null
  onNavigate: (page: 'Saved jobs' | 'Settings') => void
  error: string
  retry: () => void
  activePhase: Phase
  review: Extract<OutboundConsentPreview, { ok: true }> | null
  consentAccepted: boolean
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
  changeCvTitle: (title: string | null) => Promise<boolean>
  approveCurrentDraft: () => Promise<void>
  onProposalAccepted: (draft: DraftRevision, document: CanonicalDocument | null, fit: DocumentFitReport | null) => void
  exportDocx: () => Promise<void>
  docxBusy: boolean
}

function PhaseNavigation({ current }: { current: Phase }) {
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const reveal = () => { const nav = navRef.current, item = nav?.querySelector('[aria-current="step"]'); if (nav && item) { const a = nav.getBoundingClientRect(), b = item.getBoundingClientRect(); nav.scrollLeft += b.left - a.left - (a.width - b.width) / 2 } }
    reveal(); window.addEventListener('resize', reveal); return () => window.removeEventListener('resize', reveal)
  }, [current])
  const phases = ['Job posting', 'Outgoing data', 'Generate', 'Review evidence', 'Export']
  return <nav ref={navRef} className="tailoring-phase-nav" aria-label="Tailoring phases"><ol>{phases.map((phase, index) => <li key={phase} className={index + 1 < current ? 'is-complete' : undefined} aria-current={index + 1 === current ? 'step' : undefined}><span className="phase-number">{index + 1}</span><span className="phase-label">{phase}</span></li>)}</ol></nav>
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

function EmptyDocument({ message }: { message: string }) {
  return <section className="document-area" aria-label="CV document"><div className="document-toolbar"><div className="document-toolbar-title"><FileText size={17} aria-hidden="true" /><strong>Tailored CV</strong><span className="document-stage">No draft yet</span></div></div><div className="paper-wrap"><div className="document-empty"><FileText aria-hidden="true" /><h2>Your tailored CV will appear here</h2><p>{message}</p></div></div></section>
}

export function WorkbenchStageLayout(props: Props) {
  const { returnToReview, renewDraftReview, decideSuggestedSkill, activeJob, onNavigate, error, retry, activePhase, review, consentAccepted, consentError, consentBusy, recovery, recoveryBusy, resumeSavedGeneration, cancelSavedGeneration, draft, canonical, fitReport, fitBusy, acceptedCuts, setAcceptedCuts, draftBusy, draftError, pageTarget, setPageTarget, sources, outgoingProfileCounts, inspectOutgoing, cancelOutgoing, authorizeOutgoing, startAnalysis, generateDraft, cancelAnalysis, measurePageFit, applyPageCuts, correctDraft, changeCvTitle, approveCurrentDraft, exportDocx, docxBusy } = props
  const api = props.api
  const analysis = props.analysis ? { ...props.analysis, analysis: props.analysis.displayAnalysis ?? props.analysis.analysis } : null
  const workingTextDiffersFromSource = Boolean(activeJob?.sourceSnapshot && activeJob.sourceSnapshot.description !== activeJob.description)
  const sourceScopeNote = 'This assessment uses only the accepted working posting. The separately retained source snapshot differs, so source requirements absent from the working text were not assessed.'
  const [recordEditor, setRecordEditor] = useState<RecordEditorTarget | null>(null)
  function editRecord(section: MutateDraftRecordInput['section'], operation: 'add' | 'update' | 'remove', index?: number) {
    if (!draft) return
    const records = operation === 'add' ? [] : listDraftRecords(draft)
    let record = records.find(record => record.section === section && record.index === index)
    if (!record && index !== undefined && (section === 'experience' || section === 'projects')) {
      const citations = draft.content[section][index]?.citations ?? []
      const owner = draft.lockedFields[section].find(parent => citations.some(citation => (parent.sourceIds ?? [parent.evidenceId]).includes(citation.evidenceId)))
      record = records.find(record => record.section === section && record.sourceId === owner?.evidenceId)
    }
    if (operation !== 'add' && !record) return
    setRecordEditor({ section, operation, record, draftId: draft.id, revision: draft.revision })
  }
  const [exportMessage, setExportMessage] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const [selectedItem, setSelectedItem] = useState<{ section: Section; index: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [titleEditing, setTitleEditing] = useState(false)
  const [specialSelection, setSpecialSelection] = useState<string | null>(null)
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false)
  useEffect(() => { setReviewAcknowledged(false); setTitleEditing(false) }, [draft?.id])
  useEffect(() => { setSpecialSelection(null) }, [activeJob?.id])
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth >= 1350)
  const [contextView, setContextView] = useState<'sources' | 'skills' | 'match'>('sources')
  const [detailsReveal, setDetailsReveal] = useState(0)
  const [dismissedEvidenceId, setDismissedEvidenceId] = useState<string | null>(null)
  function openDetails(target: 'sources' | 'skills' = 'sources') { setContextView(target); setInspectorOpen(true); setDetailsReveal(value => value + 1) }
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null)
  const lastReviewSelectionRef = useRef<HTMLElement | null>(null)
  useEffect(() => { setSelectedItem(null); setEditing(false) }, [activeJob?.id])
  const firstSection = (['experience', 'education', 'projects', 'skills'] as const).find(section => draft?.content[section].length)
  const activeSelection = selectedItem && draft?.content[selectedItem.section][selectedItem.index] ? selectedItem : firstSection ? { section: firstSection, index: 0 } : null
  const selectedDraftItem = activeSelection && draft?.content[activeSelection.section][activeSelection.index]
  const selectedId = specialSelection ?? (activeSelection ? `${activeSelection.section}-${activeSelection.index}` : undefined)
  const pendingSkills = draft?.suggestedSkills?.filter(skill => skill.status === 'pending').length ?? 0
  const selectedEntry = canonical?.sections.flatMap(section => section.entries).flatMap(entry => entry.reviewItems?.map(item => ({ ...entry, id: item.id, text: item.text, bullets: item.bullets, ...(item.descriptionFormat ? { descriptionFormat: item.descriptionFormat } : { descriptionFormat: undefined }) })) ?? [entry]).find(entry => entry.id === selectedId)
  const selectedSources = selectedDraftItem?.citations.map(citation => {
    const evidence = draft?.evidence.find(item => item.evidenceId === citation.evidenceId && item.revision === citation.revision)
    return describeSource(evidence?.snapshot)
  }) ?? []
  const inlineEvidenceKey = selectedId && draft ? `${draft.id}:${draft.revision}:${selectedId}` : null
  const inlineEvidence = selectedItem && !specialSelection && selectedDraftItem && selectedId && inlineEvidenceKey !== dismissedEvidenceId ? {
    id: selectedId,
    sources: selectedSources,
    rationale: readableText(selectedDraftItem.rationale),
    manual: selectedDraftItem.citations.some(citation => draft?.evidence.some(source => source.evidenceId === citation.evidenceId && source.revision === citation.revision && source.provenance === 'manual'))
  } : null
  const reviewHasError = /could not|failed|blocked|unavailable|stale|too long|issues? need attention|invalid|not approved|cannot|can't|error|choose a destination|no file was written/i.test(draftError)
  const outgoing = review?.outgoing as unknown as OutboundPayload | undefined
  const hasGenerationFacts = Boolean(outgoing && [outgoing.profile.experience, outgoing.profile.projects, outgoing.profile.skills, outgoing.profile.education].some(items => items.length > 0))
  const headings = ['Start with the right role.', 'Your data, before it leaves.', props.letterOnly ? 'Prepare your cover letter.' : draftBusy ? props.includeLetter ? 'Your documents are taking shape.' : 'Your CV is taking shape.' : 'Understand the role. Then tailor your CV.', props.selectedDocument === 'cover-letter' ? 'Review your cover letter' : 'Review your CV', 'Ready for your next application.']
  const descriptions = ['The posting sets the target. Your profile supplies the facts.', 'See what will be shared before you choose to continue.', 'Qualifications and keywords guide the wording—not invented experience.', 'Make it yours. Review the wording, check the fit, then approve.', 'A clean document, without review highlights or added-skill notices.']

  return <div className={`cv-workbench-start${activePhase === 4 ? ' cv-review-mode' : ''}`}>
    <header className="cv-workbench-heading">
      {activeJob && <div className="workbench-job-context"><span className="company-monogram" aria-hidden="true">{activeJob.company.slice(0, 1).toUpperCase()}</span><div><strong>{activeJob.title}</strong><span>{activeJob.company}</span></div></div>}
      <div><h1>{headings[activePhase - 1]}</h1>{descriptions[activePhase - 1] && <p>{descriptions[activePhase - 1]}</p>}</div>
    </header>

    <PhaseNavigation current={activePhase} />
    {recovery && recovery.jobId === activeJob?.id && <section className="recovery-panel" aria-labelledby="generation-recovery-heading">
      <h2 id="generation-recovery-heading">Interrupted generation</h2>
      <p role={recovery.status === 'uncertain' ? 'alert' : 'status'}>{recovery.progress}</p>
      {recovery.canResume ? <div className="recovery-actions"><button className="primary-button" type="button" disabled={recoveryBusy} onClick={() => void resumeSavedGeneration(recovery.status === 'uncertain')}>{recoveryBusy ? 'Resuming…' : recovery.status === 'uncertain' ? 'Retry generation' : 'Resume generation'}</button><button className="secondary-button" type="button" disabled={recoveryBusy} onClick={() => void cancelSavedGeneration()}>Cancel run</button></div> : <button className="primary-button" type="button" disabled={consentBusy} onClick={() => void inspectOutgoing()}>Review outgoing data</button>}
    </section>}
    {activePhase === 1 && <section className="workbench-columns" aria-label="Tailoring workspace">
      {activeJob ? <section className="posting-overview"><header><h2>{activeJob.title}</h2><p>{activeJob.company}</p></header><div className="posting-source-text">{activeJob.description}</div><footer><p>The posting sets the target. Your profile supplies the candidate facts.</p><div className="outbound-actions"><button className="secondary-button" type="button" onClick={() => onNavigate('Saved jobs')}>Choose another job</button><button className="primary-button" type="button" disabled={consentBusy} onClick={() => void inspectOutgoing()}>{consentBusy ? 'Preparing…' : 'Inspect outgoing data'}</button></div></footer></section> : <EmptyDocument message="Choose a saved job to set the target before creating a draft." />}
      <aside className="inspector" aria-label="Run review">
        <section className="job-stage" aria-labelledby="job-stage-heading">
        {error && <div className="job-stage-error" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={retry}>Retry</button></div>}
        {consentError && <div className="job-stage-error" role="alert"><p>{consentError}</p><button className="secondary-button" type="button" onClick={() => onNavigate('Settings')}>Open Settings</button></div>}
        {activeJob ? <><header><h2 id="job-stage-heading">A profile to build from</h2><p>Your saved career facts supply the content.</p></header>{sources && <dl className="profile-source-summary"><div><dt>Experience and training</dt><dd>{sources.evidence.experience.length} records</dd></div><div><dt>Projects</dt><dd>{sources.evidence.projects.length} records</dd></div><div><dt>Skills</dt><dd>{sources.profile.skills.length} saved skills</dd></div><div><dt>Education</dt><dd>{sources.profile.education.length} records</dd></div></dl>}<p className="job-stage-note">Job requirements are not automatically treated as your career facts. New skills will need your decision.</p></> : <><h2 id="job-stage-heading">Choose a posting first</h2><p>Open a saved job or add a new one.</p><button className="primary-button" type="button" onClick={() => onNavigate('Saved jobs')}>Open saved jobs</button></>}
      </section></aside>
    </section>}

    {(activePhase === 2 || activePhase === 3) && review && <section className={`outbound-review${activePhase === 3 ? ' analysis-phase' : ''}`} aria-label="Tailoring workflow">
      {(() => { const ReviewBody = 'div'; return <ReviewBody className="outbound-review-body">
      {activePhase === 2 && <header className="outbound-phase-heading"><h2>Your data, before it leaves</h2></header>}
      {activePhase === 2 && <>
        {props.letterOnly ? <p role="status">Purpose: cover letter only. This fresh authorization will not analyze the posting again or regenerate your CV.</p> : <CoverLetterRunOption checked={props.includeLetter} disabled={consentBusy} onChange={props.setIncludeLetter} />}
        <p role="status">Preview purpose: {review.purpose === 'cv+cover-letter' ? 'CV and cover letter' : review.purpose === 'cover-letter-only' ? 'Cover letter only' : 'CV only'}.</p>
        {outgoing && <section className="outbound-data-card" aria-labelledby="outgoing-included-heading"><h3 id="outgoing-included-heading">What your selected model provider receives</h3><dl className="outbound-category-list"><div><dt>Job posting</dt><dd>Title and full description</dd></div>{outgoingProfileCounts.length ? outgoingProfileCounts.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.count} {item.count === 1 ? item.unit : `${item.unit}s`}</dd></div>) : <div><dt>Profile details</dt><dd>None saved yet</dd></div>}<div><dt>Pi model</dt><dd>{outgoing.model.providerId}/{outgoing.model.name}</dd></div><div><dt>Thinking level</dt><dd>{outgoing.model.thinkingLevel}</dd></div></dl></section>}
        {outgoing && <IncludedContent outgoing={outgoing} />}
        <aside className="outbound-privacy-notice" aria-label="Cloud processing notice"><p>No model request starts until you authorize this run. Pi uses your existing sign-in to send the reviewed, minimized text to the selected provider.</p><p>Provider data policies and charges vary. Redaction cannot guarantee anonymity. Review the provider's terms before sending sensitive information.</p><details><summary>Full privacy notice</summary><p>{review.warning} {review.termsNotice}</p></details></aside>
        <div className="outbound-actions"><button className="secondary-button" type="button" disabled={consentBusy} onClick={() => void cancelOutgoing()}>Back to posting</button><button className="primary-button" type="button" disabled={consentBusy} onClick={() => void authorizeOutgoing()}>{consentBusy ? 'Authorizing…' : 'Authorize and start this run'}</button></div>
      </>}
      {activePhase === 3 && <>
        {props.letterOnly ? <section className="generate-ready" aria-label="Generate cover letter"><h2>Generate your cover letter</h2><p>Authorized purpose: cover letter only. The saved CV and posting analysis will not change.</p>{outgoing && <p>Pi provider: {outgoing.model.providerId} · Model: {outgoing.model.name} · Thinking level: {outgoing.model.thinkingLevel}</p>}<p>{review.warning}</p><p>{review.termsNotice}</p><button className="primary-button" type="button" disabled={draftBusy || consentBusy} onClick={() => void props.generateLetterOnly()}>{draftBusy ? 'Generating cover letter…' : 'Generate cover letter'}</button>{draftBusy && <button className="secondary-button" type="button" onClick={() => void cancelAnalysis()}>Cancel cover letter generation</button>}<button className="secondary-button" type="button" disabled={draftBusy || consentBusy} onClick={() => void cancelOutgoing()}>Revoke this run</button>{draftError && <p role="alert">{draftError}</p>}</section> : <>
        <CoverLetterRunOption checked={props.includeLetter} disabled authorizedPurpose={review.purpose === 'cv+cover-letter' ? 'cv+cover-letter' : 'cv'} onChange={props.setIncludeLetter} />
        {draftBusy ? <><GenerationProgress analysis={analysis} measuring={fitBusy} onCancel={() => void cancelAnalysis()} cancelling={false} />{props.includeLetter && <p role="status">{props.letterGenerationStatus === 'generating' ? 'Your CV is saved. Generating the authorized cover letter…' : props.letterGenerationStatus === 'saved' ? 'Cover letter saved. Preparing the document review…' : 'The cover letter follows successful CV generation. Its outcome is separate from your CV.'}</p>}</> : <>
        {analysis?.status === 'running' && <section className="analysis-loading" role="status"><h2>Reading the job posting…</h2><p>Finding the qualifications, skills and keywords to guide your CV.</p><button className="secondary-button" type="button" onClick={() => void cancelAnalysis()}>Cancel analysis</button></section>}
        {analysis?.status === 'failed' && <p className="inspector-error" role="alert">{analysis.error ?? analysis.progress}</p>}
        {analysis?.status === 'cancelled' && <p role="status">{analysis.progress}</p>}
        {analysis?.status === 'stale' && analysis.analysis && <section className="posting-analysis" aria-label="Earlier posting analysis"><p role="status">This assessment targets an earlier posting and is retained for history, not as current guidance.</p><h2>Earlier requirements</h2><h3>Required qualifications</h3><ul>{(analysis.displayAnalysis ?? analysis.analysis).required.map(item => <li key={item}>{item}</li>)}</ul><h3>Preferred qualifications</h3><ul>{(analysis.displayAnalysis ?? analysis.analysis).preferred.map(item => <li key={item}>{item}</li>)}</ul><button className="primary-button" type="button" disabled={consentBusy} onClick={() => void inspectOutgoing()}>Review outgoing data for current posting</button></section>}
        {!consentBusy && (!analysis || analysis.status === 'queued') && <button className="primary-button" type="button" onClick={() => void startAnalysis()}>Analyze posting</button>}
        {(analysis?.status === 'failed' || analysis?.status === 'cancelled') && <button className="primary-button" type="button" disabled={consentBusy} onClick={() => void inspectOutgoing()}>Review outgoing data again</button>}
        {analysis?.status === 'complete' && analysis.analysis && <div className="analysis-ready"><section className="posting-analysis" aria-label="Posting analysis">{workingTextDiffersFromSource && <p className="posting-scope-note" role="status">{sourceScopeNote}</p>}<header><span className="analysis-ready-label"><CheckCircle2 size={16} aria-hidden="true" /> Posting analysis ready</span><h2>What this role calls for</h2></header><section><h3>Required qualifications</h3><ul>{analysis.analysis.required.map(item => <li key={item}>{item}</li>)}</ul>{!analysis.analysis.required.length && <p>No required qualifications were explicitly listed.</p>}</section><section><h3>Preferred qualifications</h3><ul>{analysis.analysis.preferred.map(item => <li key={item}>{item}</li>)}</ul>{!analysis.analysis.preferred.length && <p>No preferred qualifications were explicitly listed.</p>}</section><section><h3>Tools and responsibilities</h3><div className="analysis-keywords">{analysis.analysis.tools.map(item => <span key={item}>{item}</span>)}</div><ul>{analysis.analysis.responsibilities.map(item => <li key={item}>{item}</li>)}</ul></section><section><h3>Keywords</h3><div className="analysis-keywords">{analysis.analysis.keywords.map(item => <span key={item}>{item}</span>)}</div></section></section><aside className="generate-ready"><Sparkles aria-hidden="true" /><h2>Make it your CV</h2><p>Bring this role’s language into your saved experience and projects, without changing what you did.</p><ul><li>Keep original job titles and organizations</li><li>Tailor experience and project descriptions</li><li>New skills clearly flagged for your decision</li></ul><label>Page target<select aria-label="Page target" value={pageTarget} onChange={event => setPageTarget(Number(event.target.value) as 1 | 2)}><option value={1}>One page</option><option value={2}>Two pages</option></select></label>{!hasGenerationFacts && <p role="status">Your profile has no saved career facts. Add experience, projects, skills or education in My profile, or restore your workspace backup in Settings. Then inspect outgoing data again.</p>}<button className="primary-button" type="button" disabled={consentBusy || draftBusy || !hasGenerationFacts} onClick={() => void generateDraft()}>Generate tailored draft</button>{draft && activeJob && draft.targetPostingUpdatedAt !== activeJob.updatedAt && <div className="renew-review-choice"><p>Your existing CV wording is unchanged and still targets the earlier posting. Review it against this assessment, or choose to generate a new draft.</p><button type="button" className="secondary-button" disabled={draftBusy} onClick={async () => { if (await renewDraftReview()) setReviewAcknowledged(false) }}>{draftBusy ? 'Preparing review…' : 'Review existing CV against this posting'}</button></div>}<p>Review the extracted requirements before you continue. Posting-only skills will need your confirmation.</p></aside></div>}
        <button className="secondary-button revoke-run" type="button" disabled={consentBusy} onClick={() => void cancelOutgoing()}>Revoke this run</button>
        </>}
        {draftError && !(analysis?.status === 'failed' && draftError === (analysis.error ?? analysis.progress)) && <p className="inspector-error" role="alert">{draftError}</p>}
        </>}
      </>}
      {consentError && <p className="inspector-error" role="alert">{consentError}</p>}
      </ReviewBody>; })()}
    </section>}

    {activePhase >= 4 && <ApplicationDocumentSelector selected={props.selectedDocument} onSelect={props.selectDocument} cvStatus={draft?.approved && activeJob && draft.targetPostingUpdatedAt === activeJob.updatedAt ? 'Approved' : draft ? 'Ready to review' : 'Not available'} coverLetterStatus={props.letterStatus} />}
    {activePhase >= 4 && props.selectedDocument === 'cover-letter' && <section className="review-stage" aria-label="Tailoring workflow">{props.letterWorkspace}</section>}
    {activePhase >= 4 && props.selectedDocument === 'cv' && draft && <section className={activePhase === 4 ? 'review-stage' : undefined} aria-label="Tailoring workflow"><section aria-label={activePhase === 4 ? 'CV review' : undefined}>
      {activePhase === 4 && workingTextDiffersFromSource && <p className="posting-scope-note" role="status">{sourceScopeNote}</p>}
      {activePhase === 4 && activeJob && draft.targetPostingUpdatedAt !== activeJob.updatedAt && <section className="stale-target-notice" role="status" aria-label="Earlier posting review"><h2>This CV targets an earlier posting</h2><p>Your approved wording and review history are preserved, but this approval does not cover the accepted posting revision. Review the current posting assessment before reusing this wording; generating a new draft is optional.</p><button type="button" className="primary-button" disabled={consentBusy} onClick={() => void inspectOutgoing()}>{consentBusy ? 'Preparing…' : 'Review outgoing data for current posting'}</button></section>}
      {activePhase === 4 && <ReviewActionBar feedback={reviewHasError ? draftError : ''} draft={draft} targetCurrent={Boolean(activeJob && draft.targetPostingUpdatedAt === activeJob.updatedAt)} fit={fitReport} fitBusy={fitBusy} busy={draftBusy} acknowledged={reviewAcknowledged} setAcknowledged={setReviewAcknowledged} onMeasure={measurePageFit} onApprove={approveCurrentDraft} onOpenDetails={openDetails} detailsOpen={inspectorOpen} acceptedCuts={acceptedCuts} setAcceptedCuts={setAcceptedCuts} onApplyCuts={applyPageCuts} />}
      <div className={`workbench-columns${activePhase === 4 ? ` review-columns${inspectorOpen ? '' : ' review-columns--focused'}` : ''}`}>
      <section className="document-area" aria-label="CV document">
        <div className="document-toolbar"><div className="document-toolbar-title"><FileText size={17} aria-hidden="true" /><strong>Tailored CV</strong><span className="document-stage">{activeJob && draft.targetPostingUpdatedAt !== activeJob.updatedAt ? 'Earlier posting' : draft.approved && draft.checkReport?.passed && fitReport && !fitReport.overflow ? 'Approved' : pendingSkills ? 'Skills to review' : draft.status === 'blocked' ? 'Needs changes' : 'Ready to review'}</span>{activePhase === 4 && <>{draft.cvTitle && <button className="review-title-toolbar-button" type="button" disabled={draftBusy || fitBusy} onClick={() => setTitleEditing(true)}>Edit CV title</button>}<button className="review-title-toolbar-button" type="button" disabled={consentBusy || draftBusy} onClick={() => void inspectOutgoing()}>Create another CV</button><span className="review-hint">Select wording to see its sources</span></>}</div><span className="page-target-control">{draft.pageTarget}-page target</span></div>
        <div className="paper-wrap">{activePhase === 5 && activeJob && canonical ? <PdfPreview key={activeJob.id} jobId={activeJob.id} canonical={canonical} /> : canonical ? <><p className="review-layout-note">Review layout · spacing and pagination may differ from the compiled PDF.</p><DraftDocument document={canonical} approved={draft.approved && Boolean(activeJob && draft.targetPostingUpdatedAt === activeJob.updatedAt)} suggestedSkills={draft.suggestedSkills} recordBusy={draftBusy || fitBusy} onAddRecord={activePhase === 4 ? section => editRecord(section, 'add') : undefined} selectedId={activePhase === 4 ? selectedId : undefined} inlineEvidence={activePhase === 4 ? inlineEvidence : null} onDismissEvidence={() => { if (inlineEvidenceKey) setDismissedEvidenceId(inlineEvidenceKey); window.requestAnimationFrame(() => selectedId && document.getElementById(`cv-review-${selectedId}`)?.focus({ preventScroll: true })) }} onSelectEntry={activePhase === 4 ? id => { lastReviewSelectionRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; const match = /^(education|experience|projects|skills|certificates)-(\d+)$/.exec(id); if (match) { setSelectedItem({ section: match[1] as Section, index: Number(match[2]) }); setSpecialSelection(null) } else { setSpecialSelection(id) }; setDismissedEvidenceId(null); setEditing(false); setContextView('sources'); if ((document.querySelector('.review-stage')?.getBoundingClientRect().width ?? 0) >= 1080) setInspectorOpen(true) } : undefined} /></> : <p className="document-loading" role="status">Loading tailored CV…</p>}</div>
        {activePhase === 5 && <section className="page-fit-controls" aria-label="Actual PDF page fit"><p>Check that this CV fits the page length you chose.</p><button type="button" className="secondary-button" disabled={fitBusy} onClick={() => void measurePageFit()}>{fitBusy ? 'Measuring…' : 'Check page length'}</button>{fitReport && <div role="status">Your CV uses {fitReport.actualPages} of {fitReport.targetPages} page{fitReport.targetPages === 1 ? '' : 's'}. {fitReport.overflow ? 'It is too long. Choose which suggested content to remove before approval.' : 'Fits the selected target.'}{fitReport.overflow && fitReport.proposedCuts.map(cut => <label key={cut.entryId}><input type="checkbox" checked={acceptedCuts.includes(cut.entryId)} onChange={event => setAcceptedCuts(value => event.target.checked ? [...value, cut.entryId] : value.filter(id => id !== cut.entryId))} />Proposed cut: {cut.section} — {cut.label}</label>)}{fitReport.overflow && <button type="button" className="primary-button" disabled={!acceptedCuts.length} onClick={() => void applyPageCuts()}>Apply selected cuts</button>}</div>}</section>}
      </section>
      <aside className={`inspector${activePhase === 4 ? ' review-context' : ''}`} aria-label="Run review">
        <ReviewContextPanel view={contextView} reveal={detailsReveal} embedded={activePhase === 5} open={activePhase === 4 && inspectorOpen} onOpenChange={setInspectorOpen}>
        {activePhase === 4 && <nav className="review-detail-nav" aria-label="Review detail categories"><button type="button" aria-pressed={contextView === 'sources'} onClick={() => setContextView('sources')}><BookOpen size={18} aria-hidden="true" /><span>Sources</span></button><button type="button" aria-pressed={contextView === 'skills'} onClick={() => setContextView('skills')}><ListChecks size={18} aria-hidden="true" /><span>New skills</span>{pendingSkills > 0 && <span className="review-nav-count">{pendingSkills}</span>}</button><button type="button" aria-pressed={contextView === 'match'} onClick={() => setContextView('match')}><BriefcaseBusiness size={18} aria-hidden="true" /><span>Job match</span></button></nav>}
        <div hidden={contextView !== 'skills' || activePhase !== 4}>
        {activePhase === 4 && <SuggestedSkillReview draft={draft} busy={draftBusy} onDecision={async (id, decision) => { await decideSuggestedSkill(id, decision); setSpecialSelection(null) }} />}{!draft.suggestedSkills?.length && <p className="review-panel-empty">No new skills need a decision. You can still add or edit skills in your CV.</p>}</div>
        <div hidden={contextView !== 'sources'}>{activePhase === 4 && (specialSelection ? <TailoringInspector key={`${draft.id}-${specialSelection}`} selection={specialSelection} draft={draft} headingRef={reviewHeadingRef} onReturn={() => { setInspectorOpen(false); window.requestAnimationFrame(() => lastReviewSelectionRef.current?.isConnected && lastReviewSelectionRef.current.focus()) }} /> : <SelectedReview selection={activeSelection} item={selectedDraftItem} entry={selectedEntry} sources={selectedSources} draft={draft} headingRef={reviewHeadingRef} onReturnToDocument={() => { setInspectorOpen(false); if (selectedId) window.requestAnimationFrame(() => document.getElementById(`cv-review-${selectedId}`)?.focus()) }} editing={editing} setEditing={setEditing} onEditRecord={(section, index) => { if (section !== 'certificates') editRecord(section, 'update', index) }} onRemoveRecord={(section, index) => { if (section !== 'certificates') editRecord(section, 'remove', index) }} onSave={(section, index, text) => correctDraft(section, index, text)} busy={draftBusy} />)}</div>
        {activePhase === 4 && <div hidden={contextView !== 'match'}><JobMatchReview draft={draft} sources={sources} job={activeJob} /></div>}
        {activePhase === 5 && <section className="draft-inspector" aria-label="CV review"><h2>Ready to export</h2><p>You approved this CV. Choose PDF or an editable Word document.</p>
          <p>The compiled PDF is the authoritative export preview. Word documents remain editable and may reflow.</p><button className="secondary-button" type="button" onClick={returnToReview}>Back to review</button>
          {draft.approved && <div className="export-actions"><button type="button" className="primary-button" disabled={exportBusy || docxBusy || !fitReport || fitReport.overflow} onClick={async () => { if (!activeJob) return; setExportBusy(true); setExportMessage(''); try { setExportMessage((await api.exportApprovedPdf(activeJob.id)).message) } catch { setExportMessage('PDF export failed. Check the destination and try again.') } finally { setExportBusy(false) } }}>{exportBusy ? 'Exporting…' : 'Export approved PDF'}</button><button type="button" className="secondary-button" disabled={exportBusy || docxBusy || !fitReport || fitReport.overflow} onClick={() => void exportDocx()}>{docxBusy ? 'Preparing editable Word…' : 'Export editable Word document'}</button><p role="status" aria-live="polite">{exportMessage || 'Files are checked locally; no ATS service or model request is used. Word may reflow differently from PDF.'}</p></div>}

          {activePhase === 5 && draftError && <p className={`review-feedback${reviewHasError ? ' is-error' : ''}`} role={reviewHasError ? 'alert' : 'status'}>{draftError}</p>}
          <button type="button" className="secondary-button new-run-button" disabled={consentBusy || draftBusy} onClick={() => void inspectOutgoing()}>{consentBusy ? 'Preparing…' : 'Create another CV'}</button>
          {consentError && <p className="inspector-error" role="alert">{consentError}</p>}
        </section>}
        </ReviewContextPanel>
      </aside>
      </div>
    </section></section>}
    {activePhase === 4 && props.selectedDocument === 'cv' && titleEditing && draft?.cvTitle && <CvTitleEditor key={draft.id} title={draft.cvTitle.text} onClose={() => setTitleEditing(false)} onChange={changeCvTitle} />}
    {recordEditor && activeJob && <DraftRecordEditor key={`${recordEditor.draftId}-${recordEditor.section}-${recordEditor.operation}-${recordEditor.record?.index ?? 'new'}`} target={recordEditor} onClose={() => setRecordEditor(null)} onSave={async (scope, value) => {
      const result = await props.mutateRecord({ draftId: recordEditor.draftId, sourceRevision: recordEditor.revision, section: recordEditor.section, operation: recordEditor.operation, scope, ...(recordEditor.record ? { index: recordEditor.record.index } : {}), ...(value === undefined ? {} : { value }) })
      if (result.ok && result.draft) {
        const length = result.draft.content[recordEditor.section].length
        const index = result.recordIndex ?? Math.min(recordEditor.record?.index ?? 0, length - 1)
        setSelectedItem(length ? { section: recordEditor.section, index } : null); setSpecialSelection(null); setEditing(false); setContextView('sources')
        if (window.innerWidth < 1200) setInspectorOpen(false)
      }
      return result
    }} />}
  </div>
}
