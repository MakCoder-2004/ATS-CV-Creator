# Optional cover-letter renderer components

**Scope.** This is an isolated renderer seam for issue #122, not a shipped cover-letter flow. The components are not imported by the production workbench. Existing shell, stage layout, and global renderer styles were left unchanged. They use the strict `CoverLetterRevision` and `CanonicalCoverLetter` types and expose actions only as callbacks; there is no `window` or preload access.

## Component contracts

- `CoverLetterRunOption` exports `CoverLetterRunOptionProps` and takes `checked`, `disabled`, optional `authorizedPurpose` (`cv` or `cv+cover-letter`), and `onChange(included)`. Before authorization it shows an unchecked labeled choice and the added-request/local-recipient explanation. Once purpose is provided, the rendered value comes from that frozen purpose and the checkbox is disabled; changing purpose requires refreshed preview and fresh authorization.
- `ApplicationDocumentSelector` exports `ApplicationDocumentSelectorProps` and takes `selected`, independent `cvStatus` and `coverLetterStatus` strings, and `onSelect('cv' | 'cover-letter')`. Selection is represented by named native buttons with `aria-pressed`, not partially implemented tabs.
- `CoverLetterReview` exports `CoverLetterReviewProps`, `CoverLetterCheckStatus`, `CoverLetterFitStatus`, `CoverLetterReadiness`, `CoverLetterActionInput`, `CoverLetterParagraphEditInput`, and `CoverLetterRecipientInput`. It takes the current `jobId`, immutable `originatingCvRevisionId`, strict `letter` and `canonical` values, host-provided `checkStatus`, `fitStatus`, `readiness`, `message`, and `busy`, plus `onSaveParagraph({ jobId, letterId, paragraphId, text })`, `onSaveRecipient({ jobId, letterId, recipient })`, `onAcknowledge({ jobId, letterId, paragraphId, acknowledged: true })`, `onCheck({ jobId, letterId })`, `onMeasureFit({ jobId, letterId })`, and `onApprove({ jobId, letterId })`. No callback receives a renderer-computed hash or fit measurement.

The review component checks that the letter matches the current job and CV revision and that the canonical document matches the letter identity, revision, and paragraph wording before showing canonical content. Local paragraph, recipient, pending, and error state is tagged with the current render visit: the rendered identity (`jobId`, letter ID/revision, and CV revision) plus a monotonic epoch advanced on every observed identity transition. This distinguishes A→B→A without relying on effect cleanup or remount. A single edit session prevents opening paragraph editing while recipient text is unsaved and prevents recipient editing during paragraph editing; recoverable save failures retain the entered text. Checks, fit, acknowledgment and approval are unavailable while changes are unsaved. Async replies update local state only while the exact visit epoch is still current. The host must validate explicit IDs/expected identity itself and fence stale async persistence responses. Callback contract: resolve only after the requested persistence/action succeeded; reject on refusal or recoverable failure, with a useful `Error.message` when available. A resolved callback is not itself evidence shown by this component about the underlying authority or result.

Source acknowledgments are explicit, per-paragraph `acknowledged: true` callbacks. Existing current acknowledgment entries are shown as reviewed, with a visible count. There is no false/undo checkbox because the current callback contract cannot unacknowledge. The UI explains that automated checks do not prove semantic truth and that acknowledgment is not proof of truth. Source passages and review controls are separate from canonical printed content. The paper is a structured, selectable review layout, not PDF pagination; the host's real fit result is displayed without calculating fit in the renderer. CV and letter readiness and approval remain separate.

## First worker corrections, not accepted after re-review (2026-10-28)

- Moved the sticky action bar ahead of the paper, consistent with Review contract order. It retains the 8px sticky inset and observes its actual height to set focus scroll clearance. Paper-bound source annotations, acknowledgment status, input surfaces, and input focus use the existing light paper palette (`--paper-ink`, `--paper-muted`, `--paper-rule`, `--paper-selected`, `--paper-accent`); the app-level action bar retains app theme tokens. Controls retain 44px minimum targets.
- Added the component-used edit-session/visit helpers and regressions for field-session exclusion and A→B→A epoch changes. Added rendered action-bar ordering and calculated WCAG contrast tests for actual paper tokens. These are deterministic state/markup checks, not browser interaction tests.

## Static verification

These were the first worker's static checks. Dependencies were already physically installed and `npm ls --depth=0` succeeded. That worker did not install dependencies, rebuild native modules, send a provider request, launch Electron, or exercise an interactive app. The later parent component checks are recorded below.

- `npm ls --depth=0`: passed using existing physical dependencies.
- `npx vitest run tests/cover-letter-review-markup.test.ts --maxWorkers=1`: passed, 11 tests (the original 8 plus 3 static/state/contrast regressions).
- `npm run typecheck`: passed.
- `npm run build`: passed for the existing production app. Rollup emitted warnings about removable `@__PURE__` comment placement in installed Zod modules. Because this component unit is intentionally not imported by the workbench, that build does not bundle its CSS or exercise its renderer output; focused tests and typecheck cover its isolated TSX and pure state helpers.
- `git diff --check`: passed after validation.

Exact command outputs are under `.audit/cover-letter-ui-review-fixes/`: `npm-ls.log`, `focused-static-tests.log`, `typecheck.log`, and `build.log`.

