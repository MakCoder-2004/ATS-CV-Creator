import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, Check, Circle, CircleCheck, FileCheck2, FileText, FolderOpen, History, LoaderCircle, LockKeyhole, Pause, Play, Plus, ShieldCheck, Sparkles, Square, TriangleAlert } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { graphSteps } from '../fixtures';
import { canExport, jobSchema, usePrototype, type JobInput, type Stage } from '../store';
import { DocumentPaper, ExportButtons, ReviewControls } from './document';
import { cn } from '../lib/utils';

export const workflowStages: { id: Stage; label: string; detail: string }[] = [
  { id: 'job', label: 'Job posting', detail: 'Give the CV a clear target' },
  { id: 'privacy', label: 'Outgoing data', detail: 'Inspect before anything leaves' },
  { id: 'generate', label: 'Generate', detail: 'Bounded, visible progress' },
  { id: 'review', label: 'Review evidence', detail: 'Read, edit, and approve' },
  { id: 'export', label: 'Export', detail: 'One approved document' },
];
export function StageNavigation({ vertical = false }: { vertical?: boolean }) {
  const s = usePrototype();
  return <nav className={cn('stage-navigation', vertical && 'stage-navigation-vertical')} aria-label="Tailoring stages">{workflowStages.map((step, i) => <button key={step.id} aria-current={s.stage === step.id ? 'step' : undefined} onClick={() => s.setStage(step.id)} disabled={(step.id === 'review' || step.id === 'export') && !s.hasDraft}>
    <span className="stage-number">{i + 1}</span><span><strong>{step.label}</strong>{vertical && <small>{step.detail}</small>}</span>
  </button>)}</nav>;
}

export function NewJobForm({ onSaved }: { onSaved?: () => void }) {
  const saveJob = usePrototype(s => s.saveJob);
  const { register, handleSubmit, formState: { errors } } = useForm<JobInput>({ resolver: zodResolver(jobSchema), defaultValues: { title: '', company: '', description: '' } });
  return <form className="form-stack" onSubmit={handleSubmit(data => { saveJob(data); onSaved?.(); })} noValidate>
    <div className="form-columns"><div><Label htmlFor="job-title">Job title</Label><Input id="job-title" {...register('title')} placeholder="Machine Learning Engineer" aria-invalid={!!errors.title} aria-describedby={errors.title ? 'job-title-error' : undefined} />{errors.title && <p id="job-title-error" className="field-error">{errors.title.message}</p>}</div><div><Label htmlFor="job-company">Company</Label><Input id="job-company" {...register('company')} placeholder="Company name" aria-invalid={!!errors.company} />{errors.company && <p className="field-error">{errors.company.message}</p>}</div></div>
    <div><Label htmlFor="job-description">Posting and requirements</Label><Textarea id="job-description" {...register('description')} rows={9} placeholder="Paste the role description, responsibilities, and requirements…" aria-invalid={!!errors.description} />{errors.description && <p className="field-error">{errors.description.message}</p>}</div>
    <p className="small muted">Use fictional text here. Saved only in memory; refreshing clears this prototype.</p><Button type="submit"><Plus aria-hidden="true" /> Save demo posting</Button>
  </form>;
}
export function NewJobButton() {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Plus aria-hidden="true" /> New job</Button></DialogTrigger><DialogContent className="wide-dialog"><DialogHeader><DialogTitle>Add a job posting</DialogTitle><DialogDescription>Set the target before selecting or rewriting profile evidence.</DialogDescription></DialogHeader><NewJobForm onSaved={() => setOpen(false)} /></DialogContent></Dialog>;
}

export function JobsPage() {
  const s = usePrototype();
  return <div className="content-page"><div className="page-heading"><div><p className="context-label">Your applications</p><h1>Give every CV a clear target.</h1><p>Saved postings, drafts, and the evidence behind them.</p></div><NewJobButton /></div>
    {s.jobs.length === 0 ? <div className="empty-state"><FolderOpen aria-hidden="true" /><h2>Your first job starts here</h2><p>Paste a posting, inspect what would leave your machine, then create a draft grounded in your own experience.</p><NewJobForm /></div> : <div className="jobs-table"><div className="jobs-table-heading"><span>Posting</span><span>Draft status</span><span>Next action</span></div>{s.jobs.map(job => <button key={job.id} className="job-table-row" onClick={() => s.selectJob(job.id)}><span><strong>{job.title}</strong><small>{job.company} · fictional posting</small></span><Badge variant="secondary">{job.id === s.activeJobId && s.hasDraft ? 'Review available' : job.status}</Badge><span>Open posting <ArrowRight aria-hidden="true" /></span></button>)}</div>}
    <div className="inline-note"><History aria-hidden="true" /><p>Production history will preserve draft revisions and checkpoints. This browser prototype resets on refresh.</p></div>
  </div>;
}

