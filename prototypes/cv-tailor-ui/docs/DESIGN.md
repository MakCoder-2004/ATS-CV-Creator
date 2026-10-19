# Throwaway UI design exploration

## Question

Which desktop information architecture best supports a truthful, privacy-aware CV tailoring workflow: a persistent workbench, a guided desk, or a document-first review room?

Three structurally different variants share `/prototype?variant=A|B|C`. There is no existing app/route to host this exploration. This browser-only prototype precedes Electron scaffolding, `/to-spec`, and `/to-tickets`. The user explicitly approved **A — Workbench with light/dark modes, Sora headings and Manrope interface text** after the requested refinement. This settles the visual direction, not production correctness or comprehensive interaction usability.

## Compact design plan

| Variant | Layout and hierarchy | Palette | Type |
| --- | --- | --- | --- |
| A — Workbench | Persistent job sidebar; editable paper in the center; evidence and gaps in a right inspector. Navigation and draft context remain visible. | Canvas `#f3f5f8`, paper `#ffffff`, ink `#202d40`, action `#315dcc`, muted `#59687d`, line `#d8dfea` | Refined: locally bundled Sora Variable headings + Manrope Variable UI; Arial in the CV |
| B — Guided desk | Top-level navigation; sequential stage rail; one focused task at a time; compact document/context alongside. The primary next action follows the stage. | Canvas `#eff5f2`, paper `#ffffff`, ink `#183b33`, action `#17654f`, muted `#526c63`, line `#d1e0d8` | Original IBM Plex Sans UI; Arial document |
| C — Review room | Document-first horizontal ribbon; evidence ledger on the left, paper center, requirements on the right. Editing and source inspection outrank job navigation. | Canvas `#202638`, paper `#ffffff`, ink `#edf0fa`, action `#536dc4`, muted `#b8c2da`, line `#46516b` | Original IBM Plex Sans UI; white Arial CV stays unchanged |

All variants are left-aligned except the centered name/headline in the reference-derived CV. Sections, work history, projects and factual evidence use real product vocabulary. Evidence connections—not dashboard stats—are the memorable element. No marketing hero, gradients, decorative metric cards, external font requests, or automatic animation.

## Critique before implementation

The local design-system search returned landing-page patterns twice, unsuitable for this desktop editor. Those patterns were rejected. Its minimal/flat workspace, focus visibility and contrast guidance remain relevant; the layouts above are brief-specific hypotheses, not validated database recommendations. A generic rounded-card dashboard would hide the main question: can the user move between job requirements, CV wording and evidence without losing context? Each variant therefore changes where that context lives, not just its color.

## Workbench refinement plan

Preserve the selected Workbench structure: saved jobs left, CV center, evidence right. Spend the new visual emphasis on typography rather than decorations or a redesigned layout.

- **Light:** retain the familiar cool canvas `#f3f5f8`, white surface `#ffffff`, ink `#202d40`, action blue `#315dcc`, supporting text `#59687d`, and line `#d8dfea`.
- **Dark:** canvas `#111827`, surface `#192338`, raised surface `#23314b`, ink `#ecf1fb`, supporting text `#b6c2d6`, action blue `#4364cf`. Links/focus use lighter blue separately so button-fill contrast does not dictate text contrast.
- **Typography:** locally bundled Sora Variable at 700–750 for brand/page headings; Manrope Variable at 450–650 for the interface, with clear weight hierarchy. Keep the white CV document in Arial; app typography is not an export-font change.
- **Control:** labeled Light/Dark buttons in a header that remains available at narrow widths. `mode=light|dark` makes appearance shareable/reload-stable without storing personal data.
- **Review against brief:** a full-screen dark neon dashboard or oversized decorative headings would fight document review. Retain restrained blue surfaces, ordinary reading sizes, and bold task headings. The white page remains a document, not a dark-mode inversion.
- **Search caveat:** local typography search did not identify a verified Sora/Manrope pairing (the Sora result was a different script family), and dark-mode-specific search had no exact match. This pair/palette is a brief-driven design choice; the verified general contrast guidance is used as a check, not a claim that a database prescribed this design.
- **Pre-build token check:** light muted text 5.01:1; light action/white 5.89:1; dark ink/surface 13.85:1; dark muted/raised surface 7.24:1; dark action/white 5.30:1; dark link/raised surface 7.29:1. This is a small palette check, not a full accessibility audit.

The user approved the new theme/font styling: “i approve that is so good”. B/C are retained only as historical comparison directions, not competing redesign work.

## Comparison prompts (remaining interaction feedback pending)

- Which layout makes the next action obvious without hiding the document?
- Can you distinguish an unsupported claim (blocking) from an absent qualification (advisory)?
- Can you see exactly what leaves the machine before a simulated run?
- Is the source inspector close enough to the edited paragraph?
- Does regeneration feel safe when it proposes rather than overwrites?
- Which elements would you combine across variants?

A’s layout and the refined font/theme system are approved. Detailed usability findings remain distinct from visual approval. Updated light/dark screenshots are in SCREENSHOTS.md. Do not translate a visually present control into a production implementation claim.
