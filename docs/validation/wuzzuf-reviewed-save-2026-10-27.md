# Wuzzuf guarded capture and reviewed Save — candidate checks

**Scope:** Issue #112 candidate branch only, based on merged main `1eca4b35426f8af347974ff4a18d4aaefbeb850a`. This is synthetic development evidence, not a release, publisher permission, or installed-app acceptance.

## Implemented boundary

- The generic Wuzzuf public direct-read/research path remains separate and non-saveable. The named route defaults off and accepts only a single `https://wuzzuf.net/jobs/p/<exact-id-or-slug>` page after both an owner-created local policy file and explicit per-run opt-in/Fetch action. To enable only the maintainer's Windows installation, create `%APPDATA%/CV Tailor Personal Local Policy/wuzzuf-personal-local.json` with `{"version":1,"wuzzufPersonalLocalEnabled":true,"acknowledgedNoticeVersion":1}`; restart CV Tailor. The app never creates this file. Remove it or invalidate its contents to disable. It is outside userData/workspace exports and is not carried in workspace backups. This local opt-in is not publisher permission or legal advice.
- Main pins every resolved address only when all are public, sends minimal headers with no browser/model/profile credentials, refuses all redirects, limits the response to 2 MiB, applies a 15-second deadline and two-second worker parse budget, and cancels/discards superseded or closed attempts. It does not retry or follow linked pages.
- An identity-less `JobPosting` candidate needs one unique canonical URL equal to the selected posting URL, exactly one structured role, independently matching visible title and employer, and a complete description present in visible page text. Static visibility checks reject hidden/aria-hidden/inert/title/company evidence, hidden ancestors, known hidden classes, and inline display/visibility/opacity/content-visibility hiding. Conflicts, missing evidence, login/restricted pages, and incomplete/teaser text fail closed. Static parsing cannot evaluate arbitrary external CSS/media queries; this residual limitation is documented, and the human must inspect the displayed source before Save.
- Preview text stays in an expiring main-held session until exact-role/full-text review and a one-time Save grant. Saving is transactional, detects duplicates, and retains the captured source snapshot separately from editable working wording. Save does not authorize model dispatch. Existing backups remain unchanged and may retain accepted text after live deletion.
- The source notice distinguishes the maintainer's accepted local product-risk decision from publisher permission; LinkedIn/Indeed and generic Lever/Greenhouse pauses are unchanged. #113 Pi extraction/contacts are out of scope.

## Synthetic checks observed

- `npx vitest run --maxWorkers=1 tests/wuzzuf-posting.test.ts tests/wuzzuf-local-enablement.test.ts tests/named-posting-contract.test.ts tests/named-posting-api.test.ts tests/main/named-posting-preview-session.test.ts tests/jobs.test.ts` — 6 files, 76 passed, including hidden identity/description evidence, owner config parsing/default-off/symlink cases, one-use review tokens and transactional SQLite coverage.
- `npx playwright test tests/electron/wuzzuf-local-policy.spec.ts tests/electron/named-greenhouse-preview.spec.ts --workers=1` — 2 visible Electron tests passed. The disabled-install case checks hidden controls, direct public-preload IPC denial by main, and zero Wuzzuf requests. The enabled case creates the policy only in an isolated appData sibling, uses scripted HTML, verifies no save before review, and checks corrected wording versus the immutable SQLite source snapshot plus existing paused-host behavior. No live Wuzzuf, Pi, or model request is made.
- `npm run typecheck`, `npm run build`, `node scripts/check-doc-links.cjs` (81 Markdown files), and `git diff --check` passed.

## Gates still open

Independent security/privacy/source-policy review, maintainer confirmation of the final source notice/retention scope, and any installed-app/release acceptance remain separate gates. No package/install check or live source/provider request was performed. Do not edit earlier dated validation reports to imply this candidate was installed or publisher-approved.
