# Issue 98 named API adapter — NOT ENABLED

This focused unit adds an inert main-process adapter for exact named Lever and Greenhouse public detail APIs. It has no IPC or renderer route, source-policy change, live network check, persistence, provider/Tavily/settings changes, or enabled product workflow. Results are temporary typed attempt/candidate objects; integration and promotion remain outside this unit.

The adapter constructs only the documented detail endpoint from the validated #97 reference, requires trusted main-process source-specific personal-local eligibility, checks DNS public addresses, pins HTTPS to the checked address, disables redirects, and bounds response/body/text/TTL. Mismatched identity and ambiguous hosted URLs fail closed. Greenhouse HTML `content` is converted to text with unsafe script-like blocks removed. No test contacted either provider.

Focused deterministic tests are in `tests/named-posting-api.test.ts`. This unit does not establish source reuse/retention rights or supersede #104's pause. It is not enabled pending #99/#101 gates, broader cancellation/deadline and hostile-response tests, and review of source-specific identity/expiry semantics.
