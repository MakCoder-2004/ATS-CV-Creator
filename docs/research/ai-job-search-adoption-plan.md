# Adopting useful AI Job Search capabilities in CV Tailor

**Status:** historical research-backed proposal, not a current implementation specification. Link intake and profile upload have since shipped in narrower forms; check [current workflows](../workflows.md) and code before treating an item here as unimplemented.\
**Date:** 2026-10-21.\
**User direction confirmed during research:** expand into a **phased job-search workspace**; cover discovery/ranking, application writing/review, tracking/interviews, and profile enrichment/learning; prioritize **Egypt/MENA**. **Requested addition:** paste a job-posting link and automatically extract its details instead of copying the posting text. **B1 behavior was confirmed through four design-interview rounds and a final shared-understanding confirmation; its spec and approved child tickets were subsequently published without starting implementation.** **Additional confirmed feature:** upload a text PDF or DOCX in My profile, automatically map it into compatible profile data, review add/update/skip proposals, and fill the profile after confirmation; local first, with optional separately authorized AI structuring.\
**Local baseline:** commit `4b301370ea8fa0cae49517a91b529e64302f58c6`, plus the working tree inspected during research. Existing `package.json`, `package-lock.json`, and `CV/` changes were not modified.
**External baseline:** [`ashishpatel26/ai-job-search` at `30158c0493ae8ae1610769955ad04b189049afe8`](https://github.com/ashishpatel26/ai-job-search/tree/30158c0493ae8ae1610769955ad04b189049afe8).

## 1. Recommendation

**Adopt the other repository's lifecycle ideas, not its Claude Code runtime or filesystem-driven architecture.** Evolve CV Tailor from “prepare a CV for a saved posting” into:

> Collect opportunities → understand fit → prepare an evidence-backed application package → record what was submitted → prepare interviews and follow-ups → learn from recurring gaps.

Keep the existing CV workbench intact inside that larger lifecycle. The highest-value first additions are:

1. **Explainable fit evaluation before drafting**, with a reusable shortlist and candidate preferences.
2. **Evidence-backed cover letters and an optional critique pass**, reusing the present generation safeguards.
3. **A real application record with immutable submitted materials**, not just a saved posting or an exported file.
4. **Paste-link job-posting import and carefully scoped Egypt/MENA discovery**: automatically extract a single posting from a supported public URL, with review before saving and manual text as fallback; expand to sources that actually permit integration.
5. **Early standalone CV-to-profile upload**, with explicit confirmation before extracted facts become evidence; selected public-source enrichment and interview preparation remain later additions.
6. **Repeated-gap learning plans and outcome summaries**, once enough useful records exist.

Do not make autonomous application submission, LinkedIn scraping, Gmail access, Notion sync, a generic plugin system, or arbitrary template execution prerequisites. Each adds substantial access, security, maintenance, or product complexity without improving the core evidence loop first.

### What “agents” should mean here

Use bounded, purpose-specific LLM tasks—evaluate fit, draft a letter, critique wording, prepare questions—behind typed application commands. CV Tailor already uses a LangGraph-based generation workflow. It does not need Claude Code, Python, Bun, a shell-capable agent, or a new general-purpose agent runtime to acquire these capabilities. A second reviewer can be a separate structured model request with a deliberately limited input packet; it need not be an autonomous process.

## 2. What the external repository actually provides

The detailed evidence is in [the pinned source audit](ai-job-search-source-audit.md). Most high-level capabilities are **Markdown instructions interpreted by Claude Code**, not reusable application implementations. Portal CLIs, some state-management helpers, salary lookup, and PDF/layout checks are executable code. This distinction affects effort: adopting a workflow is product engineering, not installing a library.

| Capability verified in upstream source | Value to CV Tailor | Adopt / adapt / defer |
| --- | --- | --- |
| Document-folder, pasted-CV, and interview-style onboarding | Reduce manual profile entry and improve available evidence | Adapt into local extraction plus editable proposals; never silently trust imported claims |
| Writing-style preferences and optional behavioral/career context | Less generic letters and better preference matching | Adopt concise user-controlled preferences; do not require personality assessments |
| Multi-portal discovery, source tracking, deduplication, freshness states | Build a reusable shortlist | Adopt acquisition/state patterns; replace Denmark-specific source assumptions |
| Profile-based fit rubric, deal-breakers, language/location handling, batch ranking | Avoid spending time and tokens on unsuitable postings | Adopt explainable dimensions and uncertainty; do not copy fixed weights or claim hiring probability |
| CV plus cover-letter drafting | Complete an application package | Add the letter while preserving our exact CV template and existing approval rules |
| Separate drafter/reviewer, company research, revise loop | Catch generic writing and unsupported employer statements | Adapt into optional, bounded critique and separately sourced research |
| Relevance-weighted content cuts and actual PDF inspection | Better fit without deleting valuable older evidence first | Extend current measurement/cut proposals; keep user acceptance mandatory |
| Application archive, outcome history, reminders and follow-up drafts | Preserve continuity after export | High priority; record exact submitted bytes and user-confirmed submission |
| Stage-specific interview packs and mock interviews | Reuse the materials an interviewer actually saw | Adopt after submitted-material archive and confirmed story records exist |
| Public-profile enrichment | Surface useful project details | Later, selected sources only, as proposals needing confirmation |
| Skill-gap heatmaps and learning plans | Make repeated gaps actionable | Add after stable requirement/profile matching; learning is not career evidence |
| Offline dashboard | See pipeline and follow-up workload | Build a native local summary over SQLite; do not generate HTML with an LLM |
| Salary lookup | Help assess compensation | Keep disclosed compensation fields first; defer benchmarking until a licensed, current regional dataset exists |
| Gmail-derived status proposals | Reduce tracking effort | Defer OAuth/email scope and hostile-email risks; manual outcomes first |
| One-way Notion sync | Optional mobile/glanceable view | Defer; workspace remains local and authoritative |
| Custom templates and generated portal skills | Broad extensibility | Do not import arbitrary executable toolchains/plugins into the desktop app |
| Networking links | Find relevant employer career/people pages | Optional external links; no contact scraping, inferred relationships, or automatic outreach |

Upstream's reported hiring success is a self-reported anecdote, not evidence of causal benefit. Its factuality instructions and reviewer are not proof that generated claims are true. Its privacy documents also conflict: SECURITY describes profile data as gitignored, while README warns that setup personalizes tracked files; the actual ignore rules do not protect those tracked profile files. Do not copy that storage/public-fork pattern. Its MIT license does not grant permission to scrape job boards or redistribute their datasets. See the source audit for exact limitations and licensing references.

## 3. Baseline at the time of research

This table records the source inspected on 2026-10-21. It is not maintained as the current feature inventory. Link intake, PDF/DOCX profile import, and full-profile qualification comparison shipped later in narrower forms. For current behavior, read [shipped workflows](../workflows.md) and the cited source. Evidence pointers for the original baseline are in §16.

| Area | Implementation at research baseline | Gap proposed at research baseline |
| --- | --- | --- |
| Profile | Local structured CRUD, stable evidence revisions, historical snapshots, JSON exchange | General career-document ingestion, source passages, merge proposals, confirmed interview stories, target-role preferences |
| Saved jobs | Title, company, original description, timestamps, reopening | Automatic extraction from a pasted posting URL; source URL/ID, location/work arrangement, deadlines, deduplication, independent posting revisions and acquisition state |
| Posting analysis | Explicit required/preferred qualifications, tools, responsibilities, keywords; compatible caching | Structured requirement IDs/source passages, employment constraints, confidence/unknown states, pre-draft fit |
| Evidence selection | Batched relevance scoring against the posting and page-budget selection | A user-facing job-fit decision before generating a CV; scoring evidence is not scoring an opportunity |
| Gaps/coverage | Evidence-supported wording heuristic over drafted items | Profile-wide fit before drafting, richer supported/unknown/conflicting distinctions, recurring-gap analysis |
| Writing and review | Cited CV content, deterministic factual checks, optional semantic comparison, editing and replacement proposals | Cover letters, writing preferences, critique focused on relevance/style, separately sourced company context |
| Documents | Exact Letter/Lato CV template; local bundled pdfLaTeX; actual PDF page count/text/reading-order/link checks; PDF and DOCX | Better cut ranking and layout diagnostics; a separately approved cover-letter document model |
| Lifecycle | Draft/check/approval state and export | Application status, submission history, exact submitted package, interviews, reminders and follow-up drafts |
| Reliability/privacy | Minimized outgoing bundle, run-specific consent, encrypted key, request/time budgets, cancellation, durable checkpoints, explicit recovery | Purpose-specific authorization for new data categories and destinations; aggregate batch budgets; token/cost observations |
| Backup | Full workspace format with explicit tables/schema validation and secret exclusion | Forward migration and backward-compatible backup import before new tables/assets are introduced |

**Profile-import history:** older issue #6 describes a reference-PDF importer, but [merged PR #24](https://github.com/MakCoder-2004/ATS-CV-Creator/pull/24) removed its UI and application interfaces. At the time of this research, the public bridge did not expose it. A redesigned PDF/DOCX upload with review-before-apply and optional separately authorized AI structuring has since shipped; it is not the removed importer restored unchanged.

**Important document nuance:** our actual compiled PDF text/reading-order checks already cover a large part of upstream's “ATS parseability” story. The missing value is better diagnostics and content selection, not another third-party ATS upload or an invented ATS score.

**Scope conflicts:** discovery, cover letters, interview tools, external research, and broad document import expand areas originally excluded by issue #1. Current OpenRouter and Letter/Lato decisions also supersede older Gemini/A4 descriptions. This document proposes future scope; it does not silently rewrite the original specification or the normative design system. Arabic processing is a separate decision from choosing Egypt/MENA as the target market.

## 4. Product principles and non-negotiable invariants

1. **A posting describes the employer's request, not the candidate's qualifications.** Missing profile support means “no saved evidence,” not necessarily “you cannot do this.”
2. **Preference fit, factual support, document quality, and application outcome are separate things.** Never collapse them into an “ATS success” percentage.
3. **Unknown stays unknown.** Missing salary, work authorization, language level, deadline, or office policy must not be guessed.
4. **Human decision before an external consequence.** No auto-apply, automatic emails, offer acceptance, profile writes, or automatic status changes from model output.
5. **Existing drafts and approvals remain meaningful.** New features do not silently change CV wording, its exact template, locked historical titles, or approval hashes.
6. **Career evidence and company research are different source classes.** A company webpage cannot support a statement about the candidate; a repository's technology list does not prove individual authorship or expertise.
7. **No additional recipient or private category under old consent.** Public browsing, private model analysis, and future third-party sync are distinct operations with explicit scope.
8. **Local storage is not local inference or automatic encryption.** SQLite, backups, source documents, salary preferences, and interview notes can contain sensitive information.
9. **Read and review offline.** Network-dependent features fail independently without preventing access to existing profile, postings, submitted files, or interview packs.
10. **No framework tax.** Add the smallest useful modules at real seams, not a generic multi-agent platform, vector database, or marketplace before a demonstrated need.

## 5. Feature specifications at planning depth

These are proposed behavior and acceptance directions. Final screens, schemas, and implementation tickets follow prototype approval, not the other way around.

### A. Candidate preferences and explainable pre-draft fit — first product increment

**User value:** decide which postings deserve attention before generating documents.

**Proposed behavior**

- Capture target roles/seniority, locations, onsite/hybrid/remote preferences, timezone constraints, relocation, user-declared work eligibility, spoken-language levels, and optional compensation expectations.
- Distinguish hard constraints from preferences. Keep fields optional; never infer nationality, eligibility, age, religion, or protected attributes from names, schools, location, or language.
- Extend posting analysis with stable requirement IDs, exact source passages, required/preferred status, and explicit employment constraints. Retain original wording alongside normalized terms.
- Evaluate against the full relevant confirmed profile, not just the facts selected for a one-page CV.
- For each requirement, show **supported**, **partly supported**, **no saved evidence**, or **unclear**, with evidence or a reason. Distinguish transferable evidence from an exact match.
- Separately show explicit preference conflicts and questions to ask the recruiter. “Remote” is not equivalent to “can hire from Egypt.”
- Start with qualitative fit bands and a visible dimension breakdown: role skills, experience/responsibility, career direction, and practical eligibility/preferences. If numeric ranking is later needed, expose a versioned rubric and user-controlled weights; do not import upstream's fixed weights as a universal truth.
- Hard-gate only an explicit, user-chosen deal-breaker supported by explicit posting data. Unknown eligibility gets a flag, not a silent rejection. Let the user inspect excluded results and reverse shortlist decisions.
- Explain how to improve an incomplete profile without converting a missing keyword into a factual claim.

**Acceptance:** a synthetic Cairo role with Python support, absent Docker evidence, and unclear visa/onsite terms shows those three different conditions. Fit can be saved without generating a CV; a profile/preference/posting revision makes the assessment stale. A substantial gap never prevents the user preparing an honest CV.

**Reuse:** posting extraction, profile snapshots, authorized dispatcher, evidence revisions, coverage concepts. Add a distinct fit record; do not rename draft coverage or the current evidence-relevance scores into job fit.

### B. Paste-link import, capture, shortlist, deduplication, and permitted discovery

**User value:** paste a job-posting link and let the app collect the details, instead of manually copying the description; maintain one trustworthy queue of opportunities from regional boards and employer sites.

#### B1. Single-posting link import history

Lever-only link intake and explicit preview/accept/refresh later shipped. The following is the original proposal, not a claim that every proposed source or workflow is supported today. See [shipped workflows](../workflows.md) and [link release validation](../validation/link-11-release-2026-10-22.md).

**Published specification at the time:** [#26 — Import a job posting from a supported link](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/26). Publication had not started implementation at that point.

**Confirmed design:** the behavior below was agreed in four grilling rounds and a final confirmation. Remaining source-specific feasibility, exact safety ceilings, and UI prototyping are implementation prerequisites, not permission to change these product decisions silently.

**Primary flow:** **Paste job link → explicitly Fetch posting → Review/correct details → explicitly Save job.** Existing tailoring remains available afterward; fit, ranking, and broader discovery are not prerequisites. On supported pages, the user should not have to type the title/company or copy any description text.

##### User flow and source support

- Offer **Import from link** alongside the existing paste-text route in an approved add-job intake. Accept one public HTTPS posting URL, not a search query or crawl. Show the hostname before fetching.
- **No request merely on paste, opening the intake, reopening a saved job, or starting the app.** Only an explicit **Fetch posting** or **Refresh** initiates retrieval; no background polling or prefetching.
- Version one fetches only sources on a **reviewed support list**, including recognized permitted provider endpoints/employer-board patterns. Unknown hosts get an unsupported-source explanation without a speculative page fetch. A provider supporting many employers does not authorize arbitrary URLs or unrestricted paths on its host.
- Establish source access/terms and tested extraction behavior before adding a supported entry. Publish a support matrix; accepting paste-text fallback for LinkedIn/WUZZUF/Bayt or other restricted/unsupported sources is an explicit user decision, not a defect to bypass.
- Automatically populate title, company, full description/responsibilities/requirements, and optional location, work arrangement, employment type, compensation, source language, posted date, deadline, and application URL **only when present in the source**. Missing optional fields remain unknown. Do not infer values or invent an exact posting date from an ambiguous age label.
- Preserve meaningful headings, paragraphs, and bullets. Exclude navigation, ads, cookie notices, related jobs, and application-form fields. Never silently truncate, summarize, translate, or rewrite posting content during import.

##### Local extraction, completeness, and conflict handling

- Extract locally: first a documented posting-detail endpoint when a recognized source permits it; otherwise explicit structured posting data such as `JobPosting` JSON-LD, then supported source-specific selectors or bounded readable-HTML extraction. The support policy applies to every method; generic HTML parsing is not permission to contact unknown websites.
- **No website JavaScript execution, hosted scraper, model request, browser login/session reuse, or personal browser cookies in version one.** A JavaScript-only page with no permitted static/detail-data path gets a clear fallback. Isolated browser rendering or cloud extraction needs a separate future proposal, not a hidden fallback.
- Validate schemas and source completeness signals. A schema-valid teaser is not a complete description. Multiple postings, search/listing pages, removed-role pages, and material disagreements between structured metadata and readable text must not be silently resolved as a successful import.
- Show competing values with their source when title/company/location/salary or other material details disagree. Require the user to resolve material conflicts before saving; never calculate a compromise value. Optional absent fields do not block saving.
- Show partial extraction for correction, but **block Save job until essential content is supplied or consciously confirmed complete**. Provide manual text entry for missing content and keep provenance of corrections; do not disguise a teaser as a complete source. Completeness checks are limited heuristics plus human review, not proof that every webpage fragment was captured.

##### Temporary preview and explicit acceptance

- Show an editable **posting import preview** with source link(s), retrieval time, extracted fields/text, validation notices, and source-versus-user-correction distinctions. Fetch success is not save success and not a truth/availability guarantee.
- Previews remain temporary: **do not persist preview text or edits in the database, backups, crash-recovery records, or disk logs before Save job**. Closing discards the preview; warn before losing user edits. App exit/crash does not recover unfinished imports in version one.
- Cancellation aborts queued/in-flight work where supported; late responses cannot replace a newer preview, change saved records, or trigger analysis. Keep the URL and correction controls available on recoverable errors within the open intake.
- **Save job** atomically persists the accepted working posting, source snapshot/provenance, and relevant posting revision through an extended typed application contract. Today's title/company/description-only `saveJob` contract cannot represent this by itself; it must be evolved with validation, transactional persistence, and backup migration. There is no saved mutation on fetch or preview alone.
- Fit/generation still requires its own outgoing-data review and authorization. Saving never starts model work or spends OpenRouter requests automatically.

##### Source snapshots, working postings, and refresh

- Preserve the **posting source snapshot** separately from the accepted **working posting**. Retain captured wording, original extracted values, submitted URL, validated final URL, stable provider ID when available, retrieval time, extraction method/version, source hash, and field provenance on acceptance. Store cleaned source text/data rather than active HTML; never render executable source content.
- A **posting revision** records an accepted version of reviewed details. User edits must not overwrite source wording; a source refresh must not overwrite user edits. Retain earlier accepted revisions/snapshots for inspection and historical references.
- An unchanged match offers **Open existing** without creating a duplicate or a needless posting revision. A changed match offers **Review changes**, showing previous source, current working posting, and newly fetched source. Preserve current wording by default; the user explicitly accepts replacement fields/text. **No automatic merge or overwrite.** Detect intervening edits before accepting a preview.
- Accepted changes to requirements mark affected current fit results and CV targeting/readiness as **based on an earlier posting**. Require renewed assessment/review before claiming readiness for the updated target; do not rewrite old CV content or carry its approval onto a different posting revision. Existing submitted packages and historical source snapshots remain unchanged.

##### Storage ceilings versus analysis budgets

- The current job schema caps descriptions at **30,000 characters**. The confirmed requirement is to support longer complete postings by raising that limit within a **measured, tested safety ceiling**, not quietly truncate them or preserve the old limit as an unannounced product restriction.
- Define separate bounded download/decompression, parsing/source-text, saved-working-text, and provider-input limits during the feasibility spike. Apply compatible schema/backup/migration and resource protections. A page beyond the safety ceiling fails clearly before any saved mutation; never store unbounded content. Exact limits must be documented with test evidence before shipping.
- A complete posting that fits storage limits **can be saved even if it does not fit the selected model's input budget**. Gate analysis separately, preserving the full source. Offer a suitable model or an explicitly edited, reviewed shorter working posting; never silently summarize/truncate to fit, send only part of the text, or start extra model calls. Label analysis based on a shortened working version accordingly.

##### Redirects, privacy, and failure behavior

- After an explicit fetch, follow only a **small bounded number of validated public HTTPS redirects** through supported/permitted destinations. No repeated confirmation is needed for allowed redirects; show both pasted and final source links before saving. Stop on unknown/unsafe destinations, login/restricted flows, or redirect loops.
- Validate source policy, hostname/path, DNS resolution, and public connection destination before requests and at every redirect; protect against loopback/private-network targets and rebinding. Treat a page-declared canonical URL as a hint, not authority to fetch, change provenance, or merge jobs. Never forward browser/session credentials or sensitive headers across sites.
- Request only the selected posting and narrowly approved source requests needed for that role. The site sees the connection IP/normal request metadata, but receives no candidate profile, API key, app session, or personal browser credentials. Source URLs can contain sensitive tokens: do not expose them in logs/model prompts and handle retained links cautiously.
- Show specific states for login required, access restricted, unsupported/JavaScript-only/non-job page, expired/removed posting, incomplete extraction, oversized response, timeout, and cancellation. Retain the entered URL while the intake remains open. Offer **Open original posting**, **Paste posting text instead**, and explicit retry when appropriate.
- Do not bypass login, CAPTCHA, paywalls, robots/access restrictions, or scrape restricted sources because a user pasted their URL. Do not crawl links in the description, images, related jobs, or application forms. Opening a source in the system browser requires its own safe external-link path; today's narrow OpenRouter link handler is not a general job-link capability.

#### B2. Additional capture fields and later discovery

Keep manual text saving as a complete fallback. Add source URL, source/provider ID, original source title/company, location, work arrangement, source language, posted date/deadline when explicit, captured time, last checked time, and user notes. Open the original page in the user's browser. No account credentials or cookies are needed.

**Then:** add an approved-employer feed connector behind the same normalized acquisition interface. Fetch public postings on explicit refresh; preview results before adding them. Search/filter imported records locally. Single-link import and multi-posting discovery are separate capabilities: link import can ship as a standalone Saved jobs improvement after its own migration/security/prototype gates, without waiting for fit/ranking, cover letters, tracking, or a regional search connector. Employer-feed discovery is not comprehensive WUZZUF/Bayt/LinkedIn search.

**Deduplication rules**

- Prefer a provider's stable posting ID and canonical URL; preserve all source references.
- Normalize tracking parameters conservatively. Do not strip query parameters that identify a real role.
- Use normalized employer/title/location plus a content fingerprint to suggest cross-source duplicates, not silently merge similar openings.
- Keep a refreshed posting as a new revision. Do not overwrite the posting used by a saved fit assessment, draft, or application archive.
- Distinguish **active**, **closed confirmed**, **deadline passed**, **unreachable**, **unknown**, and **dismissed by you**. An HTTP timeout/403 is not evidence a role closed.
- Show stale/partial source coverage. A connector failure must not empty a shortlist or delete saved material.

**Security:** approved HTTPS hosts/endpoints, explicit network settings, request/response size and time ceilings, rate/backoff limits, redirect validation, and protection against loopback/private-network requests and DNS rebinding. Fetch text/data in main/utility processes; no remote page scripts in the privileged renderer. Do not follow links embedded in posting text or solve CAPTCHAs/access restrictions.

**Acceptance:** supported synthetic URL imports populate title/company/full description without copying; structured-data and supported HTML paths work without executing scripts or calling a model. Merely pasting/reopening/launching makes no website request; unknown sources are rejected before page fetch. Material source conflicts and incomplete essential content prevent Save until resolved. Missing optional salary/deadline stays unknown. Editing a preview, cancelling it, closing/restarting, or receiving a late cancelled response cannot mutate saved records or persist unsaved preview contents. Accepting saves the complete source separately from the reviewed working posting; both survive offline reopen and backup/restore. Longer-than-30,000-character postings succeed within the new tested safety ceiling; oversized pages fail without truncation. A stored posting beyond model context limits remains saved but cannot dispatch an oversized/partial request. Redirects are bounded and validated and both URL origins are visible. Repeat import avoids duplicates; changed-source refresh compares previous source/current edits/new source and creates a revision only after explicit acceptance. A changed target stales current fit/CV readiness without modifying historical submissions. Blocked/login-required/JavaScript-only/timeout failures retain safe manual fallback. Routine discovery sends search filters only—not the private profile—to the source.

**Regional source selection:** see [the Egypt/MENA feasibility research](egypt-mena-job-discovery.md). Market coverage, permission, current API shape, and relevance need a small pilot before committing to a connector.

### C. Evidence-backed cover letters and writing preferences

**User value:** produce an application package without separately prompting another tool or repeating unsupported claims.

- Add a separate cover-letter draft with an opening, relevant contribution/evidence paragraphs, and closing. Default to a concise one-page English letter; allow plain-text copy and approved PDF/DOCX export.
- Link each factual candidate statement to career evidence. Link employer-specific statements to a separately confirmed company source, or omit them. Candidate intentions may be user-confirmed statements, never inferred motivations.
- Reuse the approved CV's evidence selection where relevant, but do not assume a CV approval authorizes a letter or allows sending extra private sources.
- Capture tone/formality, length, preferred phrasing, and phrases to avoid. Allow an optional user-selected writing sample with its own preview; third-party references and private employer information are not automatically forwarded.
- Do not treat style samples as factual evidence or turn personality assessments into hiring predictions.
- Preserve historical titles, ownership, scope, and certainty. Show no invented familiarity with the employer or unverified recipient name.
- Separate document approvals. Editing a letter invalidates its approval and package readiness, not an otherwise unchanged approved CV. Changing shared career facts stales affected current documents as appropriate.
- Design an application-owned cover-letter template compatible with the existing pdfLaTeX bundle if feasible. Do not copy upstream's XeLaTeX cover class and quietly add another compiler/font runtime.
- Do not add letter prose, summaries, or headlines to the agreed CV template. Letters remain optional for postings that do not request one.

**Acceptance:** approved letter and CV can be exported together or independently; unsupported metrics are blocked through the public application command; package export never regenerates text. Cancelling export reports cancellation truthfully.

### D. Optional critique and smarter page fitting

**User value:** improve relevance and readability after factual checks without surrendering control over wording.

- Reuse the existing optional semantic check for factual comparison; add a distinct optional critique for specificity, relevance, clarity, repetition, missing supported requirements, and letter/CV consistency.
- Reviewer receives only a frozen, authorized packet: minimized posting, relevant evidence, candidate text, and deterministic check results. Use a fresh model context. This is a second opinion, not independent proof—even if a different model is selected later.
- Return structured findings anchored to a document item/revision with explanation and suggested change. Style findings are advisory. Known factual failures remain blockers and cannot be erased by turning the reviewer off.
- Offer accept/reject replacement proposals using the current stale-proposal safeguards. One critique pass and at most one bounded proposed revision per user action initially; no recursive agent debate or auto-accept loop.
- Improve overflow suggestions using posting relevance, distinctiveness, evidence coverage lost, redundancy, and—in an application package—whether letter text depends on the material. Explain each proposal.
- Preserve relevant older-role evidence ahead of generic recent-role text. Start with item-level cuts supported by current editing; only add bullet-level cuts once stable per-bullet identity/provenance is designed.
- Add local layout diagnostics incrementally: orphaned headings, extreme whitespace, clipped/overlapping text, and literal contact extraction where reliably measurable. Mark heuristic findings as such. Actual compiled PDF remains authoritative.
- No unapproved font shrinking, margins changing, content deletion, LLM-authored LaTeX, or template replacement.

**Acceptance:** an older highly relevant project is not first to be cut merely because of its position. Rejected proposals preserve text. Accepted proposals invalidate affected checks/approval and require a fresh compile. Existing PDF text/reading-order/link checks continue to pass.

### E. Application tracking and submitted-material archive

**User value:** know what was applied to, what was actually sent, and what needs attention.

- Keep **saved opportunity**, **document draft**, and **application attempt** distinct. The same posting may have multiple attempts or submission packages; avoid a schema that permanently equates one job with one application.
- Proposed lifecycle: preparing, submitted, interviewing, offer received, hired, rejected, withdrawn, offer declined. Interview rounds, assessments, and reminders are dated events rather than an exploding list of statuses. Silence is “no response recorded,” not automatically rejected.
- “Exported” never means “submitted.” Submission requires user confirmation of date, channel, and materials; support an application made outside CV Tailor.
- At submission, archive the exact posting revision, CV/letter canonical snapshots, actual submitted PDF/DOCX bytes where available, checksums, template/version metadata, and a package manifest. Filenames or mutable paths alone are insufficient.
- External Word edits need an explicit import/attachment path. Preserve those actual bytes, label their content as externally edited/unverified, and do not claim the original CV checks cover them.
- Read-only historical archives do not change when current profile facts, templates, or drafts change. Future re-use creates a new reviewable document; it does not rewrite the old submission.
- Store append-only status events with dates, notes, and source (“recorded by you”; future integrations may propose changes). Allow corrections with an audit trail and duplicate-operation protection.
- Provide local filters, next action, deadlines, interview dates/timezones, and due follow-ups. Initially reminders appear when the app is open/on next launch; closed-app notifications require a separate decision and Windows scheduling work.
- Start with counts and timelines computed from local records. Use consistent cohort denominators; do not infer that a score caused an interview from a tiny self-selected dataset.

**Acceptance:** changing a current CV cannot alter an archived submission. Restart and backup/restore preserve its exact bytes/hash and timeline. Multiple interview stages and outcome corrections remain inspectable. Empty history produces no invented funnel statistics.

### F. Follow-up and thank-you drafts

- Suggest a configurable follow-up after a user-chosen delay from a confirmed submission or stage. Upstream's ten-day/two-follow-up pattern is inspiration, not a universal regional rule.
- Generate a short message using only the archived submitted material and explicitly selected context; never add a qualification just introduced into today's profile.
- Offer interview thank-you drafts after the user records an interview and selects appropriate notes.
- Track drafted, copied/exported, and user-confirmed sent as different states. Copying text does not prove delivery.
- Do not send email/messages, discover recipient addresses, or contact anyone automatically. Avoid reminders for closed/withdrawn cases; allow snooze and dismissal.

**Acceptance:** a post-submission skill added to the profile is absent from a follow-up unless the user explicitly authorizes and reviews that new claim. No reminder is falsely presented as an email that was sent.

### G. Upload a CV to fill My profile, then selective enrichment

#### G1. Standalone CV-to-profile upload — confirmed early feature

**Published specification:** [#38 — Upload a CV to fill My profile from PDF or DOCX](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/38), labeled `ready-for-agent`. Separate from job-link spec #26. The six approved child tickets are published as [#39–#44](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/38): feasibility/prototype → text-PDF onboarding → independent DOCX, existing-profile merge and optional-AI slices → installed-app verification, all labeled `ready-for-agent` with native blocking edges. Shared contracts/backup migrations must be integrated coherently; no job-link behavior is a prerequisite.

**Primary flow:** **My profile → Upload CV → extract locally → automatically organize profile proposals → review/correct add/update/skip → Apply accepted changes.** The app converts the CV into validated structured data suitable for its profile format; the person does not manually author JSON or retype every section.

**Confirmed choices:** selectable-text PDFs and modern Word DOCX; local first with optional separately authorized OpenRouter structuring; reviewable add/update/skip for existing profiles; explicit review/confirmation before any saved profile change. Scanned PDFs/images/OCR, old Word formats, and automatic unreviewed filling are not initial scope.

- Read selected files through a narrow native picker and bounded local parsers, without modifying the original, executing document scripts/macros, following hyperlinks, or loading external resources. Explain unreadable, encrypted, malformed, scanned/no-text, oversized, or unsupported files instead of inventing content.
- Map supported contact/links, skills/categories, experience/training and factual items, projects/technologies/links, education, certificates, summary, languages, and extras to the current validated profile representation. Preserve titles, organizations, numeric claims, units, context, and exact source date wording. Education's year/year-month and certificates' year fields cannot represent every source date: retain finer/ambiguous precision in linked source evidence, flag it, and require an explicit supported value or exclusion rather than silently discard precision or invent months. Missing/uncertain facts stay absent or flagged; do not infer proficiency, tenure, leadership, or achievements.
- Present human-readable fields grouped by existing profile sections alongside relevant extracted passages/page or paragraph references. Preserve unmapped text and extraction uncertainty for review. A profile import proposal is not saved evidence until accepted.
- Generate compatible structured data internally; application code owns stable IDs, revisions, validation, parent associations, and serialization. AI/parser output must not choose authoritative record IDs/revisions or bypass the existing profile contract. Accepted data must round-trip through existing JSON exchange; raw JSON is not the required review interface.
- Support empty-profile onboarding and populated profiles. Suggest matches/additions/conflicts, but make add/update/skip explicit. Do not delete unrelated existing facts, silently overwrite contact details, merge similarly named roles, or duplicate prior imports. Keep the existing JSON **replacement** workflow separate and unchanged.
- Apply accepted records atomically and reject stale previews if the profile changed during review. Preserve evidence history and source references; affected current CVs become stale through existing rules rather than being rewritten. Cancellation, parsing/model failure, invalid output, or failed application leaves the profile and original file unchanged.
- Local extraction/mapping remains available without a model key or network. Offer optional AI structuring only through a separate outgoing-text preview, explicit run-specific consent, bounded dispatcher/budgets, cancellation, and schema/source-reference validation. Never upload a binary file or extracted personal text automatically or reuse job-generation consent. Minimize locally recognizable contact/unneeded data where practical and disclose residual sensitivity; do not claim anonymization.
- Optional AI returns proposals into the same review flow, not trusted facts or direct writes. A rejected/invalid/unsupported suggestion cannot become profile evidence by appearing in a schema-valid response. Preserve source support and detect out-of-document additions where possible, with human review still required.
- Use the original file for the active local review without overwriting it; retaining a permanent binary copy is not required and must not be enabled silently. Persist accepted hashes/passages/locations as a separate provenance representation linked to exact record/nested-fact identity, revision, owner and relevant fields; include active/historical references in compatible workspace backups. Later updates/removals retain old support for history without falsely attributing new manual text to the CV. Re-import must not duplicate support. Existing profile-only JSON carries its declared facts, not extra provenance/history it cannot represent. Disclose sensitivity and do not retain unsaved document/model previews in logs or checkpoints by default.
- Prototype the upload action and merge preview as an extension of the implemented My profile structure, keeping its section navigation and existing JSON toolbar semantics. No CV-template, job-link stage, or global-navigation redesign.

**Acceptance:** upload synthetic text PDF/DOCX, automatically organize compatible profile fields without manual JSON, correct/exclude uncertain facts, apply accepted changes once, and reopen/export/import the same records. Test empty and populated profiles, add/update/skip, repeated imports, stale previews, wrong-parent/source references, rollback, evidence history, affected-draft staleness, backup/restore, malformed/no-text files, and absence of unapproved requests. Optional AI requires its own approved payload and remains a proposal generator; local review still works without it.

#### G2. Later selected-source enrichment

Linked GitHub/portfolio inspection, course-syllabus discovery, broader document libraries and OCR remain later proposals, not prerequisites for G1. Let the user select a public source and confirm contribution; a repository technology list is not proof of authorship and a syllabus is not proof of mastery. Do not automatically fetch profile links, private repositories, reference letters, diplomas, or identity documents. Any additional recipient or source category needs its own approved scope.

### H. Interview packs, confirmed stories, and optional mock interview

- Store optional confirmed STAR-style stories linked to experience/project evidence: situation, task, the candidate's action, result, and what remains uncertain. Do not manufacture numerical results to complete the structure.
- Build preparation from the exact submitted package and original posting first, supplemented by selected confirmed stories and prior-round feedback.
- Tailor by stage: recruiter screening, technical/assessment, behavioral, hiring manager, or final discussion. Provide likely topics, relevant examples, honest bridge answers for gaps, questions to ask, and logistics.
- Show differences between archived submitted claims and newly added career facts so the candidate can explain changes truthfully.
- Company research is optional, sourced, dated, and separately confirmed. Avoid personal interviewer profiling; names/roles supplied by the user are enough for a first release.
- Begin with a saved prep pack. Add a bounded text mock interview later: one question at a time, user-controlled stop, feedback tied to a visible rubric and confirmed facts.
- No voice recording, biometric/emotion/personality scoring, secret interview capture, or promise that these are actual interview questions.

**Acceptance:** prep uses the archived CV rather than the latest generated draft. Unknown company facts remain absent/flagged. A gap yields an honest learning/transferable-experience answer, never invented work history. Saved prep remains available offline.

### I. Recurring skill gaps, learning plans, and outcome summaries

- Aggregate normalized requirements across user-selected target roles and a recent deduplicated posting set. Show sample size, dates, sources, and required versus preferred frequency.
- Separate **no saved evidence**, **user-confirmed learning need**, **not relevant to my target**, and **already learning**. Let the user correct alias mappings and exclude irrelevant roles.
- Prioritize by frequency, target-role importance, prerequisites, user interest, and stated time budget. Avoid false precision in “hours to mastery.”
- Recommend small practice projects/courses with links, costs if verified, prerequisites, milestones, and an explanation of why each closes a relevant gap. Prefer official documentation/provider course pages and record the checked date.
- Learning completion is not automatically a new qualification or past professional experience. Invite the user to save a genuine completed project/certificate through normal evidence confirmation.
- Show descriptive outcome summaries and invite manual rubric adjustments; do not automatically train/calibrate a hiring predictor on a handful of outcomes.

**Acceptance:** duplicate postings do not inflate gap frequency; unsupported requirements remain visible; an outdated/unverified resource is labeled; completing a plan cannot silently change the profile or previously submitted documents.

## 6. Egypt/MENA adaptation

The market selection changes source evaluation and practical fit, not the app's fundamental truthfulness rules.

- **Source coverage:** keep WUZZUF, Forasna, Bayt, GulfTalent, LinkedIn, and employer career pages available as manual sources. An “open original posting” shortcut is useful even when there is no lawful/reliable automated connector.
- **Connector readiness:** a public HTTP response, permissive robots file, open-source scraper, or upstream personal-use warning is not permission for us to integrate a site. Verify official API/access/reuse terms and employer configuration.
- **Employer feeds:** evaluate documented Greenhouse, Lever, and Ashby job-board feeds for a user-selected employer list. Validate the number of useful Egypt/MENA postings before investing; these are not complete regional indexes.
- **Work location:** support Egypt, specific MENA countries, multi-location roles, and remote eligibility as separate fields. Keep relocation, visa/work eligibility, timezone, contract type, onsite requirements, and any explicit language requirements visible.
- **Compensation:** if explicitly disclosed, retain original currency (e.g. EGP, AED, SAR), pay period, gross/net uncertainty, range, and whether benefits/allowances are included. Do not compare monthly EGP with annual AED, silently convert currency, or invent a salary range.
- **Arabic/English:** retain original Unicode source text/metadata without corruption. The existing product is English-only; English job analysis and English CV/letter output remain the initial supported path. Arabic posting analysis, translation, Arabic search aliases, Arabic output, and RTL interfaces require separate evaluation and approval. Do not claim Arabic support merely because text can be stored.
- **Data minimization:** do not collect sensitive personal fields simply because a regional application form requests them. The app should not infer nationality/religion/marital status or recommend discriminatory filtering.
- **Time:** persist unambiguous timestamps, timezone identifiers where known, and user-facing local dates. Do not hardcode a permanent Cairo UTC offset; account for timezone/DST changes.

The companion [regional research](egypt-mena-job-discovery.md) is the evidence register for source-specific decisions and unresolved permissions.

## 7. Proposed application architecture

### Keep the existing stack and public seam

Continue Electron/TypeScript/React, shared Zod contracts, real SQLite, main-process secrets/network control, current LangGraph workflow, bundled compiler, and the narrow preload interface. Test behavior through the same application interface the renderer uses. Do not execute Markdown commands, arbitrary source code, community portal plugins, or LaTeX supplied by a model.

`src/main/workbench.ts` already owns many responsibilities. New behavior should live in cohesive deep modules behind the existing application seam, with composition/transactions coordinated there—not thousands more lines in its current closure and not a repository-wide rewrite before shipping value.

| Proposed module | Small user-facing interface / owned behavior | Existing foundations |
| --- | --- | --- |
| Opportunity intake | Fetch one user-pasted posting URL, preview/correct extraction, accept/cancel capture or refresh, find possible duplicates; owns safe fetching, extraction provenance, source policy and revisions | Jobs persistence and validated IPC |
| Fit assessment | Assess/compare opportunities, read assessment; owns requirements, preference projection, evidence links, stale state | Analysis, profile/evidence, dispatcher |
| Application documents | Draft/critique/accept changes/approve/export a letter or package; owns document-specific readiness | CV generation, factual checks, proposals, canonical documents/compiler |
| Application history | Record submission/stage/outcome/reminder, read timeline/archive; owns immutable package manifests and retention | SQLite, export artifacts, backups |
| Profile intake | Preview sources, resolve conflicts, accept/cancel; owns unconfirmed proposals and provenance | Profile revisions and exchange patterns |
| Preparation and growth | Build/read an interview pack or gap plan; owns versioned derived outputs and source links | Archived applications, requirements, confirmed evidence |

These names and file boundaries are provisional. Use production plus scripted external adapters for real variation (provider requests, approved feeds, optional search). Keep ordinary in-process matching and local database operations internal. No generic “agent registry,” per-task microservice, or universal plugin abstraction is justified yet.

### Proposed durable concepts

- **Posting / posting revision / source reference:** opportunity identity separate from immutable captured text and provider IDs.
- **Posting import preview:** temporary, non-persisted, cancellable result bound to the submitted/final URL, fetch operation, extraction version, source snapshot/hash, per-field provenance and validation notices. Late responses for cancelled/superseded URLs cannot replace the current preview; saving a preview must detect intervening changes to an existing posting.
- **Working posting:** the accepted current wording, distinct from captured source; may contain explicit corrections or a consciously shortened version whose analysis scope is labeled.
- **Candidate preferences revision:** optional user declarations and hard/preferred constraints, stored separately from career evidence.
- **Requirement:** exact source span, type, required/preferred, normalized aliases, unknown/confidence markers.
- **Fit assessment:** posting/profile/preferences/rubric/model versions plus findings; stale rather than silently recomputed.
- **Letter draft / review proposal / approval:** document-specific revision and hash; candidate and employer references are typed separately.
- **Application attempt / event:** lifecycle identity, dated events, corrections, and idempotency token.
- **Submitted package / artifact:** immutable canonical snapshots, posting revision, actual bytes, checksums, provenance, and user-confirmed submission metadata.
- **Source document / fact proposal / confirmed story:** untrusted extraction staged before versioned career evidence.
- **Research note / interview pack / learning plan:** dated derived outputs whose source snapshots remain inspectable.

Do not force these into `JobRecord.description` or overloaded draft status. Review concepts against `GLOSSARY.md` before approved schemas/ADRs; this research does not modify the glossary.

### Staleness and cache rules

- Accepted posting-requirement revisions stale derived current fit/analysis and CV targeting/readiness when relevant inputs change. Readiness for the revised target requires renewed assessment/review; never silently mutate prior CV content or historical submissions.
- Fit caches bind to posting hash, relevant profile/preferences revision, prompt/schema/rubric/model configuration. Changing rank weights may allow local recalculation only if underlying dimension findings remain compatible.
- Letter critique/replacement proposals bind to their exact base draft and sources; stale acceptance fails safely.
- Interview packs bind to submitted package, selected stage/stories, prior feedback, and dated research.
- Learning plans bind to a selected, deduplicated posting cohort and profile state.
- Compatible cached data may be reused; it never authorizes a new outbound run.

## 8. Privacy, security, and cost controls

### Purpose-specific outgoing data

The existing outgoing bundle excludes spoken languages/extras/contact and pseudonymizes employer/project identifiers. Preferences, writing samples, company identity, source documents, submitted letters, and interview feedback must not simply be appended to the old payload.

Design purpose-specific projections and immutable consent snapshots for fit, letter, critique, interview, and learning tasks. A fit check may evaluate practical eligibility locally to avoid sending work-rights/salary preferences at all. If cloud processing needs a new category, preview exactly that projection and obtain new authorization. Contact/recipient formatting should be restored locally where possible.

Separate **public research** from **private synthesis**: employer search need not receive the candidate profile. Do not issue searches containing career-history passages, salary expectations, reference content, or interview notes. If external research is unavailable, prepare a source-limited result rather than inventing company facts.

### Untrusted-content handling

All retrieved postings, PDFs/DOCX, repository readmes, emails if later introduced, and model responses remain data. The app, not the LLM, selects allowed tools/hosts/actions. A posting cannot request file access, alter consent, select an export path, install packages, or turn off factual checks. Maintain Electron isolation/CSP/validated IPC and safe link handling. Add parser/file size limits, timeouts, and archive/zip protections for document imports.

### Bounded cost and resumability

- Reuse the shared dispatcher; all transport retries, structured repairs, critique, and revision calls count toward one declared operation budget.
- Batch **user experience and scheduling**, not an unbounded fan-out of agents. Preview the number of selected postings; enforce per-item and aggregate attempt/time/token limits, bounded concurrency, and cancellation.
- Make advanced research/reviewer/mock-interview actions opt-in. No fixed five-minute timer across a human interview session; bound each turn and the session's total spend separately.
- Prefer deterministic local constraints, deduplication, counts, dashboards, layout checks, and aggregation. Use LLMs where wording/semantic synthesis actually helps.
- Add output-token ceilings and observed token/price metadata where available. Current transport returns text, so usage plumbing needs design rather than assuming accurate billing already exists.
- Do not advertise a hard dollar cap from local estimates alone; provider usage/pricing can lag or vary. Use conservative local ceilings and provider-side spending controls where supported.
- Reopen never dispatches work automatically. Uncertain in-flight operations remain explicit; retries can incur duplicate charges and must not silently reset accounting.

### Retention, backups, and licenses

Set clear limits for retained source files, generated artifacts, and research caches; provide previewed deletion without silently corrupting historical references. Never embed personal fixtures in the installer or commit real career/email data. Secrets stay in secure storage and out of backups.

If code or substantial prompt text is copied from MIT-covered upstream content, retain the applicable copyright/license notice and record origin. Audit fonts, document packages, portal terms, and dataset licenses separately. Prefer implementing product ideas within our own contracts rather than vendoring the complete framework.

## 9. Migration and backup work is a prerequisite

This is a specific blocker in the current architecture, not optional cleanup. `workspace-backup.ts` enumerates known tables, rejects unknown tables, and checks exact table schemas/table sets and migration history. Adding new persistence tables without updating it can make backup fail; changing jobs/settings formats can also make old backups unreadable.

Before the first schema expansion:

1. Design a versioned domain backup upgrade path. Read an old backup into a known old representation, validate, migrate in isolation, validate current invariants, and preview replacement.
2. Support the current released backup fixture in the newer app. Reject unknown future versions safely; do not run arbitrary SQL supplied by a backup or weaken validation to accept any table.
3. Add forward, transactional database migrations and rollback/failure tests using representative old workspaces, drafts, and approved documents.
4. Default new fields safely; old jobs have unknown provenance/constraints and no fabricated “submitted” date/status. Existing draft approvals remain valid only under their original supported contract.
5. Choose retained-artifact storage after a spike. SQLite BLOBs can simplify atomic archive transactions; a managed content-addressed file store needs explicit crash-safe manifest and backup handling. Test realistic workspace size before choosing; a filename outside the workspace is not an archive.
6. Include every new record and retained byte in backup/restore, with checksums and bounded input sizes. Exclude credentials and invalidate imported authorization as today.
7. Preserve verified safety-backup-before-replacement behavior; restore never sends requests or reconnects third-party accounts automatically.

**Release gate:** migrate/reopen a legacy workspace, import a legacy backup, create a new archive, back up/restore it, and verify exact artifact hashes and unchanged historical evidence. Do not ship a feature whose data is missing from backup.

## 10. UX integration without breaking the approved workbench

This is information-architecture direction, not a new approved screen design.

- Preserve the five exact CV stages: **Job posting → Outgoing data → Generate → Review evidence → Export**. Put pre-draft fit beside posting/analysis, not in a sixth stage.
- Keep the CV the review-stage hero. Add the optional letter as a distinct document view after an approved prototype; do not turn the workbench into a chatbot transcript or shrink the CV behind a dashboard.
- Preserve the current Saved jobs three-column contract initially. Fit and next actions may be progressively disclosed within existing roles if visually approved; additional columns, tabs, an Applications page, or new primary navigation require an explicit design-system update first.
- Start URL import in an approved intake dialog/panel: **Import from link** and **Paste posting text** lead to the same editable job preview/save flow. Show fetching, cancellation, missing fields, blocked-source fallback, and source/freshness/duplicate review before a role enters saved jobs. Do not add a sixth CV stage or a new primary “Agents” screen. Prototype and document this intentional addition to the current add-job form contract before implementation.
- Place preferences/import proposals within an approved extension of Profile/Settings while retaining their implemented structure. Mark any new sharing behavior precisely; existing “local-only” language categories cannot be silently reclassified as cloud input.
- Tracking/interviews need clear application context and a timeline. Prototype whether a contextual application detail panel is sufficient or a dedicated Applications destination is warranted before changing the four-page shell.
- Follow established tokens, Manrope/Sora UI, white Lato CV paper, both themes, keyboard focus/dialog behavior, and responsive document-first order.
- Use plain language: “Why this role fits,” “No saved evidence,” “Materials you submitted,” “Prepare for interview.” Keep run IDs, JSON, counters, prompt diagnostics, and agent topology out of primary UI.

**Prototype gate:** compare screenshots with Variant A and the current Profile/Settings baseline; test keyboard and supported widths; explicitly approve and document intentional contract changes before production implementation.

## 11. Delivery roadmap and dependency order

All phases below are proposals. First complete feasibility/prototypes, then write approved scope and GitHub issues. Do not create a large ticket backlog or begin application coding merely because this research exists.

| Phase | Deliverable | Dependencies | Exit gate |
| --- | --- | --- | --- |
| **0 — Discovery and design approval** | Single-link extraction/source-permission spike and import-preview prototype; PDF/DOCX profile-intake feasibility and merge-preview prototype; regional-source spike; fit/preference prototype; letter/package prototype; tracking/archive prototype; backup/artifact feasibility | This research and user feedback | Source choice, core interactions, invariants, storage approach, and scope approved |
| **1a — Standalone link import** | Compatible job/backup migrations; source snapshots/working posting revisions; reviewed-source local extraction; explicit fetch and temporary editable preview; conflict/size/redirect safeguards; safe refresh and manual fallback | Approved intake prototype, source/size/security feasibility; no fit/letter/tracking dependency | Supported link imports without copying; no auto-dispatch/scripts/pre-save persistence; full source and edits preserved; safe limits and legacy backup/reopen verified |
| **1b — Standalone CV-to-profile upload** | My profile upload for text PDF/DOCX; local extraction/structured proposals; explicit add/update/skip and atomic apply; source/evidence history; optional separately authorized AI mapping | Its own format/privacy/resource feasibility, approved Profile extension and compatible persistence/backup; no job-link/fit/tracking dependency | Automatic compatible field mapping, correction/confirmation, safe existing-profile updates, JSON round-trip/reopen/restore, and zero unapproved file/model disclosure |
| **1c — Better shortlist** | Preferences; structured requirements; single-role fit; bounded comparison of selected saved roles | Phase 0 and shared provenance/migration foundation; may use manual profiles/postings independently of URL or CV-file extraction | Useful fit explanations on strong/partial/unknown cases; separate model-input ceilings; old workspaces/backups preserved; no CV regressions |
| **2 — Better application package** | Writing preferences; cited cover letter; optional critique; relevance-aware cut proposals; separate approvals and real exports | Phase 1c/shared foundation; letter/layout prototype; no URL/CV-file-import dependency | One coherent CV+optional-letter package passes factual/compiled-artifact review without changing the agreed CV template |
| **3 — Pipeline and first discovery pilot** | User-confirmed submission; immutable package archive; statuses/events/reminders; follow-up drafts; one permitted employer-feed connector if feasibility/coverage pass | Shared provenance/migration foundation; Phase 2 for native letters; source gate for connector | Exact submitted materials survive reopen/restore; one end-to-end acquisition→shortlist→submission flow works |
| **4 — Richer evidence and interview prep** | Optional selected public-source enrichment; confirmed stories; stage-specific prep pack; broader document/OCR proposals only if separately approved | Phase 3 archive for submitted-context prep; G1 upload is an independent earlier feature, not a prerequisite | No unconfirmed fact promotion; interview prep uses what was sent, not a newer draft |
| **5 — Learning and selective integrations** | Recurring-gap plan; local outcome summaries; optional bounded text mock interview; evaluate mail/calendar/Notion only if still valuable | Stable requirements/evidence, application history, prep | Useful user-reviewed outputs, justified external scope, no automatic profile or outcome rewriting |

**Parallelism and priority:** plan/prototype Phase 1b CV upload alongside Phase 1a job-link import, and deliver it early rather than waiting for interview preparation. The features have no behavioral dependency on each other or on Phase 1c fit; existing manual profiles/postings remain usable. Coordinate shared profile/evidence/backup contracts and migrations under one integration owner so task-owned worktrees do not independently introduce incompatible backup versions. After Phase 1c, package writing and the permitted-source discovery pilot can proceed independently. Future archive storage is not a prerequisite for either importer; tracking external applications need not wait for generated letters.

**Preferred first shippable slice:** paste a manually found Egypt/MENA job link, explicitly fetch it on a supported permitted source, review/correct, explicitly save, and reopen the source and working posting offline. This standalone Saved jobs improvement does not wait for new fit/ranking, cover letters, tracking, or multi-board discovery. Existing tailoring can follow with normal consent; preferences/fit arrive separately. Text entry remains fallback, not a required copying step on successful import.

### Relative effort—not a calendar commitment

- **Medium:** safe single-link import for a bounded set of supported static/structured-data pages, preferences/constraints, explainable fit, single-source connector after a successful spike, follow-up drafts, simple local dashboard.
- **Large:** migration/backup evolution, immutable submission archive, cover-letter approvals/exports, safe general document import, stage-aware interview prep.
- **Small to medium:** source URL capture, local filters, writing preferences, confirmed event entry, basic requirement-frequency aggregation.
- **High uncertainty:** regional-board permissions/access, robust Arabic processing, arbitrary document formats, cross-provider usage accounting, email OAuth and status inference.

Each increment includes contracts, persistence/backup, UI, tests, and installed-app validation—not prompts alone. Re-estimate after Phase 0; a precise end-to-end completion date would currently be speculative.

## 12. Proposed implementation slices after approval

These are **planning slices, not created GitHub issues**. Each should deliver visible behavior through the public application seam and own its migration/backup/test changes.

| Slice | Outcome | Must follow |
| --- | --- | --- |
| S1 | Legacy workspace/backup upgrade path for the relevant increment; decide archive-artifact storage separately before submission archives | Approved feasibility; do not block link import on future archive storage |
| S2 | Save provenance and immutable posting revisions; review duplicates | S1 |
| S2a | Standalone link import: reviewed-source local/static extraction; explicit fetch; non-persisted preview/save/cancel; source/working version separation; conflict/long-text/model-budget handling; compared refresh; bounded supported redirects; safe fallback and stale-target guards | S2; source/size/security feasibility and approved intake prototype; no S3–S15 dependency |
| S3 | Optional candidate preferences and explicit/unknown posting constraints | S1; S2 for posting constraints |
| S4 | Source-linked requirements and single-role fit with stale-state handling | S2, S3 |
| S5 | Compare/rank selected roles with aggregate budgets and partial failure | S4 |
| S6 | Writing preferences and cited letter draft/edit/review | S4; approved letter prototype |
| S7 | Letter canonical model, approval, compiled PDF/DOCX, package manifest | S6; template spike |
| S8 | Optional structured critique and relevance-aware cut proposals | Existing replacement seam; S4; S7 for cross-document dependencies |
| S9 | Application attempts/events and exact submitted-artifact archive | S1, S2; S7 when archiving native letter packages |
| S10 | Reminders, follow-up/thank-you drafts, local pipeline summary | S9 |
| S11 | One documented employer-feed acquisition connector | S2; regional-source gate; S5 for ranked results |
| S12 | Early standalone text-PDF/DOCX upload to My profile, validated structured proposals, add/update/skip review, atomic evidence-preserving apply, and optional separately authorized AI structuring | Own format/privacy/prototype gates and relevant compatible backup changes; no dependency on S2a job-link import, fit, letters or tracking |
| S13 | Confirmed story library and submitted-package interview pack | S9; profile evidence; S12 optional, not required |
| S14 | Repeated-gap report and approved learning plan | S4, S5; S12/S13 optional enrichments |
| S15 | Bounded text mock interview and optional integration decisions | S13; separate approval of any new external scope |

Use dependency-aware GitHub issues only once the relevant research/prototype is accepted. For parallel implementation use task-owned worktrees with disjoint file ownership and centralized integration; schema, backup, shared contracts, and shell/design-system changes need one coordinated owner.

## 13. Validation and acceptance strategy

### Automated behavior tests through the public application interface

Use isolated real SQLite and scripted external model/feed responses, not a fake application. Assert outcomes rather than private graph topology or exact AI prose.

- **Legacy compatibility:** old workspace migration and backup import; preserved evidence/drafts/approvals; safely rejected future/corrupt backups; safety-backup failure leaves workspace intact.
- **Intake:** reviewed-source structured-data/HTML extraction without website scripts; explicit-fetch-only requests; unknown sources rejected before page fetch; complete description/formatting; multiple/conflicting postings and explicit resolution; missing required versus optional fields; login/CAPTCHA/403/429/JavaScript-only/removed/non-job pages; bounded validated redirects and visible pasted/final URLs; timeout/cancellation and late-response suppression; no pre-save mutation, disk-persisted preview, or model call; discard/edit warning; duplicate/no-op detection; three-way source/current/new comparison without auto-merge; accepted revisions and stale-target guards.
- **Length and context:** complete postings above the old 30,000-character cap but within tested new storage limits; download/decompression/parsing ceilings; rejection without truncation above safety limits; complete local save with analysis blocked when provider context is insufficient; explicit shorter working version preserves full source and labels analysis scope.
- **Fit:** required/preferred separation; cited support, transferable/partial support, unknowns, explicit deal-breakers, changed preference/profile versions, unsupported language/eligibility inference, no hiring probability claims.
- **Privacy:** no pre-consent dispatch; canary contact/company identifiers/excluded categories absent from captured payloads; new purpose/data/destination requires approval; public research queries contain no private profile fragments.
- **Writing:** wrong/foreign/uncited career evidence, unsupported numbers/ownership, company-source mixups, malicious writing samples, cross-document contradictions, cancellation and stale proposals.
- **Budgets:** total attempts/time/tokens across selected postings, retries/repairs/reviewer calls; late-response suppression; uncertain restart; partial batch results; cancellation never discards completed local work.
- **Documents:** exact CV template unchanged; no raw model LaTeX; separate letter approval; PDF/DOCX content checks; selectable text/reading order/links; rejected cuts preserve document; accepted cuts require remeasurement/review.
- **Applications:** export ≠ submission; multiple attempts; event correction/idempotency; immutable bytes/hash despite later edits; external edits labeled; all retained artifacts included in restore.
- **Preparation/growth:** archived-not-current materials used; no invented STAR results; deduplicated cohorts; no automatic learning→profile conversion; saved packs readable offline.
- **Network/file security:** malicious posting links; private/loopback targets and redirect pivots; huge/compressed/malformed files; blocked sources fail without bypass; no script execution or generic renderer filesystem access.

### Visible Electron and installed Windows tests

Keep a small representative smoke suite: paste posting URL→fetch→review/correct→save→fit→letter→review→approve→export→record submission→restart→interview pack; blocked-link paste-text fallback; cancelled/failed source refresh; rejected profile import; offline read; keyboard/dialog focus; both themes and supported widths. Use screenshot-guided comparison to the approved prototype and update design contracts only for approved changes.

At integration, run typecheck and the full behavior suite, then Electron tests with the correct native SQLite ABI. Installer/release checks use the user's accepted fresh Windows machine, not a mandatory new VM. Install the actual app, test first-window startup, native SQLite close/reopen, local compiler, archived bytes, backup/restore, and offline reading. Do not package through a dependency junction or ship personal fixtures/keys.

### Human pilot before expansion claims

Use explicit opt-in and reviewed data, with sensitive artifacts kept local. Suggested cohort: 8–12 real English-language Egypt/MENA postings spanning strong match, transferable match, clear gap, ambiguous remote eligibility, and missing compensation/deadline cases. This is a proposed evaluation sample, not a promised market-coverage claim.

Record:

- Fit explanation usefulness and shortlist ordering versus the user's own judgment.
- Unsupported or inflated claims observed in CV, letter, follow-up, and prep outputs.
- Distinctive/specific versus generic prose; factual employer-research accuracy.
- Actual source coverage, duplicates, stale postings, import correction effort.
- Attempts/tokens/estimated spend, retries, latency, and interrupted-work recovery.
- Time to first useful fit decision and approved application package.
- Successful offline reopen and byte-identical archived-artifact restore.

**Minimum release conditions:** zero observed unsupported claims in approved pilot materials, no unapproved outbound data, no archive mutation or legacy-data loss, working real exports/reopen/restore, and user-accepted usefulness. These observations are not universal factuality/privacy/ATS/hiring guarantees.

## 14. Risks and stop/go decisions

| Risk | Response / stop condition |
| --- | --- |
| Regional board blocks or does not permit automation | Keep manual workflow; do not ship the connector without a supported access basis |
| Employer feed has too few relevant regional roles | Keep it a limited pilot or stop; do not market comprehensive Egypt/MENA discovery |
| Scores look precise but explanations are weak | Ship qualitative findings; tune rubric with user-reviewed examples before prominent numeric rankings |
| Imported facts or public-project technologies are overclaimed | Stage as proposals; require contribution/source confirmation and preserve uncertainty |
| Reviewer amplifies the drafter's mistake | Maintain deterministic checks, evidence inspection, and human approval; reviewer is advisory, not authority |
| New data silently broadens old consent | Purpose-specific projections and captured-payload regression tests; block dispatch on mismatch |
| New tables/assets break backups | Complete S1 first; every slice carries backward-compatibility and byte-preservation tests |
| Archived submission changes after profile correction | Immutable package/artifacts; current reuse creates a new draft, never mutates history |
| Letters/Arabic need extra document engines | Prove compatibility and bundle impact first; keep English letter/simple template initially |
| Batch ranking becomes expensive or slow | User-selected batches, local filters first, aggregate ceilings, partial results and explicit continuation |
| Feature expansion destroys workbench focus | Prototype/approve navigation and contextual views before changes; preserve CV-first review |
| Outcome analytics encourage false causal conclusions | Descriptive counts/cohorts only; no automatic “winning profile” or hiring-probability model |

## 15. Decisions still needed before coding

Already decided: phased workspace, all four capability groups, Egypt/MENA focus, no application implementation during research. **B1's sixteen product decisions and standalone delivery scope are confirmed**: reviewed-source coverage/fallback; review before save; local/no-paid extraction; separate source/edits; no website scripts; explicit fetch/refresh; incomplete-content resolution; compared refresh; longer complete-text support within safety ceilings; conflict resolution; validated redirects; temporary unsaved previews; preservation of local edits; stale targeting after changed requirements; separate storage/model limits; no speculative unknown-source fetch. Shared understanding was explicitly confirmed for documentation only.

For B1, remaining work is to validate the supported-source matrix, exact resource/context ceilings, safe-fetch/extraction feasibility, schema/backup changes, and the intake prototype. These are explicit pre-implementation gates, not permission to implement or reopen settled choices silently. The broader product questions below remain outside this narrowly confirmed feature.

Resolve during focused prototypes/spikes, not a broad new requirements interview:

1. Which target roles and employer list make discovery demonstrably useful? What minimum coverage justifies a connector?
2. Which candidate constraints are genuinely hard versus preferences, and which should never leave the device?
3. Is the initial English-only regional workflow sufficient? Arabic processing/translation remains a separate scope proposal.
4. What is the preferred cover-letter tone/length, and is an English PDF/DOCX/plain-text letter sufficient?
5. Should application detail stay contextual or receive a new navigation destination? Approve screens before revising the four-page contract.
6. How should retained originals, externally edited submitted files, storage limits, and sensitive archive deletion work?
7. **Resolved for G1:** redesigned CV upload is explicitly wanted: text PDF/DOCX, local first with optional authorized AI, add/update/skip, review-before-apply. Validate extraction/structuring quality and the Profile extension; broader source libraries, public enrichment and OCR remain separate proposals.
8. What per-action/batch spending comfort level should guide advanced critique/research? Choose only after a measured pilot rather than guessing a fixed dollar rate.

After those answers: approve a short new scope/decision record, update relevant design contracts, create dependency-linked GitHub issues, then implement one visible slice at a time. This document is not authorization for those later actions.

## 16. Source and evidence register

### External implementation

- [Pinned full source audit](ai-job-search-source-audit.md): capability table, runtime dependencies, executable-versus-prompt distinction, source permalinks, maintenance, and licensing caveats.
- [Pinned upstream README](https://github.com/ashishpatel26/ai-job-search/blob/30158c0493ae8ae1610769955ad04b189049afe8/README.md).
- [Fit rubric](https://github.com/ashishpatel26/ai-job-search/blob/30158c0493ae8ae1610769955ad04b189049afe8/.claude/skills/job-application-assistant/04-job-evaluation.md), [rank workflow](https://github.com/ashishpatel26/ai-job-search/blob/30158c0493ae8ae1610769955ad04b189049afe8/.claude/commands/rank.md), [application/reviewer/PDF workflow](https://github.com/ashishpatel26/ai-job-search/blob/30158c0493ae8ae1610769955ad04b189049afe8/.claude/commands/apply.md).
- [Outcomes/archive/follow-up](https://github.com/ashishpatel26/ai-job-search/blob/30158c0493ae8ae1610769955ad04b189049afe8/.claude/commands/outcome.md), [interview prep](https://github.com/ashishpatel26/ai-job-search/blob/30158c0493ae8ae1610769955ad04b189049afe8/.claude/commands/interview.md), [upskill](https://github.com/ashishpatel26/ai-job-search/blob/30158c0493ae8ae1610769955ad04b189049afe8/.claude/skills/upskill/SKILL.md).
- [Security threat model](https://github.com/ashishpatel26/ai-job-search/blob/30158c0493ae8ae1610769955ad04b189049afe8/SECURITY.md), [MIT license](https://github.com/ashishpatel26/ai-job-search/blob/30158c0493ae8ae1610769955ad04b189049afe8/LICENSE).
- [Egypt/MENA source feasibility and official references](egypt-mena-job-discovery.md).

### Current CV Tailor source

Paths below are relative to this research file; line ranges refer to the inspected local baseline. New behavior above is a proposal, not a claim that these files already implement it.

- [README](../../README.md), [GLOSSARY](../../GLOSSARY.md), [original scope #1](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/1), [historical reference-import issue #6](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/6), [deliberate removal PR #24](https://github.com/MakCoder-2004/ATS-CV-Creator/pull/24).
- [Job schema](../../src/shared/jobs.ts), [profile schema](../../src/shared/profile.ts), [public application interface](../../src/shared/appearance.ts), [posting analysis/budgets](../../src/shared/posting-analysis.ts).
- [Generation graph](../../src/main/source-linked-generation.ts), [qualification coverage](../../src/main/qualification-coverage.ts), [factual checks](../../src/main/factual-verification.ts), [frozen outgoing data](../../src/shared/outbound-consent.ts), [request dispatcher](../../src/main/posting-analysis.ts).
- [Workspace implementation](../../src/main/workbench.ts): tables/migrations at lines 78–109; job persistence at 490–516; per-run consent thereafter; check/approval/export guards at 994–1034.
- [Compiled PDF inspection](../../src/main/pdf-document.ts), [canonical document](../../src/shared/document.ts), [actual page-fit/cut proposals](../../src/main/index.ts) at lines 300–307. Current overflow suggestions reverse document entries rather than implement a relevance-weighted cut rubric.
- [Backup engine](../../src/main/workspace-backup.ts): table registry at 17–23; unknown-table guard at 36–41; exact schema/table/migration validation at 95–141; verified safety backup/transactional restore at 153–184.
- [Profile UI](../../src/renderer/ProfileEditor.tsx), [current import absence regression test](../../tests/electron/profile-sections.spec.ts) at line 16, [narrow bridge regression test](../../tests/electron/appearance.spec.ts).
- [Normative design-system entry](../../design%20system/README.md), [page contracts](../../design%20system/pages.md), [tokens](../../design%20system/tokens.md), [interaction/accessibility](../../design%20system/interaction.md).

**Research validation boundary:** this work inspected source and documentation. It did not run the CV Tailor test suites, upstream tools, live job-search connectors, a model-quality benchmark, or an installer. No runtime compatibility, regional coverage, permission, or efficacy claim is inferred from source inspection alone.
