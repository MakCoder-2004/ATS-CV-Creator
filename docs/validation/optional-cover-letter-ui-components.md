# Optional cover-letter renderer components

**Scope.** This is an isolated renderer seam for issue #122, not a shipped cover-letter flow. The components are not imported by the production workbench. Existing shell, stage layout, and global renderer styles were left unchanged. They use the strict `CoverLetterRevision` and `CanonicalCoverLetter` types and expose actions only as callbacks; there is no `window` or preload access.

## Component contracts

- `CoverLetterRunOption` exports `CoverLetterRunOptionProps` and takes `checked`, `disabled`, optional `authorizedPurpose` (`cv` or `cv+cover-letter`), and `onChange(included)`. Before authorization it shows an unchecked labeled choice and the added-request/local-recipient explanation. Once purpose is provided, the rendered value comes from that frozen purpose and the checkbox is disabled; changing purpose requires refreshed preview and fresh authorization.
- `ApplicationDocumentSelector` exports `ApplicationDocumentSelectorProps` and takes `selected`, independent `cvStatus` and `coverLetterStatus` strings, and `onSelect('cv' | 'cover-letter')`. Selection is represented by named native buttons with `aria-pressed`, not partially implemented tabs.
- `CoverLetterReview` exports `CoverLetterReviewProps`, `CoverLetterCheckStatus`, `CoverLetterFitStatus`, `CoverLetterReadiness`, `CoverLetterActionInput`, `CoverLetterParagraphEditInput`, and `CoverLetterRecipientInput`. It takes the current `jobId`, current CV `sourceRevisionId`, strict `letter` and `canonical` values, host-provided `checkStatus`, `fitStatus`, `readiness`, `message`, and `busy`, plus `onSaveParagraph({ jobId, letterId, paragraphId, text })`, `onSaveRecipient({ jobId, letterId, recipient })`, `onAcknowledge({ jobId, letterId, paragraphId, acknowledged: true })`, `onCheck({ jobId, letterId })`, `onMeasureFit({ jobId, letterId })`, and `onApprove({ jobId, letterId })`. No callback receives a renderer-computed hash or fit measurement.

The review component checks that the letter matches the current job and CV revision and that the canonical document matches the letter identity, revision, and paragraph wording before showing canonical content. Local paragraph, recipient, pending, and error state is tagged with the currently rendered identity (`jobId`, letter ID/revision, and CV revision) so a subsequent render under another identity does not display the prior edit buffer. Async UI replies update local state only while that identity is still current. The host must still validate these explicit IDs and expected identity at its own operation boundary; renderer guards do not constrain backend side effects.

Source acknowledgments are explicit, per-paragraph `acknowledged: true` callbacks. Existing current acknowledgment entries are shown as reviewed, with a visible count. There is no false/undo checkbox because the current callback contract cannot unacknowledge. The UI explains that automated checks do not prove semantic truth and that acknowledgment is not proof of truth. Source passages and review controls are separate from canonical printed content. The paper is a structured, selectable review layout, not PDF pagination; the host's real fit result is displayed without calculating fit in the renderer. CV and letter readiness and approval remain separate.

## Static verification

Dependencies were already physically installed. `npm ls --depth=0` completed successfully. No dependency installation, native rebuild, provider request, Electron launch, or interactive app exercise was performed.

- `npx vitest run tests/cover-letter-review-markup.test.ts --maxWorkers=1`: passed, 8 static React-rendered output tests.
- `npm run typecheck`: passed.
- `npm run build`: passed for the existing production app. Rollup emitted warnings about removable `@__PURE__` comment placement in installed Zod modules. Because this component unit is intentionally not imported by the workbench, that build does not bundle its CSS or exercise its renderer output; the focused test and typecheck cover the isolated TSX files.
- `git diff --check`: passed after the validation note was added.

Exact command outputs are under `.audit/cover-letter-ui-components/`: `npm-ls.log`, `focused-static-tests.log`, `typecheck.log`, and `build.log`.

These static-output tests verify server-rendered labels, status text, disabled states, escaping, identity-mismatch refusal, current acknowledgment display, document-selection semantics, and absence of hidden authority fields. They do **not** establish keyboard operation, focus order, responsive rendering, live-region timing, local edit/save/cancel behavior, async races, stale callback behavior under an actual renderer rerender, host authorization, persistence, or any end-to-end workflow. The CSS has not been visually inspected in a running app. Visible Electron acceptance remains deferred to the planned later integration gate (#14), after production APIs and shell integration are reviewed.

No claims are made here about generation, consent enforcement, storage, checks, approval, measured PDF fit, exports, retry, or installed behavior. Those remain unimplemented or unverified by this component unit.
