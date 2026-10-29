# Review panel removal and cover-letter diagnostics

## Confirmed scope

The maintainer requested complete removal of **Checks & options** from Review evidence, then selected **Panel only**: keep document editing and the existing check/page-fit/approval bar.

The fourth navigation control, notes panel, whole-section/paragraph AI wording suggestions and alternate-title proposal controls are removed, not hidden or renamed. Sources, New skills and Job match remain. Actual findings open from Review issues beside the review bar; wording and full records remain editable through the document and Sources. An existing CV title keeps local editing/removal in a small toolbar-opened dialog. Create another CV remains available from the document toolbar. Export and backend compatibility APIs/history remain intact.

The two Electron specifications devoted solely to the retired regeneration UI were removed; backend regeneration tests and dated installed-validation reports remain historical/compatibility evidence. Other affected UI cases/helpers were adapted to the retained controls, not broadly rerun.

## Focused verification

- Typecheck and build passed.
- `npx playwright test tests/electron/review-ux.spec.ts --workers=1`: one test passed. It checks the absent fourth category/panel and regeneration affordances, retained three views, title editing/removal without profile changes, source-backed local wording editing, review bar, desktop/narrow layouts, both themes, keyboard/dialog focus and overflow.
- Eight targeted cover-letter diagnostic checks passed under Electron-as-Node without changing the native SQLite ABI. The first integration assertion compared a stored CV with a read model that adds `coverage.stale`; it was corrected to assert raw stored CV equality separately and compare like-for-like public read models across reopening.

Evidence: `.audit/cover-letter-template/review-panel-{typecheck,build,visible}.log`, `.audit/cover-letter-template/letter-failure-diagnostics.log`, and retained screenshots in `.audit/review-panel-removal/`.

## Separate letter failure boundary

Earlier reported letter attempts retained only failed status, so their exact underlying rejection cannot be recovered. An offline clone with a synthetic valid response passed the letter-only request/save path; that is not a real-provider reproduction or proof that the original rejection is fixed.

New failed operations persist only a fixed diagnostic category, never rejected prose or raw provider errors. Their safe explanation survives reopening. The generation prompt now explicitly specifies positive source ordinals (not CV indexes), concise length and source-supported names, placeholders, numbers and skills. It uses generic application-context wording rather than encouraging unsupported target-company placeholders in the body. Existing privacy/factual checks, consent and no-automatic-retry behavior remain.

The real-provider rejection still needs one fresh, explicitly authorized letter-only attempt. No CV regeneration, real-provider retry, installer, installation or merge was performed during this patch. No repeated full suite or broad review round is claimed.
