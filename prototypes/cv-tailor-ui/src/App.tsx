// THROWAWAY: three desktop UI variants on /prototype?variant=A|B|C. All services are mocked.
import { useEffect, useLayoutEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, BriefcaseBusiness, Check, ChevronDown, ChevronLeft, ChevronRight, Code2, FileText, FlaskConical, Layers2, LockKeyhole, Moon, PanelLeft, RotateCcw, Settings2, ShieldCheck, Sparkles, Sun, UserRound } from 'lucide-react';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './components/ui/dialog';
import { CheckStatus, DocumentPaper, DocumentToolbar, EvidencePanel, ExportButtons, KeywordPanel, RegenerationDialog, ReviewControls } from './components/document';
import { FocusedStage, JobsPage, NewJobButton, StageNavigation, workflowStages } from './components/workflow';
import { ProfilePage, SettingsPage } from './components/management';
import { scenarioLabels, variants, type Scenario } from './fixtures';
import { usePrototype, type Page } from './store';
import { cn } from './lib/utils';

type VariantKey = (typeof variants)[number]['key'];
type Appearance = 'light' | 'dark';
function AppearanceToggle({ appearance, onChange }: { appearance: Appearance; onChange: (value: Appearance) => void }) {
  return <div className="appearance-toggle" role="group" aria-label="Color appearance" data-appearance-controls>
    <button type="button" aria-label="Use light mode" aria-pressed={appearance === 'light'} onClick={() => onChange('light')}><Sun aria-hidden="true" /><span>Light</span></button>
    <button type="button" aria-label="Use dark mode" aria-pressed={appearance === 'dark'} onClick={() => onChange('dark')}><Moon aria-hidden="true" /><span>Dark</span></button>
  </div>;
}
const navigation = [
  { id: 'workspace', label: 'Tailor CV', icon: FileText },
  { id: 'jobs', label: 'Saved jobs', icon: BriefcaseBusiness },
  { id: 'profile', label: 'My profile', icon: UserRound },
  { id: 'settings', label: 'Settings', icon: Settings2 },
] as const;
function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="brand"><span className="brand-mark"><Layers2 aria-hidden="true" /></span><div><strong>CV Tailor</strong>{!compact && <small>Your experience, supported.</small>}</div></div>;
}
function Navigation({ horizontal = false }: { horizontal?: boolean }) {
  const { page, navigate } = usePrototype();
  return <nav className={cn('app-navigation', horizontal && 'nav-horizontal')} aria-label="Main navigation">{navigation.map(item => <button key={item.id} aria-label={item.label} onClick={() => navigate(item.id)} aria-current={page === item.id ? 'page' : undefined}><item.icon aria-hidden="true" /><span>{item.label}</span></button>)}</nav>;
}
function UserBadge() {
  return <div className="user-badge"><span className="avatar small-avatar">MA</span><span>Personal workspace<small>Demo data · not persisted</small></span></div>;
}
function Notice() {
  const notice = usePrototype(s => s.notice);
  return <div className="notice-strip" role="status"><FlaskConical aria-hidden="true" /><span>{notice}</span></div>;
}
function JobContext({ minimal = false }: { minimal?: boolean }) {
  const { jobs, activeJobId } = usePrototype();
  const job = jobs.find(j => j.id === activeJobId);
  return <div className={cn('job-context', minimal && 'job-context-minimal')}><span className="company-monogram">{job?.company.slice(0, 1) ?? 'J'}</span><div><strong>{job?.title ?? 'Choose a posting'}</strong><p>{job?.company ?? 'No active job'}{!minimal && ' · fictional target'}</p></div></div>;
}
function InspectorTabs() {
  return <Tabs defaultValue="evidence" className="inspector-tabs"><TabsList aria-label="Review inspector"><TabsTrigger value="evidence"><BookOpen aria-hidden="true" /> Evidence</TabsTrigger><TabsTrigger value="coverage"><Check aria-hidden="true" /> Coverage</TabsTrigger></TabsList><TabsContent value="evidence"><EvidencePanel /></TabsContent><TabsContent value="coverage"><KeywordPanel /></TabsContent></Tabs>;
}
function OtherPage() {
  const page = usePrototype(s => s.page);
  return page === 'jobs' ? <JobsPage /> : page === 'profile' ? <ProfilePage /> : <SettingsPage />;
}
function StartRunButton() {
  const s = usePrototype();
  return <Button variant="outline" disabled={s.runStatus === 'running' || !s.activeJobId} onClick={() => s.setStage('privacy')}><Sparkles aria-hidden="true" /> New generation</Button>;
}

