# Review evidence browser — five layout concepts

Design-only exploration for the existing Review evidence phase. These are alternate arrangements of real review content, not new capabilities. All five retain the approved Variant A Workbench shell, title/job context, sticky and reachable review action bar, a white Letter-proportioned selectable CV in Lato (max 612px; Education → Experience → Projects → Technical Skills), and the actual review controls. No summary, headline, Certificates, fake checks, approval, ATS score, export, or provider action is introduced. Export remains its own phase.

## Shared content and truth rules

The CV is the anchor. Details can navigate among **Sources**, **New skills**, **Job match**, and **Checks & options**. Sources distinguishes linked evidence from profile context and shows actual source wording on request; absent linked sources are stated plainly. New skills contains only actual pending posting-derived suggestions and the real confirm/remove/undo decisions; a user's confirmation is a draft-local declaration, not saved-profile evidence. Job match reports the actual qualification comparison with evidence and uncertainty (not an ATS score or categorical lack). Checks & options shows actual findings, current target, and measured page fit; no success is implied before the operation succeeds. These regions are navigation/context, not evidence claims. No fixture data may be described as live product state.

For every concept, keep semantic reading order and visible focus; action-bar scroll margin tracks its measured height. At 1440px use the 220px shell rail plus document and optional 304px details; at 1200px and other widths where the 612px paper plus 304px details do not fit, details become a requested dialog and the paper is never squeezed to make room. At 375px preserve the 16px paper inset/20px paper padding, full-width stacked content and actions, no page horizontal scrolling; the detail dialog is reachable and dismissible. Tab order follows visual order, every toggle/view/action has an accessible name, focus returns to its trigger or selected wording, and no information depends on hover. Standard app tokens and both themes apply; CV paper stays white.

## 1. Compact focus rail

Keep the CV dominant and make context navigation a narrow, persistent rail beside it. The rail changes its contents in place; selected wording opens Sources and aligns the selected excerpt to the item. The action bar remains above both columns.

```text
1440  Workbench shell | Review / job context
      [sticky: next action · checks · fit · acknowledge · actions]
      ┌────────────── CV paper (≤612) ──────────┐ ┌─ Details rail (304) ──┐
      │ Education → Experience → Projects → ... │ │ Sources   │ New skills│
      │ selected wording                        │ │ Job match │ Checks    │
      └──────────────────────────────────────────┘ │ Job match │ Checks    │
                                                   │ selected evidence     │
                                                   └───────────────────────┘
1200  same CV; rail opens as requested dialog
375   action bar → CV → [Show review details] → full-width dialog
```

- **Hierarchy:** document first; persistent bar; a compact 2×2 grid of named view buttons sits above the relevant detail. Each button has a minimum 44px target and readable text; the grid reduces navigation height without shrinking labels. Rail can remain open without changing paper width. Actions stay in the bar; record/wording editing stays attached to selected content/details.
- **Sources / skills / match / checks:** always-visible destinations, including accurate empty/unavailable copy. Counts only when backed by actual current data. Current selection and source link are explicit, not color-only.
- **Tradeoff:** easy orientation and quick view switching; persistent rail competes visually with evidence and feels busy on shorter windows. The 1200px dialog transition must retain current selection and focus.
- **Keyboard/responsive:** four named buttons, each at least 44px high, in a logical 2×2 group; do not make an unlabelled icon rail. At 1200 and below use the existing accessible dialog model; at 375 details follow the document rather than narrowing it.

## 2. On-demand source drawer

Make review reading calm: the paper occupies the full reading column, and contextual material appears only when explicitly requested. A clear “Review details” control in the action bar or selected wording opens a side drawer at desktop and a modal dialog below 1200px.

```text
1440  Workbench shell | Review / job context
      [sticky: next action · checks · fit · acknowledge · actions]
      ┌────────────────── CV paper (≤612) ──────────────────┐
      │ selected wording                         [Sources]   │
      │ ...                                                  │
      └──────────────────────────────────────────────────────┘
      [Show review details] → ┌─ 304px drawer ───────────────┐
                              │ Sources | New skills | ...   │
1200  CV full width; requested details dialog (≤560)
375   CV full width → requested full-width modal dialog
```

- **Hierarchy:** title/context, sticky action bar, uninterrupted CV; details are subordinate and user-triggered. Selected wording exposes an obvious route to its source. Close returns focus to the selected wording or opener.
- **Sources / skills / match / checks:** drawer header offers four separately named views; selected source text uses the established slim interactive-colored rule. New skills and findings remain actionable only where real operations exist. No drawer badge invents a count or readiness.
- **Tradeoff:** maximal document focus and uncluttered reading; evidence takes an extra action to reach and may be overlooked. Keep the details affordance visible and named.
- **Keyboard/responsive:** drawer is non-modal complementary content at desktop; below 1200px use a titled, focus-contained dialog, Escape close and focus restoration. At 375px no behind-dialog controls are presented as available.

## 3. Wide evidence shelf

Put the selected excerpt and its provenance in a horizontal shelf below the paper, like a reading footnote. It can be opened for the current selection without displacing the CV into a third column. Use a bounded, scrollable shelf region only when content needs it.

