# Stage D temporary research integration (development branch)

Issue #88, integrated on `feat/universal-research-stage-d`. This is **development evidence, not an installed release**. The user's running installed 0.5 app was not opened, replaced or modified.

## Scope and storage boundary

A selected LinkedIn search-results URL resolves to its one canonical job ID before a bounded public read. Full and partial new non-Lever reads transfer their captured findings once to app-held research; the full capture is read-only and offers no Save, Refresh, edit or indexed-search action. Main refuses crafted import/refresh of new non-Lever captures, including after handoff; historical manual, Lever and previously saved records remain distinct. Research source wording, indexed snippets, review selection, Pi outgoing authorization and returned analysis are temporary, expire on cancellation/app close or the bounded 15-minute lifecycle, and do not become jobs, drafts, analysis cache, checkpoints, recovery or backups. A full direct source needs no Tavily search. Exact-role indexed partial evidence requires a meaningful access gate or incomplete direct role, a matching selected URL/ID and acknowledgment; removed 404/410, unexpected 429, server failures, unsafe redirects and conflicting title/employer cannot be rescued by indexed content. Employer background is never role evidence.

Review of findings alone is not Pi consent. The exact outgoing user message, separate structured system-instruction disclosure, physical model and effort appear before a fresh one-run authorization and explicit Start analysis action. Results link to selected source findings and cannot generate/export a CV.

## Checks on this integration

- Focused Electron-ABI Vitest, one worker and serial groups: `tests/universal-direct-workbench.test.ts`, `job-research-transfer.test.ts`, `job-research-session.test.ts`, `job-research-core.test.ts` — **118 passed**; `job-research-ui.test.ts`, `research-volatile-analysis.test.ts`, `research-consented-analysis-ipc.test.ts`, `research-provisional-review-ui.test.ts`, `tavily-search.test.ts` — **94 passed**. An initial run had one stale static UI assertion about the mounted child key; the stable token identity was restored and the affected tests passed. No full suite run.
- `npm run typecheck`, `npm run build` passed. `out/main/job-research-extraction-worker.cjs` exists; the built sandbox preload does not include `node:crypto`, `node:util` or Node built-in `require` imports.
- Visible synthetic development Electron: `tests/electron/research-full-temporary-flow.spec.ts` **passed**. A LinkedIn selected-ID search URL with eBP/keywords/origin/geoId yielded the canonical direct full review, one synthetic public GET (zero second GET), zero Tavily/provider calls before consent, one synthetic Pi analysis after explicit consent, source-linked result and zero rows in jobs/consents/cache/run-state/recovery/drafts in native SQLite after close. Workspace backup status was unchanged. `tests/electron/research-provisional-flow.spec.ts` **passed** after updating its consent/action labels; it covers a partial direct review, visible consent, one scripted Pi result, revocation on new search and zero saved jobs.
- `node scripts/check-doc-links.cjs` passed. No live Tavily or real Pi request, installer, package run or installed SQLite/reopen check was performed here.

## Open acceptance

Independent review of this exact integrated HEAD and any proven fixes are required before merging to main. Real Pi wording/quality, installed Windows SQLite/reopen, real source availability/rights, representative light/dark/narrow screenshots and any installer execution remain unverified. No rights to retain newly fetched third-party content are assumed; changes to this policy require a separate user decision. Historical dated validation files retain their own scope.
