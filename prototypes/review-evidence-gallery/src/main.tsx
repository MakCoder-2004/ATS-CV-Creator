import { useEffect, useRef, useState, type RefObject } from 'react'
import { createRoot } from 'react-dom/client'
import { BookOpen, BriefcaseBusiness, Check, ChevronDown, CircleHelp, FileText, ListChecks, Moon, PanelRightOpen, Sun, X } from 'lucide-react'
import './style.css'

const names = ['Compact focus rail', 'On-demand drawer', 'Wide evidence shelf', 'Next-decision queue', 'Paired source comparison']
const views = ['Sources', 'New skills', 'Job match', 'Checks & options'] as const
type View = typeof views[number]
const viewIcon = [BookOpen, ListChecks, BriefcaseBusiness, CircleHelp]
const passages = [
  { id: 'education', section: 'Education', title: 'B.Sc. in Computer Science', meta: 'Cairo University · 2021–2025', text: 'Graduated with a degree in Computer Science, with coursework in machine learning and computer vision.', source: 'Cairo University · Education record', evidence: 'Bachelor of Science in Computer Science. Coursework: Machine Learning, Computer Vision, Algorithms.', why: 'Keeps the degree and study area visible for this role. Coursework is not presented as professional experience.' },
  { id: 'experience', section: 'Experience', title: 'Machine Learning Trainee', meta: 'National Telecommunication Institute · Aug–Sep 2025', text: 'Completed a 120-hour machine learning program with hands-on Python, Scikit-learn, and TensorFlow model development across NLP and computer vision tasks.', source: 'NTI · Training record', evidence: 'Completed a 120-hour intensive machine learning program covering core ML concepts, deep learning fundamentals, and applied model development. Hands-on work using Python, Scikit-learn, and TensorFlow across NLP and computer vision tasks.', why: 'Supports Python, TensorFlow, and computer vision while retaining the training label.' },
  { id: 'project', section: 'Projects', title: 'Parking Spots Detection', meta: 'TensorFlow · OpenCV · ResNet50', text: 'Developed a real-time parking-space classification system using a fine-tuned ResNet50 with TensorFlow/Keras. Integrated OpenCV video processing, motion detection, batch inference, and GPU acceleration to visualize parking availability.', source: 'Parking Spots Detection · Project description', evidence: 'Developed a real-time parking spot detection system using a fine-tuned ResNet50 model with TensorFlow/Keras to classify parking spaces as occupied or empty. Integrated OpenCV-based video processing with motion detection and batch inference for optimized real-time performance.', why: 'Direct project evidence for transfer learning and image classification; does not imply production deployment.' },
]
const skills = [
  { group: 'Languages', items: 'Python · C++ · JavaScript · SQL' },
  { group: 'Technologies', items: 'TensorFlow · OpenCV · Scikit-learn · FastAPI' },
  { group: 'Concepts', items: 'Computer vision · Model evaluation · Transfer learning' },
]
const icons = [BookOpen, ListChecks, BriefcaseBusiness, CircleHelp]

