# Review evidence browser — five layout concepts

A static visual exploration of review arrangements in the approved Variant A Workbench shell. All people, CV records, posting language, sources, skills, and decisions in the gallery are invented. No local reference-CV fixture or production state is used. The prototype reads no app data and has no persistence or backend.

## Shared contract

The paper is the anchor: white, Letter proportions, local Lato, max width 612px, selectable wording, and these populated sections in order: Education → Experience → Projects → Technical Skills grouped as Languages, Technologies, Concepts. It has no headline, summary, or Certificates. One fictional CV/posting/source set is shared across all arrangements.

A measured sticky review bar remains above the paper and visibly includes wording acknowledgment, Check CV for issues, Check page length, Approve CV, and a review-details/jump control. This is a visual prototype only: check buttons route to “not run” details, the page-fit state stays “not measured,” and Approve CV is disabled with an explanation. Nothing claims verified evidence, a passed check, measured fit, approval, or export. Skill confirm/remove/undo changes only in-memory presentation and updates a clearly demo-only CV annotation; it does not make profile or past-experience claims.

All four named detail views are available: Sources, New skills, Job match, and Checks & options. Sources pairs selected wording with its cited invented passage and rationale. Job match is illustrative, never a score or verdict. Checks & options describes what did not run. At widths below 1240px, requested details use a native accessible dialog capped at 560px. The app shell retains its 220px rail and four visible, inert named destinations through 761px; it changes to a named compact navigation at 760px and below, then two columns below 520px. The paper is not narrowed to preserve a details rail. The sticky bar's measured height informs focus/scroll margins. Dialogs close on Escape and restore focus.

## Arrangements and tradeoffs

1. **Compact focus rail:** persistent 304px context beside the paper on wide windows, with four named controls in a 2×2 grid. Quick orientation costs persistent visual attention.
2. **On-demand drawer:** paper first, details requested from the sticky bar. It reduces visual noise but makes context one action farther away.
3. **Wide evidence shelf:** the sticky bar jumps to a broad details shelf after the document. Context stays close without a third column, at the cost of extra page length. Below 1240px, the same request opens the details dialog.
4. **Next-decision queue:** a clearly illustrative queue routes to all four detail views without implying actual unresolved work. It clarifies possible order but risks suggesting a forced sequence.
5. **Paired source comparison:** the sticky bar opens a details dialog with all four views; a separate Compare action opens a CV/source pair capped at 680px desktop and 560px below 1240px. Comparison is provenance, not a factual verdict; at 375px the wording and source stack in reading order.

The global theme uses the repository's semantic light/dark colors. UI typography uses Manrope/Sora when locally installed and system sans-serif fallbacks otherwise; no external font fetch is made. Reduced motion is respected and the page does not scroll horizontally at 375px.
