# Cover-letter production renderer integration (#122)

## Scope

This slice connects the already reviewed main/shared/preload implementation at `62b9948` to the production Tailor CV renderer. It does not change backend, shared contracts, preload, dependencies, templates, artifact authority, or CV export primitives. No push, merge, packaging, installer, native rebuild or dependency installation was run.

- Outgoing data has a default-unchecked **Include a cover letter** option. Changing it cancels/replaces the preview and prepares `cv` or `cv+cover-letter` purpose. Explicit acceptance starts analysis, not document generation. Generate displays the frozen authorized purpose and retains the analysis pause and separate **Generate tailored draft** action.
- Initial generation calls `generateRequestedDocuments(token, pageTarget)` and handles CV and letter outcomes independently. A failed/cancelled/uncertain letter does not discard the saved CV. Actual generation state and letter dispatch are displayed without timed completion.
- Review and Export contain the accessible CV/Cover letter selector. The host loads `getCoverLetterReadModel(jobId)` on opening, generation, document selection, and after letter actions. Letter readiness—not historical approval or fit booleans—controls its Export phase. Latest attempt status is separate from retained-document readiness.
- The displayed letter's own `cvRevisionId` supplies `CoverLetterReview.originatingCvRevisionId`; the read model's top-level frozen `experienceKinds` supplies source-kind labels. Current expected letter/paragraph IDs accompany edits, recipient changes and acknowledgments. Callbacks reject refusals so correctable local text and error feedback remain available.
- Local letter editing, paragraph decisions, deterministic checks, actual PDF fit and explicit approval use only the existing narrow actions. No renderer measurement, source hash, private path or export bytes are supplied as authority. Letter editing does not route through the profile editor or alter CV data.
- `PdfPreview` retains the original CV branch and adds compiled letter bytes from `getCoverLetterPdf({jobId, letterId})`, with distinct accessible region/canvas labels. Export has separate PDF/Word actions and main-returned success/cancellation/refusal feedback. Back to review preserves approval until an edit; an unchanged approved letter can return directly to its PDF.
- Missing, stale, failed, cancelled and uncertain letter states remain visible while CV review/export stays selectable. Where allowed, retry/add prepares `prepareCoverLetterRetry(jobId, generation.originCvRevisionId)`, requires fresh explicit acceptance and pauses at **Generate cover letter** before `generateCoverLetter(token)`. That path makes no analysis or CV-generation call. Uncertainty/provider/effort/privacy are displayed; unavailable bounded retry explains the fresh-full-flow route.
- A render-time monotonically increasing job/posting visit keys the entire host, including A → B → A. The guarded public-API facade rejects old visits before/after awaits, cancels late-created preview tokens, and prevents follow-up calls from old visits. Read-model and generation epochs fence superseded loads and cancelled outcomes. New visits cannot render an earlier visit's canonical or feedback state. The facade proxies an empty object because Electron's contextBridge object is frozen.
- The real review host's more-specific CSS now reserves the measured letter action-bar full height plus 24px (sticky inset and focus clearance), overriding the generic CV review scroll margin. Existing white, Lato, content-growing letter paper and paper annotation colors are retained.

## Focused verification

Evidence is local/uncommitted under `YOUR.audit/cover-letter-visible-flow/`.

| Command | Result / boundary |
| --- | --- |
| `npm run typecheck` | Passed. Checks production renderer and the new Electron case against current public types; not runtime acceptance. |
| `npm run build` | Passed. Main/preload/renderer bundles produced; existing dependency annotation warnings remain nonfatal. No native/toolchain provisioning or installed proof. |
| `npx vitest run tests/cover-letter-review-markup.test.ts` | 14 tests passed in one file. Existing review markup/state and accessibility coverage, not host Electron coverage. |
| `node scripts/check-doc-links.cjs` | Local documentation targets checked. |
| `git diff --check` | Whitespace checked. |

`typecheck-initial.log`, `typecheck.log`, `build.log`, `component-test.log`, `docs-links.log`, `diff-check.log` and `scope.log` record these checks. No full test suite or review round was run.

## Integrated-host acceptance case (not executed here)

`tests/electron/cover-letter-flow.spec.ts` launches the real built main with isolated, asserted userData and `CV_TAILOR_SCRIPTED_ANALYSIS=cover-letter-success`. It seeds only contact, skill, experience and job through public preload, selects the synthetic model visibly in Settings, and drives visible consent, analysis pause, both-document generation, local paragraph/recipient edits, actual source acknowledgments, checks, real one-page measurement, letter approval, real compiled canvas and PDF/Word native destination actions. It inspects actual saved PDF selectable text/page dimensions and editable DOCX text, verifies no review annotations print, confirms CV/profile/experience remain unchanged by letter operations, and checks the five exact stage labels. Native destination pickers alone are stubbed. No draft, acknowledgment, fit or approval is seeded; no hidden control is manipulated.

Run on the parent's already provisioned integrated Electron/SQLite/toolchain host after building:

```sh
npx playwright test tests/electron/cover-letter-flow.spec.ts --workers=1
```

Do not use `npm run test:electron` for this bounded check: that script rebuilds native SQLite and runs broader orchestration. This renderer-only tree's dependencies were installed with scripts disabled; Electron/native SQLite and the pinned private toolchain were intentionally not provisioned. Therefore the new test is **not executed**, and no visible-flow screenshot, native runtime pass, real-provider result, responsive visual acceptance, packaged/installed acceptance or letter-only-retry E2E result is claimed. No known unimplemented normal UI branch is intentionally left as a feature-button stub; runtime acceptance remains the next gate.
