# Issue 101 integration checkpoint — 2026-10-27

**Verdict: INCOMPLETE; issue #101 remains open pending installed Windows acceptance.** This checkpoint used a new isolated worktree at `E:/cv-tailor-101`, based on reviewed #99 PR #107 commit `7e05755d505d8edab429bd30ec29e663ae736399`. It did not modify or merge PR #107 or `main`.

## Scope and evidence

- Installed the locked dependencies in this worktree with `npm ci --no-audit --no-fund` (696 packages); no concurrent install or test process ran.
- `npm run typecheck` and `npm run build` passed. Build emitted only the known nonfatal upstream Zod annotation warnings.
- Initial serial integration run, `npm test` (Node-ABI SQLite rebuild followed by Vitest with one worker), found four failures. After correcting only the two stale policy assertions, one final serial `npm test` pass completed with **74 test files passed, 2 skipped; 538 tests passed, 3 skipped; no failures**. The unchanged Electron preview was not repeated.
- After rebuilding `better-sqlite3` for Electron, one unpacked visible desktop test passed: `node node_modules/playwright/cli.js test tests/electron/named-greenhouse-preview.spec.ts --workers=1 --reporter=line` — **1 passed**. It exercised synthetic-only Greenhouse and Lever flows, exact-role/completeness review, explicit Save, the source-snapshot/working-record split, native SQLite persistence after renderer reload, deletion and the old-backup disclosure, and fail-closed generic Greenhouse/EU Lever routes. The dev-only fixture logs exactly three named API requests (two Greenhouse attempts, one Lever); link changes did not issue a late extra read. It uses isolated `appData` and `userData` siblings and scripted local responses; no live posting, Tavily, Pi model, packaged executable or installer was used. This is unpacked development preview evidence, not installed-app acceptance.
- In the final serial suite, named-posting unit coverage, including SQLite Save/backup/restore/delete/reopen, passed (`tests/jobs.test.ts`); source-policy, named API/session, backup, profile/CV, and authorization suites also passed. This does not establish installed behavior.

## Failure diagnosis and follow-up

- `tests/job-research-ui.test.ts` had stale copy expecting Lever generally paused. Updated the assertion to require the current accurate disclosure: generic/direct LinkedIn, Indeed and Lever remain paused, with a distinct per-run opt-in and reviewed Save route.
- `tests/research-volatile-analysis.test.ts` expected LinkedIn and Indeed identities to proceed to model outgoing-data preview, contradicting current fail-closed policy. Replaced it with assertions that both source-specific pauses are returned before dispatch and the synthetic model transport is never called. No source policy or production code was weakened.
- The two paragraph-repair failures from the initial integration run were not reproducible consistently. The paragraph-boundary suite passed 4/4 on a separate clean worktree at `origin/main` commit `c52533f2dc2f61a23d7741d5eec312efe48fa378`; relevant generation/recovery production code is unchanged between that baseline and pinned #99 commit (the #99 workbench delta is the separate named-posting acceptance method). In `E:/cv-tailor-101`, the suite initially failed two cases, then one multiline-correction case on a subsequent targeted run, and passed all 4 cases in both the focused 3-file run and final serial integration. No assertion was weakened and no production code changed. The transient failure's cause was not established; do not claim it was introduced by #99.
- The focused rerun of `tests/job-research-ui.test.ts`, `tests/research-volatile-analysis.test.ts`, and `tests/paragraph-repair-boundary.test.ts` passed **25/25**. The final serial `npm test` pass passed all non-skipped tests. No further full suite or Electron preview was run.

## Acceptance limits and remaining gates

The reviewed named Greenhouse and non-EU Lever paths remain narrowly separate from generic/direct intake. Lever EU, LinkedIn and Indeed stay paused. Indexed Tavily search is retired; no provider credentials or live requests were used. Named posting Save does not authorize a Pi run. Existing records and normal profile/CV workflows remain exercised by the passing domain tests, but this checkpoint did not perform a real-provider run or claim source access/license rights.

The required **installed Windows application**, native SQLite persistence/reopen on that installed application, and end-user workflow acceptance were not performed. The user authorized an unpacked preview only and did not authorize packaging, launching a packaged executable, or installation. Treat installed validation as **NOT VERIFIED**, not passed. Per the user’s instruction, do not close #101; request any further packaged/installed approval from the parent agent before proceeding.

## Artifacts

- Worktree: `E:/cv-tailor-101`
- Baseline: `7e05755d505d8edab429bd30ec29e663ae736399` (PR #107, branch `issue-99-reviewed-save`)
- Visible test: `tests/electron/named-greenhouse-preview.spec.ts`
- Relevant domain test: `tests/jobs.test.ts`
