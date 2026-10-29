import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { WorkbenchAPI } from '../shared/appearance'
import type { CoverLetterReadModel } from '../shared/cover-letter-artifact'
import type { CoverLetterActionResult } from '../shared/cover-letter'
import type { ApplicationDocument } from './ApplicationDocumentSelector'
import { CoverLetterReview, type CoverLetterActionInput } from './CoverLetterReview'
import { PdfPreview } from './PdfPreview'
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

type StartProps = { activeJob: JobRecord | null; onNavigate: (page: 'Saved jobs' | 'Settings') => void }

// Advance during render, not in an effect: A → B → A is three distinct visits.
export function WorkbenchStart(props: StartProps) {
  const identity = `${props.activeJob?.id ?? 'none'}:${props.activeJob?.updatedAt ?? ''}`
  const visit = useRef({ identity, epoch: 0 })
  if (visit.current.identity !== identity) visit.current = { identity, epoch: visit.current.epoch + 1 }
  const epoch = visit.current.epoch
  return <WorkbenchVisit key={epoch} {...props} isCurrent={() => visit.current.epoch === epoch} />
}

function WorkbenchVisit({ activeJob, onNavigate, isCurrent }: StartProps & { isCurrent: () => boolean }) {
  const live = useRef(true)
  useLayoutEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const current = () => live.current && isCurrent()
  // Fence every host await, including existing CV/regeneration actions. No old visit
  // may issue a follow-up action or publish canonical data/feedback into a new visit.
  const api = useRef(new Proxy({} as WorkbenchAPI, { get(_target, property: keyof WorkbenchAPI) {
    // contextBridge freezes its object; proxy an empty facade, not frozen methods.
    const target = window.workbench
    const method = target[property] as (...args: unknown[]) => Promise<unknown>
    return async (...args: unknown[]) => {
      if (!current()) throw new Error('This posting visit has ended.')
      const result = await method.apply(target, args)
      if (!current()) {
        if ((property === 'prepareOutboundConsent' || property === 'prepareCoverLetterRetry') && result && typeof result === 'object' && 'token' in result && typeof result.token === 'string') void window.workbench.cancelOutboundConsent(result.token).catch(() => {})
        throw new Error('This posting visit has ended.')
      }
      return result
    }
  } })).current
  const [includeLetter, setIncludeLetter] = useState(false)
  const [letterOnly, setLetterOnly] = useState(false)
  const [selectedDocument, setSelectedDocument] = useState<ApplicationDocument>('cv')
  const [letterModel, setLetterModel] = useState<CoverLetterReadModel | null>(null)
  const [letterMessage, setLetterMessage] = useState('')
  const [letterBusy, setLetterBusy] = useState(false)
  const [letterOperation, setLetterOperation] = useState<'check' | 'fit' | 'export' | null>(null)
  const [letterReviewOpen, setLetterReviewOpen] = useState(false)
  const letterLoadEpoch = useRef(0)
  const cvLoadEpoch = useRef(0)
  const operationEpoch = useRef(0)
  async function loadLetter() {
    if (!activeJob) return null
    const request = ++letterLoadEpoch.current
    try {
      const model = await api.getCoverLetterReadModel(activeJob.id)
      if (current() && request === letterLoadEpoch.current) setLetterModel(model)
      return model
    } catch (failure) {
      if (current() && request === letterLoadEpoch.current) setLetterModel(null)
      throw failure
    }
  }
  const [sources, setSources] = useState<LocalSources | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [review, setReview] = useState<Extract<OutboundConsentPreview, { ok: true }> | null>(null)
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [reviewApprovedDraft, setReviewApprovedDraft] = useState(false)
  const [authorizedRunId, setAuthorizedRunId] = useState<string | null>(null)
  const [newRun, setNewRun] = useState(false)
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
    selectedJob.current = activeJob?.id
    setAnalysis(null); setRecovery(null); setReviewApprovedDraft(false)
    setReview(null); setConsentAccepted(false); setAuthorizedRunId(null); setNewRun(false); setConsentError(''); setDraft(null); setCanonical(null); setFitReport(null); setAcceptedCuts([]); setDraftError(''); setDraftBusy(false)
    if (activeJob) {
      const jobId = activeJob.id
      const request = ++cvLoadEpoch.current
      void api.getDraft(jobId).then(async value => {
        if (!current() || request !== cvLoadEpoch.current || !value) return
        await api.checkDraft(jobId)
        const [saved, document, fit] = await Promise.all([api.getDraft(jobId), api.getCanonicalDocument(jobId), api.getDocumentFitReport(jobId)])
        if (!current() || request !== cvLoadEpoch.current) return
        setDraft(saved ?? value); setPageTarget(value.pageTarget); setCanonical(document); setFitReport(value.targetPostingUpdatedAt === activeJob.updatedAt ? fit : null)
      }).catch(() => { if (selectedJob.current === jobId) setDraftError('Saved draft could not be opened offline.') })
      void api.getAnalysis(jobId).then(value => { if (current() && request === cvLoadEpoch.current) setAnalysis(value) }).catch(() => {})
      void api.getGenerationRecovery(jobId).then(value => { if (current() && request === cvLoadEpoch.current) setRecovery(value) }).catch(() => { if (current()) setDraftError('Saved run recovery state could not be read.') })
      void loadLetter().catch(() => { if (current()) setLetterMessage('Cover letter status could not be loaded. Reopen this posting to try again. Your CV remains available.') })
    } else { setAnalysis(null); setRecovery(null) }
    return () => {
      selectedJob.current = undefined
      const token = pendingToken.current
      pendingToken.current = null
      if (token) void window.workbench.cancelOutboundConsent(token).catch(() => {})
    }
  }, [activeJob?.id, activeJob?.updatedAt])

  async function inspectOutgoing(included = includeLetter, retryLetter = false) {
    if (!activeJob || consentBusy) return
    ++cvLoadEpoch.current; ++operationEpoch.current
    setConsentBusy(true); setConsentError(''); setReview(null); setConsentAccepted(false); setAuthorizedRunId(null)
    setIncludeLetter(included); setLetterOnly(retryLetter)
    try {
      if (pendingToken.current) {
        const cancelled = await api.cancelOutboundConsent(pendingToken.current)
        if (!cancelled.ok) { setConsentError(cancelled.message); return }
        pendingToken.current = null
      }
      const origin = letterModel?.generation.originCvRevisionId
      const result = retryLetter && origin ? await api.prepareCoverLetterRetry(activeJob.id, origin) : retryLetter ? { ok: false as const, message: 'A fresh full flow is required because the originating CV is unavailable.' } : await api.prepareOutboundConsent(activeJob.id, included ? 'cv+cover-letter' : 'cv')
      if (selectedJob.current !== activeJob.id) {
        if (result.ok) void api.cancelOutboundConsent(result.token)
        return
      }
      if (!result.ok) { setConsentError(result.message); return }
      pendingToken.current = result.token
      setConsentAccepted(false); setAuthorizedRunId(null); setAnalysis(null); setReview(result); setNewRun(true)
    } catch { setConsentError('Outgoing data could not be prepared. Try again.') }
    finally { setConsentBusy(false) }
  }
  async function resumeSavedGeneration(retryUncertain: boolean) {
    if (!recovery || recoveryBusy) return
    setRecoveryBusy(true); setDraftError('')
    try {
      const result = await api.resumeGeneration(recovery.runId, retryUncertain ? 'retry-uncertain' : 'resume')
      if (!result.ok) { setDraftError(result.message); return }
      const [savedDraft, latestAnalysis, latestRecovery] = await Promise.all([api.getDraft(recovery.jobId), api.getAnalysis(recovery.jobId), api.getGenerationRecovery(recovery.jobId)])
      if (selectedJob.current !== recovery.jobId) return
      setDraft(savedDraft); setAnalysis(latestAnalysis); setRecovery(latestRecovery)
      if (savedDraft) { setCanonical(await api.getCanonicalDocument(recovery.jobId)); setFitReport(await api.getDocumentFitReport(recovery.jobId)) }
      await loadLetter()
      setDraftError(result.message)
    } catch (failure) { setDraftError(failure instanceof Error ? failure.message : 'Saved generation could not resume. No automatic request was sent.') }
    finally { setRecoveryBusy(false) }
  }
  async function cancelSavedGeneration() {
    if (!recovery || recoveryBusy) return
    setRecoveryBusy(true)
    try { const result = await api.cancelGenerationRecovery(recovery.runId); setRecovery(null); setDraftError(result.message) }
    catch { setDraftError('Saved generation could not be cancelled. Try again.') }
    finally { setRecoveryBusy(false) }
  }
  async function analyzeAuthorizedRun(token: string, runId: string | undefined, jobId: string) {
    const operation = operationEpoch.current
    setAnalysis({ jobId, runId, status: 'running', analysis: null, progress: 'Analyzing the authorized posting…', attempts: 0, cacheHit: false, generationStep: 'parse-posting', completedSteps: [] })
    try {
      const result = await api.startAnalysis(token)
      if (selectedJob.current !== jobId || pendingToken.current !== token || operation !== operationEpoch.current) return
      setAnalysis(result)
    } catch (failure) {
      if (selectedJob.current !== jobId || pendingToken.current !== token || operation !== operationEpoch.current) return
      setAnalysis(null); setConsentError(readableFailure(failure, 'Analysis could not start. Check Settings and try again.'))
    }
  }
  async function startAnalysis() {
    const token = pendingToken.current, jobId = activeJob?.id
    if (!token || !jobId || consentBusy || !consentAccepted || letterOnly) return
    setConsentBusy(true); setConsentError('')
    try { await analyzeAuthorizedRun(token, authorizedRunId ?? undefined, jobId) }
    finally { if (selectedJob.current === jobId) setConsentBusy(false) }
  }
  async function generateDraft() {
    const token = pendingToken.current, jobId = activeJob?.id
    if (!token || !consentAccepted || draftBusy || !jobId) return
    const operation = ++operationEpoch.current
    setDraftBusy(true); setDraftError(''); setLetterMessage('')
    setAnalysis({ jobId, runId: authorizedRunId ?? undefined, status: 'running', analysis: analysis?.analysis ?? null, progress: 'Finding the most relevant career facts…', attempts: analysis?.attempts ?? 0, cacheHit: false, generationStep: 'score-evidence', completedSteps: ['parse-posting'] })
    try {
      ++cvLoadEpoch.current
      const documents = await api.generateRequestedDocuments(token, pageTarget)
      if (operation !== operationEpoch.current || pendingToken.current !== token) { await loadLetter().catch(() => {}); return }
      const result = documents.cv
      await loadLetter().catch(() => { setLetterMessage('Cover letter status could not be refreshed. Your saved CV remains available.') })
      if (documents.letter.status === 'failed' || documents.letter.status === 'cancelled' || documents.letter.status === 'uncertain') setLetterMessage(documents.letter.message)
      else if (documents.letter.status === 'not-started') setLetterMessage(documents.letter.reason)
      else setLetterMessage('')
      if (selectedJob.current !== jobId) return
      if (result.ok && result.draft && result.draft.jobId === jobId) {
        const document = await api.getCanonicalDocument(jobId)
        if (selectedJob.current !== jobId) return
        setDraft(result.draft); setCanonical(document); setFitReport(null); setReviewApprovedDraft(false); setFitBusy(true)
        try {
          const fit = await api.measureDocument(jobId)
          if (selectedJob.current === jobId) setFitReport(fit)
        } catch { if (selectedJob.current === jobId) setDraftError('Your draft is saved, but page length could not be checked. Retry Check page length before approval.') }
        finally { if (selectedJob.current === jobId) { setFitBusy(false); setNewRun(false) } }
      }
      else if (!result.ok) setDraftError(result.message)
      const latest = await api.getAnalysis(jobId)
      if (latest && selectedJob.current === jobId) setAnalysis(latest)
    } catch (failure) { if (selectedJob.current === jobId && operation === operationEpoch.current) setDraftError(failure instanceof Error ? failure.message : 'Draft generation failed.') }
    finally { if (selectedJob.current === jobId && operation === operationEpoch.current) setDraftBusy(false) }
  }
  async function renewDraftReview() {
    if (!activeJob || draftBusy) return false
    const jobId = activeJob.id
    setDraftBusy(true); setDraftError('')
    try {
      const result = await api.renewDraftReview(jobId)
      if (selectedJob.current !== jobId) return false
      if (!result.ok || !result.draft) { setDraftError(result.message); return false }
      const [document, latestAnalysis] = await Promise.all([api.getCanonicalDocument(jobId), api.getAnalysis(jobId)])
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
      const updated = await api.addDraftItem({ jobId: activeJob.id, section: addSection, text, citation: { evidenceId: selected.evidenceId, revision: selected.revision } })
      if (!updated) { setDraftError('That evidence is not a current selected source for this section. Refresh the draft before trying again.'); return }
      setDraft(updated); setCanonical(await api.getCanonicalDocument(activeJob.id)); setFitReport(null); setDraftError('Wording saved. Check your CV and page length again before approval.')
    } catch { setDraftError('Local correction could not be saved. Try again.') } finally { setDraftBusy(false) }
  }

  async function mutateRecord(input: Omit<MutateDraftRecordInput, 'jobId'>): Promise<MutateDraftRecordResult> {
    if (!activeJob || draftBusy || fitBusy) return { ok: false, message: 'Wait for the current operation before saving this record.' }
    const jobId = activeJob.id
    setDraftBusy(true); setDraftError('')
    try {
      const result = await api.mutateDraftRecord({ ...input, jobId })
      if (!result.ok || !result.draft || selectedJob.current !== jobId) return result
      const [current, document, profile, evidence] = await Promise.all([api.getDraft(jobId), api.getCanonicalDocument(jobId), api.getProfile(), api.getExperience()])
      if (selectedJob.current !== jobId) return result
      setDraft(current ?? result.draft); setCanonical(document); setSources({ profile, evidence }); setFitReport(null); setAcceptedCuts([]); setReviewApprovedDraft(true); setDraftError(result.message)
      return { ...result, draft: current ?? result.draft }
    } catch (failure) { return { ok: false, message: readableFailure(failure, 'The record could not be saved. Your original CV is unchanged.') } }
    finally { if (selectedJob.current === jobId) setDraftBusy(false) }
  }

  async function checkDraftNow() {
    if (!activeJob) return
    const report = await api.checkDraft(activeJob.id)
    setDraft(await api.getDraft(activeJob.id))
    setDraftError(report?.passed ? 'Automated checks found no blocking issues. Review the wording and its sources before approving.' : `${report?.findings.length ?? 0} issue${report?.findings.length === 1 ? '' : 's'} need attention. Choose Review issues to open the correction guidance.`)
  }
  async function exportDocx() {
    if (!activeJob || docxBusy) return
    setDocxBusy(true); setDraftError('')
    try {
      const result = await api.exportDraftDocx(activeJob.id)
      setDraftError(result.message)
      if (!result.ok && !result.cancelled) { const latest = await api.getDraft(activeJob.id); if (latest) setDraft(latest) }
    } catch (failure) { setDraftError(failure instanceof Error ? failure.message : 'Editable DOCX export failed.') }
    finally { setDocxBusy(false) }
  }
  async function approveCurrentDraft() {
    if (!activeJob || draftBusy) return
    const jobId = activeJob.id
    setDraftBusy(true)
    try {
      const result = await api.approveDraft(jobId)
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
      const result = await api.decideSuggestedSkill({ jobId, draftId: draft.id, skillId, decision })
      if (selectedJob.current !== jobId) return
      if (!result.ok || !result.draft) { setDraftError(result.message); return }
      const document = await api.getCanonicalDocument(jobId)
      if (selectedJob.current !== jobId) return
      setDraft(result.draft); setCanonical(document); setFitReport(null); setAcceptedCuts([]); setReviewApprovedDraft(true)
      void loadLetter().catch(() => {})
      setDraftError('Skill decision saved for this CV only. Check the updated wording and page length before approval.')
    } catch { if (selectedJob.current === jobId) setDraftError('Your skill decision could not be saved. Try again.') }
    finally { if (selectedJob.current === jobId) setDraftBusy(false) }
  }
  async function changeCvTitle(title: string | null) {
    if (!activeJob || !draft || draftBusy || fitBusy) return false
    const jobId = activeJob.id
    setDraftBusy(true); setDraftError('')
    try {
      const result = await api.changeCvTitle({ jobId, draftId: draft.id, title })
      if (selectedJob.current !== jobId) return false
      if (!result.ok || !result.draft) { setDraftError(result.message); return false }
      const document = await api.getCanonicalDocument(jobId)
      if (selectedJob.current !== jobId) return false
      setDraft(result.draft); setCanonical(document); setFitReport(null); setAcceptedCuts([]); setReviewApprovedDraft(true); setDraftError(result.message)
      return true
    } catch { if (selectedJob.current === jobId) setDraftError('The CV title could not be saved. Your previous draft is unchanged.'); return false }
    finally { if (selectedJob.current === jobId) setDraftBusy(false) }
  }
  async function correctDraft(section: 'education' | 'experience' | 'projects' | 'skills' | 'certificates', index: number, text: string, editIntent: 'wording-only' | 'new-fact' = 'wording-only') {
    if (!activeJob || !draft) return false
    setDraftBusy(true)
    try {
      const corrected = await api.correctDraft({ jobId: activeJob.id, section, index, text, editIntent, ...(editIntent === 'new-fact' ? { evidence: draft.content[section][index]?.citations } : {}) })
      if (!corrected || selectedJob.current !== activeJob.id) return false
      setDraft(corrected); setCanonical(await api.getCanonicalDocument(activeJob.id)); setFitReport(null); setDraftError('Wording saved. Check your CV and page length again before approval.')
      return true
    } catch { setDraftError('Wording could not be saved. Your original CV is unchanged.'); return false }
    finally { setDraftBusy(false) }
  }
  async function measurePageFit() {
    if (!activeJob || fitBusy) return
    setFitBusy(true); setDraftError(''); setAcceptedCuts([])
    const jobId = activeJob.id
    try { const report = await api.measureDocument(jobId); if (selectedJob.current === jobId) setFitReport(report) }
    catch (failure) { if (selectedJob.current === jobId) setDraftError(failure instanceof Error ? failure.message : 'The real PDF page measurement failed.') }
    finally { if (selectedJob.current === jobId) setFitBusy(false) }
  }
  async function applyPageCuts() {
    if (!activeJob || !fitReport || !acceptedCuts.length) return
    try {
      const result = await api.acceptDocumentCuts(activeJob.id, fitReport.documentHash, acceptedCuts)
      if (!result.ok) { setDraftError(result.message); return }
      const revised = await api.getDraft(activeJob.id)
      setDraft(revised); setCanonical(await api.getCanonicalDocument(activeJob.id)); setAcceptedCuts([])
      setFitReport(await api.measureDocument(activeJob.id))
    } catch (failure) { setDraftError(failure instanceof Error ? failure.message : 'Accepted cuts could not be applied.') }
  }
  async function cancelOutgoing() {
    const token = pendingToken.current
    if (!token || consentBusy) return
    setConsentBusy(true); setConsentError('')
    try {
      const result = await api.cancelOutboundConsent(token)
      if (!result.ok) { setConsentError(result.message); return }
      ++operationEpoch.current
      pendingToken.current = null
      setDraftBusy(false); setLetterBusy(false); setLetterOperation(null)
      await loadLetter().catch(() => {})
      setReview(null); setConsentAccepted(false); setAuthorizedRunId(null); setNewRun(false)
    } catch { setConsentError('This run could not be cancelled. Try again.') }
    finally { setConsentBusy(false) }
  }
  async function authorizeOutgoing() {
    const token = pendingToken.current
    if (!token || consentBusy) return
    setConsentBusy(true); setConsentError('')
    try {
      const result = await api.acceptOutboundConsent(token, true, true)
      if (!result.ok) { setConsentError(result.message); return }
      const jobId = activeJob?.id
      if (!jobId || selectedJob.current !== jobId || pendingToken.current !== token) return
      setAuthorizedRunId(result.runId ?? null)
      setConsentAccepted(true)
      if (!letterOnly) await analyzeAuthorizedRun(token, result.runId, jobId)
    } catch { setConsentError('Consent could not be saved. Review the data and try again.') }
    finally { setConsentBusy(false) }
  }
  useEffect(() => {
    if (!activeJob || analysis?.status !== 'running') return
    let mounted = true
    const operation = operationEpoch.current
    const poll = async () => {
      try {
        const latest = await api.getAnalysis(activeJob.id)
        if (mounted && operation === operationEpoch.current && latest) setAnalysis(latest)
      } catch { /* The initiating request still reports its final state. */ }
    }
    const timer = window.setInterval(() => void poll(), 250)
    void poll()
    return () => { mounted = false; window.clearInterval(timer) }
  }, [activeJob?.id, analysis?.status])
  useEffect(() => {
    if (!draftBusy || letterOnly || !includeLetter) return
    let active = true
    const poll = () => { if (active) void loadLetter().catch(() => {}) }
    const timer = window.setInterval(poll, 250); poll()
    return () => { active = false; window.clearInterval(timer) }
  }, [draftBusy, letterOnly, includeLetter])
  useEffect(() => {
    let mounted = true
    Promise.all([api.getProfile(), api.getExperience()])
      .then(([profile, evidence]) => { if (mounted) { setSources({ profile, evidence }); setError('') } })
      .catch(() => { if (mounted) setError('Your profile sources could not be loaded. Try again to see your workspace.') })
    return () => { mounted = false }
  }, [attempt])

  async function generateLetterOnly() {
    const token = pendingToken.current
    if (!activeJob || !token || !consentAccepted || !letterOnly || draftBusy) return
    const operation = ++operationEpoch.current
    setDraftBusy(true); setLetterBusy(true); setLetterMessage('Generating the authorized cover letter…')
    try {
      const outcome = await api.generateCoverLetter(token)
      if (pendingToken.current !== token || operation !== operationEpoch.current) { await loadLetter().catch(() => {}); return }
      await loadLetter()
      setLetterMessage(outcome.status === 'saved' ? 'Cover letter saved. Review its wording and sources.' : 'message' in outcome ? outcome.message : 'reason' in outcome ? outcome.reason : 'No cover letter was requested.')
      setSelectedDocument('cover-letter'); setLetterReviewOpen(true); setNewRun(false)
    } catch (failure) {
      if (current()) { setLetterMessage(readableFailure(failure, 'Cover letter generation failed. Your CV is unchanged.')); await loadLetter().catch(() => {}); setNewRun(false) }
    } finally { if (current() && operation === operationEpoch.current) { setDraftBusy(false); setLetterBusy(false) } }
  }
  async function letterAction(input: CoverLetterActionInput, action: () => Promise<CoverLetterActionResult>, operation: 'check' | 'fit' | null = null) {
    if (!activeJob || input.jobId !== activeJob.id || input.letterId !== letterModel?.letter?.id || letterBusy) throw new Error('Reopen the current cover letter before trying again.')
    setLetterBusy(true); setLetterOperation(operation); setLetterMessage('')
    try {
      const result = await action()
      await loadLetter().catch(() => { if (result.ok) throw new Error(`${result.message} The current letter could not be refreshed; reopen this posting.`) })
      if (!result.ok) { setLetterMessage(result.message); throw new Error(result.message) }
      setLetterMessage(result.message)
      if (operation === null) setLetterReviewOpen(true)
    } catch (failure) {
      if (current()) setLetterMessage(readableFailure(failure, 'The cover letter action could not be completed.'))
      throw failure
    } finally { if (current()) { setLetterBusy(false); setLetterOperation(null) } }
  }
  async function exportLetter(format: 'pdf' | 'docx') {
    if (!activeJob || !letterModel?.letter || letterBusy) return
    setLetterBusy(true); setLetterOperation('export'); setLetterMessage(format === 'pdf' ? 'Exporting cover letter PDF…' : 'Exporting editable cover letter Word document…')
    try {
      const result = await api.exportCoverLetter({ jobId: activeJob.id, letterId: letterModel.letter.id, format })
      setLetterMessage(result.message)
      await loadLetter().catch(() => { if (current()) setLetterMessage(`${result.message} The current letter status could not be refreshed; reopen this posting.`) })
    } catch (failure) { if (current()) setLetterMessage(readableFailure(failure, 'Cover letter export failed. No success was confirmed.')) }
    finally { if (current()) { setLetterBusy(false); setLetterOperation(null) } }
  }
  async function selectDocument(document: ApplicationDocument) {
    setSelectedDocument(document); setLetterMessage('')
    try { await loadLetter() } catch { if (current()) setLetterMessage('Cover letter status could not be refreshed. Reopen the posting before exporting.') }
  }
  const outgoing = review?.outgoing as unknown as OutboundPayload | undefined
  const outgoingProfileCounts = outgoing ? [
    { label: 'Experience and training', count: outgoing.profile.experience.length, unit: 'record' },
    { label: 'Projects', count: outgoing.profile.projects.length, unit: 'record' },
    { label: 'Skills', count: outgoing.profile.skills.length, unit: 'skill' },
    { label: 'Education', count: outgoing.profile.education.length, unit: 'record' },
    { label: 'Certificates', count: outgoing.profile.certificates.length, unit: 'record' }
  ].filter(item => item.count > 0) : []
  const draftTargetsCurrent = Boolean(draft && activeJob && draft.targetPostingUpdatedAt === activeJob.updatedAt)
  const cvExportReady = Boolean(draft?.approved && draftTargetsCurrent && draft.checkReport?.passed && fitReport && !fitReport.overflow && !reviewApprovedDraft)
  const activePhase: 1 | 2 | 3 | 4 | 5 = newRun && review ? consentAccepted ? 3 : 2 : selectedDocument === 'cover-letter' && (draft || letterModel?.letter) ? letterModel?.readiness.canExport && !letterReviewOpen ? 5 : 4 : cvExportReady ? 5 : draft ? 4 : consentAccepted ? 3 : review ? 2 : 1
  const readiness = letterModel?.readiness
  const displayedLetter = letterModel?.letter ? { ...letterModel.letter, findings: readiness?.findings ?? letterModel.letter.findings, acknowledgments: Object.fromEntries(Object.entries(letterModel.letter.acknowledgments).filter(([id]) => readiness?.paragraphAcknowledgments[id])) } : null
  const letterProblem = readiness?.bindingProblem || readiness?.canonicalProblem
  const letterStatus = !letterModel ? 'Loading' : letterProblem ? 'Needs current review' : readiness?.canExport ? 'Approved for export' : letterModel.letter ? 'Ready to review' : 'Not available'
  const letterWorkspace = activeJob && <>
    <section className="cover-letter-review-status" aria-label="Cover letter generation status">
      <p role="status">Latest cover letter attempt: {letterModel?.generation.status ?? 'loading'}. {letterModel?.generation.reason}</p>
      {letterModel?.generation.warning && <p role="alert">{letterModel.generation.warning}</p>}
      {letterProblem && <p role="alert">{letterProblem}</p>}
      {letterModel?.generation.retryAvailable ? <button className="secondary-button" type="button" disabled={consentBusy || letterBusy || draftBusy} onClick={() => void inspectOutgoing(true, true)}>{letterModel.letter ? 'Review data to regenerate cover letter' : 'Review data to add a cover letter'}</button> : letterModel && <><p>A fresh full flow is required before generating another letter. Your saved CV remains separate.</p><button className="secondary-button" type="button" disabled={consentBusy || letterBusy} onClick={() => void inspectOutgoing(true)}>Review data for a new run</button></>}
      {consentError && <p role="alert">{consentError}</p>}
      {readiness?.canExport && letterReviewOpen && <button className="secondary-button" type="button" disabled={letterBusy} onClick={() => { setLetterReviewOpen(false); void loadLetter().catch(() => {}) }}>View approved cover letter PDF</button>}
    </section>
    {activePhase === 5 && letterModel?.letter && letterModel.canonical && readiness?.canExport ? <section className="document-area" aria-label="Cover letter document">
      <div className="document-toolbar"><strong>Cover letter · approved</strong></div>
      <div className="paper-wrap"><PdfPreview key={letterModel.letter.id} jobId={activeJob.id} letterId={letterModel.letter.id} letterCanonical={letterModel.canonical} /></div>
      <section className="page-fit-controls" aria-label="Cover letter export"><p>The compiled PDF is authoritative. Editable Word may reflow.</p><div className="cover-letter-control-row">
        <button className="secondary-button" type="button" disabled={letterBusy} onClick={() => { setLetterReviewOpen(true); void loadLetter().catch(() => {}) }}>Back to review</button>
        <button className="primary-button" type="button" disabled={letterBusy} onClick={() => void exportLetter('pdf')}>Export cover letter PDF</button>
        <button className="secondary-button" type="button" disabled={letterBusy} onClick={() => void exportLetter('docx')}>Export cover letter Word</button>
      </div><p role="status" aria-live="polite">{letterMessage}</p></section>
    </section> : <CoverLetterReview jobId={activeJob.id} originatingCvRevisionId={displayedLetter?.cvRevisionId ?? null} letter={displayedLetter} canonical={letterModel?.canonical ?? null} experienceKinds={letterModel?.experienceKinds}
      checkStatus={letterOperation === 'check' ? 'pending' : readiness?.findings.length ? 'issues' : displayedLetter && !letterProblem ? 'passed' : 'idle'}
      fitStatus={letterOperation === 'fit' ? 'pending' : readiness?.currentFit ? 'passed' : 'idle'}
      readiness={{ canApprove: readiness?.canApprove ?? false, reason: letterProblem || (readiness?.canExport ? 'Approved for export' : !readiness?.currentFit ? 'Measure the actual PDF and review every paragraph before approval.' : 'Review every paragraph and resolve known issues before approval.') }}
      message={letterMessage} busy={letterBusy}
      onSaveParagraph={input => letterAction(input, () => api.editCoverLetter({ jobId: input.jobId, letterId: input.letterId, recipient: displayedLetter?.recipient ?? null, paragraphs: displayedLetter!.paragraphs.map(paragraph => paragraph.id === input.paragraphId ? { ...paragraph, text: input.text } : paragraph) }))}
      onSaveRecipient={input => letterAction(input, () => api.setCoverLetterRecipient(input))}
      onAcknowledge={input => letterAction(input, () => api.acknowledgeCoverLetterParagraph(input))}
      onCheck={input => letterAction(input, () => api.checkCoverLetter(input.jobId), 'check')}
      onMeasureFit={input => letterAction(input, () => api.measureCoverLetter(input), 'fit')}
      onApprove={async input => { await letterAction(input, () => api.approveCoverLetter(input.jobId, input.letterId)); setLetterReviewOpen(false) }} />}
  </>
  const displayedAnalysis = newRun && consentAccepted && analysis?.runId !== authorizedRunId ? null : analysis
  return <WorkbenchStageLayout
    api={api} selectedDocument={selectedDocument} selectDocument={document => void selectDocument(document)} letterStatus={letterStatus} letterWorkspace={letterWorkspace}
    letterGenerationStatus={letterModel?.generation.status ?? null} includeLetter={includeLetter} setIncludeLetter={included => void inspectOutgoing(included)} letterOnly={letterOnly} generateLetterOnly={generateLetterOnly}
    activeJob={activeJob} onNavigate={page => onNavigate(page)} error={error} retry={() => setAttempt(value => value + 1)} activePhase={activePhase}
    review={review} consentAccepted={consentAccepted} consentError={consentError} consentBusy={consentBusy}
    analysis={displayedAnalysis} recovery={recovery} recoveryBusy={recoveryBusy} resumeSavedGeneration={resumeSavedGeneration} cancelSavedGeneration={cancelSavedGeneration} draft={draft} canonical={canonical} fitReport={fitReport} fitBusy={fitBusy} acceptedCuts={acceptedCuts} setAcceptedCuts={setAcceptedCuts} draftBusy={draftBusy} draftError={draftError}
    pageTarget={pageTarget} setPageTarget={setPageTarget} addSection={addSection} setAddSection={setAddSection} addEvidence={addEvidence} setAddEvidence={setAddEvidence} sources={sources} outgoingProfileCounts={outgoingProfileCounts}
    inspectOutgoing={inspectOutgoing} cancelOutgoing={cancelOutgoing} authorizeOutgoing={authorizeOutgoing} startAnalysis={startAnalysis} generateDraft={generateDraft} cancelAnalysis={async () => { if (!activeJob) return; ++operationEpoch.current; const result = await api.cancelAnalysis(activeJob.id); setAnalysis(result); setDraftBusy(false); setLetterBusy(false); await loadLetter(); const saved = await api.getDraft(activeJob.id); if (saved) { setDraft(saved); setCanonical(await api.getCanonicalDocument(activeJob.id)); setFitReport(await api.getDocumentFitReport(activeJob.id)); setNewRun(false) } }}
    returnToReview={() => { setReviewApprovedDraft(true); void loadLetter().catch(() => {}) }} renewDraftReview={renewDraftReview} decideSuggestedSkill={decideSuggestedSkill}
    mutateRecord={mutateRecord} measurePageFit={measurePageFit} applyPageCuts={applyPageCuts} addDraftItem={addDraftItem} correctDraft={correctDraft} changeCvTitle={changeCvTitle} checkDraftNow={checkDraftNow} approveCurrentDraft={approveCurrentDraft} exportDocx={exportDocx} docxBusy={docxBusy}
    onProposalAccepted={(next, document, fit) => { setDraft(next); setCanonical(document); setFitReport(fit); setAcceptedCuts([]) }}
  />
}
