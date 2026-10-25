# Version 0.5.0 integration and build evidence

This report records the reviewed implementation and local build. It does not establish installed-app acceptance or real-provider quality.

## Integrated work

| Spec | Reviewed head | Result |
| --- | --- | --- |
| #72 saved-job deletion | `7aea0c4645974c2c8951a1295b18e3aca3550142` | Single and bulk deletion, atomic ownership cleanup, busy and stale refusal, and visible confirmation. The user approved retaining unattributable legacy history, including in new backups. |
| #73 AI-led CV upload | `408d8b2d9e1b81da7ac5f4cc864c558b492d3afe` | Exact source-backed PDF and DOCX proposals, explicit consent, reviewed merge and recovery. Ambiguous mixed-record source units cannot authorize unsupported classification. |
| #74 LinkedIn feasibility | `62d780e34e4dc72bf0e755b2a7455781f3be3c6a` | Research completed. No appropriate automatic retrieval route was verified. No connector was implemented. |
| #75 tailored paragraphs | `5322d708929e54f0837c00901221ef77cdd5ccf3` | New and explicitly regenerated descriptions use compatible paragraph metadata. Old draft wording, canonical hashes and approval behavior remain intact. |

Each head received an independent `openai-codex/gpt-6-sol` review. Proven findings were fixed before integration. The additional integration patch at `0786e62f09c3ba013e43ccb2f7c30bad29721430` received the same independent review.

The integration patch separates logical cancellation from unsettled physical requests. Posting edits can proceed after logical cancellation, but deletion, backup, restore and same-run recovery wait for physical settlement. Late progress cannot replace a newer run. Manual record updates retain the selected paragraph format without imposing the generation word limit on user edits.

The task-owned spec worktrees, integration worktree and merged local branches were removed. The pre-existing untracked `docs/plans/pi-sdk-migration.md` was preserved.

## Verification

| Check | Actual result |
| --- | --- |
| `npm ls --depth=0` | Locked direct dependencies resolve. No package additions were required. |
| `npm run typecheck` | Passed after integration. |
| `node scripts/check-doc-links.cjs` | Passed after integration. |
| First planned `npm test` | 333 passed and five failed across four files. The failures exposed old-format fixtures, a missing consent column and coupled cancellation state. |
| Reviewed integration fixes | Focused public API, SQLite and legacy tests passed. The [integration fix report](specs-integration-fixes.md) records the changes. |
| Final `npm test` | All 345 tests passed across 59 files with one worker. This was the justified repeat after production lifecycle fixes, not a full suite per spec. |
| Focused integrated development Electron checks | Four passed. The cases cover deletion, full-fact PDF import and reopen, full-fact DOCX import and reopen, and paragraph selection, source inspection and replacement comparison. |
| `npm run verify:latex` | Pinned compiler, 132 package records, licenses and template smoke passed. |
| `npm run build` | Passed. Existing Zod annotation warnings did not stop the build. |
| `npm run rebuild:electron` and `npm run verify:electron-sqlite` | Passed. Native SQLite queried successfully under Electron ABI 140. The source check also passed after packaging. |

The four integrated Electron cases ran with one worker:

```text
npx playwright test tests/electron/job-deletion.spec.ts tests/electron/tailored-paragraph-review.spec.ts tests/electron/profile-ai-fixtures.spec.ts --grep 'saved-job deletion|development Electron selects|consented (pdf|docx) full-fact' --workers=1 --reporter=line
```

The orchestrator inspected representative integrated screenshots. Fresh captures were archived locally under `.audit/spec-implementation/integrated-ui/`. Test-generated changes to the earlier committed captures were restored so the historical evidence was not rewritten.

## Installer artifact

The installer was built from source commit `bb62dc37b095c199bcd3d0b920ab09de8e420036`, which adds only version metadata after the reviewed code. The local artifact is `release/CV-Tailor-Setup-0.5.0.exe`, Windows x64, 257,021,485 bytes.

SHA-256:

```text
f0b01276de4c3df15e38dccd50b93a578abd9a6382374ef51ad331f005da8d45
```

Packaging used `npm exec -- electron-builder --win nsis`. The command reached its timeout after emitting the installer and blockmap. Its process exit was not recorded as successful. Subsequent artifact inspection verified all of the following without launching the packaged app:

- The complete `0.5.0` updater manifest matches the installer's SHA-512 and exact size.
- The installer has a valid PE header and its blockmap decompresses to version-2 JSON.
- The packaged application declares version `0.5.0`.
- All 22 built output files match their packaged ASAR contents byte for byte.
- The packaged SQLite binary matches the source binary verified under Electron ABI 140.
- Windows reports that the installer is not digitally signed.

The standard `dist:win` post-package executable checks were not run because those checks launch the packaged executable. Static artifact checks are not installed-app checks. The installer and packaged application have not been launched or installed by the orchestrator. The build is local and is not a published release.

## Open acceptance gates

- #78, #81 and #86 still require approved installed Windows checks, native SQLite reopen and the specified installed flows. The user's accepted Windows machine is the intended environment.
- Real-provider extraction and paired wording-quality baselines remain NOT VERIFIED. The app made no real CV model request during this run. Request-specific outgoing-data consent is still required.
- #74 remains `needs-info`. Private partner and licensed-supplier routes are inconclusive, not disproved. Manual capture has not been accepted as automatic LinkedIn support.
- Unattributable pre-migration history remains under the user's approved exception. The confirmation discloses that limit. No secure-erasure or remote-provider deletion claim is made.

Per-spec evidence remains in the [deletion report](spec-72-implementation.md), [upload report](spec-73-ai-upload.md), [paragraph report](spec-75-implementation.md) and [LinkedIn research](../research/linkedin-job-intake-feasibility-2026-10-25.md). The local orchestration trail is `.audit/spec-implementation/decisions.tsv`. The local artifact receipt is `.audit/spec-implementation/build-manifest.json`.
