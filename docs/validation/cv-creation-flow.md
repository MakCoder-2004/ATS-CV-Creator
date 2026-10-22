# Approved CV-creation flow — implementation validation

**Historical v0.1.1 record.** The headline, summary, and Arial layout below were superseded by the supplied Letter/Lato template in [v0.2.0 export validation](latex-export.md). See the [current workflows](../workflows.md) before changing the app.

Scope: [issue #25](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/25), version **0.1.1**. The user approved the throwaway preview on `prototype/cv-creation-flow` (source `0aa68f4`, approval record `c1a84a0`). Production was rewritten against its decisions; no prototype simulator was merged.

## Implemented behavior

- Exact stages: **Job posting → Outgoing data → Generate → Review evidence → Export**.
- Authorizing the minimized bundle starts analysis for the accepted run automatically, including compatible cache reuse. The user reviews qualifications, tools/responsibilities and keywords before explicitly generating a CV.
- Progress follows actual scoring, selection, tailoring, checks and document work. The application measures the rendered PDF locally before approval. Cancellation, limits, uncertainty/recovery and explicit retry authorization are preserved.
- Model-provided target headline and evidence-cited short summary are required for new generation. Employment titles, employers, institutions, project names and dates remain authoritative. Historical drafts remain readable; older unfinished narrative-free checkpoints request fresh authorization rather than inventing a summary.
- Posting-only tool suggestions appear in the draft and inspector as **Not in your profile**. Confirmation/removal persists as a draft-local decision, not a profile change. Pending suggestions block backend approval/export. Confirmation cannot establish unsupported use in a role/project/summary; source checks still apply. Accepted page cuts also remove confirmed suggested skills when selected.
- The single-column Arial document includes the target headline, Professional summary and populated standard sections, real description bullets, project technologies and compact Technical skills. PDF and Word share canonical wording and order. Review annotations and pending/removed suggestions never enter exports.
- Identifier restoration is local: headlines, summaries, skills, rationale and the display-only analysis copy are human-readable. Provider inputs remain minimized. Cache compatibility includes the minimized posting so changed redaction-token assignments cannot reuse an incompatible analysis.
- Wording/skill changes reset acknowledgment, approval and page-fit state. The approval/export guards bind current content, source revisions, check results and actual measured fit.

## Verification observed

- TypeScript typecheck and production Electron build passed.
- **113 unit/contract tests passed across 26 files**, including strict output validation, summary citations/quantities, confirmed-skill provenance, proposal decisions/reopen, source changes, accepted cuts, consent/cache scopes, checkpoint recovery, backup/restore and document/export parity. These were run under the Electron ABI during integration and passed again with the normal `npm test` Node rebuild after merging to main.
- **20 Electron tests passed, 1 installed-app test skipped** in the complete serial Playwright run. Visible paths cover authorization/analysis pause, new skill decisions, narrative editing, fresh acknowledgment, approval invalidation, measured page fit, actual PDF/DOCX export, overwrite/cancel/failure handling, reopening and existing profile/settings/recovery/backup workflows.
- Additional real Electron visual checks used a fictional profile on this Windows machine. Widths 375, 520, 760, 980, 1024 and 1440px had no page-level horizontal overflow. The selected stage is revealed within its locally scrollable strip. Narrow paper expands around content rather than clipping it; controls remain below the document. Light/dark app modes preserve white CV paper.
- A one-page PDF was actually exported, checked for selectable text and canonical reading order, and rendered for visual inspection against the supplied template. DOCX content, links, bullet structure and paragraph order were inspected through its generated ZIP/XML.
- Independent read-only safety/spec review reported no blocking findings. Follow-up validation also tightened posting-tool provenance and cache/redaction compatibility.

## Screenshots from the real application

These use a DEV-only scripted transport and fictional source data, not live model results or the user's profile:

- [Posting analysis](cv-flow/analysis.png)
- [Operation-driven generation progress](cv-flow/progress.png)
- [Document-first review and skill decisions](cv-flow/review.png)
- [Narrow dark workspace](cv-flow/mobile.png)
- [Rendered, actually exported PDF](cv-flow/exported-pdf.png)

## Packaging verification

`release/CV-Tailor-Setup-0.1.1.exe` was built from main using physical dependencies. The first post-Node-test package exposed a native ABI mismatch: SQLite was built for Node ABI 137 while Electron requires ABI 140. This was reproduced with a direct native query, not attributed to the renderer. The Windows distribution script now forces `rebuild:electron`, runs `verify:electron-sqlite`, builds the installer, and verifies the packaged binding itself. Both checks passed after the fix.

The actual packaged v0.1.1 executable was opened with isolated temporary user data. Its exact five stages and new skill-review bridge were present; a profile write and appearance choice persisted through native SQLite and offline reopen. This was explicitly an **unpacked packaged-app smoke test**, not an installer installation test. The existing installed application and user data were not replaced.

## Limits and release distinction

No paid/live OpenRouter request was made for this validation. Transport and application contracts were tested with deterministic provider responses; live wording quality still depends on the selected model and the person's sources. Semantic faithfulness review remains optional and is a second opinion, not proof. Word pagination may differ from PDF. A clean template does not guarantee an ATS or hiring result.

The installed-app test requires `CV_TAILOR_INSTALLED_EXE` pointing to a genuinely installed executable. It was not substituted with an unpacked build. Installer creation or packaged smoke checks must not be described as a completed installation/reopen test. The user's confirmed Windows machine is the accepted environment; no separate VM is required. A new installer must be installed to update an existing desktop installation; source changes alone do not update it.