export function VariantA({ appearance, onAppearanceChange }: { appearance: Appearance; onAppearanceChange: (value: Appearance) => void }) {
  const s = usePrototype();
  return <div className="variant-shell workbench" data-variant="A"><aside className="workbench-sidebar"><Brand /><Navigation /><div className="sidebar-jobs-heading"><span>Saved postings</span><span>{s.jobs.length}</span></div><div className="sidebar-jobs">{s.jobs.map(job => <button key={job.id} onClick={() => s.selectJob(job.id)} className={cn(job.id === s.activeJobId && 'selected-job')}><span className="job-dot" /><span><strong>{job.title}</strong><small>{job.company}</small></span></button>)}</div><div className="sidebar-new-job"><NewJobButton /></div><div className="sidebar-footer"><div className="local-note"><LockKeyhole aria-hidden="true" /><span>Memory-only prototype<br /><small>No Gemini calls</small></span></div><UserBadge /></div></aside>
    <div className="workbench-main"><header className="workspace-header"><div className="breadcrumb">Workspace <ChevronRight aria-hidden="true" /> {navigation.find(n => n.id === s.page)?.label}</div><div className="header-tools"><AppearanceToggle appearance={appearance} onChange={onAppearanceChange} /><Badge variant="outline"><FlaskConical aria-hidden="true" /> UI exploration</Badge></div></header><Notice />{s.page !== 'workspace' ? <OtherPage /> : <><div className="workbench-title"><div><JobContext /><h1>{s.stage === 'review' ? 'Review your tailored CV' : workflowStages.find(step => step.id === s.stage)?.label}</h1><p>Relevant to the role. Grounded in what you have actually done.</p></div><StartRunButton /></div><StageNavigation />{s.stage === 'review' ? <div className="workbench-columns"><main className="document-workspace"><DocumentToolbar /><div className="paper-canvas"><DocumentPaper /></div><ReviewControls /></main><aside className="workbench-inspector"><InspectorTabs /><div className="inspector-export"><ExportButtons /><p className="small muted">Exports unlock after review.</p></div></aside></div> : <div className="workflow-container"><FocusedStage /></div>}</>}</div>
  </div>;
}

function SourceDrawer() {
  return <Dialog><DialogTrigger asChild><Button variant="outline"><BookOpen aria-hidden="true" /> Open source ledger</Button></DialogTrigger><DialogContent className="source-dialog"><DialogHeader><DialogTitle>Read the source beside your judgment</DialogTitle><DialogDescription>The selected paragraph’s support and inclusion rationale. No claim of automatic truth detection.</DialogDescription></DialogHeader><EvidencePanel /></DialogContent></Dialog>;
}
export function VariantB() {
  const s = usePrototype();
  return <div className="variant-shell guided-desk" data-variant="B"><header className="guided-header"><Brand compact /><Navigation horizontal /><UserBadge /></header><Notice />{s.page !== 'workspace' ? <OtherPage /> : <><div className="guided-job-bar"><JobContext /><StartRunButton /></div><div className="guided-layout"><aside className="guided-rail"><h2>A considered application</h2><p>One decision at a time.</p><StageNavigation vertical /><div className="guided-safety"><ShieldCheck aria-hidden="true" /><h3>You stay in control.</h3><p>Nothing is sent before consent. Nothing is exported before your approval.</p><span className="small muted">Both actions are simulated here.</span></div></aside><main className="guided-main">{s.stage === 'review' ? <><div className="guided-focus-heading"><div><Badge variant="outline">Step 4 of 5</Badge><h1>Does every paragraph earn its place?</h1><p>Read the draft, check its sources, and keep your own voice.</p></div><SourceDrawer /></div><div className="guided-review"><div><DocumentToolbar /><div className="paper-canvas"><DocumentPaper /></div><ReviewControls /></div><aside className="guided-context"><h2>Keep the target in view</h2><KeywordPanel /><div className="guided-source-prompt"><BookOpen aria-hidden="true" /><h3>Pause on a claim.</h3><p>Select a paragraph, then open its source ledger. You don’t have to trust the wording just because it sounds good.</p><SourceDrawer /></div><Button className="w-full" onClick={() => s.setStage('export')}>Continue to export <ArrowRight aria-hidden="true" /></Button></aside></div></> : <FocusedStage />}</main></div></>}</div>;
}

export function VariantC() {
  const s = usePrototype();
  return <div className="variant-shell review-room" data-variant="C"><header className="review-room-header"><Brand compact /><Navigation horizontal /><Badge variant="outline"><LockKeyhole aria-hidden="true" /> No external calls</Badge></header><Notice />{s.page !== 'workspace' ? <OtherPage /> : <><div className="review-ribbon"><div><span className="ribbon-document"><FileText aria-hidden="true" /> Document room</span><JobContext minimal /></div><div><CheckStatus /><StartRunButton /></div></div><StageNavigation />{s.stage === 'review' ? <div className="review-room-grid"><aside className="source-ledger"><div className="ledger-label"><PanelLeft aria-hidden="true" /> Source ledger</div><EvidencePanel /></aside><main className="review-room-document"><DocumentToolbar /><div className="paper-canvas"><DocumentPaper /></div></main><aside className="review-room-checks"><h1>Ready to stand behind it?</h1><p className="muted small">Read the document, not a score.</p><KeywordPanel /><ReviewControls /><ExportButtons /></aside></div> : <div className="workflow-container"><FocusedStage /></div>}</>}</div>;
}

