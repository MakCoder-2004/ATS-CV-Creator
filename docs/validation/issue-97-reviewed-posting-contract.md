# Issue 97: reviewed named posting contract (NOT ENABLED)

This artifact defines a future contract only. It does not enable Lever or Greenhouse requests, add an adapter/IPC/renderer route, change source policy, or authorize saving or model dispatch. Lever, LinkedIn, and Indeed remain paused in shipped behavior under #104. Greenhouse is not enabled.

`src/shared/named-posting-contract.ts` accepts only recognized global exact-posting page URLs: Lever `jobs.lever.co/{site}/{postingId}` and Greenhouse `boards.greenhouse.io` / `job-boards.greenhouse.io/{board}/jobs/{numericId}` (optional ASCII descriptive slug). Lever EU hosts intentionally remain unsupported pending source-policy and #98 review. Unknown hosts, query/fragment, credentials, ports, controls, apply/listing paths and malformed IDs fail closed. A retrieved attempt carries source-specific personal-local opt-in eligibility and bounded lifetime; candidates bind the complete selected reference, returned board/ID, complete text, timestamps, and the actual named API method/endpoint (`api.lever.co/v0/postings/...` or `boards-api.greenhouse.io/v1/boards/...`).

`createNamedPostingAcceptance` is only a builder and does not accept client review booleans. The trusted caller must retain immutable attempt, candidate, and review record in app-owned state; that review record binds the attempt and a hash of the candidate. Before trusting/promoting acceptance, call `verifyNamedPostingAcceptance` with all three independently held objects. Verification checks the complete binding, source opt-in, chronology, expiry and TTL, and recomputes the accepted record and hash. Shape or a client-supplied hash/review object alone is not proof: review records must only be created/retained by the trusted app process after explicit exact-role/completeness review. No production API is wired here.

`tests/named-posting-contract.test.ts` uses synthetic local values only; it performs no network calls and uses no profile, account or credential data. It covers successful/mismatched identities, namesakes, Unicode, malformed/decorated URLs, incomplete/expired/login/unsafe/cancel/deadline/opt-in failures and refusal to promote failed/unaccepted text. These tests do not prove provider API semantics, SSRF controls, temporary-data cleanup, public API wiring, visible review/save, or installed behavior.

## Remaining gates

- #98: prove official source formats and implement bounded, opt-in trusted-main-process retrieval with deterministic public API tests, safe networking, cancellation/deadlines, and temporary cleanup.
- #99: visible exact-role/completeness/freshness review and explicit Save; accepted source snapshot only, with rejected/unaccepted content excluded from durable stores/backups/CVs.
- #101: integration and separately approved installed validation after #97–#99; no live request or package was run for this contract.

The personal-local source decision in `docs/decisions/personal-local-posting-source-policy.md` is not a shipped enablement decision. Pi Web Access remains deferred negative (#102).