export function JobStage() {
  const s = usePrototype();
  const job = s.jobs.find(j => j.id === s.activeJobId);
  if (!job) return <div className="workflow-card"><h2>Choose a posting first</h2><p>Open a saved job or add a new one.</p><NewJobButton /></div>;
  return <div className="workflow-card"><Badge variant="secondary">Fictional target · reference-derived profile</Badge><h1>{job.title}</h1><p className="muted">{job.company}</p><div className="posting-text">{job.description}</div><div className="inline-note"><ShieldCheck aria-hidden="true" /><p>The posting is context, not a source of candidate facts. Missing qualifications stay missing.</p></div><div className="button-row"><Button onClick={() => s.setStage('privacy')}>Inspect outgoing data <ArrowRight aria-hidden="true" /></Button><Button variant="outline" onClick={() => s.navigate('jobs')}>Choose another job</Button></div></div>;
}

export function buildDemoPayload() {
  const s = usePrototype.getState();
  const job = s.jobs.find(j => j.id === s.activeJobId);
  const replacements = ['QovaTech', 'National Telecommunication Institute', 'Coach Academy', 'Alexandria University', 'Makrious Ayman'];
  const mask = (text: string) => replacements.reduce((t, name, i) => t.replaceAll(name, `[IDENTITY_${i + 1}]`), text).replace(/\b\d{4}-\d{2}(?:-\d{2})?\b/g, '[DATE]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[EMAIL]').replace(/https?:\/\/\S+/g, '[LINK]');
  return JSON.stringify({
    prototypeOnly: true,
    note: 'Eligible data-bundle illustration, not a production provider request or complete redactor.',
    job: { title: mask(job?.title ?? ''), description: mask(job?.description ?? '') },
    evidence: s.evidence.filter(e => s.paragraphs.some(p => p.sourceIds.includes(e.id))).map(e => ({ id: e.id, text: mask(e.text) })),
    localOnly: ['contact', 'organization/project display names', 'exact dates', 'education header fields', 'certificate display fields', 'links', 'summary', 'spoken languages', 'extras'],
  }, null, 2);
}
export function ConsentStage() {
  const s = usePrototype();
  const payload = useMemo(buildDemoPayload, [s.activeJobId, s.evidence, s.paragraphs]);
  const [checked, setChecked] = useState(false);
  const hasJob = s.jobs.some(j => j.id === s.activeJobId);
  return <div className="workflow-card consent-stage"><div className="large-icon"><LockKeyhole aria-hidden="true" /></div><h1>Your data, before it leaves.</h1><p>Approve a frozen bundle for this run and its retries. New private data would require another approval.</p><div className="privacy-warning"><TriangleAlert aria-hidden="true" /><div><strong>Free-tier Gemini is cloud processing</strong><p>Google may use unpaid-service inputs/outputs to improve products; its terms say not to submit personal, sensitive, or confidential information. Redaction and consent do not guarantee anonymity or compliance.</p><p><strong>This prototype sends nothing.</strong> This is an illustrative payload preview, not a working privacy filter.</p></div></div>
    <div className="payload-heading"><h2>What would be eligible to send</h2><Badge variant="outline">Demo JSON</Badge></div><pre className="payload-preview" tabIndex={0}>{payload}</pre><div className="privacy-kept"><Check aria-hidden="true" /><span>Contact fields, display identifiers, exact dates, and unrelated extras remain local in this illustrated bundle.</span></div>
    <label className="checkbox-line"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /><span>I inspected this demo bundle and understand the cloud-processing limitation.</span></label><div className="button-row"><Button variant="outline" onClick={() => s.setStage('job')}><ArrowLeft aria-hidden="true" /> Back to posting</Button><Button disabled={!checked || !hasJob || s.runStatus === 'running'} onClick={() => s.begin(payload)}><Play aria-hidden="true" /> Approve and simulate run</Button></div>{!hasJob && <p className="field-error">Add or choose a posting first.</p>}
  </div>;
}

