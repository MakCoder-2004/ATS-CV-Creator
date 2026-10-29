# Fresh letter-only retry and durable generation status (#122)

## Delivered boundary

Backend/shared/preload only, extending the [optional-letter contract](../plans/optional-cover-letter.md). No renderer integration, installer, artifact/compiler changes, automatic resume, fit claim or approval implementation. Approval still refuses absent a real main-generated fit measurement. Tests use actual SQLite and scripted transports, including the Pi model/auth adapter; they are not live-provider acceptance.

## Public workflow

1. Read `getCoverLetterGenerationStatus(jobId)`, including `originCvRevisionId`.
2. Call `prepareCoverLetterRetry(jobId, originCvRevisionId)`. The CV ID is an optimistic fence against the actual latest intent's origin, **not a historical CV selector**: if completed parent B superseded A, passing A refuses as stale even when both parents have the same job and scope. This returns the existing strict outgoing-data preview with purpose `cover-letter-only`, a fresh token/run and an uncertainty warning when applicable. A preview alone sends nothing.
3. Use existing `acceptOutboundConsent(token, true, true)` or `cancelOutboundConsent(token)`. Acceptance atomically saves the new grant and its prepared letter operation. Cancelling an accepted prepared retry records cancellation without dispatch.
4. Call `generateCoverLetter(token)` once. It returns the existing letter outcome (`not-started`, `saved`, `failed`, `cancelled`, `uncertain`). Successful retry makes exactly one letter request, zero posting-analysis requests and zero CV requests. No old grant, child, response or CV step is replayed.

The IPC channels are `cover-letter:retry:preview`, `cover-letter:generate`, and `cover-letter:generation:status`. Registration in `cover-letter-retry-ipc.ts` checks the trusted sender before exact arity/UUID parsing and validates results. Preload independently parses inputs/results. The existing initial wrapper and legacy CV API retain their contracts. Initial/CV-only tokens cannot call the letter-only API; letter-only tokens cannot analyze, generate or regenerate a CV.

## Provenance and refusal policy

`retryOrigin` explicitly links the new operation to the original completed v5 CV parent run and consent. The resolver independently derives that root from the actual preceding same-job intent in the persisted consent insertion ledger. Consecutive letter-only intents must have matching operations, grants and bindings all the way back to that root. A coordinated rewrite of the child selector, initial binding and saved letter to another valid same-job/same-scope CV cannot substitute that CV for the actual prior intent's origin. `initialBinding` retains the immutable actual CV identity created by that parent, exact scope/model/posting binding. An old CV-only parent supplies data only, never letter authority: Add Letter requires the new letter-only grant. A real committed CV with no letter child (including the CV-to-letter crash gap) is eligible through validated completed parent data. No API, persisted domain schema, database migration or backup version was added by the review fixes; backups explicitly retain consent insertion order, which restore re-inserts in that order.

The shared provenance resolver checks the completed recovery record, frozen successful posting analysis, original CV identity/nonempty valid generation, purpose commitment, source projection and ordinal/passage mapping. Missing/stripped retry-origin or source binding is invalid for a letter-only grant; it never becomes a permissive legacy initial operation. Unknown historical initial records remain read-only. Backup validation uses the same resolver. Retry run consent/operation owners participate in existing deletion fingerprints, transactional deletion and restore revocation.

Normal CV-only review/skill/title edits before preview do not change the origin CV ID or require CV regeneration. The currently visible latest CV ID is captured separately for preview/accept/in-flight fencing, not represented as provenance. Preview also captures the actual source consent identity before its async preparation boundary; a replacement intent during preparation or before acceptance refuses even if it has the same CV root. After acceptance, only that run's grant may remain the latest intent at dispatch, post-auth, response and save. Changed posting, profile, source passages, exact model or thinking effort refuse before dispatch; no fallback analysis is run. Source availability and bindings are rechecked after awaited auth, after response and inside the save transaction.

Current readiness, edits, acknowledgments and approval require exact issued source mappings, including the authoritative skill JSON passage. The old `Saved <heading> skill.` display label is never equivalent current evidence, for either new initial letters or retries, with or without optional child metadata. Backup compatibility may retain exactly that deterministic historical label **only as read-only prose**, with otherwise valid identity/ordinal/source/origin relationships; arbitrary passage or ordinal forgeries still refuse restore. Restore clears review authority, and the uncanonicalized label continues to fail all current-readiness paths. This preserves historical reading without pretending that removable metadata proves a record's age. Unknown older initial origins likewise remain read-only; released v1–v3 CV-only backup migrations are unchanged.

The single private letter task path serves initial and retry generation. It persists dispatch intent before sending and saves letter plus child completion atomically. Capacity failures cannot send without intent or save partial letters. One-dispatch accounting remains in the letter operation ledger, not run-wide CV attempt outcomes. Physical ownership survives cancellation until provider settlement. Reopen marks dispatched work uncertain; a new prepared retry stays durably not-started but has no restored runnable token. Restore revokes grants and cancels prepared/dispatched work.

