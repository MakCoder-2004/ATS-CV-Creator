import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { JobRecord } from '../shared/jobs'
import type { MutateDraftRecordInput, MutateDraftRecordResult } from '../shared/draft-records'
import type { OutboundPayload } from '../shared/outbound-consent'
import type { OutboundConsentPreview } from '../shared/outbound-consent-contract'
import type { CanonicalDocument, DocumentFitReport } from '../shared/document'
import { WorkbenchStageLayout, type WorkbenchSources } from './WorkbenchStageLayout'
import './workbench-start.css'
import './cv-flow.css'
import './review-workspace.css'
import './draft-record-editor.css'

type LocalSources = WorkbenchSources
const readableFailure = (failure: unknown, fallback: string) => failure instanceof Error ? failure.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : fallback

export function WorkbenchStart({ activeJob, onNavigate }: { activeJob: JobRecord | null; onNavigate: (page: 'Saved jobs' | 'Settings') => void }) {
  const [sources, setSources] = useState<LocalSources | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [review, setReview] = useState<Extract<OutboundConsentPreview, { ok: true }> | null>(null)
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [reviewApprovedDraft, setReviewApprovedDraft] = useState(false)
  const [authorizedRunId, setAuthorizedRunId] = useState<string | null>(null)
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
  const [docxBusy, setDocxBusy] = useState(false)
  const [acceptedCuts, setAcceptedCuts] = useState<string[]>([])
  const [draftBusy, setDraftBusy] = useState(false)
  const [draftError, setDraftError] = useState('')
  const [addSection, setAddSection] = useState<'education' | 'experience' | 'projects' | 'skills' | 'certificates'>('experience')
  const [addEvidence, setAddEvidence] = useState('')
  const [pageTarget, setPageTarget] = useState<1 | 2>(1)
  const pendingToken = useRef<string | null>(null)
  const selectedJob = useRef(activeJob?.id)
  selectedJob.current = activeJob?.id
  useEffect(() => {
    setAnalysis(null); setRecovery(null); setReviewApprovedDraft(false)
    setReview(null); setConsentAccepted(false); setAuthorizedRunId(null); setNewRun(false); setTermsAcknowledged(false); setConsentError(''); setDraft(null); setCanonical(null); setFitReport(null); setAcceptedCuts([]); setDraftError(''); setDraftBusy(false)
    if (activeJob) {
      const jobId = activeJob.id
      void window.workbench.getDraft(jobId).then(async value => {
        if (selectedJob.current !== jobId || !value) return
        await window.workbench.checkDraft(jobId)
        const [current, document, fit] = await Promise.all([window.workbench.getDraft(jobId), window.workbench.getCanonicalDocument(jobId), window.workbench.getDocumentFitReport(jobId)])
        if (selectedJob.current !== jobId) return
        setDraft(current ?? value); setPageTarget(value.pageTarget); setCanonical(document); setFitReport(value.targetPostingUpdatedAt === activeJob.updatedAt ? fit : null)
      }).catch(() => { if (selectedJob.current === jobId) setDraftError('Saved draft could not be opened offline.') })
      void window.workbench.getAnalysis(jobId).then(value => { if (selectedJob.current === jobId) setAnalysis(value) }).catch(() => {})
      void window.workbench.getGenerationRecovery(jobId).then(value => { if (selectedJob.current === jobId) setRecovery(value) }).catch(() => { if (selectedJob.current === jobId) setDraftError('Saved run recovery state could not be read.') })
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
      setTermsAcknowledged(false); setConsentAccepted(false); setAuthorizedRunId(null); setAnalysis(null); setReview(result); setNewRun(true)
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
  async function analyzeAuthorizedRun(token: string, runId: string | undefined, jobId: string) {
    setAnalysis({ jobId, runId, status: 'running', analysis: null, progress: 'Analyzing the authorized posting…', attempts: 0, cacheHit: false, generationStep: 'parse-posting', completedSteps: [] })
    try {
      const result = await window.workbench.startAnalysis(token)
      if (selectedJob.current !== jobId || pendingToken.current !== token) return
      setAnalysis(result)
    } catch (failure) {
      if (selectedJob.current !== jobId || pendingToken.current !== token) return
      setAnalysis(null); setConsentError(readableFailure(failure, 'Analysis could not start. Check Settings and try again.'))
    }
  }
  async function startAnalysis() {
    const token = pendingToken.current, jobId = activeJob?.id
    if (!token || !jobId || consentBusy || !consentAccepted) return
    setConsentBusy(true); setConsentError('')
    try { await analyzeAuthorizedRun(token, authorizedRunId ?? undefined, jobId) }
    finally { if (selectedJob.current === jobId) setConsentBusy(false) }
  }
  async function generateDraft() {
    const token = pendingToken.current, jobId = activeJob?.id
    if (!token || !consentAccepted || draftBusy || !jobId) return
    setDraftBusy(true); setDraftError('')
    setAnalysis({ jobId, runId: authorizedRunId ?? undefined, status: 'running', analysis: analysis?.analysis ?? null, progress: 'Finding the most relevant career facts…', attempts: analysis?.attempts ?? 0, cacheHit: false, generationStep: 'score-evidence', completedSteps: ['parse-posting'] })
    try {
      const result = await window.workbench.generateDraft(token, pageTarget)
      if (selectedJob.current !== jobId) return
      if (result.ok && result.draft && result.draft.jobId === jobId) {
        const document = await window.workbench.getCanonicalDocument(jobId)
        if (selectedJob.current !== jobId) return
        setDraft(result.draft); setCanonical(document); setFitReport(null); setReviewApprovedDraft(false); setFitBusy(true)
        try {
          const fit = await window.workbench.measureDocument(jobId)
          if (selectedJob.current === jobId) setFitReport(fit)
        } catch { if (selectedJob.current === jobId) setDraftError('Your draft is saved, but page length could not be checked. Retry Check page length before approval.') }
        finally { if (selectedJob.current === jobId) { setFitBusy(false); setNewRun(false) } }
      }
      else if (!result.ok) setDraftError(result.message)
      const latest = await window.workbench.getAnalysis(jobId)
      if (latest && selectedJob.current === jobId) setAnalysis(latest)
    } catch (failure) { if (selectedJob.current === jobId) setDraftError(failure instanceof Error ? failure.message : 'Draft generation failed.') }
    finally { if (selectedJob.current === jobId) setDraftBusy(false) }
  }
  async function renewDraftReview() {
    if (!activeJob || draftBusy) return false
    const jobId = activeJob.id
    setDraftBusy(true); setDraftError('')
    try {
      const result = await window.workbench.renewDraftReview(jobId)
      if (selectedJob.current !== jobId) return false
      if (!result.ok || !result.draft) { setDraftError(result.message); return false }
      const [document, latestAnalysis] = await Promise.all([window.workbench.getCanonicalDocument(jobId), window.workbench.getAnalysis(jobId)])
      if (selectedJob.current !== jobId) return false
      setDraft(result.draft); setCanonical(document); setFitReport(null); setAcceptedCuts([]); setAnalysis(latestAnalysis); setNewRun(false); setReviewApprovedDraft(true)
      setDraftError('Existing CV wording is now bound to this posting. Review the document, run current checks and measure page length before approving.')
      return true
    } catch (failure) { if (selectedJob.current === jobId) setDraftError(failure instanceof Error ? failure.message : 'CV review could not be renewed.'); return false }
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
      setDraft(updated); setCanonical(await window.workbench.getCanonicalDocument(activeJob.id)); setFitReport(null); setDraftError('Wording saved. Check your CV and page length again before approval.')
    } catch { setDraftError('Local correction could not be saved. Try again.') } finally { setDraftBusy(false) }
  }

  async function mutateRecord(input: Omit<MutateDraftRecordInput, 'jobId'>): Promise<MutateDraftRecordResult> {
    if (!activeJob || draftBusy || fitBusy) return { ok: false, message: 'Wait for the current operation before saving this record.' }
    const jobId = activeJob.id
    setDraftBusy(true); setDraftError('')
    try {
      const result = await window.workbench.mutateDraftRecord({ ...input, jobId })
      if (!result.ok || !result.draft || selectedJob.current !== jobId) return result
      const [current, document, profile, evidence] = await Promise.all([window.workbench.getDraft(jobId), window.workbench.getCanonicalDocument(jobId), window.workbench.getProfile(), window.workbench.getExperience()])
      if (selectedJob.current !== jobId) return result
      setDraft(current ?? result.draft); setCanonical(document); setSources({ profile, evidence }); setFitReport(null); setAcceptedCuts([]); setReviewApprovedDraft(true); setDraftError(result.message)
      return { ...result, draft: current ?? result.draft }
    } catch (failure) { return { ok: false, message: readableFailure(failure, 'The record could not be saved. Your original CV is unchanged.') } }
    finally { if (selectedJob.current === jobId) setDraftBusy(false) }
  }

  async function checkDraftNow() {
    if (!activeJob) return
    const report = await window.workbench.checkDraft(activeJob.id)
    setDraft(await window.workbench.getDraft(activeJob.id))
    setDraftError(report?.passed ? 'Automated checks found no blocking issues. Review the wording and its sources before approving.' : `${report?.findings.length ?? 0} issue${report?.findings.length === 1 ? '' : 's'} need attention. Choose Review issues to open the correction guidance.`)
  }
  async function exportDocx() {
    if (!activeJob || docxBusy) return
    setDocxBusy(true); setDraftError('')
    try {
      const result = await window.workbench.exportDraftDocx(activeJob.id)
      setDraftError(result.message)
      if (!result.ok && !result.cancelled) { const latest = await window.workbench.getDraft(activeJob.id); if (latest) setDraft(latest) }
    } catch (failure) { setDraftError(failure instanceof Error ? failure.message : 'Editable DOCX export failed.') }
    finally { setDocxBusy(false) }
  }
  async function approveCurrentDraft() {
    if (!activeJob || draftBusy) return
    const jobId = activeJob.id
    setDraftBusy(true)
    try {
      const result = await window.workbench.approveDraft(jobId)
      if (selectedJob.current !== jobId) return
      if (result.draft) setDraft(result.draft)
      if (result.ok) setReviewApprovedDraft(false)
      setDraftError(result.ok ? 'Your CV is approved. You can export it now.' : result.message)
    } catch { if (selectedJob.current === jobId) setDraftError('Approval could not be saved. Review your CV and try again.') }
    finally { if (selectedJob.current === jobId) setDraftBusy(false) }
  }
  async function decideSuggestedSkill(skillId: string, decision: 'pending' | 'confirmed' | 'removed') {
    if (!activeJob || !draft || draftBusy) return
    const jobId = activeJob.id
    setDraftBusy(true); setDraftError('')
    try {
      const result = await window.workbench.decideSuggestedSkill({ jobId, draftId: draft.id, skillId, decision })
      if (selectedJob.current !== jobId) return
      if (!result.ok || !result.draft) { setDraftError(result.message); return }
      const document = await window.workbench.getCanonicalDocument(jobId)
      if (selectedJob.current !== jobId) return
      setDraft(result.draft); setCanonical(document); setFitReport(null); setAcceptedCuts([]); setReviewApprovedDraft(true)
      setDraftError('Skill decision saved for this CV only. Check the updated wording and page length before approval.')
    } catch { if (selectedJob.current === jobId) setDraftError('Your skill decision could not be saved. Try again.') }
    finally { if (selectedJob.current === jobId) setDraftBusy(false) }
  }
  async function correctDraft(section: 'education' | 'experience' | 'projects' | 'skills' | 'certificates', index: number, text: string, editIntent: 'wording-only' | 'new-fact' = 'wording-only') {
    if (!activeJob || !draft) return false
    setDraftBusy(true)
    try {
      const corrected = await window.workbench.correctDraft({ jobId: activeJob.id, section, index, text, editIntent, ...(editIntent === 'new-fact' ? { evidence: draft.content[section][index]?.citations } : {}) })
      if (!corrected || selectedJob.current !== activeJob.id) return false
      setDraft(corrected); setCanonical(await window.workbench.getCanonicalDocument(activeJob.id)); setFitReport(null); setDraftError('Wording saved. Check your CV and page length again before approval.')
      return true
    } catch { setDraftError('Wording could not be saved. Your original CV is unchanged.'); return false }
    finally { setDraftBusy(false) }
  }
  async function measurePageFit() {
    if (!activeJob || fitBusy) return
    setFitBusy(true); setDraftError(''); setAcceptedCuts([])
    const jobId = activeJob.id
    try { const report = await window.workbench.measureDocument(jobId); if (selectedJob.current === jobId) setFitReport(report) }
    catch (failure) { if (selectedJob.current === jobId) setDraftError(failure instanceof Error ? failure.message : 'The real PDF page measurement failed.') }
    finally { if (selectedJob.current === jobId) setFitBusy(false) }
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
      setReview(null); setConsentAccepted(false); setAuthorizedRunId(null); setNewRun(false); setTermsAcknowledged(false)
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
      const jobId = activeJob?.id
      if (!jobId || selectedJob.current !== jobId || pendingToken.current !== token) return
      setAuthorizedRunId(result.runId ?? null)
      setConsentAccepted(true)
      await analyzeAuthorizedRun(token, result.runId, jobId)
    } catch { setConsentError('Consent could not be saved. Review the data and try again.') }
    finally { setConsentBusy(false) }
  }
  useEffect(() => {
    if (!activeJob || analysis?.status !== 'running') return
    let mounted = true
    const poll = async () => {
      try {
        const latest = await window.workbench.getAnalysis(activeJob.id)
        if (mounted && latest) setAnalysis(latest)
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
  const draftTargetsCurrent = Boolean(draft && activeJob && draft.targetPostingUpdatedAt === activeJob.updatedAt)
  const activePhase: 1 | 2 | 3 | 4 | 5 = newRun && review ? consentAccepted ? 3 : 2 : draft?.approved && draftTargetsCurrent && draft.checkReport?.passed && fitReport && !fitReport.overflow && !reviewApprovedDraft ? 5 : draft ? 4 : consentAccepted ? 3 : review ? 2 : 1
  const displayedAnalysis = newRun && consentAccepted && analysis?.runId !== authorizedRunId ? null : analysis
  return <WorkbenchStageLayout
    activeJob={activeJob} onNavigate={page => onNavigate(page)} error={error} retry={() => setAttempt(value => value + 1)} activePhase={activePhase}
    review={review} consentAccepted={consentAccepted} termsAcknowledged={termsAcknowledged} setTermsAcknowledged={setTermsAcknowledged} consentError={consentError} consentBusy={consentBusy}
    analysis={displayedAnalysis} recovery={recovery} recoveryBusy={recoveryBusy} resumeSavedGeneration={resumeSavedGeneration} cancelSavedGeneration={cancelSavedGeneration} draft={draft} canonical={canonical} fitReport={fitReport} fitBusy={fitBusy} acceptedCuts={acceptedCuts} setAcceptedCuts={setAcceptedCuts} draftBusy={draftBusy} draftError={draftError}
    pageTarget={pageTarget} setPageTarget={setPageTarget} addSection={addSection} setAddSection={setAddSection} addEvidence={addEvidence} setAddEvidence={setAddEvidence} sources={sources} outgoingProfileCounts={outgoingProfileCounts}
    inspectOutgoing={inspectOutgoing} cancelOutgoing={cancelOutgoing} authorizeOutgoing={authorizeOutgoing} startAnalysis={startAnalysis} generateDraft={generateDraft} cancelAnalysis={async () => { if (activeJob) setAnalysis(await window.workbench.cancelAnalysis(activeJob.id)) }}
    returnToReview={() => setReviewApprovedDraft(true)} renewDraftReview={renewDraftReview} decideSuggestedSkill={decideSuggestedSkill}
    mutateRecord={mutateRecord} measurePageFit={measurePageFit} applyPageCuts={applyPageCuts} addDraftItem={addDraftItem} correctDraft={correctDraft} checkDraftNow={checkDraftNow} approveCurrentDraft={approveCurrentDraft} exportDocx={exportDocx} docxBusy={docxBusy}
    onProposalAccepted={(next, document, fit) => { setDraft(next); setCanonical(document); setFitReport(fit); setAcceptedCuts([]) }}
  />
}
