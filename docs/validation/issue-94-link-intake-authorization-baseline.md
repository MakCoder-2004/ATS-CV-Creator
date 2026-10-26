# Issue 94 link intake and authorization baseline

**Baseline source:** branch `issue-94-baseline`, starting commit `84e16e865e479a1f5b221ae5797a5694db7559d0` (2026-10-26). This is development Electron evidence with synthetic data, not an installed-app observation. No live credentials, CV, posting or provider were used. The only app behavior change is development-only synthetic search wiring guarded from packaged builds.

## Verdict

**Partially verified.** Focused API tests and visible development Electron tests passed with synthetic data. Direct-link handoff, temporary analysis, manual intake and PDF/DOCX consent have visible evidence. The new visible Tavily path used a synthetic key saved only after asserting the main process's physical isolated `appData` and `userData` paths, plus a dev-only transport that cannot reach Tavily. One visible search action produced the expected usage GET and search POST, exact-role matching indexed result, and no CV/profile data in the query. It also caused the expected second canonical direct read to verify the matching lead. No live provider, key or network was used. Focused Tailor CV evidence completes generation and paragraph regeneration without page-fit measurement. Dispatch labels below name observed operations and do not establish fixed graph-call totals.

The dispatch log added for these checks is development-test-only. It writes operation labels only when `CV_TAILOR_TEST_MODEL_DISPATCH_LOG` is set, and the scripted provider is disabled in packaged builds. It does not log prompts or user data.

## Operation baseline

| Operation | Visible decision count and result | Synthetic external work | Status and limits |
|---|---|---|---|
| Full direct link | One **Fetch posting**; one **Review temporary findings** handoff; one role-selection/review action; one outgoing-data authorization; one **Start analysis**. The handoff caused no second GET. | One direct-read log entry; zero model entries before **Start analysis**; one model request after it. | **VERIFIED** in `tests/electron/research-full-temporary-flow.spec.ts`. Temporary result was not saved, exported or backed up. |
| Incomplete direct link | One **Fetch posting**; one **Inspect captured findings**; one partial-role acknowledgment/review; one outgoing-data authorization; one **Start analysis**. | The successful-search Electron spec asserts exactly one direct read before explicit search; the earlier visible analysis flow records one model request after **Start analysis**. | **VERIFIED** across `tests/electron/research-provisional-flow.spec.ts` and the added `tests/electron/issue-94-visible-tavily-search.spec.ts`. The separate successful search check is below. |
| Tavily indexed search | One explicit **Search indexed details** action in `tests/electron/issue-94-visible-tavily-search.spec.ts`. Before the action, the local key-status check and intake handoff sent no search request. | The visible dev-only fake transport recorded exactly two HTTP-shaped requests after search: usage GET preflight and one search POST, with exact query `job site:jobs.example.org`. The matched lead caused one additional canonical direct read. The exact selected-role indexed title/excerpt appeared visibly. Candidate identity is the canonical synthetic role; the profile contained a separate synthetic candidate name/email, neither present in the query or request bodies. | **VERIFIED** for this visible synthetic transport path only. No Tavily endpoint, valid credential, billing or external request was used. See `artifacts/issue-94/tavily-search-result.png`. |
| Manual posting | One **Paste posting text instead** choice and one separate **Save job** action. | Zero model-dispatch log entries and zero direct-read log entries before and after save. | **VERIFIED** by `tests/electron/issue-94-manual-intake-baseline.spec.ts`. Saving manual text does not authorize analysis. |
| Tailor CV analysis and generation | The visible test checked outgoing-data consent and clicked **Authorize this run**, then separately clicked **Generate tailored draft**. No dispatch was present before authorization. | The visible synthetic dispatch labels are `qualification-extraction` after authorization, then `evidence-scoring` and `generation` after **Generate tailored draft**. | **VERIFIED** for this visible synthetic path. These operation labels are observed samples, not invariant graph-call totals. The test does not require page-fit or LaTeX. |
| Paragraph regeneration | The same visible test opened the paragraph action, reviewed the separate outgoing bundle and clicked **Authorize and propose**. No additional dispatch appeared before that authorization. The generated replacement was shown in the comparison. | The run added one `regeneration` label after the prior sample: `qualification-extraction`, `evidence-scoring`, `generation`, `regeneration`. | **VERIFIED** for the visible synthetic paragraph-regeneration path, including authorization gating and one observed regeneration dispatch. This does not establish a fixed total for other Tailor CV graphs or scenarios. |
| PDF profile import | The visible flow showed one successful **Send text and structure** action after the outgoing preview and one-run authorization. Two earlier attempts with changed model selections were refused before dispatch. **Apply accepted details** remained a separate decision. | One `profile-import` entry in the synthetic dispatch log. | **VERIFIED** in `tests/electron/profile-ai-structuring.spec.ts`. Local review also passed without a model dispatch. |
| DOCX profile import | One outgoing preview, one consent checkbox and one **Send text and structure** action. Applying proposals remained separate. | One `profile-import` entry in the synthetic dispatch log. | **VERIFIED** in `tests/electron/pi-docx-structuring.spec.ts`. |

