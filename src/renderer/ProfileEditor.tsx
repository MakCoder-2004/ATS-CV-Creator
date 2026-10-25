import React, { FormEvent, useEffect, useRef, useState } from 'react'
import { UserRound } from 'lucide-react'
import type { ContactInput, ProfileEntry, ProfileEntryInput, ProfileSnapshot, SkillInput, SkillRecord } from '../shared/profile'
import type { ExperienceSnapshot } from '../shared/experience'
import { profilePdfProposalSchema, type ProfilePdfProposal, type ProfilePdfPreview } from '../shared/profile-pdf-import'
import type { ProfileAiConsentPreview } from '../shared/profile-ai-structuring'
import { ExperienceEditor } from './ExperienceEditor'
import { FieldSelect } from './controls/FieldSelect'
import { MonthYearPicker } from './controls/MonthYearPicker'

type ProfileSection = 'Personal' | 'Skills' | 'Experience' | 'Projects' | 'Education' | 'Certificates' | 'Summary' | 'Languages' | 'Extras'
type LinkRow = { key: number; label: string; url: string }
const profileSections: ProfileSection[] = ['Personal', 'Skills', 'Experience', 'Projects', 'Education', 'Certificates', 'Summary', 'Languages', 'Extras']
const skillCategories = ['Technical', 'Tools', 'Domain', 'Languages', 'Leadership', 'Other']
const proficiencyLabels: Record<string, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', expert: 'Expert' }

function initialPdfDecisions(proposals: ProfilePdfProposal, profile: ProfileSnapshot, experience: ExperienceSnapshot) {
  const normalized = (value: string) => value.trim().toLocaleLowerCase()
  const decisions: Record<string, { action: 'add' | 'update' | 'skip'; targetId?: string }> = {}
  if (proposals.contact) decisions[proposals.contact.proposalRef] = profile.contact ? { action: 'skip' } : { action: 'add' }
  for (const item of proposals.skills) decisions[item.proposalRef] = profile.skills.some(existing => normalized(existing.name) === normalized(item.name) && normalized(existing.category) === normalized(item.category)) ? { action: 'skip' } : { action: 'add' }
  for (const item of proposals.experience) {
    const matches = experience.experience.filter(existing => normalized(existing.title) === normalized(item.title) || normalized(existing.organization) === normalized(item.organization))
    decisions[item.proposalRef] = matches.length ? { action: 'skip' } : { action: 'add' }
    const parent = matches.find(existing => normalized(existing.title) === normalized(item.title) && normalized(existing.organization) === normalized(item.organization))
    for (const fact of item.factualItems) decisions[fact.proposalRef] = parent?.factualItems.some(existing => normalized(existing.text) === normalized(fact.text)) ? { action: 'skip' } : { action: 'add' }
  }
  for (const item of proposals.projects) {
    const matches = experience.projects.filter(existing => normalized(existing.name) === normalized(item.name))
    decisions[item.proposalRef] = matches.length ? { action: 'skip' } : { action: 'add' }
    const parent = matches[0]
    for (const fact of item.factualItems) decisions[fact.proposalRef] = parent?.factualItems.some(existing => normalized(existing.text) === normalized(fact.text)) ? { action: 'skip' } : { action: 'add' }
    for (const technology of item.technologies) decisions[technology.proposalRef] = parent?.technologies.some(existing => normalized(existing.text) === normalized(technology.text)) ? { action: 'skip' } : { action: 'add' }
  }
  const entries = [...profile.education, ...profile.certificates, ...profile.summary, ...profile.languages, ...profile.extras]
  for (const item of proposals.entries) decisions[item.proposalRef] = entries.some(existing => existing.section === item.section && normalized(existing.title) === normalized(item.title)) ? { action: 'skip' } : { action: 'add' }
  return decisions
}

