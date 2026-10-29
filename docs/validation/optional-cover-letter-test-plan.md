# Optional cover-letter verification plan

This is a pre-implementation test contract for [issue #122](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/122), not a passing test report. The selected design is [the implementation plan](../plans/optional-cover-letter.md). Each result must point to executed tests or inspected product artifacts. Synthetic provider results do not establish live-provider or installed-app acceptance.

## Baseline captured before feature changes

Source baseline was `2a7a3a040304ab5e0e451f1a7c9df218b0b38418`.

| Gate | Observed result | Local evidence |
| --- | --- | --- |
| Typecheck | VERIFIED | `.audit/cover-letter-template/baseline-typecheck.log` |
| Build | VERIFIED | `.audit/cover-letter-template/baseline-build.log` |
| Full Node suite | VERIFIED, 354 tests in 63 files | `.audit/cover-letter-template/baseline-tests.log` |
| Visible one-run consent | VERIFIED | `.audit/cover-letter-template/baseline-electron.log` |
| Visible CV generation, review, actual PDF/Word export and reopen | VERIFIED | Same Electron log; `baseline-screenshots/latex-compiled-preview.png` alongside it |
| PDF cancellation and overwrite refusal | VERIFIED | Same Electron log |
| Downloaded source and licenses | VERIFIED, eight hashes, including fresh Windows worktree | `resources/cover-letter-template/SHA256SUMS` |

Existing `tests/document.test.ts` already pins a legacy canonical SHA-256. Retain and execute that gate rather than replacing it with a newly computed expected hash.

## Backend and artifact matrix

All new-feature rows start **NOT VERIFIED** until the implementation is executed and reviewed.

| Area | Experiment | Required observation |
| --- | --- | --- |
| Opt-out | Generate through the existing CV-only API and through the new wrapper with letter disabled. | No letter request or record. Existing CV result and canonical bytes remain unchanged. |
| Purpose | Attempt letter with old/CV-only consent, CV tasks with letter-only consent, changed purpose after preview, malformed purpose metadata, and cached analysis without fresh authorization. | Refused before dispatch. New accepted purpose is main-held and exact-model bound. |
| Handoff | Inject cancel/posting/model change/deletion/duplicate generation around CV commit and child dispatch. | No unlocked ownership gap, no duplicate letter call, no late save, valid CV retained. |
| Failure isolation | Return malformed letter, foreign citations, invalid factual content, provider error, cancellation, or capacity failure. | Letter outcome is distinct. Latest valid CV is neither replaced nor unapproved. |
| Uncertainty | Crash or lose persistence after recorded dispatch intent, then reopen or restore. | No automatic letter replay. Uncertain status remains honest; fresh retry is explicit. |
| Retry | Fresh letter-only consent against current compatible source, then changed source/model/CV binding. | Exactly one letter call and zero analysis/CV calls when compatible; otherwise explicit refusal. |
| Source mapping | Foreign/missing/out-of-range ordinals, nested facts with different parents, unsupported numbers/skills. | Invalid references/known unsupported findings block. Actual parent passages remain inspectable. |
| Human review | Omit one paragraph acknowledgment, reuse it after editing wording/recipient/source, or submit acknowledgment through an edit. | Main refuses approval until all current paragraph/source decisions are explicit and valid. |
| Separate documents | Edit/approve/check a letter while a CV has saved gates, and edit/check the CV with a saved letter. | Each artifact's independent content and approval state is preserved or invalidated only by its own source/content changes. |
| Local recipient | Enter a distinctive synthetic recipient and saved contact. Capture every provider request. | Neither dedicated field enters Pi requests. Recipient persists locally and prints in greeting. Empty value uses generic greeting. |
| PDF | Compile actual approved letter. | One 612 by 792 point Letter page, Lato, expected text/order, no source/review annotations. |
| Character safety | Use `&`, `%`, `_`, braces, backslashes, TeX-looking text, supported accented Latin, and an unsupported glyph. | Literal escaped text cannot execute TeX; supported text extracts correctly; unsupported input fails safely. |
| Overflow | Use long paragraphs/headings/recipient. | Actual overflow or invalid layout cannot be approved/exported; no clipping or silent font shrinking. |
| Assets | Corrupt required template/font/compiler/dependency files with cold and warm caches. | Manifest mismatch refuses artifact use; a cache hit cannot bypass letter integrity checks. |
| DOCX | Parse the actual emitted DOCX XML/text. | Same canonical letter body, greeting, subject, signature, and current recipient. No fake PDF pagination promise. |
| Export race | Edit source/letter during save dialog or compilation; replace/create a confirmed destination. | Current-document and destination rechecks refuse stale output; cancellation/refusal leaves files intact. |
| Persistence | Save, close and reopen; backup/restore new format and each supported old format. | Letter/local recipient reopen offline; old CV hashes remain stable; restored consent is not authority. |
| Backup corruption | Alter old/current table SQL, columns, ledgers, ownership, sizes or missing/extra tables. | Strict refusal rather than laundering a malformed legacy schema into the new format. |
| Deletion | Delete one job with CV and letter, test stale preview and live unsettled request. | Only proven owned rows removed transactionally; unrelated job/profile/exported files remain. |

## Visible Electron scenarios

Drive visible controls and public preload APIs. Use the public API only to seed source records or inspect actual persisted/exported state, not to mutate hidden controls or fabricate an impossible guard path. Keep scripted providers unpackaged-only.

1. **CV-only regression.** Start from the unchecked option, authorize, inspect analysis, generate, review, approve, and export the CV. Confirm no cover-letter operation was dispatched.
2. **Successful optional letter.** Enable the option before authorization. Inspect the named purpose and residual-sensitivity notice. Pause on analysis, then explicitly generate. Switch between documents. Review actual paragraph passages, edit one paragraph, enter a local recipient, acknowledge every paragraph, check actual fit, approve the letter, and export PDF and Word. Inspect exported bytes and source/profile immutability.
3. **Independent failure and retry.** Fail the letter after the CV commits. Show the failed/uncertain state without hiding it. Approve/export the CV. Use the visible fresh letter-only preview/authorization path to retry without regenerating the CV or analyzing again.
4. **Reopen and invalidation.** Reopen the workspace offline, verify recipient and letter state, then make a visible wording or recipient edit. Prior letter acknowledgment, fit and approval must be invalidated without changing CV wording or profile.
5. **Cancellation and stale UI.** Cancel queued/active work and change selected job. The old response cannot appear under the new job or become approved. Source/model changes require explicit fresh authorization.
6. **Responsive review.** Check both appearances and 375, 768, 1024 and 1440 pixel widths. Preserve five stages, keyboard/focus/status behavior, the readable paper, and access to both documents. No page-wide horizontal overflow or hover-only essential controls.

New scripted letter fixtures may need narrow main-process fixture support in `src/main/index.ts`. Fixtures must return the same bounded response schema as production and never be enabled in packaged builds. A frontend worker must not weaken main guards to simplify fixtures.

## Final result states

Record each gate as VERIFIED, NOT VERIFIED, or INCONCLUSIVE with exact commit, command and artifact evidence. Do not mark an implementation unit complete while required tests fail. Full regression and independent reviewed diffs precede integration/preview. Keep real-provider and installed Windows acceptance open until actually exercised with the maintainer's approval.
