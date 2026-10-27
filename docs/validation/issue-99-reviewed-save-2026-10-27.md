# Issue 99: reviewed named Greenhouse Save

**Status:** Greenhouse's exact named API preview now has an explicit review and Save flow in this development branch. Lever remains paused; this is not full #99 closure or integrated/installed acceptance.

## Implemented

- A main-process session retains the immutable retrieved attempt and candidate. A reviewed attempt/candidate hash, exact-role/completeness decisions, expiry and one-time review token are checked before Save. Renderer-supplied flags or candidate data alone cannot create save authority.
- Save writes the accepted posting, source snapshot, retrieval route/update time, source hash, field origins and first posting revision in one SQLite transaction. User corrections become working wording while the captured source snapshot remains unchanged. Exact duplicates are refused, including a transaction-time recheck; failed saves leave the preview retryable. Save does not authorize model work.
- The Saved jobs review shows source/title/employer/board/posting ID, full text, capture/source-update time and freshness limits; includes separate working fields, exact-role and completeness acknowledgements, and explicit backup/deletion notice. Existing deletion removes attributable workspace data while leaving user-created backup artifacts untouched.
- LinkedIn and Indeed remain paused. Lever remains paused and no Lever route was enabled.

## Verification

- Focused contract, named API, preview-session and paused-source suites: **48 tests passed** (Node SQLite ABI).
- Focused workspace Save/reopen/backup/restore/delete/duplicate/correction test: **passed** (Node SQLite ABI).
- `npm run typecheck`: passed after the final schema change.
- `npm run build`: passed.
- One synthetic visible Electron flow: **passed** for preview, review, explicit Save, source/working separation, reload/reopen, deletion and older-backup disclosure. It used the fixed local fake response and isolated workspace; no live provider or packaged app.
- `node scripts/check-doc-links.cjs` and `git diff --check`: passed.
- No installed-Windows or live-source checks were run. `#101` retains those broader integration and separately approved installed gates.

## Still open under #99

The named Lever preview/review path and complete source-specific safe mocked regression coverage remain unfinished. Do not reopen Lever until the adapter's deadline/extraction, redirects, DNS pinning, response limits, cancellation and failure behavior are fully covered and reviewed. LinkedIn and Indeed remain paused. The Greenhouse synthetic flow does not prove live response completeness or universal access. Issue #99 stays open; no PR merge or issue closure is implied.