export function ProfileEditor() {
  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null)
  const [experienceSnapshot, setExperienceSnapshot] = useState<ExperienceSnapshot>({ experience: [], projects: [] })
  const [loading, setLoading] = useState(true)
  const [contactEdit, setContactEdit] = useState(false)
  const [activeSection, setActiveSection] = useState<ProfileSection>('Personal')
  const nextLinkKey = useRef(0)
  const [links, setLinks] = useState<LinkRow[]>([])
  const [skillEditId, setSkillEditId] = useState<string | undefined>()
  const [contact, setContact] = useState<ContactInput>({ fullName: '', headline: '', email: '', phone: '', location: '', links: [] })
  const [skill, setSkill] = useState<SkillInput>({ name: '', category: skillCategories[0] })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [mutationError, setMutationError] = useState('')
  const [notice, setNotice] = useState('')
  const [importPreview, setImportPreview] = useState<Awaited<ReturnType<typeof window.workbench.previewProfileImport>> & { ok: true } | null>(null)
  const [pdfPreview, setPdfPreview] = useState<Extract<ProfilePdfPreview, { ok: true }> | null>(null)
  const [pdfSelected, setPdfSelected] = useState<{ contact: boolean; skills: boolean[]; experience: boolean[]; entries: boolean[]; projects: boolean[] }>({ contact: true, skills: [], experience: [], entries: [], projects: [] })
  const [pdfDecisions, setPdfDecisions] = useState<Record<string, { action: 'add' | 'update' | 'skip'; targetId?: string }>>({})
  const [pdfBusy, setPdfBusy] = useState(false)
  const [docxReview, setDocxReview] = useState(false)
  const [pdfValidationError, setPdfValidationError] = useState('')
  const [profileChangedDuringReview, setProfileChangedDuringReview] = useState(false)
  const [reviewTokenExpired, setReviewTokenExpired] = useState(false)
  const [aiPreview, setAiPreview] = useState<Extract<ProfileAiConsentPreview, { ok: true }> | null>(null)
  const [aiAuthorized, setAiAuthorized] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiDispatched, setAiDispatched] = useState(false)
  const [aiStage, setAiStage] = useState<'preparing' | 'running' | null>(null)
  const [localOnlyReview, setLocalOnlyReview] = useState(false)
  const activePdfToken = useRef<string | null>(null)
  const activeAiToken = useRef<string | null>(null)

  function loadLinks(items: Array<string | { label: string; url: string }>) {
    setLinks(items.map(item => ({ key: ++nextLinkKey.current, label: typeof item === 'string' ? item : item.label, url: typeof item === 'string' ? item : item.url })))
  }
  function changeLink(key: number, field: 'label' | 'url', value: string) {
    setLinks(current => current.map(link => link.key === key ? { ...link, [field]: value } : link))
    setFieldErrors({})
  }
  async function reload() {
    setLoading(true)
    try {
      const [value, experience] = await Promise.all([window.workbench.getProfile(), window.workbench.getExperience()])
      setSnapshot(value)
      setExperienceSnapshot(experience)
      if (value.contact) {
        setContact({ ...value.contact })
        loadLinks(value.contact.links ?? [])
      } else {
        setContact({ fullName: '', headline: '', email: '', phone: '', location: '', links: [] })
        setLinks([])
      }
      setMutationError('')
    } catch {
      setMutationError('Your profile could not be loaded. Try again.')
    } finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [])
  useEffect(() => () => { if (importPreview?.token) void window.workbench.cancelProfileImport(importPreview.token).catch(() => {}) }, [importPreview?.token])

  useEffect(() => () => { if (pdfPreview?.token) void (docxReview ? window.workbench.cancelProfileDocxImport(pdfPreview.token) : window.workbench.cancelProfilePdfImport(pdfPreview.token)).catch(() => {}) }, [pdfPreview?.token, docxReview])
  useEffect(() => () => { if (aiPreview?.token) void window.workbench.cancelProfileAiStructuring(aiPreview.token).catch(() => {}) }, [aiPreview?.token])
  async function prepareProfileAi() {
    if (!pdfPreview) return
    setMutationError(''); setNotice(''); setAiBusy(true); setAiStage('preparing'); setAiAuthorized(false)
    try {
      const result = await window.workbench.previewProfileAiStructuring(pdfPreview.token)
      if (result.ok) { activeAiToken.current = result.token; setAiPreview(result) } else setMutationError(result.message)
    } catch { setMutationError('Could not prepare the outgoing-text preview. Local CV review remains available.') }
    finally { setAiBusy(false); setAiStage(null) }
  }
  async function cancelProfileAi() {
    if (!aiPreview) return
    const token = aiPreview.token; activeAiToken.current = null; setAiPreview(null); setAiAuthorized(false)
    try { await window.workbench.cancelProfileAiStructuring(token) } catch { /* The run has already expired or ended. */ }
  }
  async function authorizeProfileAi() {
    if (!pdfPreview || !aiPreview || !aiAuthorized) return
    const importToken = pdfPreview.token, consentToken = aiPreview.token
    if (activePdfToken.current !== importToken || activeAiToken.current !== consentToken) return
    const stillCurrent = () => activePdfToken.current === importToken && activeAiToken.current === consentToken
    setAiBusy(true); setAiStage('running'); setMutationError('')
    try {
      const accepted = await window.workbench.consentProfileAiStructuring(consentToken, true)
      if (!stillCurrent()) { void window.workbench.cancelProfileAiStructuring(consentToken); return }
      if (!accepted.ok) { setMutationError(accepted.message); return }
      setAiDispatched(true)
      const result = await window.workbench.runProfileAiStructuring(consentToken)
      if (!stillCurrent()) return
      if (!result.ok) {
        activeAiToken.current = null; setAiPreview(current => current?.token === consentToken ? null : current); setAiAuthorized(false)
        setMutationError(result.message); return
      }
      const proposals = result.proposals
      setPdfPreview(current => current?.token === importToken ? { ...current, proposals } : current)
      const [currentProfile, currentExperience] = await Promise.all([window.workbench.getProfile(), window.workbench.getExperience()])
      setSnapshot(currentProfile); setExperienceSnapshot(currentExperience); setPdfDecisions(initialPdfDecisions(proposals, currentProfile, currentExperience))
      setPdfSelected({ contact: Boolean(proposals.contact?.fullName), skills: proposals.skills.map(() => true), experience: proposals.experience.map(item => !item.requiresDateResolution && item.kind !== 'unresolved'), entries: proposals.entries.map(item => !item.requiresDateResolution), projects: proposals.projects.map(() => true) })
      activeAiToken.current = null; setAiPreview(current => current?.token === consentToken ? null : current); setAiAuthorized(false); setMutationError(''); setNotice(result.message)
    } catch {
      if (stillCurrent()) {
        activeAiToken.current = null; setAiPreview(current => current?.token === consentToken ? null : current); setAiAuthorized(false)
        setMutationError('AI structuring failed. Your local proposals remain available for correction.')
      }
    } finally { setAiBusy(false); setAiStage(null) }
  }
  async function uploadPdf() { return uploadCv('pdf') }
  async function uploadDocx() { return uploadCv('docx') }
  async function uploadCv(format: 'pdf' | 'docx') {
    setMutationError(''); setNotice(''); setPdfBusy(true); setDocxReview(format === 'docx')
    try {
      const result = await (format === 'docx' ? window.workbench.previewProfileDocxImport() : window.workbench.previewProfilePdfImport())
      if (!result.ok) { if (!result.cancelled) setMutationError(result.message); return }
      if (activeAiToken.current) void window.workbench.cancelProfileAiStructuring(activeAiToken.current).catch(() => {})
      activePdfToken.current = result.token; activeAiToken.current = null; setAiPreview(null); setAiAuthorized(false); setLocalOnlyReview(false); setAiDispatched(false); setProfileChangedDuringReview(false); setReviewTokenExpired(false)
      setPdfPreview(result)
      const [currentProfile, currentExperience] = await Promise.all([window.workbench.getProfile(), window.workbench.getExperience()])
      setSnapshot(currentProfile); setExperienceSnapshot(currentExperience)
      setPdfDecisions(initialPdfDecisions(result.proposals, currentProfile, currentExperience))
      setPdfSelected({ contact: Boolean(result.proposals.contact?.fullName), skills: result.proposals.skills.map(() => true), experience: result.proposals.experience.map(item => !item.requiresDateResolution && item.kind !== 'unresolved'), entries: result.proposals.entries.map(item => !item.requiresDateResolution), projects: result.proposals.projects.map(() => true) })
    } catch { setMutationError(`The selected ${format === 'docx' ? 'Word document' : 'PDF'} could not be read. Try again with a supported file.`) }
    finally { setPdfBusy(false) }
  }
  function updatePdfProposal(update: (current: ProfilePdfProposal) => ProfilePdfProposal) {
    setPdfValidationError('')
    if (aiPreview) {
      activeAiToken.current = null
      void window.workbench.cancelProfileAiStructuring(aiPreview.token).catch(() => {})
      setAiPreview(null); setAiAuthorized(false)
    }
    setPdfPreview(current => current ? { ...current, proposals: update(current.proposals) } : current)
  }
  async function cancelPdfReview() {
    if (!pdfPreview) return
    const token = pdfPreview.token
    if (!window.confirm('Discard this CV review? Any corrections will be lost; your profile has not been changed.')) return
    activePdfToken.current = null; activeAiToken.current = null; setAiPreview(null); setPdfPreview(null)
    try { await (docxReview ? window.workbench.cancelProfileDocxImport(token) : window.workbench.cancelProfilePdfImport(token)) } catch { setMutationError('The CV review could not be cleared. No profile data was applied.') }
  }
  async function rebasePdfReview() {
    if (!pdfPreview) return
    setPdfBusy(true); setMutationError('')
    try {
      const result = await (docxReview ? window.workbench.rebaseProfileDocxImport(pdfPreview.token) : window.workbench.rebaseProfilePdfImport(pdfPreview.token))
      if (!result.ok) { setReviewTokenExpired(true); setMutationError(`${result.message} Read the CV again if these merge choices cannot be refreshed.`); return }
      setSnapshot(result.profile); setExperienceSnapshot(result.experience)
      setPdfDecisions(initialPdfDecisions(pdfPreview.proposals, result.profile, result.experience))
      setProfileChangedDuringReview(false); setReviewTokenExpired(false); setMutationError('')
      setNotice('The saved profile changed. Review every refreshed add, update, and skip choice before applying.')
    } catch {
      setReviewTokenExpired(true)
      setMutationError('These review choices could not be refreshed. Read the CV again to create a new review; your corrections remain visible until then.')
    } finally { setPdfBusy(false) }
  }
  async function applyPdfReview() {
    if (!pdfPreview) return
    setPdfBusy(true); setMutationError('')
    try {
      const [latestProfile, latestExperience] = await Promise.all([window.workbench.getProfile(), window.workbench.getExperience()])
      if (JSON.stringify(latestProfile) !== JSON.stringify(snapshot) || JSON.stringify(latestExperience) !== JSON.stringify(experienceSnapshot)) {
        setProfileChangedDuringReview(true)
        setMutationError('Your saved profile changed during this review. Refresh the merge choices or read the CV again before applying.')
        setPdfBusy(false)
        return
      }
    } catch {
      setMutationError('The current profile could not be checked. Your CV proposals remain unchanged and nothing was applied.')
      setPdfBusy(false)
      return
    }
    const proposals = { ...pdfPreview.proposals,
      contact: pdfSelected.contact && (!pdfPreview.proposals.contact || pdfDecisions[pdfPreview.proposals.contact.proposalRef]?.action !== 'skip') ? pdfPreview.proposals.contact : undefined,
      skills: pdfPreview.proposals.skills.filter((item, index) => pdfSelected.skills[index] && pdfDecisions[item.proposalRef]?.action !== 'skip'),
      experience: pdfPreview.proposals.experience.filter((item, index) => pdfSelected.experience[index] && pdfDecisions[item.proposalRef]?.action !== 'skip').map(item => ({ ...item, factualItems: item.factualItems.filter(fact => pdfDecisions[fact.proposalRef]?.action !== 'skip') })),
      entries: pdfPreview.proposals.entries.filter((item, index) => pdfSelected.entries[index] && pdfDecisions[item.proposalRef]?.action !== 'skip'),
      projects: pdfPreview.proposals.projects.filter((item, index) => pdfSelected.projects[index] && pdfDecisions[item.proposalRef]?.action !== 'skip').map(item => ({ ...item, factualItems: item.factualItems.filter(fact => pdfDecisions[fact.proposalRef]?.action !== 'skip'), technologies: item.technologies.filter(technology => pdfDecisions[technology.proposalRef]?.action !== 'skip') })),
      decisions: Object.fromEntries(Object.entries(pdfDecisions).filter(([ref]) => [pdfSelected.contact && pdfPreview.proposals.contact?.proposalRef !== undefined && pdfDecisions[pdfPreview.proposals.contact.proposalRef]?.action !== 'skip' ? pdfPreview.proposals.contact.proposalRef : undefined, ...pdfPreview.proposals.skills.filter((item, index) => pdfSelected.skills[index] && pdfDecisions[item.proposalRef]?.action !== 'skip').map(item => item.proposalRef), ...pdfPreview.proposals.experience.filter((item, index) => pdfSelected.experience[index] && pdfDecisions[item.proposalRef]?.action !== 'skip').flatMap(item => [item.proposalRef, ...item.factualItems.filter(fact => pdfDecisions[fact.proposalRef]?.action !== 'skip').map(fact => fact.proposalRef)]), ...pdfPreview.proposals.entries.filter((item, index) => pdfSelected.entries[index] && pdfDecisions[item.proposalRef]?.action !== 'skip').map(item => item.proposalRef), ...pdfPreview.proposals.projects.filter((item, index) => pdfSelected.projects[index] && pdfDecisions[item.proposalRef]?.action !== 'skip').flatMap(item => [item.proposalRef, ...item.factualItems.filter(fact => pdfDecisions[fact.proposalRef]?.action !== 'skip').map(fact => fact.proposalRef), ...item.technologies.filter(technology => pdfDecisions[technology.proposalRef]?.action !== 'skip').map(technology => technology.proposalRef)])].includes(ref))) }
    const validatedProposals = profilePdfProposalSchema.safeParse(proposals)
    if (proposals.experience.some(item => item.kind === 'unresolved')) {
      setPdfValidationError('Choose Employment or Training for each included experience record.')
      setPdfBusy(false)
      return
    }
    if (!validatedProposals.success) {
      setPdfValidationError(`Correct or skip selected proposal fields before applying: ${validatedProposals.error.issues.map(issue => `${issue.path.join('.') || 'proposal'}: ${issue.message}`).join('; ')}`)
      setPdfBusy(false)
      return
    }
    setPdfValidationError('')
    try {
      const result = await (docxReview ? window.workbench.applyProfileDocxImport(pdfPreview.token, validatedProposals.data) : window.workbench.applyProfilePdfImport(pdfPreview.token, validatedProposals.data))
      if (!result.ok) {
        if (/profile changed|profile is no longer empty|selected record or nested detail no longer/i.test(result.message)) {
          setProfileChangedDuringReview(true)
          setReviewTokenExpired(false)
          setMutationError(`${result.message} Refresh the merge choices or read the CV again before applying. Your corrections remain visible.`)
          return
        }
        if (/review expired/i.test(result.message)) {
          setProfileChangedDuringReview(true)
          setReviewTokenExpired(true)
          setMutationError(`${result.message} Read the CV again to create a fresh review. Your corrections remain visible until you choose.`)
          return
        }
        setMutationError(result.message)
        return
      }
      setPdfPreview(null); activePdfToken.current = null; activeAiToken.current = null; setProfileChangedDuringReview(false); setReviewTokenExpired(false)
      if (result.profile) setSnapshot(result.profile)
      setNotice(`${result.message} Accepted source passages are retained as personal data.`)
      setActiveSection('Personal')
    } catch { setMutationError('The reviewed CV could not be applied. Your saved profile was not changed.') }
    finally { setPdfBusy(false) }
  }
  function updateContact(field: keyof ContactInput, value: string) {
    setContact(current => ({ ...current, [field]: value }))
    setFieldErrors(current => ({ ...current, [field]: '' }))
  }
  async function saveContact(event: FormEvent) {
    event.preventDefault()
    setFieldErrors({}); setMutationError(''); setNotice('')
    const input: ContactInput = {
      fullName: contact.fullName,
      ...(contact.headline?.trim() ? { headline: contact.headline } : {}),
      ...(contact.email?.trim() ? { email: contact.email } : {}),
      ...(contact.phone?.trim() ? { phone: contact.phone } : {}),
      ...(contact.location?.trim() ? { location: contact.location } : {}),
      links: links.map(({ label, url }) => ({ label, url }))
    }
    try {
      const result = await window.workbench.saveContact({ ...input, id: snapshot?.contact?.id })
      if (!result.ok) { setFieldErrors(result.error.fieldErrors ?? {}); setMutationError(result.error.message); return }
      setSnapshot(result.value); setContactEdit(false); setNotice('Contact details saved')
    } catch { setMutationError('Contact details could not be saved. Check the fields and try again.') }
  }
  function beginContactEdit() {
    if (snapshot?.contact) {
      setContact({ ...snapshot.contact })
      loadLinks(snapshot.contact.links ?? [])
    }
    setContactEdit(true); setNotice(''); setFieldErrors({})
  }
  async function deleteContact() {
    if (!snapshot?.contact || !window.confirm('Delete your contact details? This cannot be undone.')) return
    try {
      const result = await window.workbench.deleteContact(snapshot.contact.id)
      if (!result.ok) { setMutationError(result.error.message); return }
      setSnapshot(result.value); setContact({ fullName: '', headline: '', email: '', phone: '', location: '', links: [] }); setLinks([]); setNotice('Contact details deleted')
    } catch { setMutationError('Contact details could not be deleted. Try again.') }
  }
  function updateSkill(field: keyof SkillInput, value: string) {
    setSkill(current => ({ ...current, [field]: field === 'years' ? (value === '' ? undefined : Number(value)) : field === 'proficiency' && !value ? undefined : value }))
    setFieldErrors(current => ({ ...current, [field]: '' }))
  }
  function editSkill(item: SkillRecord) {
    setSkillEditId(item.id)
    setSkill({ name: item.name, category: item.category, proficiency: item.proficiency, years: item.years })
    setNotice(''); setFieldErrors({})
  }
  function resetSkill() { setSkillEditId(undefined); setSkill({ name: '', category: skillCategories[0] }); setFieldErrors({}) }
  async function saveSkill(event: FormEvent) {
    event.preventDefault(); setFieldErrors({}); setMutationError(''); setNotice('')
    try {
      const result = await window.workbench.saveSkill({ ...skill, id: skillEditId })
      if (!result.ok) { setFieldErrors(result.error.fieldErrors ?? {}); setMutationError(result.error.message); return }
      setSnapshot(result.value); resetSkill(); setNotice(skillEditId ? 'Skill updated' : 'Skill added')
    } catch { setMutationError('Skill could not be saved. Check the fields and try again.') }
  }
  async function deleteSkill(item: SkillRecord) {
    if (!window.confirm(`Delete ${item.name}? This cannot be undone.`)) return
    try {
      const result = await window.workbench.deleteSkill(item.id)
      if (!result.ok) { setMutationError(result.error.message); return }
      setSnapshot(result.value); setNotice(`${item.name} deleted`)
    } catch { setMutationError('Skill could not be deleted. Try again.') }
  }

  async function exportProfile() {
    if (!window.confirm('The profile JSON contains personal data. Save and store the file securely. Continue?')) return
    setMutationError(''); setNotice('')
    try {
      const result = await window.workbench.exportProfile()
      if (result.ok) setNotice(result.message)
      else if (!result.cancelled) setMutationError(result.message)
    } catch { setMutationError('Profile export failed. Check the destination and try again.') }
  }
  async function previewImport() {
    setMutationError(''); setNotice('')
    try {
      const result = await window.workbench.previewProfileImport()
      if (!result.ok) { if (!result.cancelled) setMutationError(result.message); return }
      setImportPreview(result)
    } catch { setMutationError('Could not read the selected profile file. Choose a valid JSON file and try again.') }
  }
  async function cancelImport() {
    if (!importPreview) return
    const token = importPreview.token
    setImportPreview(null)
    try { await window.workbench.cancelProfileImport(token) }
    catch { setMutationError('The replacement preview could not be cleared. Reopen the profile before importing.') }
  }
  async function applyImport() {
    if (!importPreview) return
    try {
      const result = await window.workbench.applyProfileImport(importPreview.token)
      setImportPreview(null)
      if (!result.ok) { setMutationError(result.message); return }
      await reload(); setNotice('Profile replaced from JSON. Historical evidence revisions were retained.')
    } catch { setMutationError('Profile replacement failed. Your existing profile was not intentionally changed; reload and try again.') }
  }
  function renderMergeChoice(ref: string, summary: string, candidates: Array<{ id: string; label: string; current: string }>, allowAdd = true) {
    const choice = pdfDecisions[ref] ?? { action: 'add' as const }
    const setChoice = (action: 'add' | 'update' | 'skip') => setPdfDecisions(current => ({ ...current, [ref]: action === 'update' ? { action, targetId: choice.targetId ?? candidates[0]?.id } : { action } }))
    return <fieldset className="pdf-merge-choice"><legend>Apply decision</legend><p>Proposed: {summary}</p>{candidates.map(candidate => <p key={candidate.id}>Current: {candidate.current} <span className="muted">({candidate.label})</span></p>)}<div className="pdf-merge-actions">{(['add', 'update', 'skip'] as const).map(action => <label key={action}><input type="radio" name={`decision-${ref}`} value={action} checked={choice.action === action} disabled={action === 'update' && candidates.length === 0 || action === 'add' && !allowAdd} onChange={() => setChoice(action)} />{action[0].toUpperCase() + action.slice(1)}</label>)}</div>{choice.action === 'update' && candidates.length > 1 && <label>Update this record<select value={choice.targetId ?? ''} onChange={event => setPdfDecisions(current => ({ ...current, [ref]: { action: 'update', targetId: event.target.value } }))}>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.label}: {candidate.current}</option>)}</select></label>}</fieldset>
  }
  const categories = [...new Set([...(snapshot?.skills ?? []).map(item => item.category), ...skillCategories])]
  if (loading) return <section className="profile-panel" role="status">Loading your local profile…</section>
  return <div className="profile-layout">
    <div className="profile-summary"><span className="profile-avatar"><UserRound size={22} aria-hidden="true" /></span><div><strong>{snapshot?.contact?.fullName ?? 'Start your profile'}</strong><p>{snapshot?.contact?.headline ?? 'Your career facts, organized by section.'}</p></div><span className="profile-local-label">Saved on this device</span></div>
    <section className="profile-exchange-toolbar" aria-label="Profile files"><div><strong>Profile files</strong><p>JSON exchange stays separate. PDF and Word CVs are read locally; review every proposed add, update, or skip.</p></div><div className="profile-exchange-actions"><button className="secondary-button" type="button" onClick={() => void exportProfile()}>Export profile JSON</button><button className="secondary-button" type="button" onClick={() => void previewImport()}>Import profile JSON</button><button className="primary-button" type="button" onClick={() => void uploadPdf()} disabled={pdfBusy}>{pdfBusy ? 'Reading CV…' : 'Upload CV'}</button><button className="secondary-button" type="button" onClick={() => void uploadDocx()} disabled={pdfBusy}>{pdfBusy ? 'Reading CV…' : 'Upload Word CV'}</button></div></section>
    <nav className="profile-sections" aria-label="Profile sections">{profileSections.map(section => <button key={section} type="button" aria-current={activeSection === section ? 'page' : undefined} onClick={() => { setActiveSection(section); setMutationError(''); setNotice(''); setFieldErrors({}) }}>{section}</button>)}</nav>
    {pdfBusy && <p className="profile-message" role="status" aria-live="polite">Reading the selected {docxReview ? 'Word document' : 'PDF'} on this device…</p>}
    {aiStage && <p className="profile-message" role="status" aria-live="polite">{aiStage === 'running' ? 'Sending the authorized text through Pi for structuring…' : 'Preparing the outgoing-text preview locally…'}</p>}
    {pdfPreview && <section className="profile-panel pdf-import-review" role="region" aria-labelledby="pdf-import-title"><div className="panel-heading"><div><span className="context">{docxReview ? 'Local Word review' : 'Local PDF review'}</span><h2 id="pdf-import-title">Review proposed profile details</h2><p>Choose add, update, or skip for each group. Nothing is saved until you apply. Original source passages provide context; manual corrections do not become source-supported. Source passages may contain sensitive personal data and will be retained only for accepted facts.</p></div></div>{pdfValidationError && <p className="profile-message error" role="alert">{pdfValidationError}</p>}{profileChangedDuringReview && <div className="profile-message error" role="alert"><p>Your saved profile changed during this review. Refresh the merge choices before applying. Your proposed edits are still visible.</p>{!reviewTokenExpired && <button className="secondary-button" type="button" disabled={pdfBusy || aiBusy} onClick={() => void rebasePdfReview()}>Refresh merge choices</button>}<button className="secondary-button" type="button" disabled={pdfBusy || aiBusy} onClick={() => void uploadCv(docxReview ? 'docx' : 'pdf')}>Read CV again</button></div>}
      {!aiPreview && !localOnlyReview && <section className="profile-ai-route" aria-labelledby="profile-ai-route-title"><div><span className="context">AI-assisted extraction</span><h3 id="profile-ai-route-title">Structure readable CV details with AI</h3><p>Review the exact minimized text and selected Pi model before authorizing one request. Your saved profile and other documents stay local.</p></div><div className="form-actions"><button className="primary-button" type="button" disabled={pdfBusy || aiBusy} onClick={() => void prepareProfileAi()}>{aiBusy ? 'Preparing AI preview…' : 'Preview AI request'}</button><button className="secondary-button" type="button" disabled={pdfBusy || aiBusy} onClick={() => setLocalOnlyReview(true)}>Continue locally</button></div></section>}
      {!aiPreview && localOnlyReview && <p className="profile-message" role="status">Local review selected. {aiDispatched ? 'No further AI request was sent.' : 'No request was sent.'} <button className="text-button" type="button" onClick={() => setLocalOnlyReview(false)}>Use AI instead</button></p>}
      {aiPreview && <section className="profile-panel ai-consent-review" role="region" aria-labelledby="profile-ai-consent-title"><h3 id="profile-ai-consent-title">Review text sent through Pi</h3><p>Destination: Pi · Provider: <strong>{aiPreview.providerId}</strong> · Model: <strong>{aiPreview.modelId}</strong> · Thinking level: <strong>{aiPreview.thinkingLevel}</strong></p><label>Exact outgoing text<textarea rows={10} readOnly value={aiPreview.outgoing} /></label><p role="note">{aiPreview.warning}</p><p>{aiPreview.termsNotice}</p><label className="pdf-include"><input type="checkbox" checked={aiAuthorized} onChange={event => setAiAuthorized(event.target.checked)} /> I authorize this one-time request to send the text above through Pi to the selected provider for CV structuring.</label><div className="form-actions"><button className="primary-button" type="button" disabled={!aiAuthorized || aiBusy} onClick={() => void authorizeProfileAi()}>{aiBusy ? 'Structuring CV…' : 'Send text and structure'}</button><button className="secondary-button" type="button" onClick={() => void cancelProfileAi()}>{aiBusy ? 'Cancel AI request' : 'Decline AI assistance'}</button></div></section>}
      <div className="profile-ai-proposals" inert={aiBusy} aria-busy={aiBusy}>

      {pdfPreview.proposals.contact && <fieldset className="pdf-proposal"><legend>Contact details</legend><label className="pdf-include"><input type="checkbox" checked={pdfSelected.contact} onChange={event => setPdfSelected(state => ({ ...state, contact: event.target.checked }))} /> Include this proposal</label>
        {(['fullName','headline','email','phone','location'] as const).map(field => <label key={field}>{field === 'fullName' ? 'Full name' : field[0].toUpperCase() + field.slice(1)}<input value={pdfPreview.proposals.contact?.[field] ?? ''} onChange={event => updatePdfProposal(current => ({ ...current, contact: { proposalRef: current.contact?.proposalRef ?? pdfPreview.proposals.contact!.proposalRef, ...(current.contact ?? {}), [field]: event.target.value } }))} /></label>)}{(pdfPreview.proposals.contact.links ?? []).map((link,index) => <div className="form-grid" key={`contact-link-${index}`}><label>Link name<input value={link.label} onChange={event => updatePdfProposal(current => ({ ...current, contact: { proposalRef: current.contact?.proposalRef ?? pdfPreview.proposals.contact!.proposalRef, ...current.contact, links: current.contact?.links?.map((item,i) => i === index ? { ...item, label: event.target.value } : item) } }))} /></label><label>Link URL<input value={link.url} onChange={event => updatePdfProposal(current => ({ ...current, contact: { proposalRef: current.contact?.proposalRef ?? pdfPreview.proposals.contact!.proposalRef, ...current.contact, links: current.contact?.links?.map((item,i) => i === index ? { ...item, url: event.target.value } : item) } }))} /></label></div>)}
        {pdfPreview.proposals.sources.filter(source => source.field.startsWith('contact.')).map((source,index) => <blockquote key={`contact-source-${index}`}><small>Page {source.page} · {source.field}</small><br />{source.passage}</blockquote>)}
        {renderMergeChoice(pdfPreview.proposals.contact.proposalRef, [pdfPreview.proposals.contact.fullName, pdfPreview.proposals.contact.email, pdfPreview.proposals.contact.phone, pdfPreview.proposals.contact.location].filter(Boolean).join(' · '), snapshot?.contact ? [{ id: snapshot.contact.id, label: snapshot.contact.fullName, current: [snapshot.contact.email, snapshot.contact.phone, snapshot.contact.location].filter(Boolean).join(' · ') }] : [], !snapshot?.contact)}
      </fieldset>}
      {pdfPreview.proposals.skills.map((skill,index) => <fieldset className="pdf-proposal" key={`skill-${index}`}><legend>Skill {index + 1}</legend><label className="pdf-include"><input type="checkbox" checked={pdfSelected.skills[index] ?? true} onChange={event => setPdfSelected(state => ({ ...state, skills: state.skills.map((value,i) => i === index ? event.target.checked : value) }))} /> Include this proposal</label><label>Skill name<input value={skill.name} onChange={event => updatePdfProposal(current => ({ ...current, skills: current.skills.map((value,i) => i === index ? { ...value, name: event.target.value } : value) }))} /></label><label>Skill category<select value={skill.category} onChange={event => updatePdfProposal(current => ({ ...current, skills: current.skills.map((value,i) => i === index ? { ...value, category: event.target.value } : value) }))}>{[...new Set(['Technical','Tools','Domain','Languages','Leadership','Other',skill.category])].map(category => <option key={category}>{category}</option>)}</select></label>{pdfPreview.proposals.sources.filter(source => source.proposalRef === skill.proposalRef).map((source,i) => <blockquote key={i}><small>Page {source.page}</small><br />{source.passage}</blockquote>)}{renderMergeChoice(skill.proposalRef, `${skill.name} · ${skill.category}`, (snapshot?.skills ?? []).filter(existing => existing.name.toLocaleLowerCase() === skill.name.toLocaleLowerCase() || existing.category.toLocaleLowerCase() === skill.category.toLocaleLowerCase()).map(existing => ({ id: existing.id, label: existing.name, current: `${existing.category}${existing.proficiency ? ` · ${existing.proficiency}` : ''}${existing.years == null ? '' : ` · ${existing.years} years`}` })))}</fieldset>)}
      {pdfPreview.proposals.experience.map((role,index) => <fieldset className="pdf-proposal" key={`experience-${index}`}><legend>{role.kind === 'training' ? 'Training' : role.kind === 'unresolved' ? 'Choose record type' : 'Experience'} {index + 1}</legend><label className="pdf-include"><input type="checkbox" checked={pdfSelected.experience[index] ?? (!role.requiresDateResolution && role.kind !== 'unresolved')} onChange={event => setPdfSelected(state => ({ ...state, experience: state.experience.map((value,i) => i === index ? event.target.checked : value) }))} /> Include this proposal</label>{role.kind === 'unresolved' && <p className="profile-message" role="note">Choose whether this record is Employment or Training before including it.</p>}{role.requiresDateResolution && <p className="profile-message" role="note">The original date needs a supported value before this record can be included, or leave it skipped.</p>}<div className="form-grid"><label>Record type<select aria-label="Record type" value={role.kind === 'unresolved' ? '' : role.kind} onChange={event => { const kind = event.target.value; if (kind === 'employment' || kind === 'training') { updatePdfProposal(current => ({ ...current, experience: current.experience.map((value,i) => i === index ? { ...value, kind } : value) })); setPdfSelected(state => ({ ...state, experience: state.experience.map((value,i) => i === index ? true : value) })) } }}><option value="" disabled>Choose a type</option><option value="employment">Employment</option><option value="training">Training</option></select></label><label>Title<input value={role.title} onChange={event => updatePdfProposal(current => ({ ...current, experience: current.experience.map((value,i) => i === index ? { ...value, title: event.target.value } : value) }))} /></label><label>Organization<input value={role.organization} onChange={event => updatePdfProposal(current => ({ ...current, experience: current.experience.map((value,i) => i === index ? { ...value, organization: event.target.value } : value) }))} /></label><label>Start date<input value={role.startDate ?? ''} onChange={event => updatePdfProposal(current => ({ ...current, experience: current.experience.map((value,i) => i === index ? { ...value, startDate: event.target.value || undefined } : value) }))} /></label><label>End date<input value={role.endDate ?? ''} onChange={event => updatePdfProposal(current => ({ ...current, experience: current.experience.map((value,i) => i === index ? { ...value, endDate: event.target.value || undefined } : value) }))} /></label><label className="wide-field">Source description<textarea rows={3} value={role.description} onChange={event => updatePdfProposal(current => ({ ...current, experience: current.experience.map((value,i) => i === index ? { ...value, description: event.target.value } : value) }))} /></label></div>{role.factualItems.map((fact,factIndex) => <div className="pdf-nested-proposal" key={factIndex}><label>Source factual item {factIndex + 1}<textarea rows={2} value={fact.text} onChange={event => updatePdfProposal(current => ({ ...current, experience: current.experience.map((value,i) => i === index ? { ...value, factualItems: value.factualItems.map((item,j) => j === factIndex ? { ...item, text: event.target.value } : item) } : value) }))} /></label>{renderMergeChoice(fact.proposalRef, fact.text, (experienceSnapshot.experience.find(existing => existing.id === pdfDecisions[role.proposalRef]?.targetId)?.factualItems ?? []).filter(existing => existing.text.toLocaleLowerCase().includes(fact.text.toLocaleLowerCase()) || fact.text.toLocaleLowerCase().includes(existing.text.toLocaleLowerCase())).map(existing => ({ id: existing.id, label: existing.text.slice(0, 80), current: existing.text })))}</div>)}{pdfPreview.proposals.sources.filter(source => source.proposalRef === role.proposalRef || role.factualItems.some(fact => fact.proposalRef === source.proposalRef)).map((source,i) => <blockquote key={i}><small>Original CV · Page {source.page} · {source.field}</small><br />{source.passage}</blockquote>)}{renderMergeChoice(role.proposalRef, `${role.title} · ${role.organization}`, experienceSnapshot.experience.filter(existing => existing.title.toLocaleLowerCase() === role.title.toLocaleLowerCase() || existing.organization.toLocaleLowerCase() === role.organization.toLocaleLowerCase()).map(existing => ({ id: existing.id, label: existing.title, current: [existing.organization, `${existing.startDate ?? 'date not set'}${existing.endDate ? ` – ${existing.endDate}` : ''}`, existing.description, ...existing.factualItems.map(fact => fact.text)].filter(Boolean).join(' · ') })))}</fieldset>)}
      {pdfPreview.proposals.entries.map((entry,index) => <fieldset className="pdf-proposal" key={`entry-${index}`}><legend>{entry.section[0].toUpperCase() + entry.section.slice(1)} {index + 1}</legend><label className="pdf-include"><input type="checkbox" checked={pdfSelected.entries[index] ?? !entry.requiresDateResolution} onChange={event => setPdfSelected(state => ({ ...state, entries: state.entries.map((value,i) => i === index ? event.target.checked : value) }))} /> Include this proposal</label>{entry.requiresDateResolution && <p className="profile-message" role="note">The source date is more precise than this profile field. Choose a supported value below or leave this record skipped.</p>}<label>Title<input value={entry.title} onChange={event => updatePdfProposal(current => ({ ...current, entries: current.entries.map((value,i) => i === index ? { ...value, title: event.target.value } : value) }))} /></label>{entry.institution !== undefined && <label>Institution<input value={entry.institution} onChange={event => updatePdfProposal(current => ({ ...current, entries: current.entries.map((value,i) => i === index ? { ...value, institution: event.target.value } : value) }))} /></label>}{entry.issuer !== undefined && <label>Issuer<input value={entry.issuer} onChange={event => updatePdfProposal(current => ({ ...current, entries: current.entries.map((value,i) => i === index ? { ...value, issuer: event.target.value } : value) }))} /></label>}{entry.section === 'certificates' && <label>Year<input type="number" min="1900" max="2200" value={entry.year ?? ''} onChange={event => updatePdfProposal(current => ({ ...current, entries: current.entries.map((value,i) => i === index ? { ...value, year: event.target.value ? Number(event.target.value) : undefined } : value) }))} /></label>}{(entry.section === 'education' || entry.startDate) && <label>Start date (year or year-month)<input value={entry.startDate} onChange={event => updatePdfProposal(current => ({ ...current, entries: current.entries.map((value,i) => i === index ? { ...value, startDate: event.target.value } : value) }))} /></label>}{(entry.section === 'education' || entry.endDate) && <label>End date (year or year-month)<input value={entry.endDate} onChange={event => updatePdfProposal(current => ({ ...current, entries: current.entries.map((value,i) => i === index ? { ...value, endDate: event.target.value } : value) }))} /></label>}{entry.description && <label>Description<textarea rows={3} value={entry.description} onChange={event => updatePdfProposal(current => ({ ...current, entries: current.entries.map((value,i) => i === index ? { ...value, description: event.target.value } : value) }))} /></label>}{entry.link && <label>Certificate link<input type="url" value={entry.link} onChange={event => updatePdfProposal(current => ({ ...current, entries: current.entries.map((value,i) => i === index ? { ...value, link: event.target.value || undefined } : value) }))} /></label>}{pdfPreview.proposals.sources.filter(source => source.proposalRef === entry.proposalRef).map((source,i) => <blockquote key={i}><small>Page {source.page} · {source.field}</small><br />{source.passage}</blockquote>)}{renderMergeChoice(entry.proposalRef, `${entry.section}: ${entry.title}`, [...(snapshot?.education ?? []), ...(snapshot?.certificates ?? []), ...(snapshot?.summary ?? []), ...(snapshot?.languages ?? []), ...(snapshot?.extras ?? [])].filter(existing => existing.section === entry.section && existing.title.toLocaleLowerCase() === entry.title.toLocaleLowerCase()).map(existing => ({ id: existing.id, label: existing.title, current: [existing.institution, existing.issuer, existing.startDate, existing.endDate, existing.description].filter(Boolean).join(' · ') })))}</fieldset>)}
      {pdfPreview.proposals.projects.map((project,index) => <fieldset className="pdf-proposal" key={`project-${index}`}><legend>Project {index + 1}</legend><label className="pdf-include"><input type="checkbox" checked={pdfSelected.projects[index] ?? true} onChange={event => setPdfSelected(state => ({ ...state, projects: state.projects.map((value,i) => i === index ? event.target.checked : value) }))} /> Include this proposal</label><label>Project name<input value={project.name} onChange={event => updatePdfProposal(current => ({ ...current, projects: current.projects.map((value,i) => i === index ? { ...value, name: event.target.value } : value) }))} /></label><label>Description<textarea rows={3} value={project.description} onChange={event => updatePdfProposal(current => ({ ...current, projects: current.projects.map((value,i) => i === index ? { ...value, description: event.target.value } : value) }))} /></label>{project.technologies.map((technology,technologyIndex) => <div className="pdf-nested-proposal" key={`technology-${technologyIndex}`}><label>Technology {technologyIndex + 1}<input value={technology.text} onChange={event => updatePdfProposal(current => ({ ...current, projects: current.projects.map((value,i) => i === index ? { ...value, technologies: value.technologies.map((item,j) => j === technologyIndex ? { ...item, text: event.target.value } : item) } : value) }))} /></label>{renderMergeChoice(technology.proposalRef, technology.text, (experienceSnapshot.projects.find(existing => existing.id === pdfDecisions[project.proposalRef]?.targetId)?.technologies ?? []).filter(existing => existing.text.toLocaleLowerCase().includes(technology.text.toLocaleLowerCase()) || technology.text.toLocaleLowerCase().includes(existing.text.toLocaleLowerCase())).map(existing => ({ id: existing.id, label: existing.text.slice(0, 80), current: existing.text })))}</div>)}{project.factualItems.map((fact,i) => <div className="pdf-nested-proposal" key={i}><label>Source factual item {i + 1}<textarea rows={2} value={fact.text} onChange={event => updatePdfProposal(current => ({ ...current, projects: current.projects.map((value,j) => j === index ? { ...value, factualItems: value.factualItems.map((item,k) => k === i ? { ...item, text: event.target.value } : item) } : value) }))} /></label>{renderMergeChoice(fact.proposalRef, fact.text, (experienceSnapshot.projects.find(existing => existing.id === pdfDecisions[project.proposalRef]?.targetId)?.factualItems ?? []).filter(existing => existing.text.toLocaleLowerCase().includes(fact.text.toLocaleLowerCase()) || fact.text.toLocaleLowerCase().includes(existing.text.toLocaleLowerCase())).map(existing => ({ id: existing.id, label: existing.text.slice(0, 80), current: existing.text })))}</div>)}{project.links.map((link,linkIndex) => <div className="form-grid" key={`project-link-${linkIndex}`}><label>Link label<input value={link.label} onChange={event => updatePdfProposal(current => ({ ...current, projects: current.projects.map((value,j) => j === index ? { ...value, links: value.links.map((item,k) => k === linkIndex ? { ...item, label: event.target.value } : item) } : value) }))} /></label><label>Link URL<input value={link.url} onChange={event => updatePdfProposal(current => ({ ...current, projects: current.projects.map((value,j) => j === index ? { ...value, links: value.links.map((item,k) => k === linkIndex ? { ...item, url: event.target.value } : item) } : value) }))} /></label></div>)}{pdfPreview.proposals.sources.filter(source => source.proposalRef === project.proposalRef || [...project.factualItems, ...project.technologies].some(item => item.proposalRef === source.proposalRef)).map((source,i) => <blockquote key={i}><small>Page {source.page} · {source.field}</small><br />{source.passage}</blockquote>)}{renderMergeChoice(project.proposalRef, project.name, experienceSnapshot.projects.filter(existing => existing.name.toLocaleLowerCase() === project.name.toLocaleLowerCase()).map(existing => ({ id: existing.id, label: existing.name, current: [existing.description, ...existing.technologies.map(item => item.text), ...existing.factualItems.map(item => item.text), ...existing.links.map(link => `${link.label}: ${link.url}`)].filter(Boolean).join(' · ') })))}</fieldset>)}
      {pdfPreview.proposals.unmapped.length > 0 && <details open><summary>Text not mapped to a profile field ({pdfPreview.proposals.unmapped.length})</summary><ul>{pdfPreview.proposals.unmapped.map((line,index) => <li key={index}>Page {line.page}: {line.text}</li>)}</ul></details>}
      <p>The original document was not copied or changed. Unmapped text stays review-only and is not included in profile data.</p><div className="form-actions"><button className="primary-button" type="button" disabled={pdfBusy || aiBusy || profileChangedDuringReview || (!pdfSelected.contact && !pdfSelected.skills.some(Boolean) && !pdfSelected.experience.some(Boolean) && !pdfSelected.entries.some(Boolean) && !pdfSelected.projects.some(Boolean))} onClick={() => void applyPdfReview()}>Apply accepted details</button><button className="secondary-button" type="button" disabled={pdfBusy} onClick={() => void cancelPdfReview()}>Discard review</button></div>
      </div></section>}
    {importPreview && <section className="profile-panel" role="dialog" aria-labelledby="import-preview-title"><h2 id="import-preview-title">Replace profile from JSON?</h2><p>This file contains personal data. Importing replaces your current profile; it does not merge records. Historical evidence revisions used by older drafts will be retained.</p><p>Current records: {importPreview.current.records}. Replacement records: {importPreview.replacement.records}.</p><ul aria-label="Replacement effects">{importPreview.effects.length ? importPreview.effects.map((effect, index) => <li key={`${effect.section}-${effect.action}-${index}`}>{effect.section} — {effect.action}: {effect.action === 'add' ? effect.replacementLabel : effect.action === 'remove' ? effect.currentLabel : `${effect.currentLabel} → ${effect.replacementLabel}`}</li>) : <li>No record-level changes detected.</li>}</ul><button className="primary-button" type="button" onClick={() => void applyImport()}>Confirm replacement</button><button className="secondary-button" type="button" onClick={() => void cancelImport()}>Cancel</button></section>}
    {activeSection === 'Personal' && <section className="profile-panel" aria-labelledby="contact-heading">
      <div className="panel-heading"><div><span className="context">Identity</span><h2 id="contact-heading">Contact details</h2><p>Keep the details you want available when preparing your CV.</p></div>
        {!contactEdit && snapshot?.contact && <button className="secondary-button" type="button" onClick={beginContactEdit}>Edit contact details</button>}
      </div>
      {snapshot?.contact && !contactEdit ? <div className="contact-summary">
        <h3>{snapshot.contact.fullName}</h3>{snapshot.contact.headline && <p>{snapshot.contact.headline}</p>}
        <dl>{snapshot.contact.email && <div><dt>Email</dt><dd>{snapshot.contact.email}</dd></div>}{snapshot.contact.phone && <div><dt>Phone</dt><dd>{snapshot.contact.phone}</dd></div>}{snapshot.contact.location && <div><dt>Location</dt><dd>{snapshot.contact.location}</dd></div>}{snapshot.contact.links?.map((link, index) => <div key={`${link.url}-${index}`}><dt>{link.label}</dt><dd>{link.url}</dd></div>)}</dl>
        <button className="text-button destructive" type="button" onClick={() => void deleteContact()}>Delete contact details</button>
      </div> : <form className="profile-form" onSubmit={event => void saveContact(event)} noValidate>
        <div className="form-grid">
          <label>Full name<input autoComplete="name" value={contact.fullName} onChange={event => updateContact('fullName', event.target.value)} aria-invalid={!!fieldErrors.fullName} aria-describedby={fieldErrors.fullName ? 'contact-fullName-error' : undefined} />{fieldErrors.fullName && <span className="field-error" id="contact-fullName-error">{fieldErrors.fullName}</span>}</label>
          <label>Professional headline<input value={contact.headline ?? ''} onChange={event => updateContact('headline', event.target.value)} aria-invalid={!!fieldErrors.headline} aria-describedby={fieldErrors.headline ? 'contact-headline-error' : undefined} />{fieldErrors.headline && <span className="field-error" id="contact-headline-error">{fieldErrors.headline}</span>}</label>
          <label>Email<input type="email" autoComplete="email" value={contact.email ?? ''} onChange={event => updateContact('email', event.target.value)} aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? 'contact-email-error' : undefined} />{fieldErrors.email && <span className="field-error" id="contact-email-error">{fieldErrors.email}</span>}</label>
          <label>Phone<input type="tel" autoComplete="tel" value={contact.phone ?? ''} onChange={event => updateContact('phone', event.target.value)} aria-invalid={!!fieldErrors.phone} aria-describedby={fieldErrors.phone ? 'contact-phone-error' : undefined} />{fieldErrors.phone && <span className="field-error" id="contact-phone-error">{fieldErrors.phone}</span>}</label>
          <label>Location<input autoComplete="address-level2" value={contact.location ?? ''} onChange={event => updateContact('location', event.target.value)} aria-invalid={!!fieldErrors.location} aria-describedby={fieldErrors.location ? 'contact-location-error' : undefined} />{fieldErrors.location && <span className="field-error" id="contact-location-error">{fieldErrors.location}</span>}</label>
        </div>
        <div className="links-editor"><div className="links-heading"><div><h3>Links</h3><p>Name the destinations you want to keep with your contact details.</p></div><button className="secondary-button" type="button" disabled={links.length >= 20} onClick={() => { setLinks(current => [...current, { key: ++nextLinkKey.current, label: '', url: '' }]); setFieldErrors({}) }}>Add link</button></div>
          {fieldErrors.links && <p className="field-error" role="alert">{fieldErrors.links}</p>}
          {links.map((link, index) => {
            const labelError = fieldErrors[`links.${index}.label`]
            const urlError = fieldErrors[`links.${index}.url`]
            return <div className="link-row" key={link.key}>
              <label>Link name {index + 1}<input value={link.label} onChange={event => changeLink(link.key, 'label', event.target.value)} aria-invalid={!!labelError} aria-describedby={labelError ? `link-label-error-${link.key}` : undefined} />{labelError && <span className="field-error" id={`link-label-error-${link.key}`}>{labelError}</span>}</label>
              <label>Link URL {index + 1}<input type="url" inputMode="url" value={link.url} onChange={event => changeLink(link.key, 'url', event.target.value)} aria-invalid={!!urlError} aria-describedby={urlError ? `link-url-error-${link.key}` : undefined} />{urlError && <span className="field-error" id={`link-url-error-${link.key}`}>{urlError}</span>}</label>
              <button className="text-button destructive" type="button" aria-label={`Remove ${link.label.trim() || `link ${index + 1}`}`} onClick={() => { setLinks(current => current.filter(item => item.key !== link.key)); setFieldErrors({}) }}>Remove</button>
            </div>
          })}
        </div>
        <div className="form-actions"><button className="primary-button" type="submit">Save contact details</button>{snapshot?.contact && <button className="secondary-button" type="button" onClick={() => { setContactEdit(false); setFieldErrors({}) }}>Cancel</button>}</div>
      </form>}
    </section>}
    {activeSection === 'Skills' && <section className="profile-panel" aria-labelledby="skills-heading">
      <div className="panel-heading"><div><span className="context">Evidence</span><h2 id="skills-heading">Skills</h2><p>Record skills by category. Proficiency and years are optional self-reported details.</p></div></div>
      <form className="profile-form skill-form" onSubmit={event => void saveSkill(event)} noValidate>
        <div className="form-grid skill-grid">
          <label>Skill name<input value={skill.name} onChange={event => updateSkill('name', event.target.value)} aria-invalid={!!fieldErrors.name} aria-describedby={fieldErrors.name ? 'skill-name-error' : undefined} />{fieldErrors.name && <span className="field-error" id="skill-name-error">{fieldErrors.name}</span>}</label>
          <FieldSelect id="skill-category" label="Skill category" value={skill.category} onValueChange={value => updateSkill('category', value)} options={categories.map(category => ({ value: category, label: category }))} error={fieldErrors.category} />
          <FieldSelect id="skill-proficiency" label="Proficiency (optional)" value={skill.proficiency ?? ''} onValueChange={value => updateSkill('proficiency', value)} options={[{ value: '', label: 'Not specified' }, ...(['beginner', 'intermediate', 'advanced', 'expert'] as const).map(value => ({ value, label: proficiencyLabels[value] }))]} error={fieldErrors.proficiency} />
          <label>Years of experience (optional)<input type="number" min="0" max="80" step="1" value={skill.years ?? ''} onChange={event => updateSkill('years', event.target.value)} aria-invalid={!!fieldErrors.years} aria-describedby={fieldErrors.years ? 'skill-years-error' : undefined} />{fieldErrors.years && <span className="field-error" id="skill-years-error">{fieldErrors.years}</span>}</label>
        </div>
        <div className="form-actions"><button className="primary-button" type="submit">{skillEditId ? 'Save skill' : 'Add skill'}</button>{skillEditId && <button className="secondary-button" type="button" onClick={resetSkill}>Cancel</button>}</div>
      </form>
      {snapshot?.skills.length ? <ul className="skill-list">{snapshot.skills.map(item => <li key={item.id}>
        <div className="skill-copy"><h3>{item.name}</h3><span className="category-tag">{item.category}</span>{item.proficiency && <span>{proficiencyLabels[item.proficiency] ?? item.proficiency}</span>}{item.years != null && <span>{item.years} {item.years === 1 ? 'year' : 'years'}</span>}</div>
        <div className="skill-actions"><button className="text-button" type="button" onClick={() => editSkill(item)}>Edit {item.name}</button><button className="text-button destructive" type="button" aria-label={`Delete ${item.name}`} onClick={() => void deleteSkill(item)}>Delete</button></div>
      </li>)}</ul> : <p className="empty-skills">No skills added yet.</p>}
    </section>}
    {(activeSection === 'Experience' || activeSection === 'Projects') && <ExperienceEditor key={activeSection} projects={activeSection === 'Projects'} />}
    {activeSection === 'Education' && <ProfileEntryEditor key="education" section="education" items={snapshot?.education ?? []} reload={reload} onError={setMutationError} onSuccess={setNotice} />}
    {activeSection === 'Certificates' && <ProfileEntryEditor key="certificates" section="certificates" items={snapshot?.certificates ?? []} reload={reload} onError={setMutationError} onSuccess={setNotice} />}
    {activeSection === 'Summary' && <ProfileEntryEditor key="summary" section="summary" items={snapshot?.summary ?? []} reload={reload} onError={setMutationError} onSuccess={setNotice} />}
    {activeSection === 'Languages' && <ProfileEntryEditor key="languages" section="languages" items={snapshot?.languages ?? []} reload={reload} onError={setMutationError} onSuccess={setNotice} />}
    {activeSection === 'Extras' && <ProfileEntryEditor key="extras" section="extras" items={snapshot?.extras ?? []} reload={reload} onError={setMutationError} onSuccess={setNotice} />}
    <p className="locality-note">Your profile is stored locally on this device. It is not synced or shared. Local storage does not guarantee that future cloud features will be anonymous.</p>
    {(mutationError || notice) && <p className={mutationError ? 'profile-message error' : 'profile-message success'} role={mutationError ? 'alert' : 'status'}>{mutationError || notice}{mutationError && <button className="text-button" type="button" onClick={() => void reload()}>Retry</button>}</p>}
  </div>
}