A progress state, suggestion review, **Apply accepted details**, and draft proposal comparison are not separate provider authorizations. A test-seam dispatch count is not a live-provider charge count.

## Repeatable evidence

Install the locked dependencies with `npm ci`, build the unpacked app with `npm run build`, and rebuild `better-sqlite3` for Electron with `npm run rebuild:electron` before running the visible specs. The source-linked Tailor CV page-fit test still needs the pinned LaTeX toolchain. `npm run prepare:latex` did not provision it because its existing package manifest differs from the lock (`texlive.infra` revision 80721 instead of 80683); do not treat page-fit as passed. The separate focused visible paragraph-regeneration test does not compile a PDF.

Focused synthetic domain checks passed:

```text
npx vitest run tests/universal-direct-workbench.test.ts tests/job-research-transfer.test.ts tests/job-research-session.test.ts tests/job-research-ui.test.ts tests/research-consented-analysis-ipc.test.ts tests/outbound-consent-workbench.test.ts tests/analysis-workbench.test.ts tests/paragraph-regeneration-workbench.test.ts tests/profile-ai-upload-baseline.test.ts tests/profile-ai-structuring.test.ts
10 test files passed, 124 tests passed.
```

Earlier visible Electron evidence passed for the full and incomplete temporary research flows, PDF and DOCX profile import, manual posting intake, local-only profile review and the workbench start flow. Relevant specs are `tests/electron/research-full-temporary-flow.spec.ts`, `tests/electron/research-provisional-flow.spec.ts`, `tests/electron/profile-ai-structuring.spec.ts`, `tests/electron/pi-docx-structuring.spec.ts`, `tests/electron/issue-94-manual-intake-baseline.spec.ts`, and `tests/electron/workbench-start.spec.ts`. The new synthetic successful-search scenario is `tests/electron/issue-94-visible-tavily-search.spec.ts`.

Focused visible Electron checks passed:

```text
npm run typecheck
npm run build
npm rebuild better-sqlite3 --no-audit --no-fund
npx vitest run tests/job-research-session.test.ts tests/tavily-search.test.ts tests/universal-direct-workbench.test.ts tests/job-research-transfer.test.ts tests/research-consented-analysis-ipc.test.ts tests/paragraph-regeneration-workbench.test.ts --maxWorkers=1
# 6 files, 143 tests passed
npm run rebuild:electron
npx playwright test tests/electron/issue-94-visible-tavily-search.spec.ts tests/electron/issue-94-manual-intake-baseline.spec.ts tests/electron/tailored-paragraph-review.spec.ts --reporter=line
# 3 tests passed
node scripts/check-doc-links.cjs
```

The visible Tavily test checks physical isolated credential paths before its synthetic key save. It uses a fake transport and writes sanitized method/body records only in its isolated test workspace. The sanitized screenshot is `artifacts/issue-94/tavily-search-result.png`. No installer, full test suite or real network/provider check was run.

The full report and call-count evidence use only synthetic fixtures. Focused checks passed with `npx playwright test tests/electron/tailored-paragraph-review.spec.ts tests/electron/jobs.spec.ts -g "development Electron selects a generated paragraph|switching to paste text" --reporter=line` (2 tests passed). The stale paste-switch locator was updated from **Public Lever posting link** to **Public job posting link**. The baseline does not claim installed-app behavior, a live Tavily request, or fixed Tailor CV graph-call totals.