function PrototypeState() {
  const s = usePrototype();
  const { navigate, setStage, select, selectJob, saveJob, loadScenario, reset, editParagraph, validate, resolve, approve, propose, acceptProposal, rejectProposal, setPageTarget, acceptCuts, begin, tick, cancel, resume, updateProfile, updateSource, addEvidence, recheckSources, importProfile, settings, notify, simulateExport, ...data } = s;
  return <Dialog><DialogTrigger asChild><Button variant="ghost" size="sm"><Code2 aria-hidden="true" /> State</Button></DialogTrigger><DialogContent className="state-dialog"><DialogHeader><DialogTitle>Full relevant prototype state</DialogTitle><DialogDescription>Live Zustand state. Fixtures only; no persistence. Every action and variant shares this same state.</DialogDescription></DialogHeader><pre className="state-json" tabIndex={0}>{JSON.stringify({ appearance: document.documentElement.dataset.appearance, ...data }, null, 2)}</pre></DialogContent></Dialog>;
}

function PrototypeSwitcher({ variant, onChange }: { variant: VariantKey; onChange: (v: VariantKey) => void }) {
  const s = usePrototype();
  const current = variants.findIndex(v => v.key === variant);
  const cycle = (delta: number) => onChange(variants[(current + delta + variants.length) % variants.length].key);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="tablist"], [data-appearance-controls]') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); cycle(e.key === 'ArrowLeft' ? -1 : 1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [variant, onChange]);
  return <div className="prototype-dock" role="region" aria-label="Prototype comparison controls"><div className="dock-label"><FlaskConical aria-hidden="true" /><span>Prototype</span></div><div className="variant-switch"><Button size="icon" variant="ghost" aria-label="Previous UI variant" onClick={() => cycle(-1)}><ChevronLeft aria-hidden="true" /></Button><div className="variant-choices">{variants.map(v => <button key={v.key} onClick={() => onChange(v.key)} aria-pressed={v.key === variant}><span>{v.key}</span>{v.name}</button>)}</div><Button size="icon" variant="ghost" aria-label="Next UI variant" onClick={() => cycle(1)}><ChevronRight aria-hidden="true" /></Button></div><label className="scenario-select"><span className="sr-only">Load demo scenario</span><select aria-label="Load demo scenario" value={s.scenario} onChange={e => { const scenario = e.target.value as Scenario; s.loadScenario(scenario); const url = new URL(location.href); url.searchParams.set('scenario', scenario); history.replaceState(null, '', url); }}>{Object.entries(scenarioLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><ChevronDown aria-hidden="true" /></label><PrototypeState /><Button variant="ghost" size="icon" aria-label="Reset demo state" onClick={() => { s.reset(); const url = new URL(location.href); url.searchParams.delete('scenario'); history.replaceState(null, '', url); }}><RotateCcw aria-hidden="true" /></Button><span className="dock-state" aria-live="polite">{s.stage} / {s.approved ? 'approved' : s.verification}</span></div>;
}

export default function App() {
  const [variant, setVariant] = useState<VariantKey>(() => {
    const key = new URLSearchParams(location.search).get('variant');
    return key === 'B' || key === 'C' ? key : 'A';
  });
  const [appearance, setAppearance] = useState<Appearance>(() => new URLSearchParams(location.search).get('mode') === 'dark' ? 'dark' : 'light');
  const runStatus = usePrototype(s => s.runStatus);
  const tick = usePrototype(s => s.tick);
  useLayoutEffect(() => {
    const url = new URL(location.href);
    url.pathname = '/prototype'; url.searchParams.set('variant', variant); url.searchParams.set('mode', appearance);
    history.replaceState(null, '', url);
    document.documentElement.dataset.theme = variant;
    document.documentElement.dataset.appearance = appearance;
    document.documentElement.classList.toggle('dark', variant === 'C' || (variant === 'A' && appearance === 'dark'));
  }, [variant, appearance]);
  useEffect(() => {
    const scenario = new URLSearchParams(location.search).get('scenario');
    if (scenario && scenario in scenarioLabels) usePrototype.getState().loadScenario(scenario as Scenario);
  }, []);
  useEffect(() => {
    if (runStatus !== 'running') return;
    const timer = window.setInterval(tick, 850);
    return () => window.clearInterval(timer);
  }, [runStatus, tick]);
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(location.search);
      const key = params.get('variant'); setVariant(key === 'B' || key === 'C' ? key : 'A');
      setAppearance(params.get('mode') === 'dark' ? 'dark' : 'light');
    };
    addEventListener('popstate', onPopState); return () => removeEventListener('popstate', onPopState);
  }, []);
  return <><a className="skip-link" href="#prototype-main">Skip to application</a><div id="prototype-main" tabIndex={-1}>{variant === 'A' ? <VariantA appearance={appearance} onAppearanceChange={setAppearance} /> : variant === 'B' ? <VariantB /> : <VariantC />}</div><RegenerationDialog />{import.meta.env.DEV && <PrototypeSwitcher variant={variant} onChange={setVariant} />}</>;
}