function ProfileEntryEditor({ section, items, reload, onError, onSuccess }: { section: ProfileEntryInput['section']; items: ProfileEntry[]; reload: () => Promise<void>; onError: (message: string) => void; onSuccess: (message: string) => void }) {
  const empty = (): ProfileEntryInput => ({ section, title: section === 'summary' ? 'Summary' : '', ...(section === 'summary' ? { description: '' } : {}) })
  const [form, setForm] = useState<ProfileEntryInput>(empty)
  const [editId, setEditId] = useState<string>()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const update = (key: keyof ProfileEntryInput, value: string) => setForm(old => ({ ...old, [key]: key === 'year' ? value ? Number(value) : undefined : value === '' ? undefined : value }))
  async function save(event: FormEvent) {
    event.preventDefault(); setErrors({}); onError(''); onSuccess('')
    try {
      const result = await window.workbench.saveProfileEntry({ ...form, id: editId })
      if (!result.ok) { setErrors(result.error.fieldErrors ?? {}); onError(result.error.message); return }
      setEditId(undefined); setForm(empty()); await reload(); onSuccess(`${section} saved`)
    } catch { onError(`The ${section} record could not be saved. Check the fields and try again.`) }
  }
  function edit(item: ProfileEntry) { const { id, revision, ...values } = item; setEditId(id); setForm(values); setErrors({}); onError(''); onSuccess('') }
  async function del(item: ProfileEntry) {
    if (!window.confirm(`Delete ${item.title}? This cannot be undone.`)) return
    try {
      const result = await window.workbench.deleteProfileEntry(item.id)
      if (!result.ok) { onError(result.error.message); return }
      await reload(); onSuccess(`${item.title} deleted`)
    } catch { onError(`${item.title} could not be deleted. Try again.`) }
  }
  const field = (key: keyof ProfileEntryInput, label: string, options: { type?: string; multiline?: boolean } = {}) => <label className="form-field" key={key}>{label}
    {options.multiline ? <textarea rows={4} value={String(form[key] ?? '')} onChange={event => update(key, event.target.value)} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${section}-${key}-error` : undefined} />
      : <input type={options.type ?? 'text'} value={String(form[key] ?? '')} onChange={event => update(key, event.target.value)} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${section}-${key}-error` : undefined} />}
    {errors[key] && <span className="field-error" id={`${section}-${key}-error`}>{errors[key]}</span>}
  </label>
  const localOnly = section === 'summary' || section === 'languages' || section === 'extras'
  return <section className="profile-panel profile-entry-editor" aria-labelledby="entry-heading">
    <div className="panel-heading"><div><h2 id="entry-heading">{section[0].toUpperCase() + section.slice(1)}</h2><p>{localOnly ? 'Saved in your profile, not included in CV output.' : 'Keep these profile facts accurate. Edits retain their earlier revisions.'}</p></div></div>
    <form className="profile-form profile-entry-form" onSubmit={event => void save(event)} noValidate>
      <div className="form-grid profile-entry-grid">
        {section === 'summary' ? <div className="wide-field">{field('description', 'Summary', { multiline: true })}</div> : <>
          <div className={section === 'languages' || section === 'extras' ? 'wide-field' : undefined}>{field('title', section === 'languages' ? 'Language' : section === 'extras' ? 'Name' : 'Title')}</div>
          {section === 'education' && <>
            {field('institution', 'Institution')}
            <div className="wide-field">{field('field', 'Degree or field')}</div>
            <MonthYearPicker id="education-start" label="Start date" value={form.startDate} onChange={value => update('startDate', value ?? '')} error={errors.startDate} />
            <MonthYearPicker id="education-end" label="End date" value={form.endDate} onChange={value => update('endDate', value ?? '')} error={errors.endDate} />
          </>}
          {section === 'certificates' && <>
            {field('issuer', 'Issuer')}
            <MonthYearPicker id="certificate-year" label="Year" yearOnly value={form.year?.toString()} onChange={value => update('year', value ?? '')} error={errors.year} />
            <div className="wide-field">{field('link', 'Certificate link', { type: 'url' })}</div>
          </>}
          {section === 'languages' && <div className="wide-field">{field('description', 'Proficiency (optional)')}</div>}
          {section === 'extras' && <div className="wide-field">{field('description', 'Details (optional)', { multiline: true })}</div>}
        </>}
      </div>
      <div className="form-actions"><button className="primary-button" type="submit">{editId ? 'Save changes' : `Add ${section}`}</button>{editId && <button className="secondary-button" type="button" onClick={() => { setEditId(undefined); setForm(empty()); setErrors({}) }}>Cancel</button>}</div>
    </form>
    {items.length ? <div className="evidence-records"><h3>Saved {section}</h3><ul className="skill-list">{items.map(item => <li key={item.id}>
      <div><h3>{item.title}</h3><div className="entry-meta">{item.institution && <span>{item.institution}</span>}{item.field && <span>{item.field}</span>}{item.issuer && <span>{item.issuer}</span>}{item.year && <span>{item.year}</span>}{item.startDate && <span>{item.startDate} – {item.endDate ?? 'Present'}</span>}</div>{item.description && <p className="entry-description">{item.description}</p>}</div>
      <div className="skill-actions"><button className="text-button" type="button" onClick={() => edit(item)}>Edit {item.title}</button><button className="text-button destructive" type="button" onClick={() => void del(item)}>Delete</button></div>
    </li>)}</ul></div> : <p className="empty-skills">No {section} added yet. Add your first record above.</p>}
  </section>
}
