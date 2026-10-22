import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertTriangle, BriefcaseBusiness, FileText, LayoutPanelLeft, Moon, PanelLeftClose, PanelLeftOpen, Plus, Settings2, Sun, UserRound } from 'lucide-react'
import type { Appearance } from '../shared/appearance'
import type { WorkspaceBackupStatus } from '../shared/workspace-backup'
import { OpenRouterSettingsPanel } from './OpenRouterSettings'
import { WorkspaceBackup } from './WorkspaceBackup'
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem('cv-tailor-sidebar-collapsed') === 'true' }
    catch { return false }
  })
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [backupStatus, setBackupStatus] = useState<WorkspaceBackupStatus | null>(null)
  const [activeJob, setActiveJob] = useState<JobRecord | null>(null)
  const [workspaceRevision, setWorkspaceRevision] = useState(0)
  const contentRef = useRef<HTMLElement>(null)
  useEffect(() => {
    window.workbench.getSettings().then(settings => { setAppearance(settings.appearance); setReady(true) }).catch(() => setError('Could not open workspace settings. Restart the app to retry.'))
    window.workbench.getWorkspaceBackupStatus().then(setBackupStatus).catch(() => {})
    window.workbench.listJobs().then(setJobs).catch(() => setError('Saved postings could not be loaded. Restart the app to retry.'))
  }, [])
  useEffect(() => { if (ready) contentRef.current?.focus() }, [page, ready])
  function keepJob(job: JobRecord) {
    setJobs(current => [job, ...current.filter(item => item.id !== job.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))])
    setActiveJob(job)
    void window.workbench.getWorkspaceBackupStatus().then(setBackupStatus).catch(() => {})
  }
  async function afterWorkspaceRestore() {
    const [settings, savedJobs, nextBackupStatus] = await Promise.all([window.workbench.getSettings(), window.workbench.listJobs(), window.workbench.getWorkspaceBackupStatus()])
    setAppearance(settings.appearance)
    setBackupStatus(nextBackupStatus)
    setJobs(savedJobs)
    setActiveJob(null)
    setWorkspaceRevision(value => value + 1)
  }
  async function activateJob(id: string) {
    try { const job = await window.workbench.openJob(id); setActiveJob(job) }
    catch { setError('The selected saved posting could not be opened.') }
  }
  useEffect(() => {
    if (!backupStatus || backupStatus.backupable) return
    let active = true
    const refresh = () => { void window.workbench.getWorkspaceBackupStatus().then(status => { if (active) setBackupStatus(status) }).catch(() => {}) }
    const timer = window.setInterval(refresh, 2000)
    return () => { active = false; window.clearInterval(timer) }
  }, [backupStatus?.backupable])
  useEffect(() => { document.documentElement.dataset.appearance = appearance }, [appearance])
  useEffect(() => {
    try { window.localStorage.setItem('cv-tailor-sidebar-collapsed', String(sidebarCollapsed)) }
    catch { /* Keep the choice for this session if browser storage is unavailable. */ }
  }, [sidebarCollapsed])
  async function changeAppearance(value: Appearance) {
    try { const saved = await window.workbench.setAppearance(value); setAppearance(saved.appearance); setError('') }
    catch { setError('Appearance could not be saved. Try again.') }
  }
  if (!ready && !error) return <div className="loading" role="status">Opening your workspace…</div>
  return <div className="workbench" data-sidebar-collapsed={sidebarCollapsed} data-ui-ready={ready ? 'true' : undefined}>
    <a className="skip" href="#content">Skip to content</a>
    <aside id="workspace-sidebar" className="sidebar" aria-label="Workspace navigation">
      <div className="sidebar-top"><div className="brand"><span className="brand-icon"><LayoutPanelLeft aria-hidden="true" size={20} /></span><div className="brand-name"><strong>CV Tailor</strong><small>Your experience, supported.</small></div></div><button type="button" className="sidebar-toggle" aria-controls="workspace-sidebar" aria-expanded={!sidebarCollapsed} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : undefined} onClick={() => setSidebarCollapsed(value => !value)}>{sidebarCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}<span className="sidebar-toggle-label">Collapse sidebar</span></button><AppearanceControls className="sidebar-appearance" appearance={appearance} change={value => void changeAppearance(value)} /></div>
      <nav aria-label="Main navigation">{pages.map(({ label, icon: Icon }) => <button type="button" key={label} aria-label={label} title={sidebarCollapsed ? label : undefined} aria-current={page === label ? 'page' : undefined} onClick={() => setPage(label)}><Icon size={18} aria-hidden="true" /><span className="sidebar-nav-label">{label}</span></button>)}</nav>
      <div className="sidebar-jobs"><div className="section-label">Saved jobs <span>{jobs.length}</span></div>{jobs.length > 0 && <div className="sidebar-job-items">{jobs.map(job => <button type="button" key={job.id} aria-current={activeJob?.id === job.id ? 'true' : undefined} onClick={() => { setPage('Tailor CV'); void activateJob(job.id) }}>{job.title}<small>{job.company}</small></button>)}</div>}<button type="button" className="sidebar-new-job" onClick={() => setPage('Saved jobs')}><Plus size={16} aria-hidden="true" /> New job</button></div>
      <div className="sidebar-bottom"><div className="storage-note">Personal workspace<br /><span>Saved on this device</span></div></div>
    </aside>
    <div className="workspace-main">
      <header className="header"><span className="breadcrumb">Workspace <span aria-hidden="true">/</span> {page}</span><AppearanceControls className="header-appearance" appearance={appearance} change={value => void changeAppearance(value)} /></header>
      {error && <p role="alert" className="error">{error}</p>}
      {backupStatus && !backupStatus.backupable && <aside className="backup-capacity-warning" role="status" aria-label="Workspace backup limits">
        <AlertTriangle size={20} aria-hidden="true" /><div><p><strong>This workspace is above its backup safety limits.</strong></p><p>Saved data remains intact. Backups and changes that increase stored size are blocked; no history is deleted. A shorter working posting helps only if the complete saved record becomes smaller.</p></div>
        <button type="button" className="secondary-button" onClick={() => setPage('Saved jobs')}>Review saved postings</button>
      </aside>}
      <main id="content" ref={contentRef} tabIndex={-1}>
        {(page === 'My profile' || page === 'Settings') && <div className="title"><span className="context">Personal workspace</span><h1>{page}</h1><p>{page === 'My profile' ? 'Keep the career facts that support your CV in one place.' : 'Manage the model and credentials for future CV generation.'}</p></div>}
        {page === 'Tailor CV' ? <WorkbenchStart key={workspaceRevision} activeJob={activeJob} onNavigate={setPage} /> : page === 'My profile' ? <ProfileEditor key={workspaceRevision} /> : page === 'Saved jobs' ? <SavedJobs key={workspaceRevision} jobs={jobs} activeJob={activeJob} onSaved={keepJob} onOpened={keepJob} onNavigate={setPage} /> : <div className="settings-page"><OpenRouterSettingsPanel key={workspaceRevision} /><WorkspaceBackup onRestored={afterWorkspaceRestore} /></div>}
      </main>
    </div>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
