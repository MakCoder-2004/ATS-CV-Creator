// THROWAWAY state model. All data is memory-only; every service response is simulated.
import { create } from 'zustand';
import { z } from 'zod';
import { evidenceFixture, graphSteps, jobFixture, paragraphFixture, type Evidence, type Job, type Paragraph, type Scenario } from './fixtures';

export const jobSchema = z.object({
  title: z.string().trim().min(2, 'Enter a job title.'),
  company: z.string().trim().min(2, 'Enter a company name.'),
  description: z.string().trim().min(30, 'Paste at least 30 characters of the posting.'),
});
export type JobInput = z.infer<typeof jobSchema>;
export type Page = 'workspace' | 'jobs' | 'profile' | 'settings';
export type Stage = 'job' | 'privacy' | 'generate' | 'review' | 'export';
type Verification = 'passed' | 'needs-check' | 'blocked' | 'stale';
type RunStatus = 'idle' | 'running' | 'paused' | 'cancelled' | 'complete';

function initialData() {
  return {
    page: 'workspace' as Page, stage: 'review' as Stage, scenario: 'ready' as Scenario,
    jobs: structuredClone(jobFixture), activeJobId: 'job-ml', paragraphs: structuredClone(paragraphFixture),
    evidence: structuredClone(evidenceFixture), draftEvidence: structuredClone(evidenceFixture), selectedId: 'project-parking',
    verification: 'passed' as Verification, issue: '', approved: false, hasDraft: true,
    overflow: false, pageTarget: 1 as 1 | 2, consent: false, consentPayload: '',
    runStatus: 'idle' as RunStatus, step: 0, requests: 0, maxAttempts: 12, minutes: 5,
    llmVerification: false, pendingText: null as string | null,
    notice: 'Sample draft loaded. Nothing has been sent to Gemini or saved to disk.',
    events: ['Loaded a reference-derived sample draft.'],
    profileName: 'Makrious Ayman', profileHeadline: 'AI/ML Engineer', profileRevision: 1,
    model: 'gemini-3.6-flash', showEvidence: true, profileImported: false,
  };
}
type StateData = ReturnType<typeof initialData>;
type Actions = {
  navigate: (page: Page) => void; setStage: (stage: Stage) => void;
  select: (id: string) => void; selectJob: (id: string) => void; saveJob: (data: JobInput) => void;
  loadScenario: (scenario: Scenario) => void; reset: () => void;
  editParagraph: (id: string, text: string) => void; validate: () => void; resolve: () => void; approve: () => void;
  propose: () => void; acceptProposal: () => void; rejectProposal: () => void;
  setPageTarget: (value: 1 | 2) => void; acceptCuts: () => void;
  begin: (payload: string) => void; tick: () => void; cancel: () => void; resume: () => void;
  updateProfile: (name: string, headline: string) => void; updateSource: (id: string, text: string) => void;
  addEvidence: (text: string) => void; recheckSources: () => void; importProfile: () => void;
  settings: (patch: Partial<Pick<StateData, 'maxAttempts' | 'minutes' | 'model' | 'llmVerification'>>) => void;
  notify: (message: string) => void; simulateExport: (format: string) => void;
};
const event = (state: StateData, message: string) => ({ notice: message, events: [...state.events.slice(-9), message] });
export const usePrototype = create<StateData & Actions>((set, get) => ({
  ...initialData(),
  navigate: (page) => set({ page }),
  setStage: (stage) => set({ stage, page: 'workspace' }),
  select: (selectedId) => set({ selectedId }),
  selectJob: (activeJobId) => set((s) => ({ activeJobId, hasDraft: false, consent: false, consentPayload: '', approved: false, pendingText: null, paragraphs: structuredClone(paragraphFixture), verification: 'needs-check', scenario: 'ready', overflow: false, issue: '', runStatus: 'idle', step: 0, requests: 0, page: 'workspace', stage: 'job', ...event(s, 'Posting opened. Start a new simulated run; no draft from another job is reused.') })),
  saveJob: (input) => {
    const data = jobSchema.parse(input);
    const job: Job = { ...data, id: `job-${Date.now()}`, status: 'Saved' };
    set((s) => ({ jobs: [job, ...s.jobs], activeJobId: job.id, page: 'workspace', stage: 'job', hasDraft: false, consent: false, consentPayload: '', approved: false, runStatus: 'idle', step: 0, requests: 0, issue: '', overflow: false, pendingText: null, verification: 'needs-check', scenario: 'ready', paragraphs: structuredClone(paragraphFixture), ...event(s, 'Job saved in memory. Continue to payload review.') }));
  },
  loadScenario: (scenario) => set(() => {
    const base = initialData();
    const next: StateData = { ...base, scenario };
    if (scenario === 'blocked') {
      next.paragraphs[0].text = 'Led a team of 12 engineers and achieved 99.9% availability across production AI infrastructure.';
      next.selectedId = 'exp-software'; next.verification = 'blocked'; next.issue = 'Leadership, team size, and availability are not supported by this source.';
    }
    if (scenario === 'overflow') next.overflow = true;
    if (scenario === 'stale') { next.verification = 'stale'; next.issue = 'A referenced profile source changed after this draft was created.'; next.evidence[0].revision = 2; next.profileRevision = 2; next.selectedId = 'exp-software'; }
    if (scenario === 'rate-limit' || scenario === 'offline' || scenario === 'budget') {
      next.stage = 'generate'; next.runStatus = 'paused'; next.step = 2; next.requests = scenario === 'budget' ? 12 : 2;
      next.consent = true; next.consentPayload = JSON.stringify({ demo: true, approved: 'fictional posting + pseudonymized fixture evidence', identifiers: 'omitted' }, null, 2);
      next.issue = scenario === 'rate-limit' ? 'Simulated HTTP 429. Progress is retained; no retry is sent automatically.' : scenario === 'offline' ? 'Simulated offline state. Draft and completed steps are retained in memory only.' : 'Simulated budget reached. Increase the demo request budget in Settings, then resume.';
    }
    if (scenario === 'empty') { next.jobs = []; next.activeJobId = ''; next.hasDraft = false; next.page = 'jobs'; next.stage = 'job'; }
    next.notice = 'Scenario loaded. This is simulated behavior, not an integration test.';
    return next;
  }),
  reset: () => set(initialData()),
  editParagraph: (id, text) => set((s) => ({ paragraphs: s.paragraphs.map(p => p.id === id ? { ...p, text } : p), approved: false, verification: 'needs-check', pendingText: null })),
  validate: () => set((s) => {
    const unsupported = s.paragraphs.some(p => /team of 12|99\.9%/.test(p.text));
    return { verification: unsupported ? 'blocked' : 'passed', issue: unsupported ? 'The injected team size, leadership, and availability claims are unsupported.' : '', approved: false, ...event(s, unsupported ? 'Demo check found the scripted unsupported claim. Correct it before approval.' : 'Demo checks complete. This only exercises UI states; manually review wording and sources.') };
  }),
  resolve: () => set((s) => ({ paragraphs: s.paragraphs.map(p => p.id === 'exp-software' ? structuredClone(paragraphFixture[0]) : p), verification: 'needs-check', approved: false, issue: '', ...event(s, 'Unsupported wording replaced with the original supported paragraph. Run demo checks again.') })),
  approve: () => set((s) => canExport(s, false) ? ({ approved: true, stage: 'export', ...event(s, 'Draft approved in this demo. Any content change will invalidate approval.') }) : event(s, 'Resolve verification, source, or page-fit issues before approval.')),
  propose: () => set((s) => {
    const selected = s.paragraphs.find(p => p.id === s.selectedId);
    return { pendingText: selected ? proposalFor(selected) : null, ...event(s, 'A simulated replacement is ready. Your current paragraph has not changed.') };
  }),
  acceptProposal: () => set((s) => ({ paragraphs: s.paragraphs.map(p => p.id === s.selectedId && s.pendingText ? { ...p, text: s.pendingText } : p), pendingText: null, approved: false, verification: 'needs-check', ...event(s, 'Replacement accepted. The draft needs checks and renewed approval.') })),
  rejectProposal: () => set((s) => ({ pendingText: null, ...event(s, 'Replacement rejected. Existing wording is unchanged.') })),
  setPageTarget: (pageTarget) => set({ pageTarget, approved: false }),
  acceptCuts: () => set((s) => ({ paragraphs: s.paragraphs.filter(p => p.id !== 'exp-cp'), overflow: false, approved: false, verification: 'needs-check', ...event(s, 'Accepted proposed cut: competitive-programming training. Other paragraphs are unchanged.') })),
  begin: (consentPayload) => set((s) => ({ consent: true, consentPayload, draftEvidence: structuredClone(s.evidence), runStatus: 'running', step: 0, requests: 0, issue: '', approved: false, hasDraft: false, stage: 'generate', page: 'workspace', ...event(s, 'Approved this demo payload. Simulated generation started; no network request occurs.') })),
  tick: () => set((s) => {
    if (s.runStatus !== 'running') return {};
    const call = [1, 1, 0, 1, s.llmVerification ? 1 : 0, 0][s.step] ?? 0;
    if (s.requests + call > s.maxAttempts) return { runStatus: 'paused', issue: 'Demo request budget reached. Increase it in Settings before resuming.', ...event(s, 'Budget reached; no additional simulated attempt dispatched.') };
    const nextStep = s.step + 1;
    if (nextStep >= graphSteps.length) return { requests: s.requests + call, step: nextStep, runStatus: 'complete', hasDraft: true, verification: 'passed', issue: '', stage: 'review', ...event(s, 'Simulated draft ready. Human review is required before export.') };
    return { requests: s.requests + call, step: nextStep };
  }),
  cancel: () => set((s) => ({ runStatus: 'cancelled', ...event(s, 'Run cancelled. No further simulated steps will advance.') })),
  resume: () => set((s) => {
    if (!s.consent) return event(s, 'Review and approve the outgoing payload before resuming.');
    if (s.requests >= s.maxAttempts) return event(s, 'The request ceiling is reached. Increase the demo budget in Settings before resuming.');
    return { runStatus: 'running', issue: '', ...event(s, 'Resumed from the last completed simulated step. No completed step is replayed.') };
  }),
  updateProfile: (profileName, profileHeadline) => set((s) => ({ profileName, profileHeadline, profileRevision: s.profileRevision + 1, approved: false, ...event(s, 'Local profile details updated in memory. Review is required before exporting changed contact/header content.') })),
  updateSource: (id, text) => set((s) => ({ evidence: s.evidence.map(e => e.id === id ? { ...e, text, revision: e.revision + 1 } : e), profileRevision: s.profileRevision + 1, verification: 'stale', approved: false, issue: 'Referenced evidence changed. Compare the saved draft against the updated source.', ...event(s, 'Profile evidence changed; affected draft approval is invalidated.') })),
  addEvidence: (text) => set((s) => {
    const source: Evidence = { id: `src-manual-${Date.now()}`, label: 'User-added factual evidence', text, revision: 1 };
    return { evidence: [...s.evidence, source], paragraphs: s.paragraphs.map(p => p.id === s.selectedId ? { ...p, sourceIds: [...p.sourceIds, source.id] } : p), profileRevision: s.profileRevision + 1, approved: false, verification: 'needs-check', ...event(s, 'New fact saved to the demo profile and linked to this paragraph. Review and recheck it.') };
  }),
  recheckSources: () => set((s) => ({ verification: 'needs-check', issue: '', approved: false, ...event(s, 'Source change acknowledged for review. Check the draft wording against the updated source, then run demo checks.') })),
  importProfile: () => set((s) => ({ profileImported: true, ...event(s, 'Reviewed fixture import accepted in memory. No PDF parser ran and no original file changed.') })),
  settings: (patch) => set(patch),
  notify: (message) => set((s) => event(s, message)),
  simulateExport: (format) => set((s) => canExport(s) ? event(s, `Simulated ${format} export complete. No file was written; the production exporter is not implemented.`) : event(s, 'Export blocked. Resolve checks/page fit and approve this draft first.')),
}));

