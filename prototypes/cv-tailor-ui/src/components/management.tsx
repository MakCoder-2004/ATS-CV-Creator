import { useState } from 'react';
import { BookOpen, Check, Database, Download, FileInput, HardDrive, KeyRound, LockKeyhole, Save, ShieldCheck, Upload, UserRound } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Switch } from './ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { usePrototype } from '../store';
import { certificatesFixture, skillsFixture } from '../fixtures';

function FixtureImport() {
  const [open, setOpen] = useState(false);
  const s = usePrototype();
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="outline"><FileInput aria-hidden="true" /> Review PDF fixture import</Button></DialogTrigger><DialogContent className="wide-dialog"><DialogHeader><DialogTitle>Review before these facts become evidence</DialogTitle><DialogDescription>One-time local-import concept. These fixtures were manually adapted from the reference; no parser runs in this prototype.</DialogDescription></DialogHeader><div className="import-preview"><p><strong>Profile:</strong> Makrious Ayman · AI/ML Engineer</p><p><strong>Education:</strong> Alexandria University · Computer Science (Data Science)</p><p><strong>Experience:</strong> QovaTech; NTI training; Coach Academy training</p><p><strong>Projects:</strong> gesture-controlled game; parking classification; browser image classifier</p><p><strong>Contact:</strong> masked in demo; original file remains unchanged</p><p><strong>Needs manual confirmation:</strong> dates, extracted descriptions, links, category mapping, and every factual claim</p></div><Button onClick={() => { s.importProfile(); setOpen(false); }}><Check aria-hidden="true" /> Accept reviewed demo fixture</Button></DialogContent></Dialog>;
}
function SourceEditor({ id }: { id: string }) {
  const s = usePrototype();
  const source = s.evidence.find(e => e.id === id)!;
  const [value, setValue] = useState(source.text);
  return <div className="profile-source"><div><h3>{source.label}</h3><Badge variant="outline">Revision {source.revision}</Badge></div><label className="sr-only" htmlFor={`edit-${id}`}>Evidence for {source.label}</label><Textarea id={`edit-${id}`} value={value} onChange={e => setValue(e.target.value)} rows={4} /><Button variant="outline" size="sm" disabled={value === source.text || value.trim().length < 10} onClick={() => s.updateSource(id, value.trim())}><Save aria-hidden="true" /> Save evidence change</Button><small>Changing referenced facts marks affected drafts for renewed checks.</small></div>;
}
function PersonalProfile() {
  const s = usePrototype();
  const [name, setName] = useState(s.profileName);
  const [headline, setHeadline] = useState(s.profileHeadline);
  return <div className="form-stack"><div className="section-heading"><div><h2>Personal details</h2><p>Kept local and inserted when rendering the CV.</p></div><Badge variant="outline"><LockKeyhole aria-hidden="true" /> Local only</Badge></div><div className="form-columns"><div><Label htmlFor="profile-name">Full name</Label><Input id="profile-name" value={name} onChange={e => setName(e.target.value)} /></div><div><Label htmlFor="profile-headline">Professional headline</Label><Input id="profile-headline" value={headline} onChange={e => setHeadline(e.target.value)} /></div></div><div className="form-columns"><div><Label htmlFor="profile-email">Email (masked fixture)</Label><Input id="profile-email" value="your.email@example.com" readOnly /></div><div><Label htmlFor="profile-location">Location (fixture)</Label><Input id="profile-location" value="Egypt" readOnly /></div></div><p className="small muted">Full contact/link CRUD is production work. Use demo details only.</p><Button disabled={!name.trim() || !headline.trim()} onClick={() => s.updateProfile(name.trim(), headline.trim())}><Save aria-hidden="true" /> Save demo details</Button></div>;
}
function LocalOnlyCategory({ name }: { name: string }) {
  const [text, setText] = useState('');
  return <div className="form-stack"><h2>{name}</h2><p>Stored in the comprehensive profile, but excluded from the agreed five-section CV and outgoing demo bundle.</p><Label htmlFor="local-note">Demo note</Label><Textarea id="local-note" value={text} onChange={e => setText(e.target.value)} placeholder="Explore the field layout using fictional details." /><p className="small muted">This field is component-local exploration state. It resets when this category closes.</p></div>;
}
export function ProfilePage() {
  const s = usePrototype();
  return <div className="content-page"><div className="page-heading"><div><p className="context-label">Your source of truth</p><h1>Build the evidence once.</h1><p>Keep everything in your profile. Tailor only what the facts support.</p></div><FixtureImport /></div><div className="profile-summary"><span className="avatar"><UserRound aria-hidden="true" /></span><div><strong>{s.profileName}</strong><p>{s.profileHeadline}</p></div><Badge variant="outline">Profile revision {s.profileRevision}</Badge><span className="small muted">{s.profileImported ? 'Fixture import reviewed' : 'Unconfirmed reference-derived demo data'}</span></div>
    <Tabs defaultValue="personal" className="profile-tabs"><TabsList aria-label="Profile categories">{['Personal', 'Skills', 'Experience', 'Projects', 'Education', 'Certificates', 'Summary', 'Languages', 'Extras'].map(t => <TabsTrigger value={t.toLowerCase()} key={t}>{t}</TabsTrigger>)}</TabsList>
      <TabsContent value="personal"><PersonalProfile /></TabsContent>
      <TabsContent value="skills"><div className="section-heading"><h2>Skills inventory</h2><Badge variant="outline">Read-only fixture</Badge></div>{skillsFixture.map(g => <div className="skill-inventory" key={g.category}><h3>{g.category}</h3><div>{g.items.map(item => <Badge key={item} variant="secondary">{item}</Badge>)}</div></div>)}<p className="small muted">Programming languages are a skills category, not the excluded spoken-language section.</p></TabsContent>
      <TabsContent value="experience"><h2>Experience evidence</h2>{s.evidence.filter(e => ['src-software', 'src-ml', 'src-cp'].includes(e.id)).map(e => <SourceEditor key={e.id} id={e.id} />)}</TabsContent>
      <TabsContent value="projects"><h2>Project evidence</h2>{s.evidence.filter(e => !['src-software', 'src-ml', 'src-cp'].includes(e.id)).map(e => <SourceEditor key={e.id} id={e.id} />)}</TabsContent>
      <TabsContent value="education"><h2>Education</h2><div className="read-only-record"><h3>B.Sc. in Computer Science (Data Science)</h3><p>Alexandria University, Egypt · 2023–2027 · CGPA 3.3</p><p className="small muted">Read-only reference fixture. Original degree, dates, and institution are restored locally.</p></div></TabsContent>
      <TabsContent value="certificates"><h2>Certificates</h2>{certificatesFixture.map(c => <div className="read-only-record" key={c}><BookOpen aria-hidden="true" /><span>{c}</span></div>)}</TabsContent>
      {['Summary', 'Languages', 'Extras'].map(name => <TabsContent key={name} value={name.toLowerCase()}><LocalOnlyCategory name={name} /></TabsContent>)}
    </Tabs>
  </div>;
}

