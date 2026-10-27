# Personal-local Wuzzuf posting source policy

**Decision recorded:** 2026-10-27. **Scope:** the maintainer's own local CV Tailor installation and one explicitly selected Wuzzuf job posting. This decision is separate from the Lever/Greenhouse policy in [#103](personal-local-posting-source-policy.md).

## Accepted product-risk exception

The maintainer explicitly accepts a **Wuzzuf-only personal-local product-risk exception** for guarded capture, human review, and saving the exact selected job posting despite Wuzzuf's published terms' modification/use restrictions. The maintainer understands this is a product-risk choice for their own local use; it is **not publisher permission, a license, legal advice, a finding of legality, or a blanket grant** to other people, sources, installs, or distribution. Do not describe Wuzzuf as having authorized CV Tailor or as generally permitting reposting or retention.

This decision does not authorize fetching or saving any posting by itself. It records the accepted scope and the gates below. Until a specifically reviewed implementation passes its gates, Wuzzuf remains unavailable to automatic intake. Manual paste remains distinct and available.

## Local data and use boundary

- Only one exact posting selected by the user may be requested per explicit fetch. No listings, search results, bulk retrieval, background refresh, browser session/cookies, JavaScript execution, access-control/CAPTCHA/login bypass, proxy rerouting, or following posting links.
- The request must use a guarded main-process source adapter: validated Wuzzuf origin and posting path, HTTPS, bounded bytes/deadlines/redirect policy, public-address/DNS protections, minimal request data, and cancellation/stale-response protection. Never send profile/CV data, model credentials, or browser credentials to Wuzzuf.
- Captured text remains volatile until the user reviews the exact role, source, title, employer, completeness and freshness and explicitly chooses Save. A fetched preview alone is not a saved job. Preserve the original source snapshot separately from working text and later user corrections.
- An accepted posting and its source/provenance may be retained in this person's local workspace and user-created backups for their own CV tailoring. No redistribution or other-person default is authorized. Other installations default off unless a future product decision specifically authorizes that scope; this exception itself is not transferable.
- Deleting a saved job removes its attributable posting, snapshot and derived workspace data under the existing deletion contract. User-created backups remain separate files and may retain/restore previously saved text; they are not silently rewritten. Explain this before Save and at relevant deletion/backup flows.
- Saving is not model authorization. Any Pi extraction is a separate operation with a fresh, explicit, run-scoped outgoing-data consent for the immutable posting snapshot and selected extraction task. Stored posting text, citations, hashes, or an earlier authorization do not authorize a later model call.

## Paused and excluded sources

This exception is Wuzzuf-only. LinkedIn and Indeed remain paused. Generic Lever/Greenhouse routes, arbitrary HTTPS hosts, employer public pages, LinkedIn discovery, and other job boards are not enabled by analogy; they require source-specific research and a separate decision. Do not broaden this into universal posting capture or a general scraping promise. No automatic messaging or application submission is in scope.

## Preconditions before behavior ships

1. Implement and test the narrow guarded Wuzzuf request/response contract, including origin/path validation, DNS/public-address protections, redirect policy, bounded response/deadline, cancellation, no credential/private-data leakage, and no fallback to another host or provider.
2. Establish exact-role extraction and completeness/review behavior. An identity-less JSON-LD `JobPosting` is only a candidate when there is exactly one unique canonical posting identity and independently visible title and employer both match the selected role. Canonical metadata alone, schema presence alone, URL slug, or model judgment cannot establish identity or completeness. Conflicts, multiple roles, missing essential fields, partial/teaser content, or stale attempts must fail closed or remain visibly unresolved; do not persist them as accepted source facts.
3. Verify explicit opt-in and per-posting Fetch and Save, duplicate/stale rejection, temporary-preview cleanup, separate source snapshot/working corrections, backup/deletion notices, and default-off behavior outside the maintainer's local installation. Keep historical jobs and backups intact.
4. Keep Pi extraction separate from retrieval and Save. Require fresh run-scoped consent bound to the immutable saved posting snapshot and exact prompt/model operation. Extraction may propose posting-contained facts only; every optional recruiter/HR/contact reference must cite its exact source text. No people search, enrichment, invented identity, or messaging. No authorization reuse.
5. Complete source-specific policy, security, privacy, extraction and acceptance review before enabling; source reachability or passing synthetic tests is not proof of permission, legality, completeness, or installed behavior. No live posting/model or packaged-app test is implied by this decision.

Reassess before any expansion in user base, distribution, source, collection, retention, model use, or applicable terms. A later source-specific exception must not inherit this one.
