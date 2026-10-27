# Issue 99: reviewed named Greenhouse and Lever Save

**Status:** This development branch implements explicit reviewed Save through the exact named Greenhouse and non-EU Lever API routes. Generic/direct Lever, LinkedIn, and Indeed routes remain paused. This is not integrated or installed acceptance; #101 owns that handoff. PR #107 remains open for review.

## Implemented

- A main-process session retains immutable retrieved attempt/candidate data. Exact-role/completeness review is bound to that candidate hash, expiry and a one-time token. Renderer flags or candidate data alone cannot authorize Save.
- Greenhouse and non-EU Lever named API candidates share the guarded preview/review/Save path. Lever EU and generic/direct Lever are still refused before network access. LinkedIn/Indeed remain paused.
- Save writes the accepted posting, separate captured source snapshot, retrieval route/update metadata, hashes, working wording, field origins, and initial revision atomically. User corrections do not rewrite source text. Duplicate checks also run inside the transaction; stale, declined, cancelled, incomplete, and expired data is not persisted. Save does not authorize model work.
- Named API transport bounds DNS/IP selection, HTTPS route, redirects, response bytes, request deadline, and HTML worker extraction. The Lever extractor uses a two-second bound. Socket failures do not auto-retry; a retry requires a new explicit user start.
- UI discloses per-run local opt-in, source identity, full text, source update/capture time and freshness limits, separate working wording, backup/deletion semantics, and the separate model-consent step.

## Verification

- Focused contract/API/session/source-policy/adapter tests: **54 passed** (Node SQLite ABI; no live endpoints).
- Focused SQLite Save/correction/duplicate/backup/restore/delete/reopen test: **passed**.
- `npm run typecheck`, `npm run build`, docs-link check and `git diff --check`: passed.
- One synthetic visible Electron flow passed Greenhouse and Lever preview, reviewed Save, source/working separation, reopen, delete, backup-retention notice, and generic/EU pause assertions. All requests used fixed local fake responses; no live provider or packaged app was run.
- No installed Windows test was run.

## Remaining gate

#101 still owns broader integrated testing and separately approved installed-Windows validation. Public external-source behavior and legal rights are not claimed. PR #107 is open; issue #99 remains open pending review/merge. No source route beyond the exact named personal-local opt-in is enabled by this work.
