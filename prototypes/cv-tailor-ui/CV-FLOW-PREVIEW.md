# Throwaway CV-creation preview

**Question:** Does the five-stage flow clearly separate posting analysis, CV generation and human decisions about newly suggested skills, with a better document template?

**Status:** awaiting user feedback. This is not production implementation or an approved design change.

## Run

From this worktree:

```sh
npm run dev --workspace @cv-tailor/ui-prototype -- --port 5177
```

Open `http://127.0.0.1:5177/prototype?variant=A`.

To look at the CV immediately: `http://127.0.0.1:5177/prototype?variant=A&step=review`.

The existing prototype route now hosts the revised Tailor CV workbench. The prior prototype source is retained but not mounted. The production Electron renderer is untouched.

## Three document arrangements

The approved Variant A application shell stays fixed. Only the CV arrangement changes, using the bottom switcher or the left/right arrow keys outside controls:

- **A — Experience first:** summary, experience, projects, education, technical skills. Recommended general-purpose order.
- **B — Skills & projects first:** left-aligned contact block, summary, technical skills, projects, experience, education. Useful when projects make the strongest case.
- **C — Education first:** centered contact block and ruled sections closest to the supplied `cv-templete.pdf`: summary, education, experience, projects, technical skills.

All three are single-column, plain-text documents with no tables, icons, skill bars or graphics inside the CV. App-level controls and inspector are not document content. The A4-like preview scales readable Arial text toward an 11pt-equivalent size at full width. This is not a measured PDF and does not guarantee ATS compatibility.

## Agreed behavior demonstrated

1. **Job posting:** title, company, posting and requirements in the existing add/edit dialog structure.
2. **Outgoing data:** explicit review and authorization before any analysis would run.
3. **Generate:** automatically show simulated posting analysis after authorization; pause so the user can review required qualifications, preferred qualifications, tools/responsibilities and keywords. Generate CV starts a six-row simulated progress checklist.
4. **Review evidence:** document is the hero, selected wording reveals its sample source and tailoring rationale. The target headline is AI/ML Engineer; the historical Software Engineer title stays unchanged. Summary, experience and project descriptions can be edited locally in memory.
5. **Export:** both newly suggested skills must be confirmed or removed, and the review checkbox accepted, before preview approval. A clean document omits review annotations. Export controls explicitly demonstrate actions without writing files.

New skills RASA and Google Cloud Platform are intentionally absent from the fictional sample profile. They are marked **Not in your profile** in the draft and inspector. Confirmation includes a skill in this CV only; it does not persist it to the profile or claim it was used in prior roles or projects. Removal omits it entirely.

## Constraints and deliberate omissions

- Fixture data, no AI requests, no backend calls, no persistence, no real export, no real factual checks and no real page measurement.
- The supplied PDF was rendered and visually inspected as the layout reference; its invented names, metrics and skills are not imported as career facts.
- Posting edits are illustrative only: the analysis and CV remain fixed sample output. This is disclosed next to the posting and in its dialog.
- Page target is illustrative, not a pagination control. State inspector reports it without claiming the page count was measured.
- Saved jobs, Profile and Settings are disabled as outside this preview. The full production app remains unchanged.
- Loading rows show completed/active/waiting states using a timer and are clearly labeled simulated. Production progress must be driven by actual operations and must not copy fixture completion states.
- Production implementation requires evidence/provenance handling for confirmed skills, generated summary/headline support, outgoing-data schema updates as necessary, approval invalidation, factual checks, measured pagination, PDF/DOCX parity and automated tests.

## Inspection

- Typecheck and Vite build passed.
- Headless Microsoft Edge click-through passed: posting dialog cancel, consent gate, analysis pause, generation checklist, skill-confirmation/removal gate, wording edit, renewed review, approval and annotation-free export preview.
- No browser page errors or external requests observed during that click-through.
- Checked viewport widths 375, 520, 760, 768, 980, 1000, 1024, 1200 and 1440px: no page-level horizontal overflow. The stage strip scrolls locally and reveals the active step.
- Visually inspected desktop, 375px, dark theme, posting analysis and generation progress. Compared the workbench composition to the approved A-light screenshot and the document to a rendered image of the supplied PDF.
- Fixed initial dialog focus to the job-title field and reset review acknowledgment after skill or wording changes.
- This is a prototype smoke check, not production or ATS validation.

Screenshots: [CV review](docs/screenshots/cv-flow-review.png), [education-first arrangement](docs/screenshots/cv-flow-education-first.png), [analysis](docs/screenshots/cv-flow-analysis.png), [progress](docs/screenshots/cv-flow-progress.png), [375px](docs/screenshots/cv-flow-375.png), [dark](docs/screenshots/cv-flow-dark.png).

## Capture

Branch: `prototype/cv-creation-flow`.

Worktree: `E:/cv-tailor-flow-preview`.

Do not merge this branch into main. Record the user's selected arrangement and feedback here before creating implementation issues or making production changes. No implementation issue has been created yet because design approval is pending.
