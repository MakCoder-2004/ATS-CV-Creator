# Spec 75 implementation evidence

## Scope

This report records local implementation checks for #75 and children #83–86. It does not claim installed-app or real-provider acceptance.

## Baseline

Before the behavior change, `src/main/source-linked-generation.ts` required newline-separated experience/project bullets, per-target bullet counts, and a 300-character limit per bullet. `src/shared/document.ts` split description lines into bullet entries. `src/shared/latex.ts` emitted `\\resumeItem` items, and `src/main/docx-export.ts` emitted DOCX list paragraphs. The pre-change source behavior is retained as the absent-metadata path. Synthetic source/posting pairs, forbidden claims, locked fields, rubric, and legacy fixture live in `tests/fixtures/tailored-paragraphs/`.

No real-provider baseline was available or run. `tests/paragraph-fixture-contract.test.ts` loads every frozen case and verifies quoted evidence for each required concept, the same-profile paired postings, and adversarial out-of-record cases. The frontend rubric now names only facts present in its actual source. Real before/after wording remains NOT VERIFIED.

## Implemented shape

`generatedParagraphSchema` accepts optional `descriptionFormat` metadata. New generated experience/project items set `paragraph`. Missing metadata maps to legacy bullet rendering and omits the optional field from canonical JSON, preserving legacy approval hashes. Mixed same-parent groups carry per-item formats through review, HTML, LaTeX, DOCX, and selectable text without converting untouched siblings. Frozen old role/project canonical hashes, approval/export and backup restore are checked. Canonical review content, LaTeX, DOCX, and selectable text use the metadata. Education, grouped skills, saved profile descriptions, and user edits keep their existing rules.

Generation validates that new experience/project descriptions contain no line breaks or bullet prefix and remain at or below 60 English words. The shared counter treats contractions and hyphenated terms as one word. Existing regeneration remains a proposal; acceptance changes only the proposed items and retains the existing invalidation of checks and approval. Invalid regenerated paragraphs fail without changing the saved draft. Factual and supported-term corrections also apply the shared paragraph check to restored text before replacement. Recovery snapshot version 3 marks the paragraph prompt boundary. Version 1 and 2 backups remain readable, but their interrupted runs cannot dispatch on old consent; uncertain attempts retain explicit duplicate-risk status.

## Checks

- `npm exec tsc -- --noEmit` passed after the last source edit. One `npm run build` passed after the renderer and export changes and before a recovery-display guard refinement; root still owns final integration build.
- A Node ABI 137 test attempt could not load the copied better-sqlite3 built for Electron ABI 140. The focused tests then ran under the Electron ABI without rebuilding or linking native modules.
- The initial implementation reported 46 focused tests across seven files. The review-fix round independently ran focused Electron-ABI Vitest commands for `tests/generation-recovery.test.ts` (8), `tests/paragraph-repair-boundary.test.ts` (4), `tests/paragraph-regeneration-workbench.test.ts` (3), `tests/paragraph-fixture-contract.test.ts` (2), and `tests/paragraph-compiled-pdf.test.ts` (1). Compatibility worker reported 24 focused tests across document, draft-format, DOCX and LaTeX files. After the scoped changes, one combined related Vitest command passed 42 tests across nine files, including compiled PDF, SQLite regeneration, recovery, canonical, DOCX, LaTeX and fixtures. For reruns in this worktree, set `CV_TAILOR_LATEX_TOOLCHAIN_ROOT=E:/cv-tailor-main/.tools/latex` or provide a local `.tools/latex`; without a toolchain, the compiled-PDF test skips. This is not the full suite.
- The later review-fix round ran a bounded development Electron Playwright scenario for visible paragraph selection, source context, record editor and replacement comparison in `tests/electron/tailored-paragraph-review.spec.ts` (1 passed). A synthetic bundled pdfLaTeX run inspected selectable paragraph text and measured actual one- and two-page targets in `tests/paragraph-compiled-pdf.test.ts` (1 passed). It used the read-only `E:/cv-tailor-main/.tools/latex` directly, without a junction. These are not installed-app checks.
- `node scripts/check-doc-links.cjs` resolved links in 43 Markdown files. Existing physical Electron ABI 140 dependencies were reused without copying or rebuilding in the review-fix round. The earlier implementation had copied test dependencies after one timeout, with `robocopy` exit code 1. Neither round rebuilt native modules.

## Acceptance matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| Missing metadata preserves legacy draft validity and bullet HTML | VERIFIED | `tests/draft-format.test.ts`, `tests/document.test.ts` |
| New generation tags one-paragraph experience/project items and preserves parent citations | VERIFIED for direct graph fixture | `tests/source-linked-generation.test.ts` |
| More than 60 words, line breaks, and bullet markers are rejected by generation validation | VERIFIED | `tests/draft-format.test.ts` checks the shared validator at 60 and 61 words, line breaks, and bullets |
| Review keeps the paragraph selectable with its source | VERIFIED in development Electron with synthetic records | `tests/electron/tailored-paragraph-review.spec.ts`; installed UI remains open |
| PDF and DOCX paragraph rendering | VERIFIED for synthetic compiled PDF one-/two-page targets and focused DOCX structure; installed exports open | `tests/paragraph-compiled-pdf.test.ts`, `tests/docx-export.test.ts` |
| Backup and legacy recovery contracts | VERIFIED in focused synthetic tests | `tests/generation-recovery.test.ts` exercises version 1/2 refusal without dispatch and current recovery; `tests/paragraph-regeneration-workbench.test.ts` checks approved old grouped content and mixed-format restore |
| Regeneration acceptance/rejection and approval invalidation | VERIFIED in synthetic SQLite-backed tests for experience/project | `tests/paragraph-regeneration-workbench.test.ts` checks malformed refusal, scoped acceptance, rejection, factual rerun, removed fit/approval and backup roundtrip |
| Real provider paired quality and factual review | NOT VERIFIED | No authorized provider call |
| Installed Windows behavior, native SQLite reopen and actual exports | NOT VERIFIED | Deferred to #86 and final user approval |

## Remaining work

A real-provider paired baseline/new quality comparison requires exact request-specific consent and is NOT VERIFIED. Installed Windows native SQLite reopen, actual installed PDF/DOCX exports and visual approval remain open under #86. The scripted development-Electron and synthetic PDF checks do not satisfy installed acceptance. Keep the parent release gate open until those checks and source-grounded real wording review are complete.
