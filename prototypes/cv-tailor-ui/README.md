# CV Tailor — throwaway browser UI prototype

**Not production code.** Three alternative desktop interfaces test the same privacy-aware, evidence-grounded CV workflow before `/to-spec` and `/to-tickets`. The user explicitly selected **browser UI first**; Electron remains the production shell.

**Approved UI direction:** **A — Workbench**, including Light/Dark controls, bolder Sora headings and Manrope interface text. The user explicitly approved this refinement. The CV preview remains white/Arial. Visual approval does not validate production integrations or every workflow edge case.

## Run

From the repository root (Node 24 was used):

```bash
npm install
npm run prototype
```

Open **http://127.0.0.1:5173/prototype?variant=A**. If the local preview is already running, simply open the URL; do not start a second copy on port 5173.

| Variant | URL | Main design question |
| --- | --- | --- |
| A — Workbench | http://127.0.0.1:5173/prototype?variant=A | Keep saved jobs, the CV and evidence visible together? |
| B — Guided desk | http://127.0.0.1:5173/prototype?variant=B | Focus on one workflow step, opening evidence when needed? |
| C — Review room | http://127.0.0.1:5173/prototype?variant=C | Put the paper between a source ledger and requirements? |

Use the floating bottom bar or **left/right arrow keys** to cycle layouts. Arrow shortcuts are ignored in inputs, textareas, selects, editable content, dialogs and tab lists. Variant URLs and Workbench appearance (`mode=light|dark`) are reload-stable; working data is **not**. Switching layouts keeps shared state, but refreshing resets all fixture data. `scenario` links can deliberately initialize an edge case, e.g. `?variant=C&scenario=blocked`.

## Try it

1. Start with the loaded sample draft; select a paragraph and inspect why it was included and its source.
2. Edit it or propose regeneration; compare and accept/reject a replacement. Check how approval is invalidated.
3. Approve the reviewed draft, then try the **simulated** DOCX/PDF actions. No file is created.
4. Use the scenario menu: unsupported claim, page overflow, changed source, 429, offline, run budget, empty workspace.
5. Add a fictional job → inspect outgoing bundle → consent → simulated progress → review.
6. Open Profile and Settings; review the fixture-import and backup/restore previews.
7. Open **State** in the bottom bar to inspect the full relevant live state and recent events.

The sample candidate facts are manually adapted from the local reference CV, with contact details masked. Jobs are fictional. This is **not** the completed, user-approved one-time PDF import. Generation always produces sample fixture content, not a real response tailored to arbitrary pasted jobs. Coverage labels are illustrative for the sample ML posting, not live scoring.

## Technology and boundaries

Used: React + TypeScript + Vite, Tailwind CSS, CLI-generated shadcn/ui (Radix), react-hook-form, Zustand, Zod and Lucide. All fonts are local: Sora Variable + Manrope Variable for refined Workbench; IBM Plex Sans for historical B/C variants. The previewed CV uses Arial.

Workbench links: [Light mode](http://127.0.0.1:5173/prototype?variant=A&mode=light) · [Dark mode](http://127.0.0.1:5173/prototype?variant=A&mode=dark). Changing app appearance does not change draft content, checks, approval, or document styling.

Preserved for production: Electron + electron-vite; better-sqlite3/durable LangGraph checkpoints; LangGraph/LangChain/Gemini free tier; `docx`; Electron `printToPDF`; electron-builder NSIS and native-module rebuilding; Vitest and optional Playwright Electron E2E. See the [complete stack mapping and discovery agreement](docs/HANDOFF.md).

**No provider calls, API keys, database, persistence, real PDF import/export, native dialogs, installer, production verifier, complete privacy filter, or wall-clock budget enforcement.** No localStorage/IndexedDB persistence. Fixture checks demonstrate states; they do not detect arbitrary unsupported claims. Never put real secrets in this browser demo. All fonts/assets are served locally; page-level inspection observed no external requests.

## Checks

```bash
npm run prototype:typecheck
npm run prototype:build
```

Build output is ignored. The floating comparison/scenario/state bar is gated by `import.meta.env.DEV` and absent from production-mode bundles; the app is still a clearly labeled prototype, not a shippable product. A chunk-size warning is an accepted throwaway-build limitation, not a production performance decision. There is intentionally no production unit/E2E suite in this exploratory code.

## Documentation for the next stages

- [Design hypotheses, tokens, and comparison questions](docs/DESIGN.md)
- [Agreed requirements, exact stack mapping, boundaries, scenarios, and handoff](docs/HANDOFF.md)
- [Browser inspection record and known limitations](docs/INSPECTION.md)
- [Screenshot gallery](docs/SCREENSHOTS.md)
- [User approval record and remaining interaction-review notes](docs/FEEDBACK.md)
- [Published implementation tickets and dependency navigation](docs/TICKETS.md)

## Lifecycle

Branch: `prototype/cv-tailor-ui`. A’s layout and refined themes/fonts are approved; detailed interaction validation remains separate. The [specification is published as GitHub issue #1](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/1), labeled `ready-for-agent`. All 22 approved implementation tickets are published as issues #2–#23 with native blockers. Production implementation has not started and no prototype commit has been made automatically. After user feedback, record the winning/hybrid direction and verdict, capture the source on this throwaway branch, and link it from the eventual GitHub specification/implementation issues. Do not merge the three alternatives, scenario controls, or prototype state logic unchanged into production.