Recipient is copied locally when replacing the same job's letter. It is never included in a prompt. Neither prior letter/CV prose, draft-local facts, contacts, local IDs nor restoration maps enter the letter request. Declared role kinds and nested source context come from the authorized frozen parent, not a model/UI classification. Hashes bind data; they are not independent authority or semantic proof. The origin relationship is a consistency check against the retained intent ledger, not a cryptographic signature over the workspace: coordinated rewriting/removal/reordering of the entire consent/recovery history is outside this bounded protection.

## Status shape

```ts
{
  jobId: string;
  status: 'not-requested' | 'not-started' | 'generating' | 'saved'
        | 'failed' | 'cancelled' | 'uncertain';
  originCvRevisionId: string | null;
  parentRunId: string | null;
  operationId: string | null;
  letterId: string | null;
  retryAvailable: boolean;
  reason: string;
  warning: string | null;
  experienceKinds: Record<string, 'employment' | 'training'>;
}
```

The status follows the latest persisted consent/run for the job. `letterId` identifies the latest saved letter, if any; a later failed attempt does not remove an older letter. `originCvRevisionId` is the validated original CV, even if later local CV revisions exist. `experienceKinds` is resolved from the original parent's frozen facts. `retryAvailable` is false while a physical job operation is unsettled or bindings are incompatible. Status does not imply approval, fit, readiness, or semantic correctness. New previews/grants are required after restart/restore; status reading never recreates authority.

## Verification

Local logs: `YOUR.audit/cover-letter-retry/` (intentionally not committed). `red.log` records the two public behavior regressions failing on the parent because the public status/retry APIs did not exist; the baseline generation cases passed. `green-fourth.log` records the first 65 focused passing tests. Intermediate diagnostic logs are retained, including corrected test setup errors; only the final gate logs establish completion.

Public regressions cover initial failure → reviewed-CV-preserving retry; explicit Add Letter after opt-out; real committed-parent/no-child reopen; uncertainty warning; unsettled and cancelled physical locks; exact Pi model/effort; local recipient preservation/privacy; duplicate, scope, purpose, model, CV, cancel, late, auth and capacity fences; prepared/uncertain/saved offline reopen; restore revocation; new-run deletion isolation; stripped/forged origin and ordinal/passage downgrade refusals. Existing initial provenance, legacy backup and CV recovery regressions remain enabled. Strict preload and main IPC sender/arity/input/result tests supplement the real public generation tests.

### Bounded provenance review fixes

New evidence is in `YOUR.audit/cover-letter-retry-review-fixes/` (not committed). On candidate `e27600e7e2817e262bd7b28b6cc19c3861eb8e44`, `red-public-restore.log` executed the public CV/letter/retry APIs against real SQLite: seven cases failed and the stripped-retry-origin control already passed. Failures confirmed stale A acceptance after completed B (letters, CV-only and no-child gap), coordinated valid B→A substitution accepted by both live readiness and restore preview, and exact legacy-label downgrades reported current live and after applied restore (initial, retry and stripped-initial metadata). These are executed reproductions, not code-path deductions. `green-repros.log` reruns the same eight cases successfully.

Additional public regressions cover three legitimate fresh-grant retries through restore without new CV/analysis calls; a separately edited visible CV; frozen declared training kinds despite later profile changes; same-root intent replacement during async preview, before acceptance and before generation; post-auth and late-response intent replacement; and legacy-label/ordinal coordinated tampering. Existing cancellation, physical settlement, uncertainty, capacity, privacy, recipient, offline reopen and deletion coverage remains enabled.

The separate fixture correction commit `6be0b3b` changes the manual current-parent review fixture's skill passage from a historical display label to the JSON actually issued by its real completed v5 parent. `green-first-focused.log` records its original refusal under strict mapping, and `fixture-green.log` verifies the corrected current fixture. Historical-label cases remain separately covered as read-only, not granted current authority. Early chain-test diagnostic failures came from an incomplete synthetic CV response for newly added training evidence; the corrected fixture emits the required parent-group paragraph and cites the actual skill index, without changing production CV generation.

Final results: `green-focused.log` passes **96/96 tests in six files** (the original 73 generation/IPC/preload tests plus 15 new regressions and eight source/review/legacy cases); plain `npm test` passes **494/494 tests in 73 files** in `full-test.log`. `typecheck.log`, `build.log`, `docs-links.log` and `diff-check.log` record passing typecheck, build, local documentation links and whitespace checks. Build emitted dependency annotation warnings, not errors. Exact final commit IDs are reported in the handoff. No UI, packaged/installed or live-provider result is claimed.
