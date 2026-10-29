# Fresh letter-only retry and durable generation status (#122)

## Delivered boundary

Backend/shared/preload only, extending the [optional-letter contract](../plans/optional-cover-letter.md). No renderer integration, installer, artifact/compiler changes, automatic resume, fit claim or approval implementation. Approval still refuses absent a real main-generated fit measurement. Tests use actual SQLite and scripted transports, including the Pi model/auth adapter; they are not live-provider acceptance.

## Public workflow

1. Read `getCoverLetterGenerationStatus(jobId)`, including `originCvRevisionId`.
2. Call `prepareCoverLetterRetry(jobId, originCvRevisionId)`. This returns the existing strict outgoing-data preview with purpose `cover-letter-only`, a fresh token/run and an uncertainty warning when applicable. A preview alone sends nothing.
3. Use existing `acceptOutboundConsent(token, true, true)` or `cancelOutboundConsent(token)`. Acceptance atomically saves the new grant and its prepared letter operation. Cancelling an accepted prepared retry records cancellation without dispatch.
4. Call `generateCoverLetter(token)` once. It returns the existing letter outcome (`not-started`, `saved`, `failed`, `cancelled`, `uncertain`). Successful retry makes exactly one letter request, zero posting-analysis requests and zero CV requests. No old grant, child, response or CV step is replayed.

The IPC channels are `cover-letter:retry:preview`, `cover-letter:generate`, and `cover-letter:generation:status`. Registration in `cover-letter-retry-ipc.ts` checks the trusted sender before exact arity/UUID parsing and validates results. Preload independently parses inputs/results. The existing initial wrapper and legacy CV API retain their contracts. Initial/CV-only tokens cannot call the letter-only API; letter-only tokens cannot analyze, generate or regenerate a CV.

## Provenance and refusal policy

`retryOrigin` explicitly links the new operation to the original completed v5 CV parent run and consent. `initialBinding` retains the immutable actual CV identity created by that parent, exact scope/model/posting binding. An old CV-only parent supplies data only, never letter authority: Add Letter requires the new letter-only grant. A real committed CV with no letter child (including the CV-to-letter crash gap) is eligible through validated completed parent data.

The shared provenance resolver checks the completed recovery record, frozen successful posting analysis, original CV identity/nonempty valid generation, purpose commitment, source projection and ordinal/passage mapping. Missing/stripped retry-origin or source binding is invalid for a letter-only grant; it never becomes a permissive legacy initial operation. Unknown historical initial records remain read-only. Backup validation uses the same resolver. Retry run consent/operation owners participate in existing deletion fingerprints, transactional deletion and restore revocation.

Normal CV-only review/skill/title edits before preview do not change the origin CV ID or require CV regeneration. The currently visible latest CV ID is captured separately for preview/accept/in-flight fencing, not represented as provenance. Changed posting, profile, source passages, exact model or thinking effort refuse before dispatch; no fallback analysis is run. Source availability and bindings are rechecked after awaited auth, after response and inside the save transaction.

The single private letter task path serves initial and retry generation. It persists dispatch intent before sending and saves letter plus child completion atomically. Capacity failures cannot send without intent or save partial letters. One-dispatch accounting remains in the letter operation ledger, not run-wide CV attempt outcomes. Physical ownership survives cancellation until provider settlement. Reopen marks dispatched work uncertain; a new prepared retry stays durably not-started but has no restored runnable token. Restore revokes grants and cancels prepared/dispatched work.

Recipient is copied locally when replacing the same job's letter. It is never included in a prompt. Neither prior letter/CV prose, draft-local facts, contacts, local IDs nor restoration maps enter the letter request. Declared role kinds and nested source context come from the authorized frozen parent, not a model/UI classification. Hashes bind data; they are not independent authority or semantic proof.

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

Final commands: plain `npm test`, `npm run typecheck`, `npm run build`, `node scripts/check-doc-links.cjs`, `git diff --check`. Exact results and commit IDs are reported in the handoff. No UI, packaged/installed or live-provider result is claimed.
