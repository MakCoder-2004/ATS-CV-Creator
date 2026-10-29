# Cover-letter artifact controller (#122 / task 22)

## Delivered boundary

This is the complete bounded **main/shared/preload artifact-controller slice**, on top of reviewed generation/retry/provenance, deterministic PDF/DOCX adapters and the destination primitive. The production renderer host is **not linked** to these actions here. No visible-flow, unpacked Electron, packaged/installed, live-provider, recruitment-system or hostile-host acceptance is claimed. No installer, merge or push was run.

The existing CV canonical serialization, template, PDF preview channel/hash, generation/recovery, independent CV approval/export and dependencies are unchanged. No downloaded template, pinned manifest, compiler or font bytes were changed. The letter retains its originating CV identity even after later CV-only review edits.

## Public contract for the next renderer unit

Use the typed preload methods; there is no generic renderer invoke or filesystem path API. `src/shared/cover-letter-artifact.ts` is the strict artifact/readiness contract.

| Method | Input / result |
| --- | --- |
| `getCoverLetterReadModel(jobId)` | `CoverLetterReadModel`, described below. Prefer this over historical `getCoverLetter` for current authority. |
| `editCoverLetter(input)` | Existing strict job/expected-letter IDs, current paragraph identities/wording/citations, nullable local recipient. New independent revision; no acknowledgment/fit/approval fields accepted. |
| `setCoverLetterRecipient(input)` | Existing strict job/expected-letter IDs and nullable recipient; same local revision/invalidation path. |
| `acknowledgeCoverLetterParagraph(input)` | Existing strict IDs plus explicit `acknowledged: true`; main hashes actual wording and bound passages. |
| `checkCoverLetter(jobId)` | `CoverLetterActionResult`; current bindings plus rerun detectable factual checks and retained known warnings. No provider request. |
| `measureCoverLetter({jobId, letterId})` | `CoverLetterActionResult`; compiles and inspects actual PDF, stores a main-sealed current fit on success. |
| `approveCoverLetter(jobId, expectedLetterId)` | `CoverLetterActionResult`; both IDs are mandatory at IPC/preload. The storage method retains an optional argument only for old refusing callers; omitting it cannot approve. |
| `getCoverLetterPdf({jobId, letterId})` | Strict `{ok,message,documentHash?,pdfBase64?}` containing actual compiled bytes on success. May be used before approval for local review, including while factual findings remain. Does not invent approval or measured-fit authority. |
| `exportCoverLetter({jobId, letterId, format})` | `format: 'pdf' | 'docx'`; strict `{ok,cancelled,message}`. Main owns native destination/overwrite dialogs and bytes; no path is returned or accepted. Requires current explicit letter approval for either format. |

`CoverLetterReadModel` contains:

- `jobId`, current `letter` (or null), and strict `canonical` (or null). Printed contact is exactly `{fullName,email?,phone?,location?}` projected from current local contact, never the whole profile record. Headline, links, local IDs/revisions and review/source annotations do not print.
- Existing validated `generation` status, including immutable `originCvRevisionId`, latest operation status/retry availability and uncertainty warning. A saved older letter can coexist with a later failed attempt.
- Top-level `experienceKinds`, derived from **this saved letter's validated frozen origin**, not a mutable current profile guess or a later attempt. Pass it directly to `CoverLetterReview.experienceKinds`. Bound source context remains in `letter.bindings.sources`, including parent IDs, exact headings/passages/ordinals/revisions.
- `readiness: {bindingProblem,canonicalProblem,findings,paragraphAcknowledgments,currentFit,approved,canMeasure,canApprove,canExport}`. Problems and `currentFit` are nullable. The acknowledgment map contains current main-derived booleans. The returned letter's fit/approval are also attenuated to these current values; a historical fit/approved flag is not presented as current.

Refresh the read model after every local action and when returning to review/export. Use expected letter IDs from the displayed revision, not a renderer-supplied hash. A failed canonical projection still returns the letter and a readable problem. Unsupported recipient/body edits are refused before persistence, preserving the correctable previous revision; contact can be corrected in My profile. English quotes/dashes/ellipsis and extended Latin/NFC retain the reviewed support; unsupported scripts, controls and bidi remain refused.