function DataAction({ kind }: { kind: 'profile' | 'backup' | 'restore' }) {
  const s = usePrototype();
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const title = kind === 'profile' ? 'Profile JSON exchange' : kind === 'backup' ? 'Complete application backup' : 'Replace workspace from backup';
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="outline">{kind === 'restore' ? <Upload aria-hidden="true" /> : <Download aria-hidden="true" />}{title}</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Simulated preview. No file is read or written and no state is restored.</DialogDescription></DialogHeader><div className="import-preview">{kind === 'profile' ? <><p>Profile-only exchange; replacing the current profile would retain existing drafts’ historical evidence snapshots.</p><p>Production import must validate schema and show replacement details.</p></> : kind === 'backup' ? <><p>Includes profile, jobs, draft/evidence revisions, checkpoints, and non-secret settings.</p><p><strong>Excludes the API key.</strong> Backups contain personal data and must be stored safely.</p></> : <><p>A full restore replaces the workspace rather than silently merging stable IDs.</p><p>Production must create and verify a safety backup first.</p><label className="checkbox-line"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I understand the replacement behavior.</label></>}</div><Button disabled={kind === 'restore' && !confirmed} onClick={() => { s.notify(`Simulated ${title.toLowerCase()} preview acknowledged. No file operation occurred.`); setOpen(false); }}>Acknowledge demo preview</Button></DialogContent></Dialog>;
}
export function SettingsPage() {
  const s = usePrototype();
  return <div className="content-page settings-page"><div className="page-heading"><div><p className="context-label">Your machine, your controls</p><h1>Make the boundaries explicit.</h1><p>Gemini free tier is the production provider. Every integration below is simulated here.</p></div><Badge variant="outline"><HardDrive aria-hidden="true" /> Browser prototype</Badge></div>
    <section className="settings-section"><div><KeyRound aria-hidden="true" /><h2>Model and credentials</h2><p>Production keys belong in Electron safeStorage—not browser storage.</p></div><div className="form-stack"><div><Label htmlFor="model">Gemini model</Label><Input id="model" value={s.model} onChange={e => s.settings({ model: e.target.value })} /><p className="small muted">Configurable model name. Actual model availability must be verified during implementation.</p></div><div><Label htmlFor="api-key">API key</Label><Input id="api-key" type="password" placeholder="Not needed — no live calls in this prototype" disabled /><p className="small muted">Do not enter a real key. No provider SDK is installed.</p></div></div></section>
    <section className="settings-section"><div><ShieldCheck aria-hidden="true" /><h2>Generation limits</h2><p>One shared budget includes every retry. No silent model switching.</p></div><div className="form-stack"><div className="form-columns"><div><Label htmlFor="attempt-limit">Maximum outbound attempts</Label><Input id="attempt-limit" type="number" min={1} max={100} value={s.maxAttempts} onChange={e => s.settings({ maxAttempts: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} /></div><div><Label htmlFor="minute-limit">Maximum minutes</Label><Input id="minute-limit" type="number" min={1} max={30} value={s.minutes} onChange={e => s.settings({ minutes: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} /></div></div><p className="small muted">Only the simulated request cap affects this demo. Wall-clock deadlines, daily counters, pacing, Retry-After, and backoff are not implemented.</p><div className="setting-toggle"><div><Label htmlFor="llm-verification">Optional LLM faithfulness check</Label><p>Add a simulated semantic-check call. Still not proof of truth.</p></div><Switch id="llm-verification" checked={s.llmVerification} onCheckedChange={llmVerification => s.settings({ llmVerification })} /></div></div></section>
    <section className="settings-section"><div><LockKeyhole aria-hidden="true" /><h2>Privacy boundary</h2><p>Local storage and cloud generation are different promises.</p></div><div className="privacy-warning"><div><strong>Free-tier requests may be used to improve Google products.</strong><p>Human reviewers may process inputs/outputs. Google’s terms instruct users not to submit personal, sensitive or confidential information. Career history can identify you even without contact fields.</p><p>Inspect each approved outgoing bundle. Redaction does not guarantee anonymity or acceptable use. This prototype sends no profile data.</p></div></div></section>
    <section className="settings-section"><div><Database aria-hidden="true" /><h2>Profile and backups</h2><p>No automatic merging. No secrets in backups.</p></div><div className="stack-actions"><DataAction kind="profile" /><DataAction kind="backup" /><DataAction kind="restore" /><p className="small muted">Real SQLite, schema migrations, encrypted keystore, file dialogs and backups belong to the production Electron implementation.</p></div></section>
  </div>;
}
