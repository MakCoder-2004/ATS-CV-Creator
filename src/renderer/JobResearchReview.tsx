import { useEffect, useRef, useState } from 'react'
import type { JobResearchRun, ReviewedJobResearch } from '../shared/job-research-schema'
import type { ResearchState } from '../shared/job-research-ipc'
import { buildJobResearchQuery } from '../shared/job-research-search-query'
import './job-research-review.css'

export function JobResearchFindings({ run, selected, disabled, onToggle }: { run: JobResearchRun; selected: string[]; disabled: boolean; onToggle: (id: string, checked: boolean) => void }) {
  const group = (kind: 'direct-role-text' | 'indexed-role-claim' | 'verified-company-context', heading: string) => {
    const findings = run.findings.filter(finding => finding.kind === kind)
    return <section className="research-group" aria-label={heading}><h4>{heading}</h4>{findings.length ? <ul>{findings.map(finding => {
      const source = run.sources.find(item => item.id === finding.sourceId)!
      return <li key={finding.id} className="research-finding">
        {kind !== 'verified-company-context' && <label className="research-choice"><input type="checkbox" disabled={disabled} checked={selected.includes(finding.id)} onChange={event => onToggle(finding.id, event.target.checked)} /> Include this role finding in review</label>}
        <p className="research-evidence">{finding.text}</p>
        <p className="research-source"><strong>{finding.completeness === 'full' ? 'Full direct posting' : kind === 'indexed-role-claim' ? 'Partial indexed excerpt' : kind === 'verified-company-context' ? 'Employer background only' : 'Partial direct text'}</strong> · {source.title ?? 'Untitled source'} · {source.employer ?? 'Employer not stated'} · Read {new Date(source.capturedAt).toLocaleString()} · {source.identity === 'verified-employer' ? 'Verified employer' : 'Exact role'}</p>
        <p className="research-url">Source (not opened automatically): {source.url}</p>
      </li>
    })}</ul> : <p>{kind === 'verified-company-context' ? 'No verified employer background. This cannot establish role requirements.' : kind === 'indexed-role-claim' ? 'No matching indexed role claims.' : 'No usable direct role wording.'}</p>}</section>
  }
  return <>{group('direct-role-text', 'Direct role source')}{group('indexed-role-claim', 'Indexed role details')}{group('verified-company-context', 'Verified employer context — not role requirements')}</>
}

