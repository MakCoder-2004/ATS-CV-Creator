# Review evidence gallery

A standalone, browser-only study of five ways to arrange review context around the approved Variant A Workbench CV. This is not an Electron renderer change, and all CV, posting, sources, suggestions and job-match text is fictional. No production data or APIs are read; decisions only change volatile in-page presentation. This gallery does not verify claims, run checks, measure page fit, save data, approve, export, or contact a model provider.

## Run it

From the repository root, with the existing dependencies already installed:

```sh
npm --prefix prototypes/review-evidence-gallery run dev
```

Open <http://127.0.0.1:5178/>. The gallery pins port 5178 and will fail instead of taking over an occupied port. Variant and theme remain in the URL: `?variant=0` through `?variant=4`, and `&theme=dark` (omit or set `theme=light` for light appearance). Use the arrangement picker and appearance control to switch. `npm --prefix prototypes/review-evidence-gallery run typecheck` and `npm --prefix prototypes/review-evidence-gallery run build` are the focused checks. No package install or root scripts/configuration changes are needed.

## The five arrangements

1. **Compact focus rail** — always-visible 2×2 named view controls and selected wording context beside the paper at ≥1240px. At smaller widths, keep the paper full measure and request details in a dialog.
2. **On-demand drawer** — full-width reading column until the person requests the 304px details drawer; becomes a dialog below 1240px.
3. **Wide evidence shelf** — at ≥1240px, a deliberate “Jump to review details” control moves to a horizontally broad, below-document shelf. Below 1240px, that request opens a dialog capped at 560px instead of squeezing the paper.
4. **Next-decision queue** — descriptive decision destinations and direct links to all four views; the queue opens in a requested dialog below 1240px. Queue labels are marked illustrative, not actual unresolved work.
5. **Paired source comparison** — a named comparison action opens a readable, requested dialog (680px max at desktop, 560px below 1240px); CV wording precedes its cited source, stacked on mobile. It is not a verdict.

## Interactions and boundaries

Select any of three CV passages to update the linked source and rationale. The four individually named views are Sources, New skills, Job match, and Checks & options. Source wording has an explicit disclosure. New-skill confirm/remove/undo controls are labeled demo-only and do not update a profile or draft. Dialogs close with Escape and restore focus; all controls have visible keyboard focus. The action bar and CV are intentionally honest about review acknowledgment and page fit: this demo does not claim checks passed, evidence verified, or a CV approved.

The CV uses a white Letter-proportioned Lato sheet and the fixture sequence Education → Experience → Projects → grouped Technical Skills. It has no headline, summary, or Certificates. App chrome uses the repository's Manrope/Sora typography and semantic light/dark tokens; the paper remains white in both themes. At 375px the document and comparison stack, without page-level horizontal scrolling. Respect `prefers-reduced-motion`.
