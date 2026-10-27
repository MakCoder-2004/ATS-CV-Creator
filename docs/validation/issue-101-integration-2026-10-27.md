# Issue 101 integration checkpoint — 2026-10-27

**Verdict: INCOMPLETE; issue #101 remains open.** This checkpoint used a new isolated worktree at `E:/cv-tailor-101`, based on reviewed #99 PR #107 commit `7e05755d505d8edab429bd30ec29e663ae736399`. It did not modify or merge PR #107 or `main`.

## Scope and evidence

- Installed the locked dependencies in this worktree with `npm ci --no-audit --no-fund` (696 packages); no concurrent install or test process ran.
- `npm run typecheck` and `npm run build` passed. Build emitted only the known nonfatal upstream Zod annotation warnings.
- One serial integration run, `npm test` (Node-ABI SQLite rebuild followed by Vitest with one worker), completed with **71 test files passed, 3 failed, 2 skipped; 534 tests passed, 4 failed, 3 skipped**. Failures are listed below; this is not a passing integration suite.
- After rebuilding `better-sqlite3` for Electron, one unpacked visible desktop test passed: `node node_modules/playwright/cli.js test tests/electron/named-greenhouse-preview.spec.ts --workers=1 --reporter=line` — **1 passed**. It exercised synthetic-only Greenhouse and Lever flows, exact-role/completeness review, explicit Save, the source-snapshot/working-record split, native SQLite persistence after renderer reload, deletion and the old-backup disclosure, and fail-closed generic Greenhouse/EU Lever routes. The dev-only fixture logs exactly three named API requests (two Greenhouse attempts, one Lever); link changes did not issue a late extra read. It uses isolated `appData` and `userData` siblings and scripted local responses; no live posting, Tavily, Pi model, packaged executable or installer was used. This is unpacked development preview evidence, not installed-app acceptance.
- In the serial suite, named-posting unit coverage, including SQLite Save/backup/restore/delete/reopen, passed (`tests/jobs.test.ts`); source-policy, named API/session, backup, profile/CV, and authorization suites also ran as part of the same serial pass. These results do not erase the four unrelated suite failures or establish installed behavior.

## Serial-suite failures

1. `tests/job-research-ui.test.ts` — stale copy assertion expects the older Lever-pause wording and does not match the current named-Lever opt-in disclosure.
2. `tests/research-volatile-analysis.test.ts` — expects LinkedIn research dispatch, but current source policy correctly refuses it as paused.
3. Two `tests/paragraph-repair-boundary.test.ts` cases fail because `generateDraft` returns `ok: false` for the 60-word paragraph boundary and the correction `- Built 12 stable systems.`. These failures are outside named job intake; they remain unresolved and must not be called stale without investigation.

No second full suite or repeated Electron run was performed. The failures were not changed in this integration checkpoint.

## Acceptance limits and remaining gates

The reviewed named Greenhouse and non-EU Lever paths remain narrowly separate from generic/direct intake. Lever EU, LinkedIn and Indeed stay paused. Indexed Tavily search is retired; no provider credentials or live requests were used. Named posting Save does not authorize a Pi run. Existing records and normal profile/CV workflows remain exercised by the passing domain tests, but this checkpoint did not perform a real-provider run or claim source access/license rights.

The required **installed Windows application**, native SQLite persistence/reopen on that installed application, and end-user workflow acceptance were not performed. The user authorized an unpacked preview only and did not authorize packaging, launching a packaged executable, or installation. Treat installed validation as **NOT VERIFIED**, not passed. Per the user’s instruction, do not close #101; request any further packaged/installed approval from the parent agent before proceeding.

## Artifacts

- Worktree: `E:/cv-tailor-101`
- Baseline: `7e05755d505d8edab429bd30ec29e663ae736399` (PR #107, branch `issue-99-reviewed-save`)
- Visible test: `tests/electron/named-greenhouse-preview.spec.ts`
- Relevant domain test: `tests/jobs.test.ts`