function App() {
  const params = new URLSearchParams(location.search)
  const initialVariant = Math.min(4, Math.max(0, Number(params.get('variant') ?? 0)))
  const [variant, setVariant] = useState(initialVariant)
  const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light')
  const [selected, setSelected] = useState('experience')
  const [view, setView] = useState<View>('Sources')
  const [detailsOpen, setDetailsOpen] = useState(variant === 0 && matchMedia('(min-width: 1240px)').matches)
  const [compareOpen, setCompareOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [decision, setDecision] = useState<'pending' | 'confirmed' | 'removed'>('pending')
  const [wide, setWide] = useState(() => matchMedia('(min-width: 1240px)').matches)
  const detailTrigger = useRef<HTMLButtonElement>(null)
  const compareTrigger = useRef<HTMLButtonElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const detailsDialogRef = useRef<HTMLDialogElement>(null)
  const passage = passages.find(item => item.id === selected) ?? passages[1]

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    const url = new URL(location.href)
    url.searchParams.set('variant', String(variant))
    url.searchParams.set('theme', theme)
    history.replaceState(null, '', url)
  }, [variant, theme])
  useEffect(() => { setDetailsOpen(variant === 0 && wide); setCompareOpen(false) }, [variant, wide])
  useEffect(() => { const media = matchMedia('(min-width: 1240px)'); const update = () => setWide(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update) }, [])
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (compareOpen && !dialog.open) dialog.showModal()
    if (!compareOpen && dialog.open) dialog.close()
  }, [compareOpen])
  useEffect(() => {
    const dialog = detailsDialogRef.current
    if (!dialog) return
    if (detailsOpen && !dialog.open) dialog.showModal()
    if (!detailsOpen && dialog.open) dialog.close()
  }, [detailsOpen])
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setDetailsOpen(false); setCompareOpen(false) } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  function setNamedView(next: View) { setView(next); setDetailsOpen(true) }
  function closeCompare() { setCompareOpen(false); requestAnimationFrame(() => (compareTrigger.current ?? selectedRef.current)?.focus()) }
  function closeDetails() { setDetailsOpen(false); requestAnimationFrame(() => (detailTrigger.current ?? selectedRef.current)?.focus()) }

  const actionbar = <section className="actionbar" aria-label="Review actions">
    <div className="action-copy"><h2>Review this wording</h2><p>Read the draft and its sources before deciding what to change.</p></div>
    <div className="action-state"><span><Check size={16} aria-hidden="true" /> Demo-only review</span><span>Page fit not measured</span></div>
    <label className="ack"><input type="checkbox" /> I reviewed this wording (demo only)</label>
  </section>

  const navViews = <nav className="view-nav" aria-label="Review detail views">{views.map((label, i) => { const Icon = icons[i]; return <button type="button" key={label} aria-pressed={view === label} onClick={() => setNamedView(label)}><Icon size={17} aria-hidden="true"/><span>{label}</span></button> })}</nav>

  const content = <DetailContent view={view} passage={passage} sourceOpen={sourceOpen} setSourceOpen={setSourceOpen} decision={decision} setDecision={setDecision} />

  const desktopDetails = wide && (variant === 0 || (variant === 1 && detailsOpen) || variant === 3)
  const modalDetails = <dialog ref={detailsDialogRef} className="details-dialog" aria-label="Review details" onCancel={e => { e.preventDefault(); closeDetails() }}><header><div><span className="eyebrow">Review details</span><h2>{variant === 3 ? 'Your next decisions' : 'Evidence and context'}</h2></div><button className="icon-button" type="button" aria-label="Close review details" onClick={closeDetails}><X size={20}/></button></header>{variant === 3 && <Queue onChoose={setNamedView} />}{navViews}{content}</dialog>

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">c</span><strong>CV Tailor</strong></div><p className="side-label">WORKSPACE</p><nav className="primary-nav" aria-label="Workspace"><a href="#" aria-current="page">Tailor CV</a><a href="#">Saved jobs</a><a href="#">My profile</a><a href="#">Settings</a></nav><p className="side-label jobs-label">SAVED JOBS</p><button className="job-link" type="button"><span className="job-dot">N</span><span>Machine Learning Engineer<small>Northstar Labs</small></span></button><div className="side-foot">Local workspace<br/><span>Fictional review fixture</span></div></aside>
    <main id="main" className="main">
      <header className="topbar"><div><span>Workspace</span><b>/</b><strong>Tailor CV</strong></div><div className="top-actions"><span className="demo-pill">Browser-only concept</span><button type="button" className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} appearance`}>{theme === 'light' ? <Moon size={17}/> : <Sun size={17}/>}<span>{theme === 'light' ? 'Dark' : 'Light'} mode</span></button></div></header>
      <div className="page-content">
        <header className="page-heading"><div><h1>Review your CV</h1><p>Make it yours. Review the wording, sources, and job context.</p></div><div className="job-context"><span className="company-mark">N</span><span><strong>Machine Learning Engineer</strong><small>Northstar Labs · saved posting</small></span></div></header>
        <nav className="stages" aria-label="Tailoring stages"><ol>{['Job posting','Outgoing data','Generate','Review evidence','Export'].map((label,i)=><li key={label} aria-current={i===3?'step':undefined}><span>{i+1}</span>{label}</li>)}</ol></nav>
        <section className="gallery-bar" aria-label="Prototype controls"><label>Review arrangement<select value={variant} onChange={e => {setVariant(Number(e.target.value)); setView('Sources')}}>{names.map((name,i)=><option value={i} key={name}>{i+1}. {name}</option>)}</select></label><div><span>Five review patterns</span><span className="gallery-divider"/><span>Same fictional CV</span></div></section>
        <div className="demo-notice"><strong>Design demo only</strong><span>All records are fictional. Nothing is checked, verified, saved, approved, or exported here.</span></div>
        {actionbar}
        <div className={`review-layout variant-${variant+1}`}>
          <section className="document-column" aria-label="CV document">
            <div className="document-tools"><div><FileText size={16}/><strong>Tailored CV</strong><span>Review layout · not pagination</span></div><span>Letter proportions</span></div>
            <article className="paper" aria-label="Fictional CV preview">
              <header className="cv-identity"><h2>Amira Hassan</h2><p>Cairo, Egypt <i/> amira.hassan@example.test <i/> portfolio.example.test</p></header>
              {passages.slice(0,1).map(item => <CVSection key={item.id} passage={item} selected={selected === item.id} onSelect={setSelected} setCompare={() => {setCompareOpen(true);requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLButtonElement>('[data-close]')?.focus())}} variant={variant} compareTrigger={compareTrigger} selectedRef={selectedRef}/>)}
              <section className="cv-section"><h3>Experience</h3>{passages.filter(item => item.id === 'experience').map(item => <CVEntry key={item.id} passage={item} selected={selected === item.id} onSelect={setSelected} setCompare={() => {setCompareOpen(true);requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLButtonElement>('[data-close]')?.focus())}} variant={variant} compareTrigger={compareTrigger} selectedRef={selectedRef}/>)}</section>
              <section className="cv-section"><h3>Projects</h3>{passages.filter(item => item.id === 'project').map(item => <CVEntry key={item.id} passage={item} selected={selected === item.id} onSelect={setSelected} setCompare={() => {setCompareOpen(true);requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLButtonElement>('[data-close]')?.focus())}} variant={variant} compareTrigger={compareTrigger} selectedRef={selectedRef}/>)}</section>
              <section className="cv-section skills-section"><h3>Technical skills</h3>{skills.map(group=><p key={group.group}><strong>{group.group}</strong><span>{group.items}</span></p>)}</section>
            </article>
            {variant === 2 && <button ref={detailTrigger} type="button" className="jump-details" onClick={() => { if (wide) document.getElementById('evidence-shelf')?.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}); else {setDetailsOpen(true);setView('Sources')} }}>Jump to review details <ChevronDown size={16}/></button>}
            {variant === 1 && <button ref={detailTrigger} type="button" className="show-details" onClick={() => {setDetailsOpen(true);setView('Sources')}}><PanelRightOpen size={17}/> Review details</button>}
          </section>
          {desktopDetails && <aside className={`details-panel ${variant === 3 ? 'queue-panel' : ''}`} aria-label="Review details">{variant===3 ? <><h2>Next decisions</h2><p>Choose a topic to review. You can read in any order.</p><Queue onChoose={setNamedView}/>{navViews}{content}</> : <><header className="panel-title"><div><span className="eyebrow">Selected wording</span><h2>Evidence and context</h2></div>{variant===1 && <button type="button" aria-label="Hide review details" className="icon-button" onClick={closeDetails}><X size={18}/></button>}</header>{navViews}{content}</>}</aside>}
          {variant === 2 && <section id="evidence-shelf" className="evidence-shelf" aria-label="Evidence shelf"><header><div><span className="eyebrow">Below the document</span><h2>Review details</h2></div>{navViews}</header>{content}</section>}
          {variant === 4 && <div className="compare-prompt"><p>Compare selected CV wording with its cited source in a focused reading sheet.</p><button ref={compareTrigger} type="button" className="compare-button" onClick={() => setCompareOpen(true)}>Compare selected wording</button></div>}
          {variant === 1 && detailsOpen && <div className="mobile-backdrop" onClick={closeDetails} aria-hidden="true"/>}
        </div>
        <footer className="page-foot">A layout study of review evidence · Not a production workflow</footer>
      </div>
    </main>
    {(variant === 0 || variant === 2 || variant === 3) && !wide && <button className="mobile-detail-trigger" ref={detailTrigger} onClick={() => {setDetailsOpen(true);setView('Sources')}}>{variant === 3 ? 'Open next decisions' : 'Show review details'}</button>}
    {(variant === 0 || variant === 1 || variant === 2 || variant === 3) && !wide && detailsOpen && <div className="small-detail-overlay"><div className="mobile-backdrop" onClick={closeDetails}/>{modalDetails}</div>}
    <dialog ref={dialogRef} className="compare-dialog" aria-labelledby="compare-title" onCancel={e=>{e.preventDefault();closeCompare()}}><header><div><span className="eyebrow">Selected passage · source comparison</span><h2 id="compare-title">Read both records</h2></div><button data-close type="button" className="icon-button" aria-label="Close comparison" onClick={closeCompare}><X size={20}/></button></header><div className="comparison"><section><h3>Wording in this CV</h3><p>{passage.text}</p></section><section><h3>Cited source · {passage.source}</h3><p className="source-quote">{passage.evidence}</p><p className="limitation">A source can support wording without guaranteeing it is true. This display makes no factual verdict.</p></section></div></dialog>
  </div>
}

function CVSection({passage, ...props}: {passage: typeof passages[number]; selected: boolean; onSelect:(id:string)=>void; setCompare:()=>void; variant:number; compareTrigger:RefObject<HTMLButtonElement|null>; selectedRef:RefObject<HTMLButtonElement|null>}) { return <section className="cv-section"><h3>{passage.section}</h3><CVEntry passage={passage} {...props}/></section> }
function CVEntry({passage,selected,onSelect,setCompare,variant,compareTrigger,selectedRef}: {passage:typeof passages[number];selected:boolean;onSelect:(id:string)=>void;setCompare:()=>void;variant:number;compareTrigger:RefObject<HTMLButtonElement|null>;selectedRef:RefObject<HTMLButtonElement|null>}) { return <div className={`cv-entry ${selected?'is-selected':''}`}><div className="entry-heading"><strong>{passage.title}</strong><span>{passage.meta}</span></div><button ref={selected?selectedRef:null} type="button" className="passage" aria-pressed={selected} onClick={()=>onSelect(passage.id)}>{passage.text}</button>{selected && <div className="passage-tools"><span>Selected wording</span>{variant===4 && <button ref={compareTrigger} type="button" onClick={setCompare}>Compare with source</button>}</div>}</div> }

function Queue({onChoose}:{onChoose:(v:View)=>void}) { return <div className="decision-queue"><p>Demo queue · illustrative, not actual findings</p><button onClick={()=>onChoose('New skills')}><span><b>1</b>Posting-derived skills</span><small>Review a fictional suggestion</small></button><button onClick={()=>onChoose('Sources')}><span><b>2</b>Selected wording</span><small>Open cited source context</small></button><button onClick={()=>onChoose('Checks & options')}><span><b>3</b>Review conditions</span><small>No checks have run</small></button><button onClick={()=>onChoose('Job match')}><span><b>4</b>Job context</span><small>Read illustrative comparison</small></button></div> }
function DetailContent({view,passage,sourceOpen,setSourceOpen,decision,setDecision}:{view:View;passage:typeof passages[number];sourceOpen:boolean;setSourceOpen:(v:boolean)=>void;decision:'pending'|'confirmed'|'removed';setDecision:(v:'pending'|'confirmed'|'removed')=>void}) {
 if(view==='Sources') return <section className="detail-body"><p className="detail-kicker">{passage.section} · selected wording</p><h3>{passage.title}</h3><blockquote>{passage.text}</blockquote><p className="detail-label">Cited source</p><div className="source-card"><strong>{passage.source}</strong><button className="disclosure" type="button" aria-expanded={sourceOpen} onClick={()=>setSourceOpen(!sourceOpen)}>{sourceOpen?'Hide':'Read'} source wording <ChevronDown size={15}/></button>{sourceOpen&&<p className="source-text">{passage.evidence}</p>}</div><p className="rationale"><strong>Why this wording is here</strong>{passage.why}</p><p className="fixture-note">Fictional evidence fixture. The source supports context; it does not establish truth.</p></section>
 if(view==='New skills') return <section className="detail-body"><p className="detail-kicker">Posting-derived suggestion</p><h3>Model monitoring</h3><p className="soft-box">Not in your profile · fictional suggestion for this demo</p><p>This example is not confirmed evidence and is not part of the CV's career history.</p>{decision==='pending'?<div className="decision-buttons"><button onClick={()=>setDecision('confirmed')}>I have this skill · demo only</button><button onClick={()=>setDecision('removed')}>Remove suggestion · demo only</button></div>:<><p role="status">{decision==='confirmed'?'Demo-only: marked as a personal declaration. Not profile evidence.':'Demo-only: suggestion removed from this display.'}</p><button className="text-button" onClick={()=>setDecision('pending')}>Undo demo decision</button></>}<p className="fixture-note">No profile or draft is changed. This control only changes the browser presentation.</p></section>
 if(view==='Job match') return <section className="detail-body"><p className="detail-kicker">Illustrative posting context</p><h3>Computer vision model development</h3><p className="soft-box">Related evidence appears in the selected training and project descriptions.</p><p>These fixture excerpts are relevant context, not an ATS score, hiring verdict, or claim of production experience. Kubernetes and production monitoring are not established by these examples.</p><ul className="plain-list"><li>Role asks for model evaluation and transfer learning.</li><li>Project wording mentions a fine-tuned ResNet50.</li><li>Training record mentions model development.</li></ul><p className="fixture-note">No automated comparison ran. All text is fictional.</p></section>
 return <section className="detail-body"><p className="detail-kicker">Checks & options</p><h3>No checks have run</h3><p className="soft-box">Page fit not measured · no factual checks available</p><p>The layout and wording on this page are not checked against a real document or source. No approval is available in this gallery.</p><div className="fake-checklist"><span>CV issues <b>Not run</b></span><span>Page length <b>Not measured</b></span><span>Wording review <b>Demo only</b></span></div></section>
}

createRoot(document.getElementById('root')!).render(<App />)
