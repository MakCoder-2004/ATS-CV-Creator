# Visual tokens and layout contract

Values below describe the approved Workbench direction and live app baseline (`src/renderer/style.css`, `prototypes/cv-tailor-ui/src/index.css`). Use semantic CSS variables in components; never paste hex values into component styles when a token exists. New semantic colors require updating this file and both appearance themes.

## Color

### Light appearance

| Token | Value | Meaning |
|---|---|---|
| `--canvas` / `--background` | `#F3F5F8` | Main application background and recessed work area |
| `--surface` / `--card` | `#FFFFFF` | Sidebar, panels, controls, document workspace |
| `--ink` / `--foreground` | `#202D40` | Main text |
| `--muted` / `--muted-foreground` | `#59687D` | Supporting text, secondary labels |
| `--raised` / `--muted` | `#EDF1F7` | Selected/raised neutral surfaces |
| `--line` / `--border` | `#D8DFEA` | Dividers, panel and control borders |
| `--blue` / `--primary` | `#315DCC` | Primary action, selected indicators |
| `--link` / `--interactive` | `#315DCC` | Link and interactive emphasis |
| `--focus` | `#315DCC` | Focus ring |
| `--control-border` | `#8B9BB4` | Input boundary where distinct from structural border |
| `--success` | `#236C52` | Positive status (icon/text accompanies status) |
| `--warning` | `#946007` | Warning status |
| `--error` / `--destructive` | `#B42335` | Error and destructive semantics |
| `--selected-job` | `#F3F6FE` | Selected posting surface |
| `--selected-job-border` | `#D4DEF9` | Selected posting boundary |
| `--warning-surface` | `#FFF8E9` | Warning panel |
| `--warning-ink` | `#65491D` | Warning text |
| `--warning-border` | `#DABD85` | Warning boundary |

### Dark appearance

| Token | Value | Meaning |
|---|---|---|
| `--canvas` / `--background` | `#111827` | Main background |
| `--surface` / `--card` | `#192338` | Panels and controls |
| `--ink` / `--foreground` | `#ECF1FB` | Main text |
| `--muted` / `--muted-foreground` | `#B6C2D6` | Supporting text |
| `--raised` / `--muted` | `#23314B` | Raised/selected neutral |
| `--line` / `--border` | `#35445F` | Dividers and panel borders |
| `--blue` / `--primary` | `#4364CF` | Filled primary action |
| `--link` / `--interactive` | `#A9C1FF` | Interactive text and indicators |
| `--focus` | `#ADC3FF` | Focus ring |
| `--control-border` | `#7182A0` | Input boundary |
| `--success` | `#91DBBB` | Positive status |
| `--warning` | `#F2CF89` | Warning status |
| `--error` / `--destructive` | `#FFB6BB` | Error status |
| `--selected-job` | `#24385C` | Selected posting surface |
| `--selected-job-border` | `#405C8E` | Selected posting boundary |
| `--warning-surface` | `#332B1E` | Warning surface |
| `--warning-ink` | `#F5D9A4` | Warning text |
| `--warning-border` | `#846833` | Warning boundary |

CV paper is a deliberately separate artifact: always white `#FFFFFF`, text `#202838`, Lato, Letter page ratio (612:792), and light document borders regardless of application appearance. The review-stage structured layout is selectable and content-faithful but does not claim exact pagination; the Export stage canvas renders the compiled PDF. PDF is authoritative, while editable Word may reflow. Do not darken or re-theme the CV preview.

Semantic status must never rely on color alone. Pair with a plain-language label and/or recognizable icon. Keep text/background contrast at least WCAG AA 4.5:1 for normal text and 3:1 for large text and graphical controls. Check actual combinations, especially muted text, selected states and dark theme.

## Typography