Local checks run on actual restored wording/passages and then re-minimize only for the same named-employer/project token-anchor attribution policy used in generation. The raw first pass prevents scrubbing from concealing unsupported numbers, skills, dates or identifiers. Known non-rerunnable paragraph warnings are reconciled through retained sentence-word subsequences across history, independent of paragraph ID: case, whitespace, punctuation, appended or internally inserted innocuous wording do not waive them. Legacy warnings have no stable finding ID, so each `(code,message)` group is attributed to all of its occurrences on its first actual revision for the job. Inherited carrier copies cannot acquire extra claim sentences, even across a fresh letter-only retry operation. Replacement/removal can resolve the attributable wording; this is deliberately conservative lexical retention, **not semantic proof of a rewritten claim**. Every body paragraph still requires human source review. The body retains a correctable 400-word local review limit; no provider-request quota, retry or model call was introduced by local actions.

## Actual fit and local approval receipts

`createCoverLetterCompiler` and `inspectCoverLetterPdf` are used, not a renderer report or a one-page schema literal. Actual output must be one 612 x 792 point Letter page, contain exactly the canonical selectable text stream in order, and embed Lato-Regular/Lato-Bold. Existing 39-asset cold/warm integrity, allowlisted TeX environment, glyph/overflow rejection, bounded execution and owned cleanup remain unchanged. The canonical hash covers current local sender/contact, frozen date, recipient, subject, body, revision and template identity.

The optional revision field `localArtifactAuthority` carries HMAC receipts for actual measurement and explicit approval. A random 32-byte local key is created exclusively by main under userData in `cover-letter-local-authority.key`; it is not exposed through preload or included in workspace backups. Main writes/fsyncs/closes an exclusive owned temporary file, atomically publishes complete bytes via a no-clobber hard link and removes its owned temporary file. A damaged/unreadable existing key is preserved and disables only letter receipt authority, never workspace startup. A measurement receipt binds canonical content, source bindings and fit; approval additionally binds current deterministic findings, paragraph decisions and approval time. Neither a fit-shaped DB/backup record, an approved boolean, a copied receipt for different content nor an arbitrary digest is authority. Reopen can verify unchanged local receipts while independently rederiving current sources/checks/canonical state. Restore explicitly strips receipts, fit, acknowledgments and approval. Missing local key/receipt requires fresh measurement/approval, not a permissive fallback. This is local process/data consistency, not protection against a hostile user who can rewrite the app, signing key and entire workspace.

Approval requires current source/posting/profile/exact Pi model bindings, no known or deterministic findings, every current paragraph decision, real current fit and the explicit expected-revision action. Header/source changes cannot preserve old current fit or approval. Recipient/body edits create a separate letter revision and clear receipt/fit/approval/decisions without changing CV/profile. Checking an unchanged approved letter does not silently revoke its valid approval.

## Native actions and synchronous commit contract

`createCoverLetterArtifactController` receives main-only workspace and native-dialog seams. It reserves a job operation, captures an approved current snapshot **before** showing a save dialog, rechecks after native selection and overwrite confirmation, constructs real PDF or editable DOCX from the same private canonical, and rechecks after construction. Unapproved, forged, stale or unprintable letters never open the save dialog. A public posting edit is already refused while this job operation is held; tests assert that refusal rather than pretend a nonexistent UI mutation succeeded. Other permitted local edits and model changes are detected by snapshot guards.

The main-only `captureCoverLetterExport({jobId,letterId})` returns `TrustedLetterExportSnapshot`:

```ts
{
  canonical: CanonicalCoverLetter; // a copy for main consumers, not authority
  assertCurrent(): undefined;    // synchronous private DB + pure canonical/readiness rederivation
  createBytes(format: 'pdf' | 'docx'): Promise<Buffer>;
}
```

`assertCurrent` is a private closure over the captured current revision/readiness, not a renderer hash/report. It reads private SQLite state and rederives sources, checks, paragraph decisions, canonical identity, measured fit and approval without awaiting or writing. The controller supplies this exact synchronous `() => undefined` contract as `beforeCommit` to the unchanged reviewed `commitLetterDestination`. No await occurs between the last document assertion, final destination comparison and commit. Async/non-void guards remain rejected by the destination helper.

