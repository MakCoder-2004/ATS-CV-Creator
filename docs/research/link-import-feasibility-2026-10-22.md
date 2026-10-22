# Link import source and resource feasibility

**Verification date:** 2026-10-22. **Scope:** Issue #27, based on `main` at `4641b36`; research/feasibility only. No application behavior, package, parent issue, or design-system files changed. No live posting request was made. No private CV, credentials, browser session, or real posting body is included.

## Decision / release gate

**Blocker: no reviewed source currently has evidence sufficient to authorize this importer to retrieve third-party posting data.** Public unauthenticated endpoints and documentation of how to use them are evidence of endpoint existence and intended customer use, not an affirmative grant to this app to retrieve, retain, or use third-party employer content. The requested opt-in permits a bounded live request only after access terms are reviewed; that condition is not met, so the live request was deliberately not sent. Do not enable a connector or market these candidates as supported until permission is clarified by the relevant provider/rightsholder (or an equally specific published grant is located and reviewed).

The matrix is non-empty as a candidate/evidence inventory, but **the production support set is empty**. This is not a claim that the providers prohibit all use; it records that permission has not been established. Consequently, the end-to-end live-source acceptance criterion is blocked. Synthetic exercises below establish only fixture/resource feasibility, not source permission, availability, completeness, or factual correctness.

## Candidate matrix (not enabled)

