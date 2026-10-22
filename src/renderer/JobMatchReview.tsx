import { CheckCircle2, CircleHelp, CircleDot } from 'lucide-react'
import type { DraftRevision } from '../shared/draft'
import type { JobRecord } from '../shared/jobs'
import type { QualificationAssessment } from '../shared/qualification-coverage'
import type { ProfileSnapshot } from '../shared/profile'
import type { ExperienceSnapshot } from '../shared/experience'
import { describeSource } from './review-copy'

export function JobMatchReview({ draft, sources, job }: { draft: DraftRevision; sources?: { profile: ProfileSnapshot; evidence: ExperienceSnapshot } | null; job?: JobRecord | null }) {
  const scopeDiffersFromSource = !!job?.sourceSnapshot && job.sourceSnapshot.description !== job.description
  const coverage = draft.coverage as (NonNullable<DraftRevision['coverage']> & { assessments?: QualificationAssessment[]; stale?: boolean }) | undefined
  const current = sources ? [...sources.profile.education, ...sources.profile.skills, ...sources.profile.certificates, ...sources.evidence.experience, ...sources.evidence.experience.flatMap(item => item.factualItems), ...sources.evidence.projects] : []
  function evidenceLabel(evidence: { evidenceId: string; revision: number }) {
    const source = current.find(item => item.id === evidence.evidenceId && item.revision === evidence.revision) ?? draft.evidence.find(item => item.evidenceId === evidence.evidenceId && item.revision === evidence.revision)?.snapshot
    return describeSource(source)
  }
  return <section className="coverage-disclosure job-match-panel" aria-label="Job requirement comparison"><h2>How your experience matches this job</h2><p>This compares the requirements with your profile and your own CV additions, not just the wording selected for this CV. It is guidance, not a hiring verdict or an approval blocker.</p>{scopeDiffersFromSource && <p className="posting-scope-note" role="status">This comparison uses the accepted working posting only. Its retained source snapshot differs; requirements absent from the working text were not assessed.</p>}{coverage?.stale && <p role="status">This comparison reflects an earlier accepted job posting. Its results are retained for history; reassess the current posting explicitly before relying on them.</p>}{coverage?.assessments ? <div className="qualification-assessments">
    {coverage.assessments.map((item, index) => <article className={`qualification-assessment is-${item.status}`} key={`${item.kind}-${index}`}>
      <div className="qualification-status">{item.status === 'supported' ? <CheckCircle2 size={16} aria-hidden="true" /> : item.status === 'partial' ? <CircleDot size={16} aria-hidden="true" /> : <CircleHelp size={16} aria-hidden="true" />}<strong>{item.status === 'supported' ? 'Relevant evidence found' : item.status === 'partial' ? 'Some evidence found' : 'Needs a closer look'}</strong></div>
      <p className="qualification-requirement">{item.qualification}</p>
      {item.evidence.length > 0 && <><ul className="qualification-sources">{item.evidence.map(evidence => { const source = evidenceLabel(evidence); return <li key={`${evidence.evidenceId}-${evidence.revision}`}><strong>{source.heading}</strong>{source.detail && <details><summary>Read supporting fact</summary><p>{source.detail}</p></details>}</li> })}</ul><p className="qualification-placement">{item.inDraft ? 'Related source is linked in this CV.' : 'Related evidence is in your profile, but not linked in this CV.'}</p></>}
      {item.status !== 'supported' && <p>{item.remainingConcepts.includes('degree completion') ? 'Confirm whether the degree has been awarded; the saved dates suggest it may be in progress.' : item.remainingConcepts.some(term => /\d.*years?/i.test(term)) ? 'The requested years of relevant experience still need your review. Related projects or skills do not establish tenure.' : item.evidence.length ? 'Read the full requirement against these facts. Related knowledge does not establish every requested responsibility or level of experience.' : 'The local check could not confidently identify matching evidence. Review your saved details or add relevant career facts; this does not mean you lack the qualification.'}</p>}
    </article>)}
  </div> : coverage ? <div><p>This older comparison checked CV wording only. Reopen the draft to refresh its profile comparison.</p>{coverage.supportedMatches.length > 0 && <><h3>Matches in this CV</h3><ul>{coverage.supportedMatches.map((match, index) => <li key={index}>{match.qualification}</li>)}</ul></>}{coverage.gaps.length > 0 && <><h3>Requirements to review</h3><ul>{coverage.gaps.map((gap, index) => <li key={index}>{gap.qualification} — not confidently matched; review the relevant facts.</li>)}</ul></>}</div> : <p>Job comparison will appear when the saved posting analysis is available.</p>}</section>
}
