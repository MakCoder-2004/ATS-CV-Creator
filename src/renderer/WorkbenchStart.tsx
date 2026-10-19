import { useEffect, useState } from 'react'
import { BriefcaseBusiness, FileText, UserRound } from 'lucide-react'
import type { ExperienceSnapshot } from '../shared/experience'
import type { JobRecord } from '../shared/jobs'
import type { ProfileSnapshot } from '../shared/profile'
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
    <aside className="inspector" aria-label="Workspace guide">
      <div className="inspector-heading"><h2>Prepare your workspace</h2><p>Two things anchor a tailored CV: what you have done and the role you are targeting.</p></div>
      {error ? <div className="inspector-error" role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={() => setAttempt(value => value + 1)}>Retry loading sources</button></div> : !sources ? <p className="inspector-loading" role="status">Reading your local profile…</p> : <ol className="prep-list">
        <li><span className="prep-index" aria-hidden="true">01</span><div className="prep-content"><div className="prep-label"><UserRound size={16} aria-hidden="true" /><h3>Your profile</h3></div><p>{total ? `${total} ${total === 1 ? 'record' : 'records'} across CV sections${profile?.contact ? ', with your name saved' : ''}.` : profile?.contact ? 'Your name is saved. Add experience or other CV facts next.' : 'Add your name and genuine career facts.'}</p><button type="button" className="prep-link" onClick={() => onNavigate('My profile')}>{total ? 'Review profile' : 'Build your profile'}</button></div></li>
        <li><span className="prep-index" aria-hidden="true">02</span><div className="prep-content"><div className="prep-label"><BriefcaseBusiness size={16} aria-hidden="true" /><h3>Target job</h3></div><p>{activeJob ? `${activeJob.title} at ${activeJob.company} is selected.` : jobCount ? `${jobCount} saved ${jobCount === 1 ? 'posting' : 'postings'}. Choose the role you want to target.` : 'Save a posting so you can return to its original requirements.'}</p><button type="button" className="prep-link" onClick={() => onNavigate('Saved jobs')}>{activeJob ? 'Change target' : jobCount ? 'Choose a saved job' : 'Save a job posting'}</button></div></li>
      </ol>}
      <div className="inspector-future"><h3>Evidence &amp; coverage</h3><p>Once a draft exists, this space will show its sources and qualification gaps. No posting has been analyzed here.</p><p className="future-note">Drafting isn't available yet. Nothing is sent to Gemini from this page.</p></div>
    </aside>
  </div>
}
