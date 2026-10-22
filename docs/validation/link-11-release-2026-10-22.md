# Link 11 release validation — issue #37

**Validation branch/base:** `link/37-release`, based exactly on `main` `1ab3a4fbac86a4aba298637984657201219bfa85` (confirmed merge-base). This is release evidence, not a claim that every #26 acceptance item passed. Parent #26 remains open. One user-authorized Lever request was attempted through the installed app under a strict single-request mode; no model call was made.

## Supported-source matrix and limits

This matrix combines the production source policy with the earlier #27 feasibility review. “Supported” describes the implemented URL policy; it does not promise that any particular posting is current, accessible, complete, reusable, or truthful.

| Source | Accepted request surface | Evidence / limitations |
|---|---|---|
| Lever | HTTPS GET `api.lever.co/v0/postings/{site}/{posting_id}` or `jobs.lever.co/{site}/{posting_id}` only | Production source policy accepts only these named-detail paths. #27 reviewed Lever's API docs and Terms of Service and separately observed API and hosted-page responses on 2026-10-22. The API response omitted a company field; the hosted page had one `JobPosting` JSON-LD object. Those observations do not establish employer identity, completeness, continuing availability, blanket permission, or legal rights. The #37 request attempt is separately recorded below; its HTTP response did not complete. |
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
- **Stories 72, 80:** installed NSIS packaging, Electron SQLite ABI and LaTeX bundle checks passed. Installed-app first-window/SQLite reopen, fresh default model display and persistence of a subsequently chosen model, v1/v2/v3 backup restore, and offline 42,000-character manual save/close/reopen were exercised. One guarded installed source request was attempted but returned no completed response or preview.

The issue comments/commits for #27–36 contain the slice-by-slice implementation and validation evidence. In particular, #27 records feasibility only; #28 records the approved Saved jobs intake contract; #29–35 cover persistence, retrieval, review, backup, refresh, model limits and long text; #36 covers explicit target renewal. This trace maps required behaviors to those contracts plus the integrated suites; it does not turn prior isolated demos into proof of the final installed workflow.

## Observed validation

- `npm run verify:latex`: passed; physical TinyTeX toolchain and exact Letter template smoke verified.
- Targeted public-contract importer/backup/refresh/safety/scope tests: 61/61 passed before integration.
- `npm run typecheck`: passed.
- Full behavior suite, bounded to two workers (`npx vitest run --maxWorkers=2`): 256/256 passed across 43 files. The earlier isolated PDF timeout did not recur; the 5-second worker deadline was not relaxed.
- Full Electron suite (`npm run test:electron`): 44 passed, 4 skipped by existing configuration. The legacy over-cap test now verifies that an edit is refused when immutable 300-revision history means the complete record would not shrink; public preload inspection confirms the original posting and all revisions remain unchanged. The workspace warning now accurately qualifies when shortening can help.
- `npm run dist:win`: passed. Built `release/CV-Tailor-Setup-0.3.0.exe`, installed it at `E:\cv37app`, verified packaged native SQLite under Electron ABI 140 and bundled LaTeX.
- Installed application: first-window/theme persistence and native SQLite close/reopen passed. Settings displayed fresh default `xingchen-agi/xing4.0-29b-a4b:free`; a user-selected `openai/gpt-4o-mini` remained persisted after close/reopen. No key or model request was used. Installed v1 and v2 backups were upgraded and restored, and v3 backup restored the exact posting/revision. A 42,000-character manual-fallback posting survived close/reopen exactly with unknown provenance.
- Installed UI screenshots were reviewed in light/dark and at 390px width; keyboard focus is visible and the narrow page has no horizontal overflow: [`link-11/`](link-11/). Screens show the empty Saved jobs intake and approved manual fallback only; they do not show a fetched posting.
- The existing installed LaTeX scenario produced and checked a real PDF from the packaged LaTeX toolchain, then its test failed later on an absent `Remove TypeScript` button assumption in an earlier installed run. `dist:win` package smoke verified the bundled toolchain.

## Blockers and limits

1. **The single authorized live Lever attempt did not complete.** Through the installed importer, the HTTPS request-start audit recorded exactly one request start; no response/status completion was observed. The UI reached an error state and no preview or save occurred. `CV_TAILOR_SINGLE_POSTING_REQUEST=1` disabled retries and refused redirects; no second request, probing, page-body logging, or model call was made. The result is an incomplete network attempt, not evidence that the posting is unavailable or removed. Do not retry without new authorization.
2. The full behavior and Electron suites now pass, including the honest legacy-history refusal case. The refusal is intentional when shortening current wording cannot reduce the immutable full record; no history was deleted and no larger write was allowed.
3. The installed fresh-default/settings, backup-upgrade, SQLite reopen and manual fallback gates pass. The installed source check still lacks a completed HTTP response and preview/save evidence, so #37 and parent #26 are not release-complete.
