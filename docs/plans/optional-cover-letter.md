# Optional cover letter

This is the implementation contract for [issue #122](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/122). It records the maintainer's product decisions and the selected architecture before feature code.

## User workflow

1. Choose an unchecked **Include a cover letter** option before authorizing Outgoing data. The preview explicitly names CV-only or CV plus cover letter. Changing the choice replaces the preview and requires fresh authorization. Generate repeats the frozen choice and preserves the existing posting-analysis pause.
2. Generate the CV first. Only after a real generated CV is committed, generate the optional letter with one additional structured request. A letter failure cannot discard, replace, or unapprove the committed CV. Do not retry automatically.
3. Review CV and cover letter independently inside the existing Review evidence stage. Keep the approved Variant A shell, five stage names, document-first composition, accessible controls, and separate approvals. Each generated letter paragraph shows its source passages and needs explicit human acknowledgment.
4. Edit the letter locally without changing My profile. Use a concise one-page paragraph letter in Lato, adapting the approved template layout. Offer an optional manually entered recipient name, kept local and excluded from Pi. Otherwise use "Dear Hiring Manager,". Never infer or automatically use saved job contacts.
5. Export each approved document separately as PDF or editable DOCX. Show the real compiled PDF in Export. PDF is authoritative and Word may reflow. An unapproved or failed letter cannot block an independently approved CV's export.
6. If the letter fails, offer an explicit letter-only retry with fresh outgoing-data review and consent. Reuse the compatible analyzed source, not another cloud analysis or CV generation. If source/model/posting bindings changed, explain that a fresh full flow is required instead.

No installer replacement, merge, public release, automatic posting retrieval, contact enrichment, or message sending is authorized. Development delivery ends with an independently reviewed PR and an unpacked/source Electron preview. Live-provider and installed acceptance remain separate gates.

## Models, costs, and privacy

Use the exact existing Pi provider, model, and thinking level. Authentication stays external to CV Tailor. Show that including a letter adds a model request without claiming a fixed cost. No new setting, key, quota, silent repair/retry, or standing consent.

Build model input only from the authorized minimized posting and career facts. Exclude recipient, saved contacts, raw identity fields, restored local identifiers, draft CV prose, and restoration maps by construction. Retain the residual-sensitivity warning because free text can remain identifying. Models return bounded text and source ordinals, never TeX, source IDs, filenames, or executable instructions.

## Data shape and ownership

Use an independent `CoverLetterRevision` aggregate. Keep the existing `DraftRevision`, canonical CV JSON/hash construction, CV fit, approval, and public `generateDraft` arguments/result unchanged. No generic document registry, shared durable artifact union, or second generation graph.

The letter's strict bounded schemas cover:

- Revision identity, job ID, source parent run/child operation ID, originating CV revision ID, revision number, and creation timestamp.
- Real current source bindings: posting `updatedAt`, job/profile/evidence scope hash, exact evidence ID/revision pairs with local frozen snapshots and parent/category context, and frozen exact Pi selection. Do not invent a scalar profile revision.
- Locally frozen display date, posting subject/title, optional recipient, and paragraph IDs/text/citations. Main derives sender/header/signature from current local contact and checks its canonical hash whenever it changes.
- Letter-specific deterministic findings, explicit per-paragraph human decisions, actual PDF fit, and independent approval. Content edits create a new revision and clear checks/fit/approval. Derived state can be updated by the same sole main writer.
- A separate canonical letter version/template revision containing every rendered field. PDF and DOCX derive from it. Citation/review metadata does not print. Template/resource identity is part of letter artifact identity, not an incidental cache setting.

Main owns writes and authorization. Focused modules may own pure letter generation/verification/rendering policy; they must not become competing database writers. IPC/preload parses strict inputs/results, validates sender in main, and never accepts renderer measurements or approval hashes as authority.

## Public operations

Preserve `generateDraft(token, pageTarget)` exactly. Add `generateRequestedDocuments(token, pageTarget)` returning the original CV result plus an independent letter outcome. Outcomes distinguish `not-requested`, `not-started` with reason, `saved`, `failed`, `cancelled`, and `uncertain`.

Add narrow letter read/edit/check/measure/approve/actual-PDF-preview/export methods plus `prepareCoverLetterRetry(jobId, expectedCvRevisionId)` and a letter-only generation call. Reuse existing explicit accept/cancel consent actions. Editing must not accept acknowledged flags; approval validates a complete set of paragraph acknowledgments against main-held current wording/source hashes.

## Purpose authorization and operations

Keep the released input `scopeHash` algorithm unchanged. New grants add a versioned explicit purpose commitment over that hash and `cv | cv+cover-letter | cover-letter-only`. New metadata is complete or fails closed. Absent historical metadata means CV-only, never letter permission. Freeze purpose in the main-held preview, recompute at acceptance, and check it before each permitted task.

Initial generation uses one parent run/consent plus one main-created letter child operation. The child is an ownership/accounting identity, not another grant. Extend dispatch narrowly with task/operation context and main-held permission checks. Existing profile-import/regeneration behavior must remain compatible. A letter-only grant cannot dispatch analysis/CV work, and a CV-only grant cannot dispatch a letter.

Keep CV recovery versions and behavior intact. No mandatory v6 snapshot is needed. Recovery calls only the CV path and explicitly attenuates reconstructed authority to CV-only. It never calls the new wrapper, schedules a letter, or replays a letter operation. After CV recovery, any missing letter requires a new explicit letter-only grant. Workspace restore still revokes all consent and cancels runnable operations.

Reserve requested-document ownership through CV generation, the CV-to-letter gap, and child settlement. The current non-reentrant external-job-operation lock cannot simply wrap `generateDraft`, which would reject itself. Keep physical unsettled ownership until a cancelled provider promise settles. Recheck owner, current scope/purpose, job, cancellation, model, and expected CV revision at physical dispatch after awaited auth/model resolution, after response, and inside the save boundary.

Persist dispatch intent before the single letter provider call. If that write fails, send nothing. Keep letter attempt accounting in its own ledger, not existing run-wide CV checkpoint outcome queries. One-dispatch consumption and durable uncertainty prevent replay after crashes/capacity failure. Save the letter and mark child completion in one transaction. A crash/uncertain outcome is visible but never automatically retried. A crashed historical uncertain row is not a permanent live deletion lock.

A real generated CV is not merely `result.ok`. Existing CV validation failures can return `ok: true` for an empty blocked revision. Exclude that generation-failure branch. Ordinary pending CV skill/review findings do not suppress an independent letter from valid authorized profile evidence.

## Factual support and human review

Initially use education, experience, projects, and saved skills, matching existing generation input categories. Keep source parent context for nested facts. An ordinal citation resolves only through the frozen authorized allowlist. Reject foreign/missing ordinals, invalid structures, and detected unsupported numbers/skills/identifiers. A paragraph may compare multiple genuine sources but cannot attribute one role's facts to another.

Do not claim automated semantic proof. Every generated body paragraph requires human review of the linked local passages and main-bound acknowledgment of its current text/source revisions. An edit, source change, or recipient change invalidates the prior decisions. Known unresolved findings remain blocking until corrected or removed, not acknowledged away or cleared by changing an ID. Acknowledgment records acceptance, not proof of reading or truth.

## Persistence and compatibility

Add exactly two letter tables, `cover_letter_revisions` and `cover_letter_operations`, with explicit job/run/child ownership. Store independent fit with letter revision state instead of sharing the CV's job-only fit row. Add complete purpose grant columns to consent records, a forward migration ledger entry, bounded row/domain validators, and capacity accounting.

Write backup v4. Preserve the released v1-v3 parsing, warning text, and existing transforms. Validate known legacy table definitions/columns/ledger before the v3-v4 transform; never overwrite arbitrary supplied SQL with trusted SQL and thereby launder corruption. Add only the known new empty tables and CV-only legacy grant metadata, then apply exact current inventory/schema/ownership/size/ledger checks and clone replay before restore. Letters reopen offline; restoring data never restores cloud authority.

Include letter tables and letter-only run owners in deletion fingerprints, counts/copy, busy detection, cross-job ownership validation, transaction deletion, and post-commit in-memory cleanup. Preserve unrelated jobs, profile, legacy ambiguous run records, backups, and exported files.

## Real artifacts and exports

Keep downloaded upstream files unchanged. Adapt a separate application-owned Letter/Lato template with paragraphs, fixed date, local subject, greeting/signature, and no placeholder/fixed body prose. Package that template and required MIT/ancestor/font notices deliberately.

Share only necessary hardened compiler mechanics through private document adapters. Preserve existing CV canonical serialization and cache behavior. Letter compilation uses fixed app-owned filenames/commands, one-pass text escaping, T1 support, isolated temp sources, a filtered environment, pinned local executable, no shell escape, bounded time/output, and cleanup. No runtime package downloads. Unsupported glyphs, significant overfull boxes, and invalid PDF bytes fail closed.

Define a finite manifest of required runtime template/compiler/font/dependency assets and verify it before cold compilation and warm-cache reuse. A one-page sample or executable hash alone does not establish all asset integrity. Validate this with deliberate corrupt-asset tests.

Measure the actual letter PDF for exactly one 612 by 792 point Letter page, selectable canonical text in order, supported characters, and no forbidden overflow. Recompute revision/source/check/acknowledgment/canonical/fit guards in main at approval and before export. Recheck after native dialogs and after compilation/DOCX construction immediately before writing. A changed or missing posting/evidence/model/source binding blocks approval/export without rewriting historical data.

For letter destinations, preserve explicit cancellation/overwrite decisions and use a bounded snapshot of the confirmed destination. Refuse changed destinations after compilation, create without clobber when absent, and use atomic final writes with a final current-document guard. Do not claim metadata checks eliminate every hostile filesystem race. Word comes from the same canonical content but may paginate differently.

## Designed implementation and verification workflow

Rigor is high because consent, storage, recovery, untrusted text, approval, and filesystem output share the change. The baseline at `2a7a3a0` passed typecheck/build, 354 tests in 63 Node files, and three visible Electron cases covering consent, full CV generation/review/reopen and actual PDF/Word exports. The downloaded sample's source/license hashes also pass in a fresh Windows worktree after explicit Git line-ending rules.

Implement each unit as an experiment. First write the contract/gate or failing regression, make the smallest change, measure it, keep it only if the predicate advances, and record the result in `docs/validation/optional-cover-letter-decisions.tsv`. A failing/inconclusive gate is not completion.

1. Purpose contracts and compatibility. Prove opt-out makes no letter request/record, old grants/recovery stay CV-only, changed purpose needs fresh consent, and mismatched grants/tasks/models fail before dispatch. Preserve legacy canonical hash fixtures.
2. Letter storage and lifecycle. Prove v1-v4 backup/restore compatibility and corruption refusals, ownership/capacity rollback, deletion isolation, and offline reopen.
3. One-call letter generation. Prove valid-CV commit survives invalid/cancelled/failed/late/uncertain letter results, dispatch intent is durable, no second dispatch occurs, and fresh letter-only retry makes zero analysis/CV requests.
4. Local review and approval. Prove separate revisions, current source passages, per-paragraph acknowledgments, known findings, and recipient privacy/invalidation. Never approve the CV through letter actions.
5. Deterministic artifacts. Compile and inspect real Lato/Letter PDF and DOCX. Test special-character escaping, extended Latin, unsupported glyphs, overflow, warm/cold corrupt assets, stale dialogs/compilation, cancellation and destination changes.
6. Visible five-stage integration. Exercise real controls and public preload seams for opt-out/opt-in, analysis pause, separate document review/export, letter failure with valid CV export, retry, and reopen. No hidden control mutation or invented guard paths.
7. Integration and handoff. Run full typecheck/build/Node tests in ABI order, focused serial Electron tests, independent diff and audit review, then prepare the unpacked preview and PR. Keep live-provider and installed-app acceptance explicitly separate.

Use isolated worktrees and physical dependencies. Luna builds; Sol independently reviews exact commits. Do not merge unreviewed code. All configured models are OpenAI, so do not claim cross-family review. Do not run Node and Electron native rebuilds concurrently against one dependency tree.

## Architecture decision trail

Two independent sketches compared the separate letter aggregate with a generic application-document family and embedded CV state. Both preferred independent ownership. The cross-judge scored each 21 out of 25 on the written rubric, not runtime performance. Candidate A is the base because its new wrapper preserves existing public CV contracts. Candidate B contributes explicit letter-only retry/uncertainty and stricter legacy/artifact safeguards. A generic durable document framework and mandatory CV recovery v6 are rejected as unnecessary compatibility risk.

The local grounding, complete sketches, rubric judgments, baseline logs, and source evidence remain under `.audit/cover-letter-template/`. The committed decision trail plus the implementation diff are the review record. The scope estimate is several hours across roughly 20 to 35 source/test files, subject to the verified implementation units rather than a promised completion time.
