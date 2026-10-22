# Shipped workflows

This page describes what the current installed application supports. It is a reference for product changes, not a description of the browser-only prototype or a plan for future job discovery. The [architecture map](architecture.md) identifies the code that owns each boundary.

## Prepare a tailored CV

The Tailor CV page moves through five stages in [`WorkbenchStart.tsx`](../src/renderer/WorkbenchStart.tsx) and [`WorkbenchStageLayout.tsx`](../src/renderer/WorkbenchStageLayout.tsx).

1. **Job posting.** Select a saved job or add one in Saved jobs. The accepted working posting, not a separate captured source snapshot, is the input for assessment.
2. **Outgoing data.** Inspect the minimized posting and profile facts. Accept the run-scoped outgoing-data preview and any required terms acknowledgment. Authorization starts posting analysis for that run; an analysis failure offers an explicit retry. Neither an older cache entry nor a prior approval authorizes a new run.
3. **Generate.** Read the analyzed required and preferred qualifications, tools, responsibilities, and keywords. Choose a one- or two-page target, then explicitly generate. The application selects profile evidence and asks the model for structured, cited wording. Generation progress reflects recorded work, and interrupted runs have explicit recovery or cancellation paths.
4. **Review evidence.** Inspect the document and its cited sources. The inspector groups Sources, New skills, Job match, and Checks & options. Posting-only skill suggestions are marked **Not in your profile**. Confirm or remove each suggestion before approval. Confirmation applies to this CV only and does not establish past work with the tool. Edit wording or add and remove records using selected evidence, run factual checks, measure the actual PDF page fit, resolve findings, and acknowledge the current wording before approval. A proposed page cut changes the draft only after acceptance and clears the prior checks and approval.
5. **Export.** Review the actual compiled PDF. Export the approved content as a selectable PDF or editable DOCX. The DOCX uses the same canonical content but can paginate differently. A draft edit, changed source, or changed posting can require renewed review before export.

The PDF uses Letter paper and Lato, with Education, Experience, Projects, and grouped Technical Skills. It has no summary, target headline, or Certificates section. Profile facts remain in the profile even when a section is omitted from a particular CV. The model does not write LaTeX. Evidence and deterministic checks support review but do not prove that a statement is true or that a CV will pass an ATS.

## Save and refresh a job posting

[`SavedJobs.tsx`](../src/renderer/SavedJobs.tsx) supports manual entry and a link flow for named Lever detail pages. Link intake runs a bounded fetch, presents extracted fields and conflicts for correction, and saves only after the person accepts the preview. A refresh compares new source wording against the accepted working posting. The user decides whether to keep each correction or take updated source details. Source snapshots and accepted posting revisions remain separate in [`jobs.ts`](../src/shared/jobs.ts). Unsupported sites use manual entry; fetching a page is not consent to send its text to OpenRouter.

A saved draft can still target an earlier posting revision. The review workspace labels it as earlier wording. The user can inspect a new outbound preview and either generate a new draft or renew review of existing wording against the current posting. Approval for an earlier posting does not automatically cover the new revision.

## Maintain a profile

[`ProfileEditor.tsx`](../src/renderer/ProfileEditor.tsx) edits contact information, skills, education, certificates, summary, languages, and other facts. Experience and projects use their own record editors. The profile records facts for future drafts; CV-only edits do not silently rewrite it. Manual draft-record operations can explicitly target the CV alone or both the CV and profile, with source history retained. A new factual assertion requires current saved evidence; declaring a wording-only change is not a truth guarantee.

PDF and DOCX profile uploads produce temporary proposals, not automatic profile mutations. The user selects changes to apply. Optional AI structuring has a separate minimized-text preview and consent before any provider request, and its output remains proposals. Profile JSON export and import are a separate exchange and replacement flow. These paths are implemented in [`src/main/profile-pdf-import-ipc.ts`](../src/main/profile-pdf-import-ipc.ts), [`src/main/profile-docx-import-ipc.ts`](../src/main/profile-docx-import-ipc.ts), and [`src/main/profile-exchange-ipc.ts`](../src/main/profile-exchange-ipc.ts).

## Manage settings and backups

Settings stores appearance, OpenRouter model preferences, protected API-key data, faithfulness-check preference, and local analysis budgets. The app keeps the key locally with Electron secure storage when available; it does not bundle a key. Removing a local key does not revoke it at OpenRouter. Model calls depend on an explicit run authorization and provider-capacity checks. [`OpenRouterSettings.tsx`](../src/renderer/OpenRouterSettings.tsx) and [`workbench.ts`](../src/main/workbench.ts) implement this path.

[`WorkspaceBackup.tsx`](../src/renderer/WorkspaceBackup.tsx) exports the local workspace. Restore previews the replacement, validates known records, makes a safety copy, and then reopens the workspace. A backup excludes the API key and restored consent cannot authorize new cloud work. The application's backup path is the supported restore operation; a raw SQLite file copy is not.

## What is not shipped

The documents under [research on later features](research/ai-job-search-adoption-plan.md) include possible job discovery, cover letters, application tracking, interview aids, and other later features. They are research and proposals, not installed features. [`prototypes/cv-tailor-ui/`](../prototypes/cv-tailor-ui/) contains browser-only design evidence. The [frontend design system](../design%20system/README.md) is normative for UI work, but a prototype fixture is not a persisted record or a promise of production behavior.
