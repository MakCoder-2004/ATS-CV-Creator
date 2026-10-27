# Interaction, content and accessibility contract

## Controls and feedback

- Every action is a semantic button or link with an explicit accessible name. Use Lucide SVG icons already in the application; decorative SVGs are `aria-hidden="true"`. Never use emoji as interface icons.
- Primary action is one per decision area and names the outcome (“Save job”, “Open CV”, “Save changes”). Secondary actions are visually quieter; destructive actions are separated and labeled with the consequence. Keep action labels consistent from trigger through confirmation.
- Hover indicates interactivity but does not disclose the only affordance or information. Provide pressed, selected, disabled, loading and focus-visible states as applicable. Disable while an operation is pending when duplicate submission is unsafe.
- Form fields have persistent visible labels, associated help/error text and accurate `aria-invalid`/described-by relationships. Errors appear adjacent to the field and identify both the problem and correction. Preserve entered values on recoverable failure.
- For asynchronous operations, show progress and announce meaningful state through an appropriate live region. Completion is reported only after success; errors are specific and offer a retry/recovery path. Avoid vague “Something went wrong.”
- Empty states explain what is absent and provide the next useful action. Loading and initialization states indicate that the workspace is opening. Saved local data, privacy and export claims must remain factually accurate.
- Confirm destructive or hard-to-reverse actions; do not add confirmations to reversible low-risk actions.
- Profile CV upload review is source-backed and grouped in a full-width list within the existing My profile structure. Keep proposal review/correction/selection distinct from explicit application; never apply implicitly. AI-assisted extraction is the primary route after local PDF or DOCX reading, with **Continue locally** available at all times before application. Upload and deterministic parsing never invoke AI. Show exact minimized source text, the destination, and the selected Pi provider, model and thinking level. Use one labeled action to authorize and start the request. Do not add a checkbox acknowledgment before that action.

### Saved jobs deletion

- Row checkboxes sit inside Posting cells. Individual **Delete** actions sit inside Next action beside Edit and Open posting. The selection toolbar sits below the heading and contains select-all for only the rows currently shown. Checkbox, select-all, and Delete actions never open a posting.
- A selection toolbar reports the count and starts a preview. Do not open the destructive dialog until the backend returns current job names, companies, and draft counts. Show every selected job in an inspectable list. Focus **Cancel** first and restore focus to the trigger when the dialog closes. After deletion removes the trigger, focus the first remaining row checkbox or the Saved jobs title if no rows remain.
- The confirmation states that deletion removes the selected postings, drafts, and local generation history. It says profile facts and exported files remain untouched, older backups may still contain the jobs, and the workspace offers no undo. Do not claim secure erasure or remote-provider deletion.
- Cancel and recoverable errors retain the selection. A stale preview requires a new review; a busy job requires the person to stop its operation in Tailor CV. Disable duplicate submit. Announce errors and committed success through status or alert semantics. Never announce success before the storage transaction commits.
- After success, refresh Saved jobs and sidebar shortcuts. If the active posting was deleted, clear its Tailor CV selection and show the choose-a-posting state without starting another model run.

### Manual-only job intake and contacts

- Require a manually entered title, company, and complete posting text. Do not provide a job URL field, automatic fetch/research, indexed search, refresh, or Open original action. Intake is explicit and local; saving a posting does not authorize model use.
- Preserve existing source snapshots, historical URLs, posting revisions, drafts, approvals, and backups. Show source URLs only as inert historical provenance; never fetch or open them from Saved jobs.
- Contacts are manually entered, bounded, repeatable, attached only to the current saved-job record, and excluded from all model prompts and generated CVs. Validate optional profile links as HTTPS without credentials. Open a profile only after an explicit, accessible action through the trusted default-browser route; reject localhost/private/intranet URLs, never fetch, enrich, or message. CV Tailor does not inspect external redirect targets; the default browser owns redirect behavior.
- Announce save/validation states and preserve entered values on recoverable failure. Contact edits must not create posting revisions or invalidate CV approval.

### Retired link-intake contracts (historical, not normative)

Older source-research and link-refresh contracts are superseded by issue #116 and are not implementation guidance.

## Keyboard and assistive technology

- All controls work with keyboard alone. Tab order follows visible reading order; Enter/Space activates appropriate controls; Escape closes dialogs/popovers where expected. Navigation indicates the current page (`aria-current="page"`) and workflow indicates the current step (`aria-current="step"`).
- Focus indicator is always visible: 3px solid semantic focus color, 2–3px offset, not clipped or obscured. Do not remove browser focus without an equal or stronger replacement.
- Provide skip-to-content and a focusable main content target. Use landmarks, semantic headings with no skipped levels, fieldset/legend for grouped form choices and table semantics for actual tabular data.
- Dialogs have an accessible title, sensible initial focus, contained focus while open and focus restoration on close. Status announcements should not move focus unexpectedly.
- Minimum target is 40px for desktop actions and 44px for frequently used/touch controls; leave at least 8px between distinct touch targets. Icon-only action targets are at least 42px square. The desktop sidebar collapse control names its current action and exposes expanded state; collapsed page-navigation icons retain their full accessible names and visible selected state. The control is absent from the compact top shell, where page labels remain visible.
- Text contrast meets WCAG AA (4.5:1 normal, 3:1 large); focus/selected/control boundaries meet 3:1 against adjacent colors. Verify both themes; don't infer contrast from appearance.

## Motion and responsive behavior

- Motion responds to user action and clarifies state. Use short 120–180ms color/border changes; avoid decorative entrance choreography. Respect `prefers-reduced-motion: reduce` by removing nonessential transitions and animation.
- Maintain functional keyboard access and logical reading order at 375px, 520px, 760px, 980px, 1000px, 1200px and desktop. No page-level horizontal scrolling. Keep narrow content within viewport; allow a local, keyboard-accessible horizontal stage strip only when needed.
- At narrow widths, stack related columns in semantic order, preserve labels and actions, and never hide essential content/actions solely for space. Do not rely on hover-only interaction.

## Language and content

Use direct, specific, conversational language in sentence case and active voice. User-facing labels describe the task/domain, not internal architecture. Each message does one job. Prefer short instructions; use explicit dates/units and distinguish source facts from generated or suggested content. State privacy and local-storage behavior precisely. Never present prototype fixtures, simulated actions, decorative scores or unverified claims as live product capability.

## Review gate

For every UI change, check: correct page contract; approved theme tokens; typography/line-height; shared left edges and spacing; hover/focus/selected/disabled/loading/error/empty states; keyboard operation and labels; semantic status not color-only; responsive widths; reduced motion; accurate success and privacy copy. Tailor CV and Saved jobs must be visually compared to approved Variant A prototype screens; Profile and Settings must be compared to current production implementation, preserving their structure.
