# Issue 94 link intake and authorization baseline

**Baseline source:** branch `issue-94-baseline`, starting commit `44afac09b70b185903b7f35f9aac16665e2b8c5e` (2026-10-26). This is development Electron evidence with synthetic data, not an installed-app observation. No live credentials, CV, posting or provider were used. Production behavior was not changed.

## Verdict

**Partially verified.** The visible synthetic tests and focused API tests run in this worktree. Direct-link handoff, temporary analysis, manual intake and PDF/DOCX consent have visible evidence and synthetic dispatch counts. Focused visible Tailor CV evidence now completes generation and paragraph regeneration without entering page-fit measurement. The observed test-seam dispatch sample is recorded below; it does not establish a fixed graph-call count for all runs. The visible Tavily search path had no configured key, so its request count is **INCONCLUSIVE** in Electron; the synthetic search transport test records two HTTP requests after one explicit search action. No provider charges were made.

The dispatch log added for these checks is development-test-only. It writes operation labels only when `CV_TAILOR_TEST_MODEL_DISPATCH_LOG` is set, and the scripted provider is disabled in packaged builds. It does not log prompts or user data.

## Operation baseline

| Operation | Visible decision count and result | Synthetic external work | Status and limits |
|---|---|---|---|
| Full direct link | One **Fetch posting**; one **Review temporary findings** handoff; one role-selection/review action; one outgoing-data authorization; one **Start analysis**. The handoff caused no second GET. | One direct-read log entry; zero model entries before **Start analysis**; one model request after it. | **VERIFIED** in `tests/electron/research-full-temporary-flow.spec.ts`. Temporary result was not saved, exported or backed up. |
| Incomplete direct link | One **Fetch posting**; one **Inspect captured findings**; one partial-role acknowledgment/review; one outgoing-data authorization; one **Start analysis**. | One direct-read log entry and one model request after **Start analysis**. | **VERIFIED** in `tests/electron/research-provisional-flow.spec.ts`. The search action in this test had no configured Tavily key and did not produce a search request. |
| Tavily indexed search | One explicit **Search indexed details** action in the visible incomplete-link test. The local key-status check sent no request. | `tests/job-research-session.test.ts` records two synthetic HTTP requests for a successful one-search scenario: one usage preflight and one search POST. It records no requests before the explicit search action. | **INCONCLUSIVE** for a visible successful search and actual network dispatch. No key was configured, and no live key or provider was used. The two-request count is synthetic transport evidence, not a billing count. |
| Manual posting | One **Paste posting text instead** choice and one separate **Save job** action. | Zero model-dispatch log entries and zero direct-read log entries before and after save. | **VERIFIED** by `tests/electron/issue-94-manual-intake-baseline.spec.ts`. Saving manual text does not authorize analysis. |
| Tailor CV analysis and generation | The visible test checked outgoing-data consent and clicked **Authorize this run**, then separately clicked **Generate tailored draft**. No dispatch was present before authorization. | In one run of `tests/electron/tailored-paragraph-review.spec.ts`, labels were `other` after authorization and then `posting-analysis`, `generation` after **Generate tailored draft**. The `other` operation label is a real logged prompt classification, not a named domain operation. | **VERIFIED** for this visible synthetic path. This sample is not an invariant graph-call count. The test does not require page-fit or LaTeX. |
| Paragraph regeneration | The same visible test opened the paragraph action, reviewed the separate outgoing bundle and clicked **Authorize and propose**. No additional dispatch appeared before that authorization. The generated replacement was shown in the comparison. | The run added one `regeneration` label after the prior sample: `other`, `posting-analysis`, `generation`, `regeneration`. | **VERIFIED** for the visible synthetic paragraph-regeneration path, including authorization gating and one observed regeneration dispatch. This does not establish a fixed total for other Tailor CV graphs or scenarios. |
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

Visible Electron evidence passed for the full and incomplete temporary research flows, PDF and DOCX profile import, manual posting intake, local-only profile review and the workbench start flow. Relevant specs are `tests/electron/research-full-temporary-flow.spec.ts`, `tests/electron/research-provisional-flow.spec.ts`, `tests/electron/profile-ai-structuring.spec.ts`, `tests/electron/pi-docx-structuring.spec.ts`, `tests/electron/issue-94-manual-intake-baseline.spec.ts`, and `tests/electron/workbench-start.spec.ts`.

The manual baseline spec can run with:

```text
npx playwright test tests/electron/issue-94-manual-intake-baseline.spec.ts --reporter=line
```

The full report and call-count evidence use only synthetic fixtures. Focused checks passed with `npx playwright test tests/electron/tailored-paragraph-review.spec.ts tests/electron/jobs.spec.ts -g "development Electron selects a generated paragraph|switching to paste text" --reporter=line` (2 tests passed). The stale paste-switch locator was updated from **Public Lever posting link** to **Public job posting link**. The baseline does not claim installed-app behavior, a successful Tavily network request, or fixed Tailor CV graph-call totals.
