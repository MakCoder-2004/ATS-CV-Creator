import { useState } from 'react';
import { ArrowUpRight, BookOpen, Check, CheckCheck, FileCheck2, FileText, GitCompareArrows, Info, LockKeyhole, PencilLine, RefreshCw, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { canExport, usePrototype } from '../store';
import { certificatesFixture, skillsFixture, type Paragraph } from '../fixtures';
import { cn } from '../lib/utils';

export function CheckStatus() {
  const { verification, approved } = usePrototype();
  const good = verification === 'passed';
  return <span className={cn('status-label', good ? 'good' : 'warning')}>
    {good ? <ShieldCheck aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
    {approved ? 'Approved for export' : good ? 'Demo checks passed · review needed' : verification === 'blocked' ? 'Unsupported claim · export blocked' : verification === 'stale' ? 'Source changed · review needed' : 'Edits need checks'}
  </span>;
}

function EditableParagraph({ paragraph }: { paragraph: Paragraph }) {
  const { selectedId, select, editParagraph, approved } = usePrototype();
  const [editing, setEditing] = useState(false);
  const selected = selectedId === paragraph.id;
  return <div className={cn('cv-entry', selected && 'cv-entry-selected')}>
    <div className="cv-entry-heading"><strong>{paragraph.title}</strong><span>{paragraph.location ?? 'Project'}</span></div>
    {paragraph.organization && <div className="cv-entry-meta"><em>{paragraph.organization}</em><span>{paragraph.date}</span></div>}
    {editing ? <div className="paragraph-edit">
      <Textarea aria-label={`Edit ${paragraph.title} paragraph`} value={paragraph.text} onChange={e => editParagraph(paragraph.id, e.target.value)} autoFocus />
      <Button size="sm" onClick={() => setEditing(false)}><Check aria-hidden="true" /> Done editing</Button>
      <small>Edits invalidate approval. New facts must first be saved to your profile.</small>
    </div> : <button className="cv-paragraph" onClick={() => select(paragraph.id)} aria-pressed={selected} aria-label={`Inspect evidence for ${paragraph.title}`}>
      {paragraph.text}
    </button>}
    {selected && <div className="cv-entry-tools">
      <span><BookOpen aria-hidden="true" /> {paragraph.sourceIds.length} source{paragraph.sourceIds.length > 1 ? 's' : ''}</span>
      <button onClick={() => setEditing(!editing)}><PencilLine aria-hidden="true" /> {editing ? 'Close editor' : 'Edit paragraph'}</button>
      {approved && <span><Check aria-hidden="true" /> Reviewed</span>}
    </div>}
  </div>;
}

export function DocumentPaper({ compact = false }: { compact?: boolean }) {
  const { paragraphs, profileName, profileHeadline, hasDraft } = usePrototype();
  if (!hasDraft) return <div className="document-empty"><FileText aria-hidden="true" /><h3>Your tailored CV will appear here</h3><p>Review the posting and approve the outgoing demo payload to start.</p></div>;
  return <article className={cn('cv-paper', compact && 'cv-paper-compact')} aria-label="Reference-inspired CV preview">
    <header className="cv-contact"><h2>{profileName}</h2><p>{profileHeadline}</p><div>your.email@example.com <span>|</span> GitHub <span>|</span> LinkedIn <span>|</span> Egypt</div></header>
    <section><h3>Education</h3><div className="cv-entry-heading"><strong>B.Sc. in Computer Science (Data Science)</strong><span>2023 – 2027</span></div><div className="cv-entry-meta"><em>Alexandria University, Egypt</em><span>CGPA: 3.3</span></div></section>
    <section><h3>Experience</h3>{paragraphs.filter(p => p.section === 'Experience').map(p => <EditableParagraph key={p.id} paragraph={p} />)}</section>
    <section><h3>Projects</h3>{paragraphs.filter(p => p.section === 'Projects').map(p => <EditableParagraph key={p.id} paragraph={p} />)}</section>
    <section><h3>Skills</h3><Dialog><DialogTrigger asChild><button className="skill-source-link" aria-label="Inspect skill evidence">{skillsFixture.map(g => <p key={g.category}><strong>{g.category}: </strong>{g.items.join(', ')}</p>)}</button></DialogTrigger><DialogContent className="wide-dialog"><DialogHeader><DialogTitle>Skills come from your profile inventory</DialogTitle><DialogDescription>Exact-name fixture matches, not skills inferred from a job posting. Production needs versioned skill IDs and equivalent-name validation.</DialogDescription></DialogHeader>{skillsFixture.map(g => <div key={g.category}><strong>{g.category}</strong><p className="small muted">Profile skill records: {g.items.join(', ')}</p></div>)}</DialogContent></Dialog></section>
    <section><h3>Certificates</h3>{certificatesFixture.map(c => <p className="cv-certificate" key={c}>{c}</p>)}</section>
    <footer className="cv-paper-footer">Prototype preview · placeholder contact details · page fit is simulated</footer>
  </article>;
}

export function DocumentToolbar() {
  const s = usePrototype();
  return <div className="document-toolbar"><span><FileText aria-hidden="true" /> Tailored CV <Badge variant="secondary">Draft</Badge></span><label>Page target <select aria-label="Page target" value={s.pageTarget} onChange={e => s.setPageTarget(Number(e.target.value) as 1 | 2)}><option value="1">1 page</option><option value="2">2 pages</option></select></label></div>;
}

export function EvidencePanel() {
  const s = usePrototype();
  const selected = s.paragraphs.find(p => p.id === s.selectedId);
  const [fact, setFact] = useState('');
  const [factOpen, setFactOpen] = useState(false);
  return <section className="evidence-panel" aria-label="Evidence inspector">
    <div className="panel-title"><BookOpen aria-hidden="true" /><h2>Evidence, not guesswork</h2></div>
    <p className="muted small">Select any paragraph in your CV to see what supports it.</p>
    {selected ? <>
      <div className="inspector-subheading"><span>Selected paragraph</span><Badge variant="outline">{selected.section}</Badge></div>
      <h3>{selected.title}</h3>
      <div className="why-included"><span><Info aria-hidden="true" /> Why this was included</span><p>{selected.why}</p></div>
      {selected.sourceIds.map(id => {
        const source = s.evidence.find(e => e.id === id);
        const saved = s.draftEvidence.find(e => e.id === id);
        return source ? <div className="source-block" key={id}>{saved && saved.revision !== source.revision && <details className="small"><summary>View draft’s saved source · r{saved.revision}</summary><p>{saved.text}</p></details>}<div><span><LockKeyhole aria-hidden="true" /> Profile evidence</span><Badge variant="secondary">r{source.revision}</Badge></div><h4>{source.label}</h4><blockquote>{source.text}</blockquote><code>{source.id}</code></div> : null;
      })}
      <p className="small muted">Citations establish traceability—not proof that a paraphrase is faithful. Read both texts.</p>
      <div className="stack-actions"><Button variant="outline" onClick={s.propose}><RefreshCw aria-hidden="true" /> Regenerate this paragraph</Button>
        <Dialog open={factOpen} onOpenChange={setFactOpen}><DialogTrigger asChild><Button variant="ghost"><PencilLine aria-hidden="true" /> Add a factual source</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Save the fact before using it</DialogTitle><DialogDescription>New achievements must become profile evidence first. This demo saves only in memory.</DialogDescription></DialogHeader><label htmlFor="new-fact">Supporting fact</label><Textarea id="new-fact" value={fact} onChange={e => setFact(e.target.value)} placeholder="Write the factual detail you can stand behind." /><Button disabled={fact.trim().length < 10} onClick={() => { s.addEvidence(fact.trim()); setFactOpen(false); setFact(''); }}>Save to demo profile and link</Button></DialogContent></Dialog>
      </div>
    </> : <p>Select a paragraph to inspect its source.</p>}
  </section>;
}

export function KeywordPanel() {
  return <section className="keyword-panel" aria-label="Posting coverage"><div className="panel-title"><CheckCheck aria-hidden="true" /><h2>Posting coverage</h2></div><p className="muted small">Illustrative matches for the sample ML posting. Not a live analysis or an ATS score.</p><div className="keyword-list">{['Python', 'TensorFlow', 'OpenCV', 'Transfer learning', 'Model evaluation', 'APIs'].map(k => <span key={k}><Check aria-hidden="true" />{k}</span>)}</div><div className="gap-note"><TriangleAlert aria-hidden="true" /><div><strong>Not supported by this profile</strong><p>Kubernetes · production model monitoring</p><small>Honest gaps. They do not block export.</small></div></div></section>;
}

export function ReviewControls() {
  const s = usePrototype();
  return <section className="review-controls">
    <CheckStatus />
    {s.issue && s.runStatus !== 'paused' && <p className="issue-text">{s.issue}</p>}
    {s.verification === 'blocked' && <Button variant="outline" onClick={s.resolve}>Replace unsupported wording</Button>}
    {s.verification === 'stale' && <Button variant="outline" onClick={s.recheckSources}>I compared the changed source</Button>}
    {s.overflow && s.pageTarget === 1 && <div className="overflow-note"><strong>Demo page target exceeded</strong><p>Proposed cut: competitive-programming training. No content is removed until you accept.</p><Button variant="outline" size="sm" onClick={s.acceptCuts}>Accept proposed cut</Button></div>}
    <div className="review-buttons"><Button variant="outline" disabled={!s.hasDraft || s.runStatus === 'running' || s.verification === 'stale'} onClick={s.validate}><ShieldCheck aria-hidden="true" /> Run demo checks</Button><Button disabled={!canExport(s, false) || s.approved} onClick={s.approve}><FileCheck2 aria-hidden="true" />{s.approved ? 'Draft approved' : 'Approve reviewed draft'}</Button></div>
    <p className="small muted">You approve the whole document. Subsequent content edits require renewed approval.</p>
  </section>;
}

export function RegenerationDialog() {
  const { pendingText, paragraphs, selectedId, rejectProposal, acceptProposal } = usePrototype();
  const selected = paragraphs.find(p => p.id === selectedId);
  return <Dialog open={pendingText !== null} onOpenChange={open => { if (!open) rejectProposal(); }}><DialogContent className="diff-dialog"><DialogHeader><DialogTitle><GitCompareArrows aria-hidden="true" /> Proposed replacement</DialogTitle><DialogDescription>Simulated regeneration. Your current paragraph stays untouched until you accept.</DialogDescription></DialogHeader><div className="diff-columns"><section><h3>Current wording</h3><p>{selected?.text}</p></section><section><h3>Proposed wording</h3><p>{pendingText}</p></section></div><p className="small muted">Accepting invalidates approval and requires new checks. No additional private data was sent.</p><div className="button-row"><Button variant="outline" onClick={rejectProposal}><X aria-hidden="true" /> Keep current wording</Button><Button onClick={acceptProposal}><Check aria-hidden="true" /> Accept replacement</Button></div></DialogContent></Dialog>;
}

export function ExportButtons() {
  const s = usePrototype();
  return <div className="button-row"><Button variant="outline" disabled={!canExport(s)} onClick={() => s.simulateExport('DOCX')}><FileText aria-hidden="true" /> Export DOCX <span className="demo-tag">Demo</span></Button><Button disabled={!canExport(s)} onClick={() => s.simulateExport('PDF')}><ArrowUpRight aria-hidden="true" /> Export PDF <span className="demo-tag">Demo</span></Button></div>;
}