Only a native-chosen path is captured. Existing files receive a second explicit replacement decision over the captured bytes. Capture/commit retain opaque WeakMap handles, single use even on refusal, the 20 MiB bound, identity+metadata+digest or absence fencing, fixed random owned temp basenames, fsync/close, atomic replacement and absent-path no-clobber. External creation/replacement/modification after capture refuses without overwriting those external bytes. Native cancel, overwrite decline and each format's success are distinct; messages do not expose private paths/compiler logs/source content. There is necessarily no destination snapshot before the user has selected a path: capture occurs after native selection and before application overwrite confirmation. This is a bounded filesystem race policy, not hostile-directory transaction immunity.

Artifact IPC uses a current-workspace provider, and native controller delegates resolve the current workspace too. Retry IPC now does likewise: `registerCoverLetterRetryIpc(ipc, provider, trusted)` accepts either the existing direct API object or `() => RetryActions`, where `RetryActions` is the unchanged storage API subset `prepareCoverLetterRetry | generateCoverLetter | getCoverLetterGenerationStatus`. Production must pass `() => workspace!.api`. Each retry handler resolves the provider once per invocation, after trusted-frame, exact-arity and UUID validation, and invokes the method with its API receiver intact. No shared/preload API changed. Verified restore closes/replaces the workspace; both artifact actions and retry handlers continue against the reopened database rather than retaining closed methods. See the runtime correction evidence below.

## Resources and development fixtures

Development roots are fixed beneath the application root at `.tools/latex` and `resources/cover-letter-template/application`; packaged roots are `process.resourcesPath/latex` and `process.resourcesPath/cover-letter-template/application`. `package.json` deliberately adds only the adapted runtime template/manifest and explicit upstream MIT, ancestor MIT, application notice and Lato OFL copies alongside the existing bundled toolchain/license inventory. A test stages those configured letter resources into an owned path containing spaces, checks exact template/manifest bytes and compiles/inspects an actual PDF using this tree's pinned toolchain. This does not run electron-builder or establish packaged/installed resource acceptance.

For the next visible-flow unit only, unpackaged `CV_TAILOR_SCRIPTED_ANALYSIS` accepts `cover-letter-success`, `cover-letter-failure`, `cover-letter-delay` and `cover-letter-invalid`. Existing scripted CV handling remains active for these modes; successful letter output uses issued source ordinals and the real bounded response schema. Delay is 1500 ms and abortable. All modes are disabled in packaged builds, intercept only the letter task, and create no consent, fit or approval. Optional dispatch logging names the letter request separately. No renderer-only fake API was added.

## Executed evidence

All data are synthetic. Node SQLite and the complete pinned toolchain are physically local to `E:/cv-letter-build`; no parent native ABI or compiler tree was rebuilt. Evidence is intentionally local/uncommitted at `YOUR.audit/cover-letter-artifact-integration/`.

- `read-red.log` / `read-green.log` and `read-final.log`: initial current-read/edit/check failures and corrected public behavior.
- `measurement-red.log` / `measurement-green.log`: absent real measurement/preview/approval versus real compiled PDF and sealed decisions.
- `controller-red.log` / `controller-green.log` / `actions-green.log`: missing public export capture versus actual PDF/DOCX files, native cancellation/overwrite and race refusals; strict IPC/preload and existing destination cases.
- `resources-red.log` / `resources-green.log`: missing packaging mappings versus staged exact resources and actual compile, plus bounded fixture tests.
- `review-red.log` / `review-green.log`: two executed local-check bypasses (cross-employer borrowing and formatting-only known-warning waiver), current-workspace getter contract failure, and the corrected public tests. The first red getter test fails at the previously unsupported dynamic-provider boundary; it is not presented as a runtime reproduction of the reviewer's separately identified closed-DB symptom. Green exercises actual registered read/check/measure/acknowledge/approve/PDF/export across verified restore, close and reopen.
- `claim-origin-red.log` / `claim-origin-green.log` and `claim-retry-red.log` / `claim-retry-green.log`: executed append-then-remove correction regressions, first within a revision lineage and then through a real fresh-consent letter-only retry. They prove that inherited warnings neither broaden into supported appended wording nor lose their original attribution across operations.
- `artifacts/public-action.pdf` and `artifacts/public-action.docx`: actual saved outputs copied from the successful native-action test. Other test-owned destinations, copied resources and compiler workspaces are removed by tests.