- **Application body/UI:** Manrope Variable, local font asset; 14px root, weight 450 regular / 650 emphasis.
- **Display/headings:** Sora Variable, local font asset; use only for brand and page/section headings, typically 700–750.
- **CV artifact:** the supplied `resources/cv-template/resume.tex` and `custom-commands.tex` own PDF typography: Lato, Letter paper, 11pt document class with template-defined small bullet text, margins and line spacing. The compiled PDF is black on white. The selectable structured review uses Lato with a readable 1.4 line-height and dark ink; it is not a PDF layout engine. The responsive structured review layout uses a 612:792 paper ratio and grows with content rather than clipping it. Name is visually prominent; an optional evidence-grounded CV title is centered beneath it in restrained Lato (16px in Review, 12pt in PDF and Word), before contact information. Section headings are restrained, ruled and sentence case. Content is left-aligned and document-like, with only identity/contact metadata centered. Paper-only selection and pending-skill annotations use the existing light selected/warning artifact palette regardless of app theme; those annotations never enter exports. Export-stage PDF canvas pages show the actual compiled output.
- **Body line height:** 1.55 (21.7px at 14px). Dense supporting text 1.5–1.65. Do not use below 1.4 for readable text.
- **Type scale:** page title 23–30px responsive, weight 750, tracking `-0.04em`; section title 16–17px, weight 700; body/control 14px; labels and metadata 12–13px; fine metadata 10–11px only for nonessential supporting details. Never use 10–11px for instructions, validation, or primary content.
- Sentence case throughout. Headings and body are left-aligned; center alignment is reserved for concise empty states or centered document metadata. Do not justify text.
- Keep explanatory text to 50–70 characters per line where practical; long-form reading should not exceed 80 characters per line.

## Spacing and alignment

Use a 4px base grid and these permitted steps: `4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64px`. Use 4/8 for inline/icon gaps, 12/16 for control interiors, 16/24 for panel gaps, 24/32 for section separation, 40+ for major page breathing room. Do not apply arbitrary one-off spacing values except when matching an existing documented page metric.

- Desktop shell: 220px expanded sidebar or 64px collapsed icon rail + `minmax(0, 1fr)` main column. Sidebar remains full viewport height and sticky; scroll within it only when content overflows. At 760px and below, use the existing compact top shell regardless of the stored desktop collapse preference.
- Main header: 68px minimum height; horizontal padding 28px; content vertically centered.
- Page title band: 26px top, 28px horizontal, 23px bottom. Page content aligns to the same 28px left/right content edge.
- Content containers use `min-width: 0`; avoid horizontal overflow. Long text wraps with `overflow-wrap:anywhere` only for untrusted/user-provided strings.
- Use consistent left edges for page title, sections, form labels and content columns. Align related controls on their label baseline; align action groups to the end of their section/footer.
- Profile/settings may retain their existing content-driven max widths and grid structure; page-specific rules are in `pages.md`.

## Shape, borders, elevation

- Small controls: 5–6px radius; standard controls/panels: 6–8px; larger settings blocks: 10px; pill shape only for category/status chips.
- Standard structural border: 1px solid `--line`. Use inset selected indicator only to reinforce selection, never as the sole cue.
- Default is flat surfaces with no decorative gradients and no ambient card shadows. The segmented appearance control may use its existing subtle selected-control shadow. Avoid nesting bordered cards without clear grouping purpose.
- Buttons and inputs: minimum 40px high for primary/secondary actions; 44–48px for frequently used or full-width controls. Icon-only buttons are at least 42px and have an accessible name.

## Responsive behavior

- Review evidence refinement: use a 24px title in the compact heading, a 20px document/context gap, and a 660px document track and an optional context column taking the remaining width when at least 400px fits beside the 20px gap. Otherwise details use a requested dialog. The review paper retains its 612px maximum width and uses a fixed readable 14.667px body rather than shrinking type with the column; use 32px paper padding on wide windows, 24px at 760px and 20px/16px below 520px. The sticky review bar uses 16px/20px padding, 12px internal gaps and an 8px viewport inset; its measured height determines focus scroll margins. Review dialogs are at most 680px wide, use 24px form padding and 16px field gaps, and constrain height to viewport minus 48px. Context dialogs below 1200px are at most 560px wide. These are review-only app controls; the compiled template's typography, spacing and page geometry do not change.
- 1200px: profile section navigation wraps from 9 columns to 3; review details switch by available workspace width (at least 1080px for the full paper track and useful detail column), not viewport width alone.
- 1000px: Saved jobs columns stack; Settings become single-column at 980px.
- 760px: global desktop sidebar/header changes to compact top shell, nav becomes 4 columns, content horizontal padding becomes 16px; global header and desktop-only job rail/footer are hidden only where current implementation specifies.
- 520px: nav becomes 2 columns, profile forms and two-column field groups stack, profile toolbar and list actions wrap/stack.
- Preserve reading order and all functionality at 375px, 768px, 1024px and 1440px. Never create horizontal page scrolling; localized overflow (e.g. a stage strip) must remain keyboard-scrollable.
