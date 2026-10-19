import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BriefcaseBusiness, FileText, LayoutPanelLeft, Moon, Settings2, Sun, UserRound } from 'lucide-react'
import type { Appearance } from '../shared/appearance'
import './style.css'

type Page = 'Tailor CV' | 'Saved jobs' | 'My profile' | 'Settings'
const pages = [
  { label: 'Tailor CV', icon: FileText },
  { label: 'Saved jobs', icon: BriefcaseBusiness },
  { label: 'My profile', icon: UserRound },
  { label: 'Settings', icon: Settings2 }
] as const

function App() {
  const [appearance, setAppearance] = useState<Appearance>('light')
  const [page, setPage] = useState<Page>('Tailor CV')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  useEffect(() => {
    window.workbench.getSettings().then(settings => {
      setAppearance(settings.appearance)
      setReady(true)
    }).catch(() => setError('Could not open workspace settings. Restart the app to retry.'))
  }, [])
  useEffect(() => { document.documentElement.dataset.appearance = appearance }, [appearance])
  async function changeAppearance(value: Appearance) {
    try {
      const saved = await window.workbench.setAppearance(value)
      setAppearance(saved.appearance)
      setError('')
    } catch {
      setError('Appearance could not be saved. Try again.')
    }
  }
  if (!ready && !error) return <div className="loading" role="status">Opening your workspace…</div>
  return <div className="workbench" data-ui-ready={ready ? 'true' : undefined}>
    <a className="skip" href="#content">Skip to content</a>
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="brand"><span className="brand-icon"><LayoutPanelLeft aria-hidden="true" size={20} /></span><div><strong>CV Tailor</strong><small>Your experience, supported.</small></div></div>
      <nav aria-label="Main navigation">{pages.map(({ label, icon: Icon }) => <button type="button" key={label} aria-current={page === label ? 'page' : undefined} onClick={() => setPage(label)}><Icon size={18} aria-hidden="true" />{label}</button>)}</nav>
      <div className="sidebar-jobs"><div className="section-label">Saved postings <span>0</span></div><p>No saved jobs yet. Job creation is coming in the next release slice.</p></div>
      <div className="sidebar-bottom"><div className="storage-note">Personal workspace<br /><span>Saved on this device</span></div></div>
    </aside>
    <div className="workspace-main">
      <header className="header"><span className="breadcrumb">Workspace <span aria-hidden="true">/</span> {page}</span><div className="appearance" role="group" aria-label="Color appearance"><button type="button" aria-label="Use light mode" aria-pressed={appearance === 'light'} onClick={() => void changeAppearance('light')}><Sun size={16} aria-hidden="true" /> Light</button><button type="button" aria-label="Use dark mode" aria-pressed={appearance === 'dark'} onClick={() => void changeAppearance('dark')}><Moon size={16} aria-hidden="true" /> Dark</button></div></header>
      {error && <p role="alert" className="error">{error}</p>}
      <main id="content" tabIndex={-1}>
        <div className="title"><span className="context">Personal workspace</span><h1>{page === 'Tailor CV' ? 'Start with your experience' : page}</h1><p>{page === 'Tailor CV' ? 'Build your profile, then tailor a CV to a saved posting.' : page === 'Saved jobs' ? 'Your job postings and their drafts will live here.' : page === 'My profile' ? 'Keep the career facts that support your CV in one place.' : 'Choose how your workspace looks.'}</p></div>
        {page === 'Tailor CV' ? <div className="columns"><section className="document-area" aria-label="CV document"><div className="document-toolbar"><span>CV document</span><span>Not started</span></div><div className="paper-wrap"><article className="paper"><div className="paper-header"><strong>Your name</strong><span>Your CV begins here</span></div><div className="paper-rule" /><h2>Education</h2><div className="paper-line" /><h2>Experience</h2><div className="paper-line" /><h2>Projects</h2><div className="paper-line" /><h2>Skills</h2><div className="paper-line" /><h2>Certificates</h2><div className="paper-line" /><p className="paper-hint">Add your career facts in My profile when profile editing becomes available.</p></article></div></section><aside className="inspector" aria-label="Evidence and coverage"><div className="inspector-tabs"><span>Evidence</span><span>Coverage</span></div><div className="inspector-content"><h2>Nothing to inspect yet</h2><p>Once a draft is generated, select a paragraph to see its supporting profile evidence here.</p><div className="inspector-divider" /><h2>Qualification gaps</h2><p>Job requirements without supporting experience will appear as advisory gaps, not invented claims.</p></div></aside></div> : <div className="empty-panel"><h2>{page === 'Settings' ? 'Appearance' : page === 'My profile' ? 'Your career record' : 'No saved postings'}</h2><p>{page === 'Settings' ? 'Use the Light and Dark controls in the header. Your choice is saved locally and restored when you reopen the app.' : page === 'My profile' ? 'Profile editing is not available in this first installable slice. No sample personal data is included.' : 'Saving postings is not available in this first installable slice. Your workspace is ready for the next steps.'}</p></div>}
      </main>
    </div>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
