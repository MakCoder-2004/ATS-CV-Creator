# LinkedIn job-link intake feasibility

**Research date:** 2026-10-25
**Scope:** One user-selected LinkedIn job. This report does not authorize a connector or automatic-fetch promise.

## Verdict

No approved route was verified for retrieving the full text of an arbitrary selected LinkedIn job. Keep LinkedIn unsupported for automatic intake. The official Job Posting API publishes and manages customer jobs on LinkedIn; its documentation does not describe a job-search or general listing-read API. LinkedIn currently says it is not accepting new Job Posting API partnerships and directs applicants to Apply Connect.

This is a bounded documentary finding, not proof that no private agreement could ever provide access. A specific LinkedIn agreement or licensed supplier would need a separate review and user approval. The parent feature remains `needs-info` until the user chooses a route, scope, and any cost.

## Evidence and route results

| Candidate route | Result | Evidence and limits |
| --- | --- | --- |
| Official general jobs read/search API | **NOT VERIFIED** | LinkedIn's [API access guide](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access) documents open consumer permissions and restricted products. The [Job Posting API overview](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview) describes authorized partners posting jobs for customers, not job seekers reading listings. The overview currently says LinkedIn is not accepting new partnerships for that API and directs applicants to Apply Connect. |
| Job Posting API as a read route | **NOT VERIFIED** | Its documented purpose is posting and managing customer listings. The [Job Posting API terms](https://www.linkedin.com/legal/l/job-posting-api-terms) limit approved integrations to the approved use case and authorized clients. They do not grant a general job-search feed. If access were separately approved, storage would still be limited to data expressly permitted by the developer documentation. Stored data must be kept current and deleted on specified client or LinkedIn requests. These terms do not establish rights to store a job seeker's selected posting. |
| LinkedIn Job Library | **NOT VERIFIED** for this product use | LinkedIn's [Job Library help page](https://www.linkedin.com/help/linkedin/answer/a7451373) says the public library covers paid job posts, searchable by company, payer, keyword, country, and date. Restricted entries remain represented, but their job post content, company name, and payer name are withheld. The library retains posts for one year after closure. It is not documented as a user-selected-job API or a license to fetch, store, or display arbitrary job descriptions in another app. |
| Unauthenticated LinkedIn web-page fetch | **NOT VERIFIED**, and not attempted | Section 8.2 of the [User Agreement](https://www.linkedin.com/legal/user-agreement) prohibits software or other means used to scrape or copy LinkedIn services and prohibits unauthorized automation and access-control bypass. LinkedIn's [prohibited software guidance](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software) restates that restriction. No page request was made. |
| Private LinkedIn partner or customer agreement | **INCONCLUSIVE** | Official materials require approval and a signed agreement for relevant Talent integrations. No access was requested and no evidence establishes a read product, eligibility, fields, price, freshness, or downstream display and storage rights for this app. Do not treat access to a customer's own job-posting data as permission to fetch arbitrary LinkedIn jobs. |
| Third-party licensed job-data supplier | **INCONCLUSIVE** | No named supplier was selected or reviewed. A supplier would need to prove LinkedIn source provenance, exact selected-ID matching, complete posting text, freshness, and rights to retain and display that text. No supplier was contacted, purchased, or tested. |

No suitable route has verified fields, exact identity, completeness, cost, rate limits, retention window, or freshness. The public Job Library is the only reviewed user-facing read surface, but its scope does not meet the requested arbitrary single-posting intake. For authorized-client applications offering aggregate data across channels, the Job Posting API terms also require separate display of LinkedIn data and specify strict storage controls. Those terms do not grant this app access.

## URL identity is not retrieval

The following is a syntax-only analysis. It does not establish that a job exists, is public, is current, or can be fetched. No URL parser was implemented or tested against LinkedIn.

| Shape | Possible selected-ID extraction | Required rejection cases |
| --- | --- | --- |
| `https://www.linkedin.com/jobs/view/1234567890/` | A single all-decimal path segment after `/jobs/view/` | Reject missing or multiple IDs, malformed paths, deceptive hosts, credentials, and unsafe URL syntax. |
| `https://www.linkedin.com/jobs/view/software-engineer-1234567890/` | A single terminal decimal suffix after the slug separator | Reject a slug without a numeric suffix, multiple possible IDs, malformed paths, deceptive hosts, credentials, and unsafe syntax. The slug itself is not identity evidence. |
| `https://www.linkedin.com/jobs/search-results/?currentJobId=1234567890&keywords=engineer` | Exactly one decimal `currentJobId` query value | Reject absent or repeated values, non-decimal IDs, conflicting IDs elsewhere in the URL, deceptive hosts, credentials, and unsafe syntax. Ignore and do not retain or report unrelated tracking parameters. |
| `https://www.linkedin.com/jobs/search/?currentJobId=1234567890&keywords=engineer` | Exactly one decimal `currentJobId` query value | Apply the same checks as the `search-results` form. A keyword-only search URL has no selected job and must not select the first result. |

A safe normalizer could record only the canonical host, supported path shape, and one selected numeric ID for investigation. That record would mean “selected job reference recognized,” not “posting retrieved.” Exact identity would still require an approved source to return the same LinkedIn job ID and matching title and company. Complete retrieval would additionally require the full description, not a teaser, expired notice, login page, or search results. None of these checks ran because no approved read route was established.

## Live checks and privacy

No request was made to LinkedIn job URLs, search pages, or unofficial endpoints. The only external pages fetched for this report were the official documentation, terms, and help pages linked above. There was no login, cookie, account, proxy, paid service, posting-content capture, or outbound profile data. No LinkedIn request status, redirect behavior, response size, or timeout was measured.

The stopping point follows LinkedIn's stated restrictions and the lack of a suitable documented read route. Testing public page reachability would not answer whether automated retrieval is permitted or whether the response contains the selected full posting. Do not use an unofficial guest endpoint, browser session, or third-party scraper to fill that evidence gap.

## Recommendation and next decision

Keep current Lever-only automatic intake unchanged. Do not build a LinkedIn connector from URL recognition or public-page reachability. The user can decide whether to pursue a named, permissioned provider or an explicit LinkedIn agreement. Before that decision, there is no route, cost, or scope to implement. Manual capture remains a separate product choice and is not automatic LinkedIn support.

**Acceptance status:** Research completed with a negative feasibility finding. No fetch capability was implemented or demonstrated. The parent remains `needs-info` pending the user's route decision.