| Candidate/source | Proposed host + path pattern | Documented request / access evidence | Permission assessment | Extraction / redirect / limitations | Fixture / checked |
|---|---|---|---|---|---|
| Greenhouse Job Board API | `boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{job_id}`; HTTPS GET only | Official [Job Board API docs](https://docs.greenhouse.io/job-board) document public, unauthenticated GET of a single job and `content=true` for description data. | Docs establish public API access, but reviewed material does not establish third-party importer reuse/storage permission. **Not approved.** | Structured JSON; could be useful for detail retrieval if the submitted public job link can be mapped to a validated board token + numeric ID without a speculative listing request. No redirects established by docs. Optional fields may be absent; text quality/source completeness not guaranteed. | Synthetic JSON fixture is described below; docs reviewed 2026-10-22. No live call. |
| Lever Postings API | `api.lever.co/v0/postings/{site}/{posting_id}`; HTTPS GET only | Official [Lever Postings API docs](https://github.com/lever/postings-api) document public published-posting endpoints. | Docs describe endpoint/function, but no specific third-party reuse grant was identified. **Not approved.** | Structured JSON/detail route; only an exact recognized posting ID, never enumerate/search. Redirect behavior unverified. Published-posting scope only; employer-specific display/access behavior may vary. | Synthetic JSON fixture is described below; docs reviewed 2026-10-22. No live call. |
| Ashby Public Job Postings API | `api.ashbyhq.com/posting-api/job-board/{JOB_BOARD_NAME}` | Official [API docs](https://developers.ashbyhq.com/docs/public-job-posting-api) say data is for currently published postings “for your organization” and describe populating an organization’s own careers page. [Integration guide](https://docs.ashbyhq.com/routes-for-integrating-your-ashby-job-board-with-your-careers-page) describes use on the company’s external careers page. | This is a board-list response, not an identified single-posting-detail endpoint; documented purpose is organization/careers-site use. No third-party importer permission found. **Not approved; no request made** (a single request could enumerate multiple roles and would exceed the permitted one-posting check). | Structured JSON includes description HTML/plain text, metadata, hosted job/apply URLs. Mapping a submitted detail link to this endpoint requires board name and returns a list; avoid in V1 unless provider authorizes and a bounded specific-posting route is documented. | Synthetic equivalent only; docs reviewed 2026-10-22. No live call. |

No LinkedIn or regional-board source is included: no reviewed permitted detail endpoint was established. Do not infer permission from robots rules, reachability, scraper libraries, or the fact that a posting is publicly viewable.

## Extraction and representative synthetic data

Proposed extractor order is source-specific documented structured detail → explicitly supported structured posting data present in the fetched document → allowlisted source-specific static HTML. JSON is data, not permission to fetch. Static HTML requires its own source authorization and fixture evidence; do not execute scripts, run a browser, visit canonical/linked URLs, or treat generic metadata as proof of a complete posting. Source-specific extraction must reject multiple roles, listings, login/CAPTCHA/paywall pages, teasers, malformed data, and missing title/company/description as incomplete/ambiguous; retain source wording and structure and surface conflicting field values for review.

Synthetic fixture shapes used for capacity measurement (invented company/title/text; no source URLs or copied posting text):

```json
{"title":"Synthetic Systems Engineer","company":"Example Works","description":"Requirements and responsibilities. [repeated synthetic sentence]"}
```

```html
<main><h1>Synthetic Systems Engineer</h1><article><p>Requirements and responsibilities. [repeated synthetic sentence]</p></article></main>
```

At measurement time the description was 42,000 ASCII characters (1,200 repeats of a 35-character sentence); serialized JSON was 42,081 bytes and HTML was 42,074 bytes. This exceeds the old 30,000-character storage ceiling and shows that representative fixture generation/decoding is small, but is not a semantic extraction/completeness validation. Fixtures are intentionally given inline and synthetic rather than represented as a claimed real-source snapshot.

## Proposed bounded resource envelope (engineering proposal; not production settings)

| Resource | Proposed hard ceiling | Rationale / evidence and enforcement requirement |
|---|---:|---|
| Submitted URL | 2,048 UTF-8 bytes; HTTPS only; reject userinfo, fragments, malformed URL, unsupported port/path before DNS | Small enough for ordinary job links; canonicalization must not loosen supported host/path rules. Measure bytes, not JS character count. |
| Compressed response body | 2 MiB | Strict streaming byte counter independent of `Content-Length`; reject excess, do not partially accept. |
| Decompressed response body | 8 MiB | Bound decoded bytes after supported content-encoding decompression; reject expansion past limit even when compressed body is small. |
| Parsing | 2 seconds wall-clock per response; limit JSON nesting to 64 and HTML input to 8 MiB / 100,000 nodes-equivalent | Worker/utility isolation or interruptible parser required; main-thread synchronous parser cannot reliably enforce wall-clock timeout. Do not interpret this proposal as tested against a production parser (none exists). |
| Retained source description | 200,000 Unicode code points and 1 MiB UTF-8, whichever occurs first | Supports full postings far above 30,000 characters; source and working text each bounded independently. Reject, never truncate. |
| Working description | 200,000 Unicode code points and 1 MiB UTF-8 | Same completeness guarantee for edited accepted wording; schema, backup, IPC and UI must agree. |
| Concurrency | 1 active retrieval per app; 1 per source host | Prevents fan-out and simplifies cancellation/pacing. |
| Redirects | At most 3 hops; HTTPS only; every hop must independently match an approved exact origin + path policy and public-address policy; reject loops/downgrade | Redirect targets cannot add support. Validate before following and bind DNS/connection validation to each hop. |
| Pacing/retries | At most 1 request per 2 seconds per host; at most 1 retry, only for transient connect/408/429/5xx; honor bounded `Retry-After` up to 30 seconds; no retry for policy/auth/content errors | Explicit user fetch only. No automatic repeated source probing; cancellation interrupts waits. Never bypass 429/access restrictions. |
| Deadlines | 5 seconds DNS/connect/TLS, 15 seconds per response, 30 seconds total operation | Abort the socket/body read at deadline; no late preview acceptance or partial save. |

These values are proposals pending implementation testing and source policy review. The measured 42K fixture benchmark below supports a modest CPU/description baseline only; it does not validate compressed/decompressed limits, pathological parser complexity, streamed network behavior, or production parser memory. Production limits need hostile-input tests before relying on them.

### Reproducible fixture microbenchmark

Measured 2026-10-22 using Node `v24.21.0` on this Windows worktree, direct Node built-ins, 10 warmups + 1,000 in-memory iterations; each iteration parsed the synthetic JSON or stripped tags/normalized whitespace in the synthetic HTML. Output: JSON 42,081 bytes, 1,000 parses in 67.73 ms (0.0677 ms/iteration); HTML 42,074 bytes, 1,000 basic text passes in 772.94 ms (0.7729 ms/iteration). This microbenchmark excludes network, decompression, a real HTML parser, semantic extraction, schema validation, and SQLite; it is not an end-to-end performance claim. Reproduction: generate the two strings above with a 42,000-character description, warm each function 10 times, then time 1,000 calls with `process.hrtime.bigint()`.

## First-fetch security plan

- Parse and normalize before network access; allow only reviewed exact HTTPS origins, default port 443, and approved path templates/identifier grammar. Reject IP-literal hosts, userinfo, odd ports, encoded path separators/dot segments, malformed or overlong URLs, and URL schemes other than HTTPS.
- Resolve all A/AAAA results before each connection and reject loopback, private, link-local, multicast, unspecified, reserved/documentation, IPv4-mapped IPv6 and other non-public destinations. Pin the validated address for the actual connection (preserving hostname for SNI/certificate verification) to prevent DNS rebinding/TOCTOU; revalidate on every new connection/redirect. Avoid ambient proxy behavior unless explicitly reviewed and controlled.
- Validate redirect target origin, path, scheme, port and destination before following; maximum three, loop detection, no HTTPS downgrade. Do not forward cookies, authorization, API keys, referer, profile data or app headers across origins; preferably send only a minimal fixed `Accept` and user agent. Keep TLS certificate validation enabled.
- Never follow `canonical`, application, image, script, or posting-body links. Such values are untrusted display/provenance hints and cannot authorize fetches, change source identity or enable matching.
- Explicit Fetch/Refresh is the only trigger. No browser cookies/session, JavaScript, headless browser, hosted scraper, model extraction, or hidden retry. Strip sensitive query values from diagnostics; do not log bodies or full potentially token-bearing URLs. The user’s normal network IP/request metadata is exposed to the host; local parsing is not anonymous.
- Treat HTML/JSON as inert untrusted input; cap bytes, parsing time/complexity and retained text; sanitize to text/known formatting before display. Reject partial/oversized data without save. Keep source URLs out of model input unless separately necessary/authorized.

## Complete model-input capacity strategy

Storage acceptance does not imply model compatibility. Before every dispatch, freeze the exact authorized request: system/developer prompt, complete profile/facts actually selected, complete working posting, tool/schema overhead, message framing, and reserved maximum output. Use the selected model’s authoritative context/tokenizer metadata or a locally available exact-compatible tokenizer to count the entire request; require `input_tokens + reserved_output_tokens <= context_window - safety_margin`. Recompute after any model, profile, posting, prompt, or tool-schema change and bind the check to the same immutable request hash that is dispatched under current consent. Never use description characters as a token proxy, silently truncate/chunk/summarize/translate, or make an extra model call. If metadata/tokenizer/context window is unavailable or inconsistent, fail closed before dispatch and show the user the compatible-model or deliberate reviewed-shortening path. Preserve full source text, label results based on a shortened working posting, and do not treat a successful storage write as model authorization.

## Evidence boundary and next action

Reviewed official documentation proves the candidate endpoints and their documented purposes, not permission for this third-party app’s use. No live source behavior, redirects, response size, completeness, or continued availability was observed. Obtain provider/rightsholder clarification for one single-posting-detail endpoint and a clear, bounded permission basis before repeating a live check; then use one synthetic/public-safe posting URL, one request within the ceilings, no traversal, no private data, and record exact request/response characteristics. Until then, report source feasibility as blocked and keep all importer production work that assumes an enabled source gated. Manual paste-text remains the fallback in the parent specification.
