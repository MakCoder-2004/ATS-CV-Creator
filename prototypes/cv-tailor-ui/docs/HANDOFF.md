# Prototype → specification → tickets handoff

Published specification: [GitHub issue #1](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/1), labeled `ready-for-agent`. It is the canonical specification synthesized from discovery, UI approval and the confirmed public-contract + Electron-smoke testing boundary. The 22 approved implementation tickets are published as issues #2–#23 with native sub-issue/blocking relationships; see TICKETS.md for navigation.

Status: **User-approved UI direction: A — Workbench, light/dark modes, Sora headings and Manrope interface text.** Detailed interaction usability is not yet validated. This is not the production application or a substitute for a GitHub specification. The user explicitly requested prototyping before `/to-spec` and `/to-tickets`.

## Agreed product requirements (from discovery)

- Personal, English-only Windows desktop app; retain the full planned workflow rather than cutting to an MVP.
- The user explicitly approved A — Workbench’s sidebar/document/inspector layout, light/dark appearance, Sora headings and Manrope UI text (“i approve that is so good”). Preserve this visual direction in `/to-spec`, `/to-tickets`, and the eventual production rewrite. The CV itself remains white/Arial regardless of app theme. Browser preference is URL-only; durable/system preference behavior remains a production design detail.
- Gemini API free tier is a fixed requirement; default `gemini-3.6-flash`, configurable. Local storage does not mean local inference. Google’s unpaid-service terms instruct users not to submit sensitive, confidential or personal information; consent/redaction cannot guarantee anonymity or acceptable use. Retain this limitation honestly.
- Comprehensive local profile; review a one-time local extraction of `cv/Makrious Ayman CV.pdf` before making extracted facts profile evidence. The prototype fixtures are manually reference-derived examples, **not** the completed import.
- CV output is an ATS-adapted version of that PDF: Arial, no icons, text contact links, single column, section rules, right-aligned dates without layout tables, and paragraphs rather than achievement bullet lists.
- Exactly five export sections, in order: Education, Experience, Projects, Skills, Certificates. No generated Summary, spoken-language section or extras. Profile storage remains broader. Reverse-chronological education/employment; relevance chooses content and paragraph emphasis.
- A4, one-page default; two-page target selectable. Overflow requires accepted cuts or a valid target change, not silent font shrinking/deletion. Browser paper is a **visual approximation**, not a pagination engine or guaranteed page count.
- Pseudonymize organization/project identifiers; omit exact dates/contact/links and irrelevant sensitive extras before cloud requests; restore locked fields locally. Inspectable frozen payload approval per run including its retries. Ask again for additional private data. Full provider envelopes/prompts and complete redaction remain implementation work.
- Conservative rewriting preserves scope, responsibility, certainty and facts. Evidence applies to all factual generated wording, not only bullets. New factual edits must be saved as profile evidence. Human review plus deterministic checks, with optional semantic LLM checks; no invention-proof guarantee.
- Unresolved verification failures block export. Unsupported job requirements are advisory gaps, not invitations to manufacture coverage. Attainable keyword coverage is a heuristic, never an ATS score.
- Regeneration proposes a replacement/diff; never overwrites manual edits before acceptance. Accepted content changes invalidate approval. Referenced source changes flag affected drafts for revalidation/review, while historical evidence revisions remain available.
- Document-level final approval with inspectable per-paragraph/skill evidence. DOCX and PDF content/order match; pagination may differ.
- SQLite and durable generation/review checkpoints; explicit restart recovery/resume, cancellation, and no silent network resumption. Shared configurable run ceiling initially 12 outbound attempts or 5 minutes, including transport retries, schema repairs and content retries. SDK hidden retries disabled. Quota counts are local observations, not authoritative provider-wide remaining quota.
- Profile JSON exchange plus complete app backup excluding API key. Profile import replaces only current profile after preview, preserving draft evidence history. Full restore replaces the workspace after a safety backup. No silent merge.
- Test extraction locally; no automatic uploads to ATS checkers. Pilot with two real postings (strong match + substantial gaps), zero observed unsupported claims and acceptable relevance/tone; keep technical safety/export/recovery/cancel/installed-Windows checks on the user's confirmed fresh Windows machine (no separate VM required). Expand to at least five postings before broad quality claims.

## Requested technology stack — preserved, not silently replaced

| Layer | Production choice | Prototype status |
| --- | --- | --- |
| Shell | Electron + TypeScript + electron-vite | **Deferred by explicit browser-first decision.** Vite hosts this disposable renderer; not a change of production shell. |
| UI | React, Tailwind CSS, shadcn/ui, react-hook-form, Zustand | Used in the prototype. shadcn CLI-generated primitives use Radix. Zustand has no persistence middleware. |
| Schemas | Zod shared between forms and LLM output | Zod + RHF resolver validate the sample job form. Production profile/LLM schemas remain to be specified. |
| Local data | better-sqlite3 (Electron rebuild required); JSON was an original alternative | SQLite was selected during recovery discovery. Prototype state is memory-only; no production DB or backup implementation. |
| Agent | @langchain/langgraph, langchain, @langchain/core, @langchain/google-genai | Simulated finite steps only. Verify current package/classes, structured output, thinking options and cancellation/checkpoint behavior before implementation. |
| Export | docx + Electron webContents.printToPDF | Simulated notifications; **no DOCX/PDF file is created**. CV layout is an HTML approximation. |
| Packaging | electron-builder NSIS; @electron/rebuild or electron-builder install-app-deps | Deferred. Test native ABI and real installer startup on the user's confirmed fresh Windows machine early in production work; no separate VM is required. |
| Testing | Vitest unit; Playwright for Electron optional | No production test suite for throwaway code. Playwright browser inspection is development tooling, not Electron E2E coverage. |

`@hookform/resolvers` is on the compatible v5 line: the registry’s v6 resolution conflicted between optional Effect v3/v4 peers. TypeScript 7 removes `baseUrl`; prototype aliases use relative `paths`. Current dependencies are recorded in package-lock.json, not assumed from the original plan.

## Simulated state model

- Navigation: workspace / saved jobs / full profile / settings.
- Workflow: posting → payload consent → progress → evidence review → export approval.
- Draft checks: passed / needs checks / blocked / stale evidence. Approval is separate from checks.
- Run: idle / running / paused / cancelled / complete. A timer advances fixture steps; request counts are simulated.
- A payload snapshot models a consent boundary but does not constitute a verified privacy layer.
- New fact entry, source editing, import, backup, restore and export controls demonstrate interactions without disk writes. Browser refresh resets everything.
- Scenario drivers intentionally load fixture state; they are not production controls, tests, or proof of real verification. The demonstration checker detects only scripted unsupported wording, not arbitrary hallucinations. Edited fixture text still requires human inspection.
- Checkpoint/restart durability, elapsed-time enforcement, real rate limiting/backoff, exact redaction and frozen evidence migrations are **not validated by this browser demo**.

## Scenarios to walk through

1. Compare A/B/C on the same ready-for-review draft; select a paragraph and inspect its evidence and inclusion rationale.
2. Edit a paragraph → checks needed → run demo checks → review → approve → simulated DOCX/PDF export.
3. Regenerate selected paragraph → inspect old/proposed wording → reject (unchanged) or accept (approval invalidated).
4. Load unsupported-claim scenario → export blocked → replace unsupported wording → rerun checks → review.
5. Load page overflow → accept an explicit proposed cut or choose two pages → review again.
6. Load changed source → inspect source revision → acknowledge comparison → recheck → approve.
7. Load 429 / offline / request-budget scenario → inspect retained progress → explicit resume/cancel. Raise budget in settings if already exhausted.
8. Add a fictional posting with validated fields → inspect pseudonymized eligible data → authorize simulated run → review draft.
9. Open profile → review fixture import; inspect all profile categories; edit source/new evidence → see approval invalidation.
10. Empty workspace → clear next action to add posting. Open settings → inspect privacy notice, model, page/run budgets, optional semantic verification and backup/restore previews.

## Evidence to collect before `/to-spec`

- Visual direction is settled: A, light/dark, Sora/Manrope. Use FEEDBACK.md and the updated screenshots as the approval record; do not assume every simulated interaction is functionally validated.
- Retain A’s sidebar/document/inspector structure; validate which screen owns each action, particularly sources, privacy and regeneration.
- Confusing states/labels; whether blocked versus advisory is understood.
- Final navigation and disclosure density; behavior at narrower window sizes.
- Screenshots with variant, scenario and viewport recorded; manual inspection results are not automated test claims.
- Any newly requested behavior must be separated from already-agreed requirements.

## Capture / cleanup

Prototype source lives on `prototype/cv-tailor-ui`, outside main. Do not promote throwaway code unchanged. After user evaluation, capture the verdict and the complete prototype in a commit on this branch (when authorized); link its commit/branch from the eventual GitHub implementation issue. The specification is published as GitHub issue #1 and its 22 approved implementation tickets as issues #2–#23; production implementation has not started. The eventual production branch keeps validated design documentation and properly rewritten implementation, not losing variants or scenario switches.

## Sources checked during discovery

- https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash — model and capabilities.
- https://ai.google.dev/gemini-api/docs/rate-limits — RPM/TPM/RPD, project-level limits, Pacific reset; actual account limits may vary.
- https://ai.google.dev/gemini-api/terms — unpaid-service data use and use restrictions. Recheck before live data processing.
