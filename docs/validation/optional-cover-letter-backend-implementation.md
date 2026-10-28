# Issue #122 backend implementation checkpoint

This is a bounded implementation checkpoint, not evidence that the cover-letter feature ships. The accepted contract is `docs/plans/optional-cover-letter.md`; this note does not supersede it.

## Atomic unit 1 — shared strict contracts

**Gate:** reject unknown model response authority fields; bind each paragraph citation to the current source-ordinal allowlist; require fit, no findings, and an acknowledgment for every paragraph before approval; retain source parent/category context. The model-response shape deliberately cannot assert that an ordinal resolves: resolution happens against the locally frozen source list when constructing a revision.

**Change:** added `src/shared/cover-letter.ts` with purpose, source, paragraph, revision, generation-outcome, edit/recipient/acknowledgment, and model-response schemas, plus deterministic acknowledgment material construction. The shared module has no Node crypto dependency. Main must hash that canonical material itself; renderer-supplied hashes are not authority.

**Evidence:** `npx vitest run tests/cover-letter-contract.test.ts --maxWorkers=1` — 1 file, 4 tests passed. `npx tsc --noEmit` passed. Evidence is the current command output in the implementation session (no external log file).

## Unit 2 — purpose and durable storage

**Gate:** preserve the existing input `scopeHash`; bind each prepared and accepted consent to `cv`, `cv+cover-letter`, or `cover-letter-only`; make historical grants CV-only; keep recovery CV-only; preserve v1-v3 restore behavior; emit v4 backups with the two letter tables; reject malformed legacy schemas and letter ownership; include letter records in capacity and job deletion.

**Change:** main freezes the selected purpose and stores its version, purpose, and SHA-256 commitment with the existing scope hash. Preparing a different purpose expires older previews. Letter-only consent cannot start posting analysis or generate a CV. Corrupt stored purpose metadata is revoked and attenuated to CV-only. CV input scope construction and `generateDraft` remain unchanged.

Migration 12 adds `cover_letter_revisions` and `cover_letter_operations`. The v4 backup inventory contains both tables. Restoring authentic v3 backups adds only the known empty letter tables and CV-only consent metadata. The v3 inventory, ledger, table SQL, and row columns are checked against the captured pre-change fixture before schema transforms. The old warning literal and v1-v3 transforms remain intact. Startup converts stranded prepared operations to cancelled and dispatched operations to uncertain. Historical uncertain operations do not hold job deletion.

**Evidence:** `tests/fixtures/cover-letter-legacy-v3.json` was captured with the public `createWorkbench` and `backup.createBackup` before schema changes. `tests/workspace-backup.test.ts` restores it, checks CV-only consent metadata, and refuses altered consent SQL. `tests/outbound-consent-workbench.test.ts` verifies purpose freezing, stale-preview rejection, letter-only CV-task refusal, and corrupt-metadata revocation. `tests/workspace-backup.test.ts`, `tests/workspace-backup-legacy-import.test.ts`, `tests/workspace-backup-engine.test.ts`, and `tests/transactional-job-deletion.test.ts` cover v4 inventory, compatibility transforms, capacity rollback, ownership, deletion isolation, and offline reopen. Logs are under `.audit/cover-letter-backend/`.

## Unit 3 — main-owned local review API

**Gate:** keep letter edits separate from the CV and profile; reject renderer-supplied acknowledgments or fit; bind each human acknowledgment to current paragraph text and its locally frozen sources; require current source/model/posting bindings, no known findings, complete acknowledgments, and measured fit before approval.

**Change:** main exposes typed read, paragraph edit, local recipient edit, source check, paragraph acknowledgment, and approval methods through preload and trusted IPC. Content or recipient edits create a new letter revision and clear acknowledgments, fit, and approval. Acknowledgment hashes are made in main. No renderer method can set fit, findings, or approval authority. Approval remains unavailable because this unit has no main-generated PDF fit measurement, even if a stored revision contains a fit-shaped value.

**Evidence:** `tests/cover-letter-review-workbench.test.ts` exercises persisted letter data through public workbench methods. It verifies local recipient privacy, unchanged profile and CV values, rejected authority injection, edit invalidation, source-change refusal, approval refusal without real fit, and offline reopen. The fixture seeds a valid saved letter and operation because this unit does not generate a letter.

## Current gates and limits

`npm test` passed 366 tests in 65 files after rebuilding this worktree's `better-sqlite3`. `npm run typecheck` and `npm run build` passed. Command output is saved under `.audit/cover-letter-backend/`.

This is not the full cover-letter feature. There is no requested-documents generation wrapper, letter provider dispatch, durable dispatch-intent lifecycle writer, factual-support validator for generated paragraphs, real PDF fit measurement, compiler, PDF or DOCX export, renderer implementation, or visible Electron acceptance. Since no main-generated letter fit can be measured in this unit, approval always refuses. These remain separate units under the accepted plan.

## Commit sequence and environment

`5c30682` adds the actual pre-change v3 backup fixture and its public restore test. `5eddfdb` adds explicit purpose-bound consent and CV-only legacy attenuation. `3d9e920` adds durable letter storage, v4 backup migration, deletion integration, and the main-owned local review API. The worktree is `work/cover-letter-build`; pinned template hashes and `package-lock.json` were not changed. No merge, push, installer, or release was performed.
