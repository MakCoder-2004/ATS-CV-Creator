# Wuzzuf guarded capture and reviewed Save — candidate checks

**Scope:** Issue #112 candidate branch only, based on merged main `1eca4b35426f8af347974ff4a18d4aaefbeb850a`. This is synthetic development evidence, not a release, publisher permission, or installed-app acceptance.

## Implemented boundary

- The generic Wuzzuf public direct-read/research path remains separate and non-saveable. The new named route accepts only a single `https://wuzzuf.net/jobs/p/<exact-id-or-slug>` page after an explicit per-run local opt-in and Fetch action.
- Main pins every resolved address only when all are public, sends minimal headers with no browser/model/profile credentials, refuses all redirects, limits the response to 2 MiB, applies a 15-second deadline and two-second worker parse budget, and cancels/discards superseded or closed attempts. It does not retry or follow linked pages.
- An identity-less `JobPosting` candidate needs one unique canonical URL equal to the selected posting URL, exactly one structured role, independently matching visible title and employer, and a complete description present in visible page text. Conflicts, missing evidence, login/restricted pages, and incomplete/teaser text fail closed.
- Preview text stays in an expiring main-held session until exact-role/full-text review and a one-time Save grant. Saving is transactional, detects duplicates, and retains the captured source snapshot separately from editable working wording. Save does not authorize model dispatch. Existing backups remain unchanged and may retain accepted text after live deletion.
- The source notice distinguishes the maintainer's accepted local product-risk decision from publisher permission; LinkedIn/Indeed and generic Lever/Greenhouse pauses are unchanged. #113 Pi extraction/contacts are out of scope.

## Synthetic checks observed

- `npx vitest run --maxWorkers=1 tests/wuzzuf-posting.test.ts tests/named-posting-contract.test.ts tests/named-posting-api.test.ts tests/main/named-posting-preview-session.test.ts tests/jobs.test.ts` — 5 files, 72 tests passed; Wuzzuf/session tests were rerun after parser hardening (14 passed).
- `npx playwright test tests/electron/named-greenhouse-preview.spec.ts --workers=1` — 1 visible Electron flow passed. Its Wuzzuf section uses a scripted in-process HTML fixture and asserts no saved job before explicit review/Save, then confirms corrected working title and immutable source snapshot in SQLite, followed by deletion. No live Wuzzuf, Pi, or model request was made.
- `npm run typecheck`, `npm run build`, and `node scripts/check-doc-links.cjs` passed (81 Markdown files).

## Gates still open

Independent security/privacy/source-policy review, maintainer confirmation of the final source notice/retention scope, and any installed-app/release acceptance remain separate gates. No package/install check or live source/provider request was performed. Do not edit earlier dated validation reports to imply this candidate was installed or publisher-approved.
