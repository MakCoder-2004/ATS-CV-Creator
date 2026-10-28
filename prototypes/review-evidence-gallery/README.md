# Review evidence gallery

Implementation handoff for the approved Inline evidence concept: [IMPLEMENTATION-HANDOFF.md](IMPLEMENTATION-HANDOFF.md).

Open this directory's `index.html` directly in a browser or double-click it. It is a self-contained static HTML/CSS/inline-JS concept; no server, packages, network access, or application changes are required. Local Manrope/Sora WOFF2 assets and their licenses are in `fonts/`; Lato WOFF2 assets are loaded from `resources/fonts/lato/`.

## Five interaction concepts

1. **Inline evidence** — select CV wording; its cited source and inclusion reason appear immediately beneath it on the paper, with a dismiss control.
2. **Review inbox** — inspect reporting/data-quality and cautious job-match prompts alongside an affected CV excerpt; route each task to matching wording and source without a score.
3. **Compare mode** — choose among three source-backed claims for spacious side-by-side reading; Back to document returns to the inline paper.
4. **Section navigator** — move between Education, Experience, Projects, and Technical skills in a paper-like section view, with contextual source notes and full-CV access.
5. **Guided pass** — review one claim at a time; Read source toggles its citation, Next claim updates both texts, and full-CV access stays available.

The application shell, tokenized light/dark palette, 220px rail, 68px desktop header, workflow stages and white Letter-proportioned Lato paper follow the approved CV Tailor design system. Inline evidence uses a 660px document track and a wider details column where space permits; its prototype details become an on-demand overlay at 1350px and below. The other concepts are independent alternatives, not production layouts. Every concept uses the same fictional Mara Venn / Northstar Labs examples and sources.

## Limits

This is an IA/interaction study, not production behavior. All CV, source, posting, and task content is fictional. No factual checks, fit measurement, approval, save, export, provider call, or real edit occurs. Prototype action buttons state that they are illustrative. Appearance, concept selection, keyboard arrow navigation, and Escape-close behavior are implemented locally in the page. The gallery itself has no production dependencies; see [implemented workflows](../../docs/workflows.md) and the [page contract](../../design%20system/pages.md) for the separately implemented real Review behavior.
