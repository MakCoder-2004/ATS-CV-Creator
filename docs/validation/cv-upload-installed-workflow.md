# CV upload release-gate verification

**Date:** 2026-10-22  
**Code under test:** installed from the completed `feat/cv-upload-44` branch, based on the current integrated CV-upload implementation
**Installer:** `release/CV-Tailor-Setup-0.2.2.exe` (per-user NSIS, x64); installed to `E:\cv-tailor-cv-upload-44\release\installed-user\CV Tailor.exe` for isolated verification. Installer and generated `.tools/latex` are ignored build outputs, not committed.

## Completed observations

- Confirmed the task worktree began exactly at integration tip `0bc451c`; `feat/cv-upload-integration` still resolved to that same tip at final merge check. No application implementation changes were needed for this verification.
- `npm ci --no-audit --no-fund` completed in this physical-dependency worktree (599 packages, about 5 minutes; no dependency junction).
- `npm run typecheck` passed.
- Initial `npm run test:fast` had one `draft-records.test.ts` failure. Re-running that exact test alone passed. After `npm rebuild better-sqlite3 --no-audit --no-fund`, full `npm test` passed: 37 files, 176 tests passed, 1 skipped. The initial isolated failure was not reproducible in the full ABI-correct run.
- `npm run prepare:latex` provisioned the pinned Windows toolchain locally. `npm run verify:latex` passed (pdfTeX 3.141592653-2.6-1.40.29, 132 locked packages, template smoke).
- `npm run test:electron` built production bundles, rebuilt `better-sqlite3` for Electron 39.8.10 / ABI 140, and passed 34 tests; 2 installed-app tests were skipped because the installed executable variable was not set for that run.
- First Electron attempt before LaTeX provisioning had 3 failures because the ignored `.tools/latex` bundle was absent. After provisioning, the complete Electron run passed, including visible PDF/DOCX upload proposals, populated-profile add/update/skip, rejection/rollback, AI safety, JSON exchange, workspace backup and scripted-provider generation.
- `npm run dist:win` completed successfully: packaged SQLite verified under Electron ABI 140; bundled LaTeX passed packaged verification/smoke. Installer version 0.2.2 created at the path above; installer installed with exit code 0 to the isolated per-user target.
- Installed-app Playwright: the first SQLite reopen smoke exceeded its default 30-second test timeout; a bounded rerun with `--timeout=90000` passed in 5.2 seconds. The installed bundled-LaTeX workflow test passed (reopened workspace, produced and inspected a selectable one-page PDF with expected text/link, and exercised approval/export review path).

## Final release gate completed

**Final code:** merged `main` commit `3af20bf9f870c2daaa524a8a241a6977cf4922f3`; final release artifact: `release/CV-Tailor-Setup-0.3.0.exe`, installed from that installer into the isolated `release/cv44-final-installed/` directory. No normal user-data was read, changed, or replaced.

- `npm run typecheck` passed.
- On merged `main`, `npm test -- --maxWorkers=1` passed: **41 files, 191 tests**. Parallel suite load had once hit the production 5-second PDF worker deadline; serial execution passed without relaxing that deadline.
- On merged `main`, `npm run test:electron`: **37 passed, 3 skipped** (the two generic installed-app gates plus the separately gated native-picker test are intentionally skipped in this run). It covered the integrated PDF/DOCX import, populated merge, AI safety, profile JSON, backup/restore and app behavior.
- On merged `main`, `npm run dist:win` completed, including pinned bundled-LaTeX verification, Electron-ABI SQLite source/package checks, and v0.3.0 NSIS installer generation.
- The separately gated Playwright release test launched the actual v0.3.0 installed executable with a new isolated `--user-data-dir`. The user selected synthetic PDF and DOCX files in the real Windows OS picker and applied each visible review. In that same workspace, it exported valid profile JSON (without provenance fields), created/restored a complete workspace backup (retaining accepted provenance, excluding unfinished import preview and a dummy credential), then reopened the same executable and data directory. The reopened profile matched the accepted snapshot. Evidence contains only status and counts (2 skills, 2 experience records, 0 projects/education); no CV contents or credentials.
- Installed Profile screenshots were captured from that imported test workspace at desktop light, desktop dark, and 375px dark (`test-results/cv44-final/profile-light.png`, `profile-dark.png`, `profile-dark-narrow.png`). Visual review confirmed the existing Profile structure remains intact; toolbar and section navigation stay reachable and controls stack without page-level horizontal overflow at 375px. The human-readable source-review and proposal-selection interactions are exercised by the existing visible PDF/DOCX Electron flows; no new Profile information architecture or CV-template changes were introduced.
- The earlier inconclusive empty-workspace observation above is superseded: the final run on merged `main` bound real picker actions, Apply, profile read, backup/restore, and subsequent reopen to one isolated installed-app user-data directory. No claim of perfect extraction or factual correctness is made.

The `CV44_RESUME_AFTER_IMPORTS=1` mode exists only to resume the final isolated gate after successful manual picker/apply steps if later checks fail; it refuses to run without the pre-existing isolated directory. The normal gated mode refuses to reuse existing user data and requests both manual OS-picker selections. Screenshot/evidence files in `test-results/cv44-final/` are ignored local artifacts, not committed fixtures.


## Commands

```text
npm ci --no-audit --no-fund
npm run typecheck
npx vitest run tests/draft-records.test.ts -t "CV-only CRUD covers every record section"
npm test
npm run prepare:latex
npm run test:electron
npm run dist:win
CV_TAILOR_INSTALLED_EXE='E:\\cv-tailor-cv-upload-44\\release\\installed-user\\CV Tailor.exe' npx playwright test tests/electron/installed.spec.ts
CV_TAILOR_INSTALLED_EXE='E:\\cv-tailor-cv-upload-44\\release\\installed-user\\CV Tailor.exe' npx playwright test tests/electron/installed.spec.ts -g 'opens and writes SQLite' --timeout=90000
```
