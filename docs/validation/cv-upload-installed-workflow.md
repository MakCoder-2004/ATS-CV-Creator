# CV upload release-gate verification

**Date:** 2026-10-22  
**Code under test:** integration tip `0bc451c747b2945dce81dea92a39134125c4e94c` (`feat/cv-upload-44`)  
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

## Gates not completed; issue remains open

- **Native file picker in installed app:** attempted, not verified. I added a bounded (20-second) Windows UI Automation probe after the installed app's visible Upload CV button opened its picker. A first probe failed because this Windows environment does not expose the `Win32_Process` CIM class; a revised probe enumerated UIA top-level windows and required a `#32770` Open dialog whose native owner PID matched the installed app. It timed out without finding such a safely attributable dialog. No file was selected, no dialog was overridden, and no claim is made that the picker works. Completing this gate requires a human to select the provided synthetic fixtures (`release/cv44-manual-fixtures/synthetic-cv.pdf` and `synthetic-cv.docx`) in the installed app (or a reliable automation path that can prove native-dialog ownership), then complete review/apply and verify reopen/JSON/full-backup restore. The installed executable is `release/installed-user/CV Tailor.exe`; for isolated data, launch it with `--user-data-dir=E:\\cv-tailor-cv-upload-44\\release\\cv44-manual-userdata`.
- **Profile screenshot review:** captured installed-app screenshots of My profile at 1440px light, 1440px dark and 375px dark: `cv-44-profile-light.png`, `cv-44-profile-dark.png`, `cv-44-profile-narrow.png`. Visual review found the current Profile structure intact; toolbar controls wrap and stack at 375px, fields stack, the section navigation remains reachable, and no page-level horizontal overflow is visible in the captures. These are blank-profile screenshots, not import-review content screenshots.
- Consequently, this is partial release evidence, **not** completion of #44. Do not close or edit the issue until the native-picker installed import round-trip is verified.

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
