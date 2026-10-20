import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { JobRecord } from '../shared/jobs'
import type { OutboundPayload } from '../shared/outbound-consent'
import type { OutboundConsentPreview } from '../shared/outbound-consent-contract'
import type { CanonicalDocument, DocumentFitReport } from '../shared/document'
import { WorkbenchStageLayout, type WorkbenchSources } from './WorkbenchStageLayout'
import './workbench-start.css'

type LocalSources = WorkbenchSources

export function WorkbenchStart({ activeJob, onNavigate }: { activeJob: JobRecord | null; onNavigate: (page: 'Saved jobs') => void }) {
  const [sources, setSources] = useState<LocalSources | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [review, setReview] = useState<Extract<OutboundConsentPreview, { ok: true }> | null>(null)
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [newRun, setNewRun] = useState(false)
  const [termsAcknowledged, setTermsAcknowledged] = useState(false)
  const [consentError, setConsentError] = useState('')
  const [consentBusy, setConsentBusy] = useState(false)
  const [analysis, setAnalysis] = useState<Awaited<ReturnType<typeof window.workbench.getAnalysis>>>(null)
  const [recovery, setRecovery] = useState<Awaited<ReturnType<typeof window.workbench.getGenerationRecovery>>>(null)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [draft, setDraft] = useState<Awaited<ReturnType<typeof window.workbench.getDraft>>>(null)
  const [canonical, setCanonical] = useState<CanonicalDocument | null>(null)
  const [fitReport, setFitReport] = useState<DocumentFitReport | null>(null)
  const [fitBusy, setFitBusy] = useState(false)
  const [acceptedCuts, setAcceptedCuts] = useState<string[]>([])
  const [draftBusy, setDraftBusy] = useState(false)
  const [draftError, setDraftError] = useState('')
  const [addSection, setAddSection] = useState<'education' | 'experience' | 'projects' | 'skills' | 'certificates'>('experience')
  const [addEvidence, setAddEvidence] = useState('')
  const [pageTarget, setPageTarget] = useState<1 | 2>(1)
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof window.workbench.getAnalysisUsage>> | null>(null)
  const pendingToken = useRef<string | null>(null)
  const selectedJob = useRef(activeJob?.id)
  selectedJob.current = activeJob?.id
  useEffect(() => {
    setReview(null); setConsentAccepted(false); setNewRun(false); setTermsAcknowledged(false); setConsentError(''); setDraft(null); setCanonical(null); setFitReport(null); setAcceptedCuts([]); setDraftError(''); setDraftBusy(false)
    if (activeJob) {
      void window.workbench.getDraft(activeJob.id).then(async value => { setDraft(value); if (value) { setCanonical(await window.workbench.getCanonicalDocument(activeJob.id)); setFitReport(await window.workbench.getDocumentFitReport(activeJob.id)) } }).catch(() => setDraftError('Saved draft could not be opened offline.'))
      void window.workbench.getAnalysis(activeJob.id).then(value => { if (value) setAnalysis(value) }).catch(() => {})
      void window.workbench.getGenerationRecovery(activeJob.id).then(setRecovery).catch(() => setDraftError('Saved run recovery state could not be read.'))
    } else { setAnalysis(null); setRecovery(null) }
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
      if (pendingToken.current) {
        const cancelled = await window.workbench.cancelOutboundConsent(pendingToken.current)
        if (!cancelled.ok) { setConsentError(cancelled.message); return }
        pendingToken.current = null
      }
      const result = await window.workbench.prepareOutboundConsent(activeJob.id)
      if (selectedJob.current !== activeJob.id) {
        if (result.ok) void window.workbench.cancelOutboundConsent(result.token)
        return
      }
      if (!result.ok) { setConsentError(result.message); return }
      pendingToken.current = result.token
      setTermsAcknowledged(false); setConsentAccepted(false); setReview(result); setNewRun(true)
    } catch { setConsentError('Outgoing data could not be prepared. Try again.') }
    finally { setConsentBusy(false) }
  }
  async function resumeSavedGeneration(retryUncertain: boolean) {
    if (!recovery || recoveryBusy) return
    setRecoveryBusy(true); setDraftError('')
    try {
      const result = await window.workbench.resumeGeneration(recovery.runId, retryUncertain ? 'retry-uncertain' : 'resume')
      if (!result.ok) { setDraftError(result.message); return }
      const [savedDraft, latestAnalysis, latestRecovery] = await Promise.all([window.workbench.getDraft(recovery.jobId), window.workbench.getAnalysis(recovery.jobId), window.workbench.getGenerationRecovery(recovery.jobId)])
      if (selectedJob.current !== recovery.jobId) return
      setDraft(savedDraft); setAnalysis(latestAnalysis); setRecovery(latestRecovery)
      if (savedDraft) { setCanonical(await window.workbench.getCanonicalDocument(recovery.jobId)); setFitReport(await window.workbench.getDocumentFitReport(recovery.jobId)) }
      setDraftError(result.message)
    } catch (failure) { setDraftError(failure instanceof Error ? failure.message : 'Saved generation could not resume. No automatic request was sent.') }
    finally { setRecoveryBusy(false) }
  }
  async function cancelSavedGeneration() {
    if (!recovery || recoveryBusy) return
    setRecoveryBusy(true)
    try { const result = await window.workbench.cancelGenerationRecovery(recovery.runId); setRecovery(null); setDraftError(result.message) }
    catch { setDraftError('Saved generation could not be cancelled. Try again.') }
    finally { setRecoveryBusy(false) }
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
      if (result.ok && result.draft && result.draft.jobId === jobId) { setDraft(result.draft); setCanonical(await window.workbench.getCanonicalDocument(jobId)); setFitReport(null); setNewRun(false) }
      else if (!result.ok) setDraftError(result.message)
      const latest = await window.workbench.getAnalysis(jobId)
      if (latest && selectedJob.current === jobId) setAnalysis(latest)
      if (selectedJob.current === jobId) setUsage(await window.workbench.getAnalysisUsage())
    } catch (failure) { if (selectedJob.current === jobId) setDraftError(failure instanceof Error ? failure.message : 'Draft generation failed.') }
    finally { if (selectedJob.current === jobId) setDraftBusy(false) }
  }
  async function addDraftItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || !activeJob) return
    const selected = draft.evidence.find(item => item.evidenceId === addEvidence)
    if (!selected) { setDraftError('Choose a saved evidence revision first.'); return }
    setDraftBusy(true)
    try {
      const text = new FormData(event.currentTarget).get('local-correction')
      if (typeof text !== 'string') return
      const updated = await window.workbench.addDraftItem({ jobId: activeJob.id, section: addSection, text, citation: { evidenceId: selected.evidenceId, revision: selected.revision } })
      if (!updated) { setDraftError('That evidence is not a current selected source for this section. Refresh the draft before trying again.'); return }
      setDraft(updated); setDraftError('')
    } catch { setDraftError('Local correction could not be saved. Try again.') } finally { setDraftBusy(false) }
  }

  async function checkDraftNow() {
    if (!activeJob) return
    const report = await window.workbench.checkDraft(activeJob.id)
    setDraft(await window.workbench.getDraft(activeJob.id))
    setDraftError(report?.passed ? 'Current factual checks passed. Human review is still required.' : `Review blocked: ${report?.findings.length ?? 0} unresolved finding(s).`)
  }
  async function approveCurrentDraft() {
    if (!activeJob) return
    const result = await window.workbench.approveDraft(activeJob.id)
    if (result.draft) setDraft(result.draft)
    setDraftError(result.message)
  }
  async function correctDraft(section: 'education' | 'experience' | 'projects' | 'skills' | 'certificates', index: number, text: string, editIntent: 'wording-only' | 'new-fact' = 'wording-only') {
    if (!activeJob || !draft) return
    setDraftBusy(true)
    try {
      const corrected = await window.workbench.correctDraft({ jobId: activeJob.id, section, index, text, editIntent, ...(editIntent === 'new-fact' ? { evidence: draft.content[section][index]?.citations } : {}) })
      if (corrected && selectedJob.current === activeJob.id) setDraft(corrected)
    } catch { setDraftError('Correction could not be saved. The original blocked draft was retained.') }
    finally { setDraftBusy(false) }
  }
  async function measurePageFit() {
    if (!activeJob || fitBusy) return
    setFitBusy(true); setDraftError(''); setAcceptedCuts([])
    try { const report = await window.workbench.measureDocument(activeJob.id); setFitReport(report) }
    catch (failure) { setDraftError(failure instanceof Error ? failure.message : 'The real PDF page measurement failed.') }
    finally { setFitBusy(false) }
  }
  async function applyPageCuts() {
    if (!activeJob || !fitReport || !acceptedCuts.length) return
    try {
      const result = await window.workbench.acceptDocumentCuts(activeJob.id, fitReport.documentHash, acceptedCuts)
      if (!result.ok) { setDraftError(result.message); return }
      const revised = await window.workbench.getDraft(activeJob.id)
      setDraft(revised); setCanonical(await window.workbench.getCanonicalDocument(activeJob.id)); setAcceptedCuts([])
      setFitReport(await window.workbench.measureDocument(activeJob.id))
    } catch (failure) { setDraftError(failure instanceof Error ? failure.message : 'Accepted cuts could not be applied.') }
  }
  async function cancelOutgoing() {
    const token = pendingToken.current
    if (!token || consentBusy) return
    setConsentBusy(true); setConsentError('')
    try {
      const result = await window.workbench.cancelOutboundConsent(token)
      if (!result.ok) { setConsentError(result.message); return }
      pendingToken.current = null
      setReview(null); setConsentAccepted(false); setNewRun(false); setTermsAcknowledged(false)
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

  const outgoing = review?.outgoing as unknown as OutboundPayload | undefined
  const outgoingProfileCounts = outgoing ? [
    { label: 'Experience and training', count: outgoing.profile.experience.length, unit: 'record' },
    { label: 'Projects', count: outgoing.profile.projects.length, unit: 'record' },
    { label: 'Skills', count: outgoing.profile.skills.length, unit: 'skill' },
    { label: 'Education', count: outgoing.profile.education.length, unit: 'record' },
    { label: 'Certificates', count: outgoing.profile.certificates.length, unit: 'record' }
  ].filter(item => item.count > 0) : []
  const activePhase: 1 | 2 | 3 | 4 = newRun && review ? consentAccepted ? 3 : 2 : draft ? 4 : consentAccepted ? 3 : review ? 2 : 1
  return <WorkbenchStageLayout
    activeJob={activeJob} onNavigate={page => onNavigate(page)} error={error} retry={() => setAttempt(value => value + 1)} activePhase={activePhase}
    review={review} consentAccepted={consentAccepted} termsAcknowledged={termsAcknowledged} setTermsAcknowledged={setTermsAcknowledged} consentError={consentError} consentBusy={consentBusy}
    analysis={analysis} recovery={recovery} recoveryBusy={recoveryBusy} resumeSavedGeneration={resumeSavedGeneration} cancelSavedGeneration={cancelSavedGeneration} draft={draft} canonical={canonical} fitReport={fitReport} fitBusy={fitBusy} acceptedCuts={acceptedCuts} setAcceptedCuts={setAcceptedCuts} draftBusy={draftBusy} draftError={draftError}
    pageTarget={pageTarget} setPageTarget={setPageTarget} usage={usage} addSection={addSection} setAddSection={setAddSection} addEvidence={addEvidence} setAddEvidence={setAddEvidence} sources={sources} outgoingProfileCounts={outgoingProfileCounts}
    inspectOutgoing={inspectOutgoing} cancelOutgoing={cancelOutgoing} authorizeOutgoing={authorizeOutgoing} startAnalysis={startAnalysis} generateDraft={generateDraft} cancelAnalysis={async () => { if (activeJob) setAnalysis(await window.workbench.cancelAnalysis(activeJob.id)) }}
    measurePageFit={measurePageFit} applyPageCuts={applyPageCuts} addDraftItem={addDraftItem} correctDraft={correctDraft} checkDraftNow={checkDraftNow} approveCurrentDraft={approveCurrentDraft}
  />
}
