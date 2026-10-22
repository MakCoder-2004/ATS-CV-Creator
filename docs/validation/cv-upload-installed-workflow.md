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

- **Native file picker in installed app:** not yet verified. Existing visible import Electron tests substitute the dialog result; they are not evidence of the operating-system picker. No real installed PDF/DOCX selection/apply was performed, and I did not substitute a mocked/overridden picker for this gate. Completing this requires interacting with the native Windows picker in the installed app (select synthetic PDF and DOCX, complete reviewed apply, then verify reopen/JSON/full backup restore). If no safe non-human UI automation is available, the user's OS interaction is required.
- **Profile screenshot review:** no new installed-app screenshot pass was captured/reviewed for the import flow in both themes and narrow widths. Existing renderer/profile E2E tests passed, but they do not close this visual evidence gate.
- Consequently, this is partial release evidence, **not** completion of #44. Do not close or edit the issue until the native-picker installed import round-trip and Profile visual review are verified.

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
