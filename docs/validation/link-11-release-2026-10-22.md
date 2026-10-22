# Link 11 release validation — issue #37

**Validation branch/base:** `link/37-release`, based exactly on `main` `1ab3a4fbac86a4aba298637984657201219bfa85` (confirmed merge-base). This is release evidence, not a claim that every #26 acceptance item passed. Parent #26 remains open. No live source or model call was made in this validation.

## Supported-source matrix and limits

This matrix combines the production source policy with the earlier #27 feasibility review. “Supported” describes the implemented URL policy; it does not promise that any particular posting is current, accessible, complete, reusable, or truthful.

| Source | Accepted request surface | Evidence / limitations |
|---|---|---|
| Lever | HTTPS GET `api.lever.co/v0/postings/{site}/{posting_id}` or `jobs.lever.co/{site}/{posting_id}` only | Production source policy accepts only these named-detail paths. #27 reviewed Lever's API docs and Terms of Service and separately observed API and hosted-page responses on 2026-10-22. The API response omitted a company field; the hosted page had one `JobPosting` JSON-LD object. Those observations do not establish employer identity, completeness, continuing availability, blanket permission, or legal rights. No #37 live request was performed (see blocker below). |
| Greenhouse | Not enabled | #27 reviewed the documented named-job API and has a synthetic fixture only; no live validation or production support. |
| Ashby | Not enabled | The reviewed public API is a board-list route rather than an identified single-posting detail route; no live validation or production support. |
| LinkedIn, regional boards, other sites | Not supported | No approved single-posting source route; use explicit paste-text fallback. No claim of Egypt/MENA coverage. |

The user-approved #27 permission clarification waived a separate affirmative reuse grant for that bounded feasibility work; it did not establish blanket rights. Public reachability and endpoint access are not legal permission. The only production claim here is the narrow Lever URL policy. No hiring, ATS, completeness, vacancy-status, anonymity, or factuality guarantee is made.

### Implemented safety ceilings

| Boundary | Implemented ceiling / behavior |
|---|---|
| URL | 2,048 UTF-8 bytes; HTTPS; reject userinfo, fragments, non-tracking query values, ports, malformed paths, unsupported hosts and non-detail routes before DNS. |
| Download / expansion | 2 MiB compressed response; 8 MiB decompressed body; reject instead of accepting partial content. |
| Parse | Worker termination at 2 seconds; JSON nesting at most 64; bounded HTML input and parser complexity. |
| Retained source and working description | Each independently limited to 200,000 Unicode code points and 1 MiB UTF-8. No silent truncate. |
| Per-job history | 4 MiB serialized saved-job record and 256 posting revisions; legacy over-cap workspaces are guarded and do not discard history. |
| Workspace backup | v3; 64 MiB aggregate limit, 16 MiB row ceiling, plus table and reference validation. Released v1/v2 upgrades are handled by explicit compatibility paths. |
| Retrieval | One named posting per explicit Fetch/Refresh; exact approved host/path policy, public DNS destination validation/pinning, TLS verification, at most 3 same-route HTTPS redirects, 2-second host pacing, at most 1 eligible retry, Retry-After capped at 30 seconds. No crawl or linked-resource retrieval. |
| Time | 5-second DNS/connect/TLS limits, 15 seconds per response, 30-second total operation deadline; cancellation suppresses late results. |
| Outbound analysis | Separate explicit authorization. Capacity is checked for the complete frozen serialized request, including profile/prompt overhead and reserved output; unknown or excessive capacity fails closed. Storage does not imply model eligibility. |

Resource ceilings are production values, not universal safety proofs. Adversarial URL, DNS, redirect, compression, size, parsing, cancellation and retry behavior is exercised with controlled fixtures; it does not imply exhaustive Internet validation.

## Parent-story traceability (issue #26)

