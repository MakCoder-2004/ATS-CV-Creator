# Browser inspection record

Scope: one-off browser-driving and visual inspection of throwaway code, **not** a committed automated test suite, production verification, Electron E2E, or human usability validation.

## Completed

- `npm run prototype:typecheck` passed.
- `npm run prototype:build` passed; the all-in-one exploratory JS bundle emits a >500 kB warning. It was not hidden or treated as a production performance result.
- `npm audit --omit=dev` reported zero vulnerabilities at inspection time. This is not a security certification.
- Launched Microsoft Edge headlessly through Playwright with reduced motion enabled; captured screenshots and inspected desktop layouts and the narrow Workbench image.
- All A/B/C document views fit widths 1440, 1024, 768, 390, 375, and 812 CSS pixels without page-level horizontal overflow; the 812px capture used a 375px landscape height. The stage strip intentionally has its own horizontal scroll on narrow screens.
- Profile, Settings, and Saved jobs fit at 375px in all three variants.
- Fixed an observed 7px Workbench overflow caused by a CSS pseudo-label on collapsed navigation; accessible button names remain present.
- No page exceptions or failed page-resource requests in the final responsive run. No external page requests observed in the end-to-end browser workflow; assets/fonts were local.

## Visible-interaction paths inspected

- Regeneration opens proposed/current wording; acceptance invalidates checks/approval; rejection leaves existing wording.
- Rechecks → whole-document approval → export buttons enabled → explicit simulated/no-file-written feedback.
- Unsupported-claim fixture blocks approval; supported-wording replacement returns through checks.
- Overflow blocks one-page approval; explicit two-page choice or accepted proposed cut resolves the demo fit state.
- Changed-source fixture blocks checks until source comparison is acknowledged. Historical source text remains inspectable beside its newer revision.
- 429 fixture resumes explicitly; offline fixture can resume/cancel; cancellation stops further timer-driven steps.
- Exhausted request budget prevents continuation; increasing the demo cap in Settings permits explicit resume.
- Empty workspace → required-field validation → save fictional job → payload consent → simulated generation → review.
- Profile name edits update CV preview; source edits mark existing draft stale.
- Arrow key within a paragraph textarea does not switch variants; outside editable controls it does. Variant survives reload through URL.
- Guided source modal → regeneration → reject → Escape; skill-inventory evidence dialog opens/closes.
- Restore preview requires explicit replacement acknowledgement before its demo action.

## Workbench theme/font refinement inspection

- User prefers A; added URL-stable light/dark modes, Sora Variable headings at 750, and Manrope Variable UI text. Both fonts loaded from local assets.
- Typecheck and build passed again. The existing throwaway bundle-size warning remains.
- Both modes fit 1440, 1024, 768, 390 and 375px widths, with the appearance control visible. Profile, Settings and Saved jobs also fit at 375px in both modes.
- Explicit light appearance overrides dark OS preference; dark mode survives reload via URL. Switching retains current edits and an already-approved document.
- White CV background and Arial document font were checked at each width in both themes. App dark mode never inverts the document.
- Dark regeneration modal, keyboard Escape dismissal, profile fields, Settings, backup preview and consent gate were exercised through visible UI.
- Twelve sampled normal-text foreground/background pairs per theme all exceeded 4.5:1; the minimum sample was the white CV footer at 4.76:1. This is not a complete contrast/a11y audit.
- No page exceptions or external page requests observed in this refinement run.
- Captured desktop/narrow light+dark views and dark consent/settings/diff states. The user subsequently explicitly approved A’s visual direction, themes and typography; see FEEDBACK.md.

## Not established by this inspection

- Detailed interaction usability or production correctness. Visual approval came directly from the user, not from this browser inspection.
- Full accessibility/WCAG compliance, screen-reader audit, color-contrast audit, all zoom levels or touch-device usability. Narrow paper preview is intentionally dense and may need a separate readable editing surface in production.
- Semantic claim faithfulness, complete schema coverage, actual redaction, consent-enforced provider envelopes or privacy/terms compliance.
- Correct job matching: generated wording and coverage are fixed examples, even for a new posting.
- Actual A4 pagination, DOCX/PDF parity, real selectable PDF text, hyperlinks, ATS parser behavior, or local file operations.
- SQLite durability, migrations, safeStorage, native-module ABI, restart recovery, real quota handling, real cancellation, timeouts or installer behavior.
- The prototype accepts arbitrary edited paragraphs through its scripted check unless they contain the known unsupported fixture strings. The UI explicitly labels this limitation; never treat a passing demo check as evidence of truth.

Screenshots are observations of particular fixture states, not approvals by themselves. The user’s explicit visual approval of A, light/dark and Sora/Manrope is recorded in FEEDBACK.md. All artifacts remain on the throwaway prototype branch; production functionality and detailed interaction validation remain separate.
