# v0.2.0 — supplied-template LaTeX export validation

## Approved behavior

- Content-only, evidence-linked generation; no model-authored LaTeX or repeated template boilerplate in requests.
- Supplied Letter/Lato template: heading, Education, Experience, Projects, Technical Skills. No generated headline, professional summary or Certificates in CV output; saved profile facts remain intact.
- Concise role/project bullets with parent-specific citation validation and one bounded correction request. Legacy paragraphs belonging to one role/project share one heading while retaining their own review/edit targets; grouped page cuts remove all corresponding draft items.
- Selectable review layout is not a pagination promise. Export displays the actual compiled PDF; measurement, preview and export reuse the same bounded local compiler. Word remains editable and may reflow.

## Compiler and fidelity

Pinned TinyTeX-1 v2026.10 / TeX Live 2026, pdfTeX 3.141592653-2.6-1.40.29; 132 installed package records match `resources/latex-toolchain-lock.json`. The prepared tree is about 361 MiB; it lives in ignored `.tools/latex` and is copied physically into the installer, not referenced through a developer path or dependency junction. Runtime export does not invoke package installation.

The checked-in template sources and supplied `CV/cv_Template.pdf` were compared with:

```bash
node scripts/compare-latex-template.cjs 'CV/cv_Template.pdf'
```

Result: **1 Letter page, 2× PDF.js render, 0 differing channels of 7,755,264**. This compares the supplied placeholder document, not changed CV content against unrelated reference text. The external reference PDF remains user-owned and is not committed.

Extended Latin text selects the template's Lato T1 encoding so names such as “Zoë” and words such as “résumé” extract correctly. Layout macros, margins, typeface and paper size remain unchanged. Unsupported glyphs, malformed output and substantial margin overflow fail closed instead of silently exporting missing content. Text extraction, reading order, hyperlinks, page target and current approval are checked locally.

## Final checks

- `npm run typecheck`: passed.
- Full Vitest suite under Electron's matching Node ABI: **130 passed**, including real compiler integration.
- Full Playwright suite with the genuinely installed executable: **22 passed, none skipped**.
- `npm run dist:win`: passed; source and packaged native SQLite both passed a real query under Electron ABI 140; packaged compiler/package/license checks and template smoke compilation passed.
- Actual NSIS installer completed with exit code 0. Installed app was exercised under an isolated `--user-data-dir`: theme and native SQLite persisted across close/reopen; a draft created through public dev APIs with a deterministic scripted transport reopened in the installed app; its installed compiler produced a selectable Letter PDF with correct accented text and links. Visible review, skill decision, page measurement, approval and fully rendered PDF canvas also passed there.
- Screenshot checks covered desktop and narrow/mobile review, dark paper isolation and the actual compiled export preview. PDF preview tests wait for rendering completion, not merely canvas creation. PDF.js's legacy browser/worker builds are used for Electron 39 compatibility; modern builds require unsupported `Map.getOrInsertComputed`.
- Temporary source cleanup, fixed executable/no shell invocation, deadlines, compiler integrity failure, output escaping, PDF/Word parity, cancellation, overwrite preservation, consent scope, factual findings and interrupted-run recovery are covered by regressions.

Reproduction commands (after provisioning dependencies):

```bash
npm run verify:latex
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe node_modules/vitest/vitest.mjs run
CV_TAILOR_INSTALLED_EXE='<genuinely installed CV Tailor.exe>' npx playwright test
```

Local screenshot artifacts (ignored): `test-results/latex-compiled-preview.png`, `test-results/installed-latex-preview.png`, and `test-results/review-ux-*.png`.

## Installer artifact

- `release/CV-Tailor-Setup-0.2.0.exe`
- Size: 243,004,872 bytes (about 232 MiB).
- SHA-256: `2a0df89a7f4fafdcdf446485ae9f09f84149b3e524f7ddcef74b42659ff780bd`.
- Authenticode status: **NotSigned** (personal unsigned build).
- Actual validation installation: `%LOCALAPPDATA%\Temp\CVTailorLaTeX020Install\CV Tailor\CV Tailor.exe`. User profile data for tests was isolated and removed afterward; the tested app installation remains available.

## Limits

No paid/live model request was made for these deterministic regressions; they do not certify the quality of every future model response or guarantee an ATS ranking. All compilation dependencies were local, but physical network disconnection/firewall isolation was not tested. The child-process restrictions are not a full operating-system sandbox. Third-party license texts and a package inventory ship with the app; public redistribution still requires a full legal review and deliberate compiler/package update policy.