Focused final actions cover actual text/fonts/geometry, editable DOCX canonical wording, source/header/recipient/body/model changes, stale expected IDs, forged fit/ack/approved data including reopen, unknown/legacy provenance via the inherited suites, unsupported/bidi/overflow/multipage refusal, local privacy/no CV writes, no extra model requests, native cancel/overwrite/changed destination/no-clobber and final synchronous current-document fencing. Source/generation/privacy/retry/restore/CV hash suites remain enabled.

### Final gates

| Gate | Actual result |
| --- | --- |
| Focused artifact/workbench/controller/IPC/preload/resources/fixture/destination tests | **77 passed in seven files**, `focused-final.log`. |
| Plain `npm test` (local Node native rebuild, serial Vitest) | **571 passed in 80 files**, zero failed/skipped, `full-test.log`. This adds 62 tests in six files to the 509-test/74-file base. |
| `npm run typecheck` / `npm run build` | Passed, `typecheck.log` / `build.log`; existing dependency annotation/build warnings remain nonfatal. |
| `npm ls` | Passed, `npm-ls.log`; dependencies/lock were not changed. |
| Documentation links / whitespace | Passed: 104 Markdown files resolve, `docs-links.log`; `diff-check.log` clean. |
| Preserved primitive files | `preserved-primitives.log` records zero diff for CV canonical/adapters, reviewed compiler/PDF/DOCX/destination/provenance helpers, renderer, template assets and lock. |
| Independent static Sol review | All reported concrete findings closed after exact `fe0d49d` and `2f60958`, following the restore, local-attribution and warning-origin corrections. No tests/builds were run in that separate dependency-free review tree. |

Implementation commits are `f44e7cf` (current state/local checks), `f7f7252` (actual fit/approval), `4eca887` (native actions/strict IPC), `321c2fd` (review corrections/resources/fixtures), `12adbe8` (immutable claim origin), `2f60958` (complete result unions) and `fe0d49d` (origin preserved across retries). The completion handoff gives full SHAs and the final documentation commit.

The retained successful PDF is 46,466 bytes, SHA-256 `c53c69da6a7abea6f71d6f94d6186ed88b69d7197d76976bb7d7542c8c0e47d7`; DOCX is 9,905 bytes, SHA-256 `01706211395726c8928b5a1904cb10efe94a17895c864a3cc978a83038d6cb97`. These identify the retained synthetic outputs, not reproducible byte hashes across dates/ZIP metadata.

Earlier diagnostic logs are retained and are not success evidence. The independent review does not replace the executed Node/artifact tests. Visible renderer, Electron/native-dialog interaction, live-provider and installed acceptance belong to later explicitly authorized gates.

## Retry IPC restore-lifetime correction (2026-10-29)

Independent Terra review reproduced a remaining defect at baseline `b9ffa053e9851cf7b9eaaaeeb1e982a6962ab5f5`: production retry registration still captured the initial workspace API. After real verified backup preview/apply, close and reopen, the registered status handler read a closed SQLite connection even though the current workspace API worked. The independent reproduction and its log remain untouched under `YOUR.audit/cover-letter-artifact-integration/`.

Only `src/main/cover-letter-retry-ipc.ts`, its production registration in `src/main/index.ts`, `tests/cover-letter-retry-ipc.test.ts` and this report changed. No consent, purpose, nonce, provenance, serialization, renderer, artifact primitive, compiler, template, receipt or dependency code changed.

New evidence is local/uncommitted under `YOUR.audit/cover-letter-artifact-restore-fix/`:

- `registered-restore-red.log`: **three runtime failures**, not an unsupported-getter/type error. Tests first registered the real initial API exactly as production did: status threw `The database connection is not open`; preview returned `ok: false`; generation refused a fresh token explicitly accepted on the new API. Each regression first proved that the old API was closed and the current real API was eligible. `registered-restore-red.test.ts` and `.patch` retain that exact pre-fix test version.
- `registered-restore-green.log`: the same three runtime gates pass after changing the registrar and the test registration to the current-API getter; the existing three direct-object boundary tests also pass. `registered-restore-final.log` adds three provider-access ordering tests, for **nine passing tests** total.
- The final real-workspace tests exercise registered status, fresh registered preview and registered generation together after restore; separately they isolate generation from preview. Previously accepted and unaccepted tokens cannot be accepted or dispatch; restored durable consents are explicitly checked as revoked. An unaccepted fresh token cannot dispatch either. Only new explicit acceptance permits exactly **one letter request, zero CV requests and zero analysis requests**. The resulting new letter is read from the reopened database and survives another close/reopen. Frozen origin, source bindings, exact Pi model/thinking setting and CV/analysis/profile rows remain unchanged; the fresh operation has a distinct identity. Consumed tokens cannot dispatch twice. No fake status/API substitutes are used in these restore tests.
- All three provider boundary tests use a throwing getter: untrusted events, missing/extra arguments and malformed UUIDs fail without accessing it. Valid input accesses it exactly once. Strict result checks and direct-object compatibility remain tested.
- `focused.log`: **143 tests passed in six files**, covering retry IPC, generation/retry authority, review workbench, artifact IPC, actual-PDF workbench and native-action controller.
- `full-test-before-type-fix.log`: before the user's later targeted-only override, plain **`npm test` passed 577 tests in 80 files**, including the local Node SQLite rebuild, real PDF/DOCX/compiler/destination and backup suites. No failed/skipped tests. The subsequent `full-test.log` also printed 577 passes, but its tool invocation was aborted by the override; it is not an additional completed-command gate. No further full suite/build/review loop was run after the override.
- `typecheck.log` / `build.log`: passed. The initial typecheck caught a test-only UUID literal-array inference error; `typecheck-initial.log` is retained and the malformed-input array now explicitly uses `unknown[]`. Existing Zod/Rollup annotation warnings remain nonfatal.
- `docs-links.log` / `diff-check.log` / `preserved-scope.log`: documentation, whitespace and the exact four-file scope checks. The previously retained actual PDF/DOCX artifacts are unchanged; `artifact-hashes.log` records the same hashes listed above.

This closes the single reproduced retry-registration lifetime blocker only. The earlier 77-test independent focused run did **not** complete the 26-file feature review; final independent re-review remains required after this correction. No full-feature acceptance, visible Electron flow, live-provider, packaged/installed validation, installer, merge or push is claimed.

## Damaged independent letter-key startup correction

The parent separately reproduced a zero-byte `cover-letter-local-authority.key` throwing during `createWorkbench`, preventing profile/CV/backup opening and leaking the partially opened DB. The bounded correction changes only `src/main/cover-letter-authority.ts`, three letter-local checks in `src/main/workbench.ts`, the new `tests/cover-letter-authority.test.ts` and this report. Invalid existing key bytes are never replaced. Startup records an unavailable letter-authority state instead of throwing; receipt verification fails closed. The existing read-model `readiness.bindingProblem` and measurement/approval result messages expose the clear letter-local error; no shared/preload shape or UI/reset subsystem was added. Missing keys do not verify old receipts, and newly issued receipts require a newly created key plus the existing measurement/explicit-approval actions.

Under `YOUR.audit/cover-letter-artifact-restore-fix/`, `authority-red.log` records both failures, including the reopen leak's Windows cleanup failure. `targeted-final.log` records **11 passing tests in two files**: all nine registered retry gates plus key/receipt and real-workspace reopen tests. A genuinely measured/approved synthetic letter loses authority after key damage or removal; profile, CV and backup remain usable, invalid bytes remain zero-length, and workspace cleanup succeeds. Valid-key receipt reopen and missing-key replacement receipt separation are also covered. `typecheck-final.log` passes. No full-suite/build/review was run for this second correction, following the user's explicit targeted-only override. The earlier full-suite/build results above predate this second correction and are not claimed for it. Parent-owned UI integration and one focused end-to-end acceptance remain next.