/** Source links are text, never untrusted navigation targets. Only the selected canonical role can be opened via the trusted shell method. */
export function JobResearchReview({ url, onReviewedResearch }: { url: string; onReviewedResearch?: (token: string, reviewed: ReviewedJobResearch) => void }) {
  const [token, setToken] = useState<string>()
  const tokenRef = useRef<string | undefined>(undefined)
  const sequence = useRef(0)
  const mounted = useRef(false)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const researchButtonRef = useRef<HTMLButtonElement>(null)
  const [run, setRun] = useState<JobResearchRun>()
  const [selected, setSelected] = useState<string[]>([])
  const [acknowledged, setAcknowledged] = useState(false)
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reviewed, setReviewed] = useState<ReviewedJobResearch>()

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; sequence.current++; if (tokenRef.current) void window.workbench.cancelJobResearch(tokenRef.current).catch(() => {}) }
  }, [])
  function show(state: ResearchState) {
    if (state.status === 'ready') {
      setRun(state.run); setSelected([]); setAcknowledged(false); setReviewed(undefined)
      setNotice(state.run.status === 'full' ? 'A complete direct role source was found. Review its wording before continuing.' : state.run.status === 'blocked' ? 'The public source blocked this read. Nothing was accepted.' : state.run.status === 'none' ? 'No exact-role evidence was found. Nothing was accepted.' : 'Only partial role evidence was found. It is not a complete posting.')
      requestAnimationFrame(() => { if (mounted.current) cancelButtonRef.current?.focus() })
    } else if (state.status === 'unavailable') {
      setError(state.message + (state.settingsAction ? ' Set up a Tavily key in Settings, then start a new research attempt.' : ' Open the original posting or paste complete text instead.'))
    }
  }
  async function start() {
    const current = ++sequence.current
    setBusy(true); setError(''); setNotice('Reading the public posting…')
    try {
      const { token: issued } = await window.workbench.startJobResearch(url)
      if (current !== sequence.current) { void window.workbench.cancelJobResearch(issued); return }
      tokenRef.current = issued; setToken(issued)
      requestAnimationFrame(() => { if (mounted.current && current === sequence.current) cancelButtonRef.current?.focus() })
      while (current === sequence.current && mounted.current) {
        const state = await window.workbench.getJobResearch(issued)
        if (current !== sequence.current) return
        if (state.status !== 'loading') { show(state); break }
        await new Promise(resolve => window.setTimeout(resolve, 150))
      }
    } catch (failure) { if (current === sequence.current) setError(failure instanceof Error ? failure.message : 'The public read failed. Try again or paste the posting text.') }
    finally { if (current === sequence.current) setBusy(false) }
  }
  async function search() {
    if (!token || !run || busy || searched || run.status === 'full') return
    const current = ++sequence.current
    setSearched(true); setBusy(true); setError(''); setNotice('Checking indexed sources for this exact role…'); setReviewed(undefined)
    requestAnimationFrame(() => { if (mounted.current && current === sequence.current) statusRef.current?.focus() })
    try {
      const state = await window.workbench.searchJobResearch(token)
      if (mounted.current && current === sequence.current) show(state)
    } catch (failure) { if (current === sequence.current) setError(failure instanceof Error ? failure.message : 'Search could not complete. Start a new public read to try again.') }
    finally { if (current === sequence.current) setBusy(false) }
  }
  async function review() {
    if (!token || !run || !selected.length || busy) return
    const current = ++sequence.current
    setBusy(true); setError(''); setNotice('Reviewing selected role evidence…')
    requestAnimationFrame(() => { if (mounted.current && current === sequence.current) statusRef.current?.focus() })
    try {
      const { reviewed: result } = await window.workbench.reviewJobResearch(token, selected, acknowledged)
      if (!mounted.current || current !== sequence.current) return
      setReviewed(result)
      setNotice(result.analysisScope === 'provisional' ? 'Partial role findings reviewed. No analysis has started.' : 'Direct role source reviewed. No analysis has started.')
      onReviewedResearch?.(token, result)
    } catch (failure) { if (mounted.current && current === sequence.current) setError(failure instanceof Error ? failure.message : 'The evidence could not be reviewed. Select exact-role findings and try again.') }
    finally { if (mounted.current && current === sequence.current) setBusy(false) }
  }
  function cancel() {
    sequence.current++
    if (tokenRef.current) void window.workbench.cancelJobResearch(tokenRef.current).catch(() => {})
    tokenRef.current = undefined; setToken(undefined); setRun(undefined); setSelected([]); setAcknowledged(false); setSearched(false); setReviewed(undefined); setBusy(false); setError(''); setNotice('Research cancelled. No findings were saved.')
    requestAnimationFrame(() => { if (mounted.current) researchButtonRef.current?.focus() })
  }
  const role = run?.findings.filter(finding => finding.kind !== 'verified-company-context') ?? []
  const partial = !!run && !selected.some(id => role.some(finding => finding.id === id && finding.kind === 'direct-role-text' && finding.completeness === 'full'))
  return <section className="job-research-review" aria-label="Temporary job research">
    <header><h3>Research this exact role</h3><p>Starting this action makes a fresh public read of the selected job. First inspect the direct public role. Indexed search is a separate, optional decision. Nothing is saved or analyzed here.</p></header>
    {!token && <button ref={researchButtonRef} type="button" className="secondary-button" disabled={busy} onClick={() => void start()}>{busy ? 'Reading…' : 'Research indexed details'}</button>}
    {token && <button ref={cancelButtonRef} type="button" className="secondary-button" onClick={cancel}>Cancel and discard research</button>}
    {notice && <p ref={statusRef} tabIndex={-1} role="status" className="research-status">{notice}</p>}
    {error && <p role="alert" className="research-error">{error}</p>}
    {run && <><div className="research-identity"><strong>Selected role</strong><p>{run.selected.canonicalUrl}</p><p>Host: {run.selected.host}{run.selected.roleId ? ` · Role ID: ${run.selected.roleId}` : ''} · {run.status === 'full' ? 'Full direct posting' : run.status === 'provisional' ? 'Provisional, incomplete' : run.status === 'blocked' ? 'Blocked' : 'No role evidence'}</p><button type="button" className="secondary-button" onClick={() => void window.workbench.openPostingSource(run.selected.canonicalUrl).then(result => { if (!result.ok) setError(result.message) }).catch(() => setError('The original source could not be opened.'))}>Open selected original posting</button></div>
      <JobResearchFindings run={run} selected={selected} disabled={busy || !!reviewed} onToggle={(id, checked) => { setSelected(ids => checked ? [...ids, id] : ids.filter(item => item !== id)); setAcknowledged(false) }} />
      <section className="research-unknowns" aria-label="Still unknown"><h4>Still unknown</h4>{run.unknowns.length ? <ul>{run.unknowns.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>No additional unknowns were reported; completeness still cannot be guaranteed.</p>}</section>
      {run.status !== 'full' && !searched && <div className="research-search"><h4>Optional indexed search</h4><p>Search query: <code>{buildJobResearchQuery(run.selected) ?? 'Unavailable: this source has no usable host or role ID.'}</code></p><p>If this direct read is incomplete and you explicitly search, Tavily and its index providers receive the displayed query and your network address; search returns up to 5 results and may use 1 credit. After an exact-role match, the app may check the selected public page again. No title, CV, profile, contact data, posting wording, or link tracking parameters are sent. Indexed snippets remain partial.</p><p>Set up a Tavily key in Settings. Paid use is not enabled.</p><button type="button" className="secondary-button" disabled={busy || !buildJobResearchQuery(run.selected)} onClick={() => void search()}>{busy ? 'Checking…' : 'Search indexed details'}</button></div>}
      {role.length > 0 && <div className="research-review-action">{partial && selected.length > 0 && <label className="research-choice"><input type="checkbox" checked={acknowledged} disabled={busy || !!reviewed} onChange={event => setAcknowledged(event.target.checked)} /> I understand these selected role details are partial, not the complete posting. Any analysis must be provisional.</label>}
        <button type="button" className="primary-button" disabled={!selected.length || busy || !!reviewed || (partial && !acknowledged)} onClick={() => void review()}>{busy ? 'Reviewing…' : 'Review selected role findings'}</button>
        {reviewed && <p role="status">Review frozen: {reviewed.analysisScope === 'provisional' ? 'provisional' : 'full'} role evidence. {onReviewedResearch ? 'Continue to Outgoing data to inspect the exact evidence and consent to analysis.' : 'Outgoing data and analysis are not connected yet. Nothing was saved or analyzed. You can paste a complete posting to use the existing CV flow.'}</p>}
      </div>}</>}
  </section>
}