```text
1440  Workbench shell | Review / job context
      [sticky: next action · checks · fit · acknowledge · actions]
      ┌──────────────────── CV paper (≤612) ─────────────────┐
      │ selected wording                                     │
      └──────────────────────────────────────────────────────┘
      [Sources] [New skills] [Job match] [Checks & options]
      ┌──────────── Evidence shelf; current view ─────────────┐
      │ selected excerpt | source / finding / next action     │
      └──────────────────────────────────────────────────────┘
1200  at the <1200 breakpoint, requested details open in a titled dialog (≤560px); paper stays full width
375   requested dialog stacks view tabs and shelf content below the paper; no horizontal page scroll
```

- **Hierarchy:** CV first; the shelf is a secondary, selection-linked reading surface, not a second document. The shelf never replaces or overlays the sticky review actions. Avoid nested card chrome; one quiet structural divider is enough.
- **Sources / skills / match / checks:** shelf tabs are four explicit buttons. Sources shows linked source names and expandable source wording; other views show only their real records and actions. The active view and selected CV item are announced.
- **Tradeoff:** preserves paper width while keeping evidence adjacent and visible; increases vertical length and can push secondary context below the fold. Do not make essential actions dependent on reaching the shelf.
- **Keyboard/responsive:** keyboard-operable tabs (or buttons with clear focus and selected state); retain shelf heading and selection on switching. On 375px stack controls and text, no horizontal page scrolling; any long source excerpt wraps.

## 4. Next-decision queue

Organize review context by the next user decision rather than by data category: a short queue identifies actual unresolved items and routes each to its relevant detail. The paper remains primary; queue entries never infer readiness or add a synthetic score.

```text
1440  Workbench shell | Review / job context
      [sticky: next required action · real checks · fit · actions]
      ┌────────────────── CV paper (≤612) ──────────────────┐ ┌ Queue ───────────┐
      │ ...                                                  │ │ New skills (n)   │
      └──────────────────────────────────────────────────────┘ │ Check findings   │
                                                               │ Page fit / wording│
                                                               └──────────────────┘
      Select queue item → detail view: Sources | Skills | Match | Checks
1200  CV; queue/detail opened only on request in dialog
375   CV → “Review details” → queue then selected detail, stacked
```

- **Hierarchy:** bar says the next genuinely required action; queue lists unresolved decisions supported by current state, then CV remains reading anchor. A resolved or empty queue says what is actually known, not “all clear” unless checks confirm it.
- **Sources / skills / match / checks:** queue entries deep-link to one of four named detail views; Sources remains accessible even when no action is pending. New skill confirmation/removal is explicit and undoable when supported. Match uses cautious categories and source names; Checks show real report and measurement.
- **Tradeoff:** makes review sequence legible and reduces hunting; could imply a forced workflow or hide useful evidence once no item is “next.” Retain direct access to all views and allow reading/editing in any order.
- **Keyboard/responsive:** queue items are descriptive buttons with visible focus and clear selected state. At 1200px and down, details use the requested dialog; on mobile announce and present queue before detail, preserve the selected item when closing.

## 5. Paired source comparison

When a wording item is selected, offer an explicitly requested comparison sheet/dialog that gives the CV wording and linked source room to be read at full measure. The paper remains the primary surface when the comparison is closed; the pair is for inspecting provenance, not an automated factual verdict. Other views retain their own, non-comparison structure.

```text
1440  Workbench shell | Review / job context
      [sticky: next action · checks · fit · acknowledge · actions]
      ┌────────────────── CV paper (≤612) ──────────────────┐
      │ selected wording                         [Compare]   │
      └─────────────────────────────────────────────────────┘
      [Sources] [New skills] [Job match] [Checks & options]
      Compare → ┌──────────── requested sheet/dialog (≤680) ───────────┐
                │ CV wording (readable text) | Linked source (readable) │
                └─────────────────────────────────────────────────────┘
1200  requested dialog ≤560; CV stays full-width behind/when closed
375   dialog ≤560: CV wording then Source, stacked, readable line length
```

- **Hierarchy:** CV remains the main artifact. A named Compare action opens the requested sheet/dialog (max 680px at desktop, max 560px below 1200px); the closed state returns to the full document and preserves its selection. Inside, selected wording and each linked source are clearly labeled, comfortably readable blocks, not tiny columns in the 304px rail. Multiple linked sources appear as separate records. No source is shown as “missing” evidence that the draft nevertheless claims.
- **Sources / skills / match / checks:** paired comparison is limited to actual linked source material; no fabricated source text or implied match. Other named views still expose pending skills, cautious qualification comparison, and real checks/page fit separately.
- **Tradeoff:** makes discrepancies and provenance easy to inspect; wide text can be hard to scan and a side-by-side format suggests equivalence even when source text only partially supports a sentence. State provenance and limitations plainly; avoid automated “match” coloring/verdicts.
- **Keyboard/responsive:** the Compare action is keyboard reachable and named; the titled dialog/sheet contains focus, closes on Escape, and restores focus to the selected wording or Compare trigger. Read CV wording then source with headings; do not rely on synchronized scrolling or color. At 1440px cap the requested surface at 680px; below 1200px cap it at 560px. At 375px stack the pair in that semantic order with readable wrapping and keyboard-accessible source disclosure.
