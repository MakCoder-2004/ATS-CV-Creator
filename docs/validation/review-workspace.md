# v0.3.0 — review workspace, manual records and qualification comparison

## User requirements

- Keep the CV readable, with professionally aligned sections and discoverable review/page-length/approval actions.
- Add, edit and remove Education, Experience, Projects and Skills during review.
- Offer **This CV only** or **This CV and my profile** for each operation.
- Stop categorically reporting qualifications as missing when related education, projects or skills exist in the saved profile.

## Design and interaction

Used the requested frontend-design and ui-ux-pro-max skills alongside the normative design system. Retained the existing palette (`#F3F5F8` canvas, `#FFFFFF` surface, `#202D40` ink, `#59687D` muted, `#315DCC` interactive, `#D8DFEA` structure), Manrope UI, Sora headings and the separate white Lato CV artifact.

The refinement keeps Variant A's document/inspector relationship but moves workflow completion into a compact persistent review bar. It shows actual check/skill/page-fit state, a plain next action and the wording acknowledgment. Page-fit suggestions are a separate disclosure, so opening a long cut list cannot turn the sticky bar into an oversized overlay.

The review paper stays readable rather than shrinking to preserve an inspector column. Wide windows may show a 304px context panel; narrower windows give the document the full workspace and open details in a native dialog. Sources, New skills, Job match and Checks & options are separately named views. Native editor dialogs have labeled fields, inline validation, explicit save scope, a manual-fact declaration, sticky save actions, Escape handling and focus restoration. Empty sections expose Add actions in review only.

Visual checks covered desktop light, narrow/mobile dark, reduced motion, viewport bounds, persistent actions while reading the document bottom, source dialog return focus and editor Escape restoration. Viewport screenshot inspection caught and corrected inherited vertical navigation and stretched paired form fields. Full-page captures can reposition sticky elements; viewport captures are the visual authority for the inspector's real placement.

## Data and safety

- CV-only facts use frozen manual-provenance snapshots. Profile records stay unchanged unless explicitly selected as the save destination.
- Profile changes, nested evidence history and the new draft revision commit atomically. Draft/source revision checks reject stale overwrites; failed writes roll back.
- A CV-only variation of an existing record retains its frozen profile origin. Applying it to the profile later updates the original record rather than creating a silent duplicate. Genuinely new CV-only records can be added as new profile facts.
- Grouped legacy paragraphs are edited/removed together. Parent snapshots are frozen when generation cites child facts, and parent revision changes invalidate the dependent CV even when the child fact itself is unchanged.
- Every record mutation invalidates approval and page fit. Existing generation/semantic failures are retained; manual editing is not a blanket bypass of factual checks.
- A manual skill declaration resolves a matching suggestion without duplicate export entries. Posting provenance remains available to block unsupported claims of using that skill in a historical role.
- Technical IDs/revisions are excluded from numeric factual evidence; a digit in a UUID must never authorize an invented quantity.
- Saved drafts receive fresh local source checks on opening. A changed source does not remain presented as ready for export merely because an older revision was approved.

## Qualification comparison

The former check required near-verbatim whole-sentence matches in the CV and its selected evidence. The new advisory assessment also consults the full current profile and cited draft-local facts. It recognizes common degree/field alternatives, BS/B.Sc. variants, saved skill names and selected technical aliases, and shows the supporting source names.

The exact reported Bachelor's degree / Computer Science / Data Science case has regression coverage. Degree and field support must come from one education record; future graduation dates leave completion for review. Related ML knowledge does not automatically establish production deployment, requested tenure or every clause of a composite qualification. Unrelated ML, production and deployment records cannot be stitched into one production-ML claim.

Statuses distinguish relevant evidence, partial evidence and requirements needing a closer look. They do not claim a person lacks a qualification or show a hiring/ATS score. Related evidence linked in the CV is distinguished from evidence only in the profile. This remains a bounded local heuristic, not a universal semantic evaluator; ambiguous responsibilities and soft skills still require human assessment.

Local assessment refreshes after edits and offline reopen without provider requests. Frozen CV content/history remains unchanged; advisory comparison can legitimately change when profile facts change. No live provider was used for validation.

## Verification and installation

- Typecheck: passed.
- Full Vitest suite under Electron ABI: **159 passed**, 35 files.
- Full Playwright suite: **23 passed**, including actual installed-app SQLite reopen and bundled pdfLaTeX compilation.
- New public API regressions cover both scopes across all sections, history, rollback, stale writes, manual exportability, parent dependencies, profile-origin updates, skill suggestion handling and full-profile qualification refresh.
- New visible Electron flow adds/edits/removes records, verifies profile scope consequences and unchanged provider usage, reloads the saved CV, checks the actual PDF and completes approval.
- Supplied placeholder template comparison: **0 differing channels of 7,755,264 at 2×**. The PDF template itself was not redesigned.
- `npm run dist:win`: passed source/packaged SQLite and compiler verification.

Built `release/CV-Tailor-Setup-0.3.0.exe`. With explicit user permission to close the app, installed it into `%LOCALAPPDATA%\Programs\CV Tailor` (installer exit 0), ran isolated installed-app checks, confirmed installed ProductVersion `0.3.0.0`, then reopened normally. Existing user data was not replaced or removed.

Installer SHA-256: `06a3407e21513e6cdc282ec2b4a30bd5317e213a18f90199661a8df148105a45`.

Ignored visual artifacts include `test-results/review-ux-context-viewport.png`, `review-ux-light.png`, `review-ux-dark-narrow.png`, `review-ux-dark-mobile.png` and `review-record-editor.png`.
