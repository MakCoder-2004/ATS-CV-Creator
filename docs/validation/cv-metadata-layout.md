# v0.2.1 — education and project metadata

User-approved refinements to the supplied-template CV:

- Education places an explicit GPA/CGPA opposite the degree, right-aligned beneath the dates. A duplicate year range is removed only when it matches the authoritative education dates. Denominators and distinct substantive wording are preserved; ambiguous/conflicting grades remain prose. Stored source facts are unchanged.
- Project hyperlinks occupy the right heading column alongside the project name/tools, not a separate bullet. A new template helper permits long left-hand text to wrap while links remain at the top right. Link targets remain live.
- Selectable review, canonical reading order, PDF and editable Word reflect the same metadata. Template revision 2 invalidates prior page-fit/approval hashes so the changed layout is remeasured and reviewed without requiring a new model generation.

## Verification

- Typecheck: passed.
- Full Vitest suite under Electron ABI: **133 passed**.
- Full Playwright suite, including genuine installed-app compilation and SQLite reopen: **22 passed**.
- Real PDF coordinates assert that CGPA shares the degree baseline, sits below dates, and has the same right edge. Project link baseline matches the project heading and precedes accomplishment bullets.
- The updated full CV flow includes an Alexandria University education fixture with `CGPA: 3.3 | 2023 - 2027` and a project GitHub URL. Export screenshot `test-results/latex-compiled-preview.png` was visually inspected: dates appear once, CGPA is beneath them, and GitHub appears in the heading with no link bullet. Screenshot files remain ignored.
- Original supplied placeholder-template comparison remains exact: **0 differing channels of 7,755,264 at 2× rendering**; existing template commands were not changed.
- Source and packaged SQLite/compiler verification and template smoke compilation passed through `npm run dist:win`.

## Installation

Built `release/CV-Tailor-Setup-0.2.1.exe` and, with the user's explicit confirmation, installed it into `%LOCALAPPDATA%\Programs\CV Tailor`. Installer exit code: 0. Isolated installed-app tests passed, then the app was reopened normally for user testing. Existing user data was not replaced or removed.

Installer SHA-256: `41a2e9213325328556fc95abc93de3e8c82aead7e8d84ff8ca6a0dc715918ae9`.

No live model requests were needed for this deterministic layout verification. Existing drafts can use the revised layout after reopening, checking page length and renewing approval.
