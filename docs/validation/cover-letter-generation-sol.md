# Initial optional cover-letter generation — backend slice

## Scope and public behavior

Implemented on `work/cover-letter-main` from `8cdc51d` without renderer, dependency, CV canonical/template, package or installer changes.

- `generateDraft(token, pageTarget)` retains its old signature/result and delegates to a private CV core. CV v5 recovery continues to use that old public CV-only path.
- New `generateRequestedDocuments(token, pageTarget)` returns `{ cv, letter }` through typed, validated `documents:generate` IPC/preload. CV-only grants execute the CV pipeline with no letter call or row. Opt-in commits a real generated CV before one optional letter request. The CV validation-failure empty-draft branch cannot start a letter; ordinary pending skill review does not prevent it.
- Main reserves the saved job with a private symbol before the first await. The reservation covers the CV, the transition, awaited authentication, the physical child request and settlement. Public CV generation and conflicting analysis/export/deletion/restore operations cannot steal it; cancellation does not release it while a provider promise remains unsettled.
- A child operation records the parent consent/run and initial CV/scope/model/posting bindings. It durably changes from `prepared` to `dispatched` **after** awaited Pi model/auth resolution and **before** sending. A failed intent write sends nothing. Letter attempts do not enter CV run-wide attempt/checkpoint tables. Saving the letter and completing its child is transactional.
- Current purpose, consent, scope, source passages, model, expected CV, ownership and cancellation are checked at dispatch, response and save. Invalid, failed, cancelled, stale, capacity-limited or uncertain letters do not replace or roll back the CV. There is no automatic repair, retry or replay.

## Sources and limits

[Source preparation and deterministic checks](../../src/main/cover-letter-generation.ts) derive parallel bounded local/minimized passages from actual education, experience, nested career facts, projects/technologies and saved skills. Only ordinals, category and minimized headings/passages go to the model, along with the authorized minimized posting. Local IDs, contact records, saved job contacts, recipient, prior letter/CV prose and restoration maps are excluded. A remaining UUID in these outgoing inputs fails closed.

Every returned ordinal resolves through the main-held allowlist. Schema/foreign references, detectable unsupported numeric expressions, known posting/common skills, identifiers and named-role attribution transfers are rejected. This is **not semantic proof**: paraphrases, unknown technologies and other undetectable false claims still require human paragraph review. Source checks recompute current passages instead of trusting imported text attached to genuine evidence IDs. The review follow-up below additionally checks each ordinal against the parent's frozen, main-issued source mapping at backup validation and current readiness. The earlier backend's deterministic `Saved <skill name> skill.` label remains compatible only for that genuine current skill.

The resulting strict revision has local date/subject, real originating CV/parent/child bindings and source passages, but no fit, approval or acknowledgments. Existing `getCoverLetter` reads it offline. Initial-operation metadata is cross-checked but is not the authority for origin. The parent's v5 generation-recovery snapshot independently identifies its actual eligible committed CV and frozen source mapping, even when optional child metadata is removed. Historical operations remain readable; without a resolvable current origin contract they are read-only, not eligible for current provenance, editing, acknowledgment or approval. Restore discards in-memory grants after successful replacement. Uncertain historical children are not live deletion locks.

## Executed evidence

Actual logs remain in `.audit/cover-letter-generation-sol/` in this worktree; they are not release artifacts.

| Gate | Result | Log |
| --- | --- | --- |
| Initial public behavior red | Six failures: public method absent | `01-red.log` |
| Initial working slice | Six public tests passed | `02-focused.log` |
| Source attribution regression red | Detectable cross-parent prose transfer was accepted before the check | `07-sources-red.log` |
| Generation, source and preload focused checks | 29 tests passed | `20-final-focused.log` |
| Full compatibility run | 414 tests passed in 71 files, no unhandled errors | `21-final-full-tests.log` |
| TypeScript | Passed | `22-final-typecheck.log` |
| Production build | Passed; existing Rollup annotation warning | `23-final-build.log` |
| Documentation links / diff whitespace | Passed | `18-doc-links.log`, `19-diff-check.log` |

The earlier full run (`10-full-tests.log`) exposed three legacy scheduler regressions from an overly broad unsettled-run check. The implementation was narrowed to the new private reservation, preserving the released superseded-analysis behavior; the focused compatibility run (`11-compat-green.log`) passed all 60 cases, followed by the full passing run above. Intermediate logs also retain test-fixture/API corrections rather than hiding failed experiments.

Executable coverage:

