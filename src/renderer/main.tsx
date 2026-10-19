import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BriefcaseBusiness, FileText, LayoutPanelLeft, Moon, Settings2, Sun, UserRound } from 'lucide-react'
import type { Appearance } from '../shared/appearance'
import { GeminiSettingsPanel } from './GeminiSettings'
import { ProfileEditor } from './ProfileEditor'
import { SavedJobs } from './SavedJobs'
import { WorkbenchStart } from './WorkbenchStart'
import type { JobRecord } from '../shared/jobs'
import './style.css'

type Page = 'Tailor CV' | 'Saved jobs' | 'My profile' | 'Settings'
const pages = [
  { label: 'Tailor CV', icon: FileText },
  { label: 'Saved jobs', icon: BriefcaseBusiness },
  { label: 'My profile', icon: UserRound },
  { label: 'Settings', icon: Settings2 }
] as const
function AppearanceControls({ appearance, change, className }: { appearance: Appearance; change: (value: Appearance) => void; className: string }) {
  return <div className={`appearance ${className}`} role="group" aria-label="Color appearance"><button type="button" aria-label="Use light mode" aria-pressed={appearance === 'light'} onClick={() => change('light')}><Sun size={16} aria-hidden="true" /> Light</button><button type="button" aria-label="Use dark mode" aria-pressed={appearance === 'dark'} onClick={() => change('dark')}><Moon size={16} aria-hidden="true" /> Dark</button></div>
}
function App() {
  const [appearance, setAppearance] = useState<Appearance>('light')
  const [page, setPage] = useState<Page>('Tailor CV')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [activeJob, setActiveJob] = useState<JobRecord | null>(null)
  useEffect(() => {
    window.workbench.getSettings().then(settings => { setAppearance(settings.appearance); setReady(true) }).catch(() => setError('Could not open workspace settings. Restart the app to retry.'))
    window.workbench.listJobs().then(setJobs).catch(() => setError('Saved postings could not be loaded. Restart the app to retry.'))
  }, [])
  function keepJob(job: JobRecord) {
    setJobs(current => [job, ...current.filter(item => item.id !== job.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))])
    setActiveJob(job)
  }
  async function activateJob(id: string) {
    try { const job = await window.workbench.openJob(id); setActiveJob(job) }
    catch { setError('The selected saved posting could not be opened.') }
  }
  useEffect(() => { document.documentElement.dataset.appearance = appearance }, [appearance])
  async function changeAppearance(value: Appearance) {
    try { const saved = await window.workbench.setAppearance(value); setAppearance(saved.appearance); setError('') }
    catch { setError('Appearance could not be saved. Try again.') }
  }
  if (!ready && !error) return <div className="loading" role="status">Opening your workspace…</div>
  return <div className="workbench" data-ui-ready={ready ? 'true' : undefined}>
    <a className="skip" href="#content">Skip to content</a>
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="sidebar-top"><div className="brand"><span className="brand-icon"><LayoutPanelLeft aria-hidden="true" size={20} /></span><div><strong>CV Tailor</strong><small>Your experience, supported.</small></div></div><AppearanceControls className="sidebar-appearance" appearance={appearance} change={value => void changeAppearance(value)} /></div>
      <nav aria-label="Main navigation">{pages.map(({ label, icon: Icon }) => <button type="button" key={label} aria-current={page === label ? 'page' : undefined} onClick={() => setPage(label)}><Icon size={18} aria-hidden="true" />{label}</button>)}</nav>
      <div className="sidebar-jobs"><div className="section-label">Saved postings <span>{jobs.length}</span></div>{jobs.length ? <div className="sidebar-job-items">{jobs.map(job => <button type="button" key={job.id} aria-current={activeJob?.id === job.id ? 'true' : undefined} onClick={() => { setPage('Tailor CV'); void activateJob(job.id) }}>{job.title}<small>{job.company}</small></button>)}</div> : <p>No saved postings yet. Use Saved jobs to add your first target.</p>}</div>
      <div className="sidebar-bottom"><div className="storage-note">Personal workspace<br /><span>Saved on this device</span></div></div>
    </aside>
    <div className="workspace-main">
      <header className="header"><span className="breadcrumb">Workspace <span aria-hidden="true">/</span> {page}</span><AppearanceControls className="header-appearance" appearance={appearance} change={value => void changeAppearance(value)} /></header>
      {error && <p role="alert" className="error">{error}</p>}
      <main id="content" tabIndex={-1}>
        {page === 'Tailor CV' ? <div className="title cv-title"><h1>Your CV workbench</h1><p>Bring your original career facts and a saved job together before drafting a tailored CV.</p></div> : <div className="title"><span className="context">Personal workspace</span><h1>{page}</h1><p>{page === 'Saved jobs' ? 'Keep original job postings ready to revisit, even offline.' : page === 'My profile' ? 'Keep the career facts that support your CV in one place.' : 'Manage the model and credentials for future CV generation.'}</p></div>}
        {page === 'Tailor CV' ? <WorkbenchStart activeJob={activeJob} jobCount={jobs.length} onNavigate={setPage} /> : page === 'My profile' ? <ProfileEditor /> : page === 'Saved jobs' ? <SavedJobs jobs={jobs} activeJob={activeJob} onSaved={keepJob} onOpened={keepJob} /> : <div className="settings-page"><GeminiSettingsPanel /></div>}
      </main>
    </div>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
