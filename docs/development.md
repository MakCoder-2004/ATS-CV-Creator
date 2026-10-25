# Develop and verify CV Tailor

Use this guide to change the Windows Electron app and check an installed build. The commands come from [`package.json`](../package.json) and [`playwright.config.ts`](../playwright.config.ts). A local development run does not validate the installer.

## Set up the workspace

1. Install the locked dependencies with `npm ci`.
2. Provision the pinned local pdfLaTeX toolchain with `npm run prepare:latex` when you need PDF compilation or packaging. The toolchain lives in ignored `.tools/latex`. The provisioning script runs at build time, not in the installed app.
3. Run `npm run verify:latex` to check the toolchain, package inventory, licenses, and template smoke compilation.
4. Run `npm run dev` for the Electron application. Run `npm run prototype` only to inspect the browser-only UI prototype; it is not the installed application.

The source for the app is under `src/`. Change the contract in `src/shared/`, expose a typed method in `src/preload/index.ts`, register its trusted IPC handler in `src/main/index.ts` or a focused IPC module, and then call it from `src/renderer/`. Keep test-only scripted transports in unpackaged development. For renderer changes, read the [design system](../design%20system/README.md) and the relevant page, token, and interaction contracts before changing the UI.

## Run checks in ABI order

1. Run `npm run typecheck` and `npm run build` after changing TypeScript or Electron wiring.
2. Run `npm test`. This command rebuilds `better-sqlite3` for Node, then runs Vitest tests under `tests/` with one worker so parallel test files do not compete with the app's fixed PDF and posting-extraction deadlines on Windows.
3. While the binding still targets Node, repeat a focused test with `npx vitest run tests/<file>.test.ts` or use `npm run test:fast` for the full suite.
4. Run `npm run test:electron` for Playwright Electron tests under `tests/electron/`. The script builds the app, rebuilds `better-sqlite3` for Electron, and runs the serial suite.
5. If you return to Vitest after step 4, run `npm test` again before `npm run test:fast`.
6. Run `node scripts/check-doc-links.cjs` after Markdown changes. The check verifies local link targets; it does not validate external URLs or anchor fragments.

Node and Electron require different native SQLite binaries. Do not run the Node and Electron suites concurrently against the same `node_modules`. A successful TypeScript build does not prove that a native SQLite binding will load in Electron. [`scripts/verify-electron-sqlite.cjs`](../scripts/verify-electron-sqlite.cjs) runs a real in-memory query under Electron; use `npm run rebuild:electron` before its source check if the binding was last built for Node.

The Vitest suite exercises workspace and domain contracts through `createWorkbench`, including consent, cache/run binding, citation checks, migrations, backup, and exports. Playwright exercises visible Electron flows through the public preload API. [`tests/electron/installed.spec.ts`](../tests/electron/installed.spec.ts) requires `CV_TAILOR_INSTALLED_EXE` and skips when that variable is absent; an unpacked executable does not satisfy that test's installation claim. No tracked CI workflow is present, so run and record the relevant checks for each change.

## Build and validate a Windows installer

1. Use physical dependencies and the prepared LaTeX assets. Do not package through a `node_modules` junction.
2. Run `npm run dist:win`. It verifies LaTeX, builds the app, rebuilds and verifies SQLite under Electron, creates the NSIS installer under `release/`, and verifies the packaged SQLite binding and compiler. Consult [`scripts/verify-latex.cjs`](../scripts/verify-latex.cjs) and `scripts/verify-electron-sqlite.cjs` when a check fails.
3. Install the **actual** NSIS installer on the user's confirmed fresh Windows machine. A separate VM is not required for the accepted release check.
4. Open the installed executable with isolated user data. Save a profile or appearance change, close the app, reopen it, and confirm persistence through native SQLite. For Pi model work, sign in through Pi on that Windows machine and select a supported model and thinking level. Exercise posting analysis, cited CV review, regeneration, PDF and DOCX structuring, and export. Confirm that missing local login and unsupported effort fail before dispatch. A terminal-only environment key does not prove the installed GUI can authenticate. Run the installed Playwright test with `CV_TAILOR_INSTALLED_EXE` set to the genuinely installed executable when applicable.
5. Record the installer version, tested executable, checks run, and what was observed. Separate a packaged build check from an installed-app check.

The NSIS installer is per-user by default and may trigger an unknown-publisher warning because it is unsigned. `.tools/latex`, test results, and `release/` are generated local artifacts. The runtime compiler does not fetch packages during export. An app build is not a public release, and the included third-party notices are not a complete redistribution review. See [LaTeX provisioning research](research/latex-pdf-compilation.md) and [installed export validation](validation/latex-export.md) for the scope of earlier observations.

## Find the right test and owner

- For posting intake and SSRF limits, inspect `src/main/safe-posting-fetch.ts`, `tests/safe-posting-fetch.test.ts`, and the link-intake Electron tests.
- For Pi model selection, consent, cache, or recovery, inspect `src/shared/pi-model.ts`, `src/main/pi-model.ts`, `src/main/pi-workbench-dispatcher.ts`, `src/main/workbench.ts`, and the focused Pi workbench tests.
- For wording, citations, page fit, or approval, inspect `src/main/source-linked-generation.ts`, `src/shared/draft.ts`, `src/shared/document.ts`, and the review and export tests.
- For profile import or backup, inspect the focused `src/main/*-ipc.ts` modules and matching `tests/` and `tests/electron/` cases.
- For a changed installer, run the actual installed executable and verify its SQLite reopen and bundled compiler. Build-only or source-only checks do not replace this step.