- **Stories 1–9, 17–24, 75–77, 79:** explicit link/manual capture, hostname disclosure, no fetch on paste/open, key-free import, separate save/analysis, correction/conflict/incomplete guards and truthful operation states: public application-contract coverage in `tests/jobs.test.ts`, `tests/safe-posting-fetch.test.ts`; visible importer/fallback in `tests/electron/jobs.spec.ts`. Live-source behavior is not established by fixtures.
- **Stories 10–16, 19–23, 60, 67–70:** supported Lever JSON/static HTML parsing, unknown optional values, conflict and teaser handling, inert HTML, bounded requests, restrictions and failures: `tests/jobs.test.ts`, `tests/safe-posting-fetch.test.ts`, synthetic fixtures under `tests/fixtures/posting-import-feasibility/`. Production supports only the listed Lever paths; generic HTML and linked content are not supported.
- **Stories 25–31:** temporary preview, no save before acceptance, cancellation/supersession, retry and discard confirmation: `tests/jobs.test.ts`, `tests/electron/jobs.spec.ts` (visible late-response/cancel path). No preview persistence promise.
- **Stories 32–40, 71–74:** source/working/revision separation, offline reopen, v1/v2/v3 backup compatibility and refusal cases: `tests/jobs.test.ts`, `tests/workspace-backup.test.ts`, `tests/electron/workspace-backup.spec.ts`. Credentials are excluded and restore does not resume external work.
- **Stories 41–51:** exact-source matching, no-op duplicates, three-way refresh, explicit field choice, stale-target guards, offline history and preservation of prior CV wording: `tests/jobs.test.ts`, `tests/electron/jobs.spec.ts`, `tests/electron/review-renewal.spec.ts`.
- **Stories 52–59:** complete postings above the former 30,000-character ceiling, backup bounds, reviewed shortening, full-source retention and model capacity guards: `tests/jobs.test.ts`, `tests/source-linked-generation.test.ts`, `tests/workbench-model-capacity.test.ts`, `tests/electron/long-posting.spec.ts`, `tests/electron/shortened-posting-scope.spec.ts`.
- **Stories 62–66, 78:** fixed minimal website request headers, no profile/key/cookies, URL privacy boundaries, redirect/DNS/TLS checks and unchanged CV template: `tests/jobs.test.ts`, `tests/safe-posting-fetch.test.ts`, `tests/electron/workbench-start.spec.ts`, `tests/electron/shortened-posting-scope.spec.ts`; source and working text are never sent to a website beyond the selected source URL/path.
- **Stories 72, 80:** installed NSIS packaging, Electron SQLite ABI and LaTeX bundle checks passed. Installed-app first-window/SQLite reopen and offline 42,000-character manual save/close/reopen plus backup/restore were exercised. An installed-app source fetch, installed legacy-backup upgrade and the #37 live Lever request remain unverified.

The issue comments/commits for #27–36 contain the slice-by-slice implementation and validation evidence. In particular, #27 records feasibility only; #28 records the approved Saved jobs intake contract; #29–35 cover persistence, retrieval, review, backup, refresh, model limits and long text; #36 covers explicit target renewal. This trace maps required behaviors to those contracts plus the integrated suites; it does not turn prior isolated demos into proof of the final installed workflow.

## Observed validation

- `npm run verify:latex`: passed; physical TinyTeX toolchain and exact Letter template smoke verified.
- Targeted public-contract importer/backup/refresh/safety/scope tests: 61/61 passed before integration.
- `npm run typecheck`: passed.
- Full behavior run after fixes (`npm test`): 254/255 passed; one unrelated intermittent synthetic-PDF worker timeout exceeded its 5-second bound. Rerunning only `tests/profile-pdf-intake.test.ts` passed 4/4. No importer regression was observed.
- Full Electron run (`npm run test:electron`): 43 passed, 3 skipped by existing suite configuration, 1 failed. The failure was `tests/electron/legacy-backup-recovery.spec.ts`: a seeded 300-revision over-cap legacy record cannot accept the attempted “size-reducing” edit because its fully serialized history does not decrease. A targeted rerun reproduced it. No history was deleted and the app kept the edit uncommitted. The current wording promises only changes that reduce stored size; this test setup/behavior mismatch remains a release issue and was not weakened by dropping history or bypassing the 4 MiB guard.
- `npm run dist:win`: passed. Built `release/CV-Tailor-Setup-0.3.0.exe`, installed it at `E:\cv37app`, verified packaged native SQLite under Electron ABI 140 and bundled LaTeX.
- Installed application: first-window/theme persistence and native SQLite close/reopen test passed. A 42,000-character manual-fallback posting survived installed-app close/reopen exactly and retained “unknown source” provenance. Installed-app visible backup creation and confirmed restore returned the exact baseline posting; a post-backup mutation was removed. No Fetch action was taken in these checks.
- Installed UI screenshots were reviewed in light/dark and at 390px width; keyboard focus is visible and the narrow page has no horizontal overflow: [`link-11/`](link-11/). Screens show the empty Saved jobs intake and approved manual fallback only; they do not show a fetched posting.
- The existing installed LaTeX scenario produced and checked a real PDF from the packaged LaTeX toolchain, then its test failed later on an absent `Remove TypeScript` button assumption. This is separate from the PDF/package result and is not counted as a passing full installed suite.

## Blockers and limits

1. **The separately authorized #37 live Lever check was not run.** The authorized request must target one current public posting without probing. The existing committed #27 evidence intentionally omits its posting ID, and the available repository examples are synthetic or documented-demo URLs, not a known current posting. I did not guess an ID, search/probe additional sites, or make an unauthorized request. Provide one exact current public Lever detail URL (or separately authorize a bounded discovery step) before executing the one request through the installed importer. No live outcome is claimed.
2. **Legacy over-cap recovery smoke remains failing** as described above. Resolve the mismatch without deleting immutable history or permitting a stored-size-increasing write, then rerun only the affected scenario and the necessary final release suite.
3. Full installed live-fetch/preview/save and installed legacy backup-upgrade gates are therefore still open. Do not mark #37 or parent #26 complete based on this report alone.
