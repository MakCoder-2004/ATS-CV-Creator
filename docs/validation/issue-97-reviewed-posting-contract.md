# Issue 97: reviewed named posting contract (NOT ENABLED)

This artifact defines a future contract only. It does not enable Lever or Greenhouse requests, add an adapter/IPC/renderer route, change source policy, or authorize saving or model dispatch. Lever, LinkedIn, and Indeed remain paused in shipped behavior under #104. Greenhouse is not enabled.

`src/shared/named-posting-contract.ts` accepts only recognized exact-posting URL forms: Lever `jobs.lever.co/{site}/{postingId}` and Greenhouse `boards.greenhouse.io` / `job-boards.greenhouse.io` `/ {board}/jobs/{numericId}` (optional descriptive slug). Unknown hosts, query/fragment, credentials, ports, apply/listing paths and malformed IDs fail closed. Temporary attempts distinguish retrieval from typed failure; candidates are bound to an attempt, canonical identity, exact returned board/ID, full text and capture/provenance metadata. `acceptNamedPosting` requires the app-held attempt and candidate, non-expiry and explicit exact-role/completeness review. A shape-valid record or hash alone is not proof of review. This helper is contract scaffolding, not a production API.

`tests/named-posting-contract.test.ts` uses synthetic local values only; it performs no network calls and uses no profile, account or credential data. It covers successful/mismatched identities, namesakes, Unicode, malformed/decorated URLs, incomplete/expired/login/unsafe/cancel/deadline/opt-in failures and refusal to promote failed/unaccepted text. These tests do not prove provider API semantics, SSRF controls, temporary-data cleanup, public API wiring, visible review/save, or installed behavior.

## Remaining gates

- #98: prove official source formats and implement bounded, opt-in trusted-main-process retrieval with deterministic public API tests, safe networking, cancellation/deadlines, and temporary cleanup.
- #99: visible exact-role/completeness/freshness review and explicit Save; accepted source snapshot only, with rejected/unaccepted content excluded from durable stores/backups/CVs.
- #101: integration and separately approved installed validation after #97–#99; no live request or package was run for this contract.

The personal-local source decision in `docs/decisions/personal-local-posting-source-policy.md` is not a shipped enablement decision. Pi Web Access remains deferred negative (#102).