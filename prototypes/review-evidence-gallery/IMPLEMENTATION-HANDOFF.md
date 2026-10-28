# Approved review-evidence refinement — implementation handoff

**Historical design handoff (prototype-only at the time).** The approved choice is **Inline evidence** (gallery variant 1), after CSS tweaks. Variants 2–5 are alternatives, not approved. This handoff records the original design decision; current production behavior and gates are documented in [`docs/workflows.md`](../../docs/workflows.md) and [`design system/pages.md`](../../design%20system/pages.md).

## Goal and approved behavior

Reduce the cramped, misaligned feel of Review details while keeping the existing CV Tailor shell, Variant A visual language and real review workflow. Keep Manrope UI, Sora headings, shared design-system tokens, and a white Lato CV paper in both app themes.

- Keep the full, left-aligned structured CV as the workspace anchor. Use a 660px document track, paper up to 612px wide, readable existing CV type, and a 20px gap. The right Review details column takes the remaining available width (about 484px at a 1440px viewport), rather than staying fixed at the current 304px/380px sizing. Do not shrink the paper to make room.
- On selection of a CV paragraph/wording, show its **source and why it appears** immediately beneath that selected paragraph, within the structured review document. This is review-only context: never add it to canonical draft content, approval/export/PDF, or page-fit data. Provide a dismiss action. Preserve the existing selection/source inspector and its capabilities.
- Give Review details four named views—Sources, New skills, Job match, Checks & options—in a 2×2 grid of 44px controls. Use 24px panel padding and 14px body text. Retain the review bar, real skill/check/page-fit/wording/approval gates and accessible navigation to them; do not copy the prototype's simulated statuses/actions.
- At widths at or below about 1350px, or whenever the available container cannot fit the full paper plus a useful details column, keep the full paper and reveal Review details only on request in a native, accessible dialog. Escape closes and focus returns to the opener/selected wording. Prefer container-aware fit if viewport breakpoints do not reflect the actual workbench width.
- Narrow layouts must not introduce horizontal page overflow. CV paper remains white in dark mode.

## Production boundary and implementation map

The gallery is static HTML with fictional fixture content and demo-only actions; its CSS/JS demonstrate layout and interaction intent, not production behavior. Build against existing production data and gates—do not transplant its fake check, fit, approval, or export states. At handoff time the design-system review contract specified an optional 304px details column at 1200px and requested dialog below. The 660px paper-track/remaining-width column and inline source placement intentionally differed; the current page and token contracts now describe the implemented responsive behavior.

Likely production touchpoints:

- `src/renderer/WorkbenchStageLayout.tsx` — review composition, selected wording/evidence, panel views, and existing review gates.
- `src/renderer/SelectedReview.tsx` — preserve source/rationale and edit/record actions when integrating inline context.
- `src/renderer/ReviewContextPanel.tsx` — accessible wide/narrow panel and dialog behavior, Escape/focus restoration.
- `src/renderer/ReviewActionBar.tsx` and `src/renderer/review-workspace.css` — sticky bar, measured scroll margin, responsive workspace/paper/panel sizing.
- `src/renderer/DraftReview.tsx` — selectable structured document and its existing selection affordances.
- `design system/pages.md` (and tokens/interaction docs only where the shared contract actually changes) — intentional design-system exception becomes the new contract.

Avoid duplicating or detaching the real selected-review inspector functionality; choose the smallest production integration that makes evidence inline while keeping these existing controls and all gates reachable.

## Focused validation for implementation day

1. Run focused renderer tests/typecheck relevant to touched review components, plus `git diff --check`.
2. Do one visual check of the real review screen at 1440px and a narrow/container-constrained width: full paper remains readable, details fit or open on demand, no horizontal overflow, and sticky actions remain usable.
3. Verify selection reveals only review context (dismissible), and dialog Escape/focus return works. Confirm real skill/check/page-fit/acknowledgment/approval gating remains intact.

No broad Electron, provider, installer, or package validation is requested for this focused layout refinement.

## Provenance

Worktree: `E:/cv-tailor-review-gallery`, branch `design/review-evidence-gallery`, base/current prototype commit `468b648`. Approved visual reference: `prototypes/review-evidence-gallery/index.html`, `data-idea="inline"` / “1 · Inline evidence”. Other gallery concepts are not approved. `prototypes/review-evidence-gallery/CONCEPTS.md` has pre-existing unrelated dirty changes; it is not part of this handoff and must remain untouched. No production change, test run, issue update, PR, or merge is included.