export function GenerateStage() {
  const s = usePrototype();
  const running = s.runStatus === 'running';
  return <div className="workflow-card generation-stage"><Badge variant="secondary">Simulated LangGraph progress</Badge><h1>{running ? 'Making your experience relevant.' : s.runStatus === 'complete' ? 'Ready for your judgment.' : 'Your progress stays in view.'}</h1><p>One bounded run. Every paragraph stays connected to its evidence.</p><div className="generation-meta"><span><Sparkles aria-hidden="true" /> {s.model}</span><span>{s.requests} / {s.maxAttempts} demo attempts</span><span>{s.minutes}-minute target · timer not implemented</span></div><ol className="graph-progress">{graphSteps.map((step, i) => <li key={step} className={cn(i < s.step && 'step-complete', i === s.step && running && 'step-active')}><span>{i < s.step ? <CircleCheck aria-hidden="true" /> : i === s.step && running ? <LoaderCircle aria-hidden="true" className="spin" /> : <Circle aria-hidden="true" />}</span><div><strong>{step}</strong><small>{i < s.step ? 'Completed in demo' : i === s.step && running ? 'Simulating…' : 'Waiting'}</small></div>{i === 2 || i === 5 || (i === 4 && !s.llmVerification) ? <Badge variant="outline">Local check</Badge> : <Badge variant="secondary">Simulated model call</Badge>}</li>)}</ol>
    {s.runStatus === 'paused' && <div className="privacy-warning"><Pause aria-hidden="true" /><div><strong>Run paused</strong><p>{s.issue}</p></div></div>}
    {s.runStatus === 'cancelled' && <p className="inline-note">Cancelled. No further demo steps advance until you explicitly resume.</p>}
    <div className="button-row">{running ? <Button variant="outline" onClick={s.cancel}><Square aria-hidden="true" /> Cancel run</Button> : s.runStatus === 'paused' || s.runStatus === 'cancelled' ? <><Button onClick={s.resume}><Play aria-hidden="true" /> Resume demo run</Button><Button variant="outline" onClick={() => s.navigate('settings')}>Run settings</Button></> : s.runStatus === 'complete' ? <Button onClick={() => s.setStage('review')}>Review draft <ArrowRight aria-hidden="true" /></Button> : <Button onClick={() => s.setStage('privacy')}>Review payload to begin</Button>}</div>
    <details className="details-box"><summary>Inspect frozen approved bundle</summary><pre>{s.consentPayload || 'No outgoing bundle approved yet.'}</pre></details>
    <p className="small muted">No Gemini request, rate limiter, checkpoint persistence, or restart recovery is implemented here.</p>
  </div>;
}

export function ExportStage() {
  const s = usePrototype();
  return <div className="workflow-card export-stage"><div className="large-icon"><FileCheck2 aria-hidden="true" /></div><h1>{canExport(s) ? 'One reviewed CV. Two formats.' : 'Review before export.'}</h1><p>Same content and section order in DOCX and PDF. Editable Word documents may wrap differently.</p><div className="export-checklist"><p><Check aria-hidden="true" /> Five reference-derived sections</p><p><Check aria-hidden="true" /> Arial, selectable text, no layout tables</p><p><Check aria-hidden="true" /> Contact details restored locally</p><p><FileText aria-hidden="true" /> {s.pageTarget}-page A4 target · demo fit state only</p></div><ReviewControls /><ExportButtons /><p className="small muted">Export buttons demonstrate gating and feedback only. No PDF or DOCX is created.</p><Button variant="ghost" onClick={() => s.setStage('review')}><ArrowLeft aria-hidden="true" /> Back to document</Button></div>;
}

export function FocusedStage() {
  const stage = usePrototype(s => s.stage);
  if (stage === 'job') return <JobStage />;
  if (stage === 'privacy') return <ConsentStage />;
  if (stage === 'generate') return <GenerateStage />;
  if (stage === 'export') return <ExportStage />;
  return <><DocumentPaper /><ReviewControls /></>;
}