export function canExport(s: StateData, requireApproval = true) {
  return s.hasDraft && s.verification === 'passed' && (!s.overflow || s.pageTarget === 2) && (!requireApproval || s.approved);
}
export function proposalFor(p: Paragraph) {
  const originals: Record<string, string> = {
    'exp-software': 'Contribute to full-stack applications through third-party API integration, backend workflow optimization, and support for deployment pipelines and AI-driven production features.',
    'exp-ml': 'Completed 120 hours of machine learning training, developing Python, Scikit-learn, and TensorFlow models for NLP and computer vision tasks.',
    'exp-cp': 'Solved 100+ competitive programming problems through coached training in algorithms, data structures, and optimization.',
    'project-parking': 'Built a parking-space classifier with TensorFlow/Keras and a fine-tuned ResNet50. Combined OpenCV video processing, motion detection, GPU acceleration, and batch inference for real-time availability visualization.',
    'project-dino': 'Built a real-time hand-gesture-controlled Dino Runner in Python with OpenCV and MediaPipe, keyboard fallback, and Windows packaging through PyInstaller.',
    'project-browser': 'Built a client-side TensorFlow.js image classifier using MobileNet transfer learning, webcam data collection, custom class training, live predictions, and model export.',
  };
  return originals[p.id] ?? p.text;
}
