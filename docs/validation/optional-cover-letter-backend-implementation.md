# Issue #122 backend implementation checkpoint

This is a bounded implementation checkpoint, not evidence that the cover-letter feature ships. The accepted contract is `docs/plans/optional-cover-letter.md`; this note does not supersede it.

## Atomic unit 1 — shared strict contracts

**Gate:** reject unknown model response authority fields; bind each paragraph citation to the current source-ordinal allowlist; require fit, no findings, and an acknowledgment for every paragraph before approval; retain source parent/category context. The model-response shape deliberately cannot assert that an ordinal resolves: resolution happens against the locally frozen source list when constructing a revision.

**Change:** added `src/shared/cover-letter.ts` with purpose, source, paragraph, revision, generation-outcome, edit/recipient/acknowledgment, and model-response schemas, plus deterministic acknowledgment material construction. The shared module has no Node crypto dependency. Main must hash that canonical material itself; renderer-supplied hashes are not authority.

**Evidence:** `npx vitest run tests/cover-letter-contract.test.ts --maxWorkers=1` — 1 file, 4 tests passed. `npx tsc --noEmit` passed. Evidence is the current command output in the implementation session (no external log file).

**Limit:** These are contracts only. They are not connected to persisted records, main-owned review decisions, purpose-bound consent, generation, IPC/preload, backup/deletion, PDF/DOCX, or renderer APIs. No behavior beyond the contract unit is verified.

## Environment / inherited worktree state

The worktree was on `work/cover-letter-build` at `6a63630cd330f57ea05f6d3a1ff68b60526e4cdb`. Before edits, `git status` already showed `M resources/cover-letter-template/SHA256SUMS`; this inherited change was not authored or modified here. The requested `.agents/skills/poteto-mode/SKILL.md` and named leaf skills are absent from this worktree and were not available under `C:/Users/Makrious/.agents/skills/` during lookup.
