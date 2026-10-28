# Review evidence browser — five interaction concepts

A static visual exploration of review arrangements in the approved Variant A Workbench shell. All people, CV records, posting language, sources, skills, and decisions in the gallery are invented. No local reference-CV fixture or production state is used. The prototype reads no app data and has no persistence or backend.

## Shared contract

The full-document arrangement anchors the study: white, Letter proportions, local Lato, max width 612px, selectable wording, and populated sections in order: Education → Experience → Projects → Technical Skills grouped as Languages, Technologies, Concepts. It has no headline, summary, or Certificates. Focused alternatives retain a route back to the full document. One fictional CV/posting/source set is shared across all arrangements.

A sticky review bar remains above the paper and visibly includes wording acknowledgment, Check CV for issues, Check page length, an unavailable approval action, and a review-details control. This is a visual prototype only: check buttons explain that checks have not run, page fit stays unmeasured, and approval is unavailable. Nothing claims verified evidence, a passed check, measured fit, approval, or export. Skill confirm/remove/undo changes only in-memory presentation and updates a clearly demo-only CV annotation; it does not make profile or past-experience claims.

The approved Inline evidence arrangement exposes four named detail views: Sources, New skills, Job match, and Checks & options. Sources pairs selected wording with its cited invented passage and rationale. Job match is illustrative, never a score or verdict. Checks & options describes what did not run. Below 1200px the prototype's requested details use an overlay; Inline evidence also switches to an overlay at 1350px and below. This standalone demo overlay is not the production native dialog or its focus trap. The app shell retains its 220px rail and four inert named destinations above 760px, then changes to named compact navigation (two columns below 520px). The paper is not narrowed to preserve a details rail. Overlays close on Escape and restore focus.

## Arrangements and tradeoffs

1. **Inline evidence (approved):** select CV wording to reveal its cited source and inclusion reason beneath the wording; a wider details column uses a compact 2×2 navigation grid when space permits. This keeps evidence close but adds review-only content to the reading surface.
2. **Review inbox:** illustrative prompts route to an affected CV excerpt and source. Useful for finding a next item, but must not imply a real issue or forced sequence.
3. **Compare mode:** choose one of three fictional claims for spacious CV/source side-by-side reading; return to the document explicitly. Comparison is provenance, not a factual verdict.
4. **Section navigator:** inspect Education, Experience, Projects, or Technical skills in a section-focused paper with contextual notes and a route back to the full CV. Faster scanning sacrifices whole-document context.
5. **Guided pass:** read one claim at a time, reveal its source and advance to the next. Stepwise reading risks hiding the overall document, so full-CV access remains available.

The global theme uses the repository's semantic light/dark colors. UI typography uses Manrope/Sora when locally installed and system sans-serif fallbacks otherwise; no external font fetch is made. Reduced motion is respected and the page does not scroll horizontally at 375px.
