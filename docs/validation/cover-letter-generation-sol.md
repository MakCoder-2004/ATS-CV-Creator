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

Every returned ordinal resolves through the main-held allowlist. Schema/foreign references, detectable unsupported numeric expressions, known posting/common skills, identifiers and named-role attribution transfers are rejected. This is **not semantic proof**: paraphrases, unknown technologies and other undetectable false claims still require human paragraph review. Source checks recompute current passages instead of trusting imported text attached to genuine evidence IDs. The earlier backend's deterministic `Saved <skill name> skill.` label remains compatible only for that genuine current skill.

The resulting strict revision has local date/subject, real originating CV/parent/child bindings and source passages, but no fit, approval or acknowledgments. Existing `getCoverLetter` reads it offline. New initial-operation metadata is complete when present, with strict backup/ownership cross-checks; historical operations without it remain readable. Restore discards in-memory grants after successful replacement. Uncertain historical children are not live deletion locks.

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

## Deliberately remaining

No letter-only retry or fresh retry-consent workflow, renderer integration, generated-letter measurement/approval/preview/export integration, package/install, live-provider acceptance or new visible Electron acceptance was implemented. Existing approval remains honestly unavailable without main-generated actual PDF fit. Existing artifact modules/tests are not evidence that a newly generated letter can already be exported through the product. Independent review and any later integration/PR remain separate gates; no merge or release is authorized here.
