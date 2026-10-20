# CV Tailor design system

**Status:** normative product design contract. This directory is the single source of truth for frontend visual and interaction rules. The code is the source of truth for current implementation details; this contract translates those details into enforceable design rules. Resolve conflicts in this order: explicit page contract in `pages.md`, shared tokens/layout in `tokens.md`, UX/accessibility in `interaction.md`. Tailor CV and Saved jobs follow the approved Variant A Workbench prototype; My profile and Settings retain their current implemented information architecture and interactions, styled by the shared system.

## Required reading

Before designing, modifying, or reviewing any renderer UI, read this file and the relevant page section in `pages.md`. Read `tokens.md` for visual values and `interaction.md` for behavior and accessibility. Treat measurements as exact unless explicitly marked responsive or content-driven. Do not invent new colors, type scales, spacing, radii, shadows, icon families, or page structure.

## Page implementation boundary

- **Tailor CV:** reproduce the approved prototype Variant A Workbench composition and interaction model: saved-job rail, job context, staged work, document workspace and contextual inspector/review controls. The current implementation may have different content capabilities; preserve actual implemented behavior and use the prototype as the visual/organizational target, not as authority to fabricate unsupported features.
- **Saved jobs:** reproduce the prototype's Saved jobs page structure and interaction behavior exactly, while connecting to production persistence and real validation. Prototype-only fixtures, simulator actions and state are not production requirements.
- **My profile and Settings:** preserve their currently implemented page structures, section organization and capabilities. Apply shared tokens and quality rules; do not reshape them to prototype alternatives.
- **Global shell:** the existing app is an Electron desktop workbench with responsive web layouts. Apply one consistent navigation shell, appearance control, content alignment and type/color system across all pages.

## Conformance

A change conforms only when it uses named tokens, preserves the relevant page contract, has consistent baselines and spacing, has complete keyboard/focus/status behavior, works at supported responsive widths, and introduces no undocumented visual values. Document an intentional exception here before or with its implementation. Verify visual changes against the approved Variant A prototype for the two specified pages and against the current implementation baseline for Profile and Settings.

## Reference files

- `tokens.md` — colors, typography, spacing, layout, surfaces, responsive dimensions.
- `pages.md` — page-by-page composition, hierarchy, alignment and content rules.
- `interaction.md` — controls, feedback, accessibility, empty/error/loading states and motion.
- `../docs/design-system.md` — short repository-wide entry point.