- [Public generation tests](../../tests/cover-letter-generation.test.ts): real CV/letter schemas; opt-out zero calls/rows; one opt-in letter after CV; duplicate consumption; invalid schema/foreign/number/skill responses; durable pre-send intent; cancel/late/stale/provider failures with CV retained; post-auth purpose/scope/cancel/model/CV/capacity fences; real SQLite capacity rollback; offline reopen; restore source forgery; recipient/saved-contact privacy; old public CV and v5 recovery remain CV-only; uncertain children do not block deletion permanently.
- [Source tests](../../tests/cover-letter-generation-sources.test.ts): actual local parent/category/passages, minimized ordinal payload privacy, numeric unit/qualifier refusals and detectable attribution checks while allowing genuine multi-source wording.
- [Preload tests](../../tests/cover-letter-generation-preload.test.ts): typed separate result, unchanged legacy CV channel and invalid-input/result rejection.

## Bounded independent-review corrections

Follow-up to exact initial slice `891ddd3766ccc1339f7705fa54fa3f87c08a9c4d`; the earlier evidence above describes that slice, not these corrected checks. Logs for this follow-up are in `.audit/cover-letter-generation-review-fixes/` (local audit evidence, not release artifacts).

[Origin resolution](../../src/main/cover-letter-provenance.ts) now independently joins the child operation to its purpose-bound consent and completed v5 CV parent. The parent's frozen identity must match the committed CV ID, job, revision, creation time and posting target; the CV must contain content and must not be the generation-validation-failure branch. Scope/model/posting and actual issued ordinal/ID/revision/category/parent/heading/passage relationships are checked against that frozen source, not asserted by optional `initialBinding`. Both backup validation and current readiness use this resolver. Editing the latest CV title does not invalidate the correctly bound original CV, but cannot substitute the new same-job revision as the letter's origin. No new optional version tag was introduced.

Missing parent provenance (or an older parent contract) is not evidence of a current origin: historical prose remains readable, while current checks, local edits, acknowledgments and approval refuse it. Restore still clears approvals, fit and acknowledgments. Removing only optional child metadata remains compatible **only when the independent parent resolves and all relationships match**. A future fresh letter-only parent will require explicit origin-parent binding; it cannot inherit authority from an arbitrary same-job CV. No retry was implemented. Actual released v1–v3 backups contain no letters; their restore and the old CV-only recovery behavior remain unchanged.

| Gate | Actual result | Log |
| --- | --- | --- |
| Original `review probe stripped binding` | RED: restore accepted substitution and current check returned `ok: true` | `red-stripped.log` |
| Original `review probe forged source ordinal` | RED: restored ordinal 42 and current check returned `ok: true` | `red-ordinal.log` |
| Six corrected-fixture review regressions before implementation | RED at the intended boundary assertions (five accepted corrupt backups and missing-parent current eligibility) | `red-regressions-fixture-corrected.log` |
| Focused generation/source/preload | 39 passed: all original 29 checks plus ten new regressions | `green-39-generation.log` |
| Focused generation and backup/recovery/review compatibility | 84 passed in nine files | `green-focused.log` |
| Full `npm test` (native SQLite rebuild included) | 424 passed in 71 files; no unhandled errors | `full-tests.log` |
| TypeScript / production build | Passed; existing Rollup annotation warnings | `typecheck.log`, `build.log` |
| Documentation links / diff whitespace | Passed | `doc-links.log`, `diff-check.log` |

The two **unmodified** supplied probes were rerun with their exact requested `-t` names/config after the fix. Both still exit **1**, now because `previewRestore` immediately rejects `cover_letter_revisions`, before their unconditional restore/current-check code can run (`postfix-original-stripped.log`, `postfix-original-ordinal.log`). They are not claimed as exit-0 GREEN. The committed refusal-aware public generation regressions assert that stronger preview rejection and separately persist the same corruption to prove current-check/approval refusal. Correct genuine backups still restore and check successfully. Unknown historical provenance instead restores read-only, as explicitly tested.

The supplied exploratory swapped-attribution probe had failed fixture setup and was not evidence of an attribution swap. The first added two-source fixture likewise exposed its one-item scorer limitation (`red-regressions.log`); after returning a score for every actual source, both sources generated successfully and the actual ordinal-swap regression failed at the intended restore refusal assertion before the fix, then passed afterward. No unrelated attribution or semantic-proof claim is made.

## Deliberately remaining

No letter-only retry or fresh retry-consent workflow, renderer integration, generated-letter measurement/approval/preview/export integration, package/install, live-provider acceptance or new visible Electron acceptance was implemented. Existing approval remains honestly unavailable without main-generated actual PDF fit. Existing artifact modules/tests are not evidence that a newly generated letter can already be exported through the product. Independent review and any later integration/PR remain separate gates; no merge or release is authorized here.
