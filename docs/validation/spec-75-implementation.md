# Spec 75 implementation evidence

## Scope

This report records local implementation checks for #75 and children #83–86. It does not claim installed-app or real-provider acceptance.

## Baseline

Before the behavior change, `src/main/source-linked-generation.ts` required newline-separated experience/project bullets, per-target bullet counts, and a 300-character limit per bullet. `src/shared/document.ts` split description lines into bullet entries. `src/shared/latex.ts` emitted `\\resumeItem` items, and `src/main/docx-export.ts` emitted DOCX list paragraphs. The pre-change source behavior is retained as the absent-metadata path. Synthetic source/posting pairs, forbidden claims, locked fields, rubric, and legacy fixture live in `tests/fixtures/tailored-paragraphs/`.

No real-provider baseline was available or run. The fixture rubric names the same-record concepts and unsupported claims to check, but real before/after wording remains NOT VERIFIED.

## Implemented shape

`generatedParagraphSchema` accepts optional `descriptionFormat` metadata. New generated experience/project items set `paragraph`. Missing metadata maps to legacy bullet rendering. The format is carried per item so an explicitly regenerated record can change format without converting untouched records in the same draft. Canonical review content, LaTeX, DOCX, and selectable text use the metadata. Education, grouped skills, saved profile descriptions, and user edits keep their existing rules.

Generation validates that new experience/project descriptions contain no line breaks or bullet prefix and remain at or below 60 English words. The shared counter treats contractions and hyphenated terms as one word. Existing regeneration remains a proposal; acceptance changes only the proposed items and retains the existing invalidation of checks and approval. Invalid regenerated paragraphs fail without changing the saved draft.

## Checks

- `npm exec tsc -- --noEmit` passed.
- A Node ABI 137 test attempt could not load the copied better-sqlite3 built for Electron ABI 140. The focused tests then ran under the Electron ABI without rebuilding or linking native modules.
- `ELECTRON_RUN_AS_NODE=1 electron.exe node_modules/vitest/vitest.mjs run tests/draft-format.test.ts tests/document.test.ts tests/latex.test.ts tests/docx-export.test.ts tests/source-linked-generation.test.ts tests/generation-recovery.test.ts tests/workspace-backup.test.ts` passed 46 tests across seven files. This covers schema compatibility, generation grouping, canonical rendering, LaTeX output, DOCX structure, recovery, and backup restore.
- No real PDF compilation, renderer test, installed-app test, real provider request, or packaged executable check was run. Backup restore and interrupted-recovery unit tests did run.
- The test-dependency copy from `E:/cv-tailor-main/node_modules` timed out once, then `robocopy` completed with exit code 1. No native module was rebuilt.

## Acceptance matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| Missing metadata preserves legacy draft validity and bullet HTML | VERIFIED | `tests/draft-format.test.ts`, `tests/document.test.ts` |
| New generation tags one-paragraph experience/project items and preserves parent citations | VERIFIED for direct graph fixture | `tests/source-linked-generation.test.ts` |
| More than 60 words, line breaks, and bullet markers are rejected by generation validation | VERIFIED | `tests/draft-format.test.ts` checks the shared validator at 60 and 61 words, line breaks, and bullets |
| Review keeps the paragraph selectable with its source | NOT VERIFIED | No renderer test run |
| PDF and DOCX paragraph rendering | PARTIAL | LaTeX text and DOCX XML unit tests; no compiled PDF inspection |
| Backup and legacy recovery contracts | VERIFIED in focused synthetic tests | `tests/generation-recovery.test.ts`, `tests/workspace-backup.test.ts` |
| Regeneration acceptance/rejection and approval invalidation | NOT VERIFIED | No SQLite-backed test run |
| Real provider paired quality and factual review | NOT VERIFIED | No authorized provider call |
| Installed Windows behavior, native SQLite reopen and actual exports | NOT VERIFIED | Deferred to #86 and final user approval |

## Remaining work

Verify review selection and export behavior in Electron, inspect compiled selectable PDF and DOCX output, and add a focused regeneration acceptance/rejection test for format metadata and approval invalidation. Complete real-provider comparison only with exact request-specific consent. Keep #86 and installed validation open until that evidence exists.