These static-output and pure-helper tests verify server-rendered labels/status/escaping, identity-mismatch refusal, acknowledgment display, document-selection semantics, absence of hidden authority fields, action-bar order, edit-session mutual exclusion, A→B→A visit epoch advance, and calculated contrast ratios for selected white-paper colors. They do **not** establish actual keyboard operation, measured focus clearance in a browser, responsive rendering, live-region timing, local edit/save/cancel component events, promise resolution/rejection behavior, async races across live rerenders, host authorization, persistence, or any end-to-end workflow. The CSS has not been visually inspected in a running app. Visible Electron acceptance remains deferred to the planned later integration gate (#14), after production APIs and shell integration are reviewed.

No claims are made here about generation, consent enforcement, storage, checks, approval, measured PDF fit, exports, retry, or installed behavior. Those remain unimplemented or unverified by this component unit.

## Parent corrections and isolated browser checks

Re-review of `b229d65` rejected both save paths because they called a begin-edit predicate while an edit was already active. The parent added separate component-used save predicates for a matching paragraph session and an active recipient session. Positive and negative save-session tests now distinguish beginning from committing an edit.

The sticky bar now measures `getBoundingClientRect().height`, including padding and borders, and reserves that height plus 24px. Inline paper errors use the fixed light-paper error color rather than the dark app token. Spacing follows the named grid and narrow review text retains the readable 14.667px size.

Direct image inspection also caught a defect not covered by the earlier static checks. A preferred aspect ratio with `min-height: 0` left long paragraphs and source controls outside the white paper, overlapping following controls. The review paper now follows the existing content-growing Letter minimum-height pattern. An actual DOM geometry assertion checks that the signature and every preceding flow item remain inside the paper and that following controls do not overlap it. This is structured review, not a PDF page-fit claim.

The context prop is named `originatingCvRevisionId` to distinguish the immutable CV binding from later CV-only edits. The host must pass the bound originating revision, not silently substitute the latest CV wording revision. Callback IDs and signatures are otherwise unchanged.

The parent used the existing React/Vite/Playwright dependencies and installed Edge in an ignored local fixture page. No new dependency, framework, production harness, fake preload, or app route was added. The fixture is explicitly labeled synthetic and supplies callback-only results. Actions use real browser typing and clicks, not hidden React state mutation. This isolates component behavior; it does not prove backend persistence or authorization.

An initial probe used an unparsed fixture with trailing whitespace, correctly triggering the component's canonical mismatch guard. The probe was corrected to validate its input with the actual shared schema before judging behavior. The valid pre-fix probe then reproduced unreachable paragraph/recipient callbacks, missing failed-save feedback, and insufficient border-box clearance. Two later cold Vite navigation timeouts were recorded as probe-precondition failures, not product failures. The final probe uses bounded readiness and completed all eight cases.

| Actual browser case | Result |
| --- | --- |
| Paragraph save invokes the supplied persistence callback and keeps recipient editing excluded. | VERIFIED |
| Recipient save invokes the callback and updates the canonical salutation. | VERIFIED |
| Rejected paragraph save preserves entered wording and exposes a readable paper error. | VERIFIED, computed foreground/background contrast meets 4.5:1. |
| Explicit paragraph and recipient cancellation restores saved fields without a persistence callback. | VERIFIED |
| Full sticky border-box height and inset are reserved for focus scrolling. | VERIFIED through actual DOM measurement. |
| A delayed rejected save from an earlier A visit cannot erase a new A edit after visiting B. | VERIFIED through visible fixture controls and a held callback. |
| Dark-mode narrow paper is white and has no horizontal page overflow. | VERIFIED at 375px. |
| Long review paper contains the final signature and does not overlap subsequent controls. | VERIFIED at 375px and 1024px. |

The parent inspected the resulting dark failed-save and narrow long-paper screenshots. Final static/helper tests passed 12 tests. Typecheck and build also passed. Evidence is under `.audit/parent-component-probe/`, including `red-valid-fixture.log`, `red-paper-growth.log`, `final-ready.log`, `final-ready.json`, screenshot files, and final static/typecheck/build logs. Reproduce locally with `node .audit/parent-component-probe/run.mjs final-ready` while those ignored fixture files are retained. The compound verification command printed its final completion marker but the harness later labeled the wrapper timed out; the individual completed gate logs and browser JSON were inspected directly.

## Follow-up edit controls and field errors

The next independent review confirmed the parent corrections but found that other paragraphs still displayed enabled Edit buttons while an editor was open. Those controls now disable for any active paragraph session rather than presenting an enabled no-op. The existing unsaved draft remains intact.

Paragraph and recipient failures now have explicit field/action ownership. Each failed field is marked `aria-invalid` and associated with its adjacent error by `aria-describedby`; recipient errors are no longer only a top-level status. Global check/approval errors remain global. Empty exception messages use a useful fallback. This avoids duplicate alert announcements and preserves the entered field value.

The browser gate was extended before the correction and reproduced the enabled competing editor and missing field associations. `final-fields.log` and `final-fields.json` record all nine component cases passing, including adjacent associated recipient errors. Static tests remain 12 passing, and typecheck/build passed again. Field-specific logs are `static-fields.log`, `typecheck-fields.log`, and `build-fields.log` under the same ignored probe directory. No new callback or authority surface was added.

These checks supersede the earlier claim that the component had no browser observation. They do not establish real workbench navigation, keyboard-only operation and focus restoration, every responsive width, host-side request fencing, actual saved data, provider behavior, PDF approval, exports, or installed behavior. The real Electron/public-preload workflow and permanent interaction regressions remain required at integration gate #14.
