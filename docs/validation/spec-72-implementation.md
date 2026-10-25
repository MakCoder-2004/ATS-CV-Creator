# Spec 72 D1 implementation evidence

D1 adds a storage and trusted IPC deletion preview and execute contract. The Saved jobs controls and installed acceptance are separate child units D2 and D3. This report uses synthetic workspaces only. The user's installed Windows executable has not been run or approved for this check.

## Ownership and baseline

`tests/transactional-job-deletion.test.ts` was committed before the deletion operation at `f3ec8210745a5ee64f98dbb165ccca903307cc76`. Its public scripted workflow saved three named jobs, three valid draft revisions, three consent records, three analysis states and nonzero graph checkpoints. A backup contained all three job IDs, all three draft rows and checkpoints. The baseline test passed before implementation.

The job's posting source snapshots, source history and accepted revisions live in `jobs.data`. The six tables with direct `job_id` ownership are `posting_analysis_cache`, `analysis_run_state`, `generation_recovery`, `draft_revisions`, `regeneration_proposals` and `document_fit_reports`. `outbound_consents` now records `job_id` at consent time, including consent accepted before analysis starts. Historical rows are backfilled from run-linked analysis, cache or recovery where possible. Run IDs are collected from those tables and active previews before deletion. They own `analysis_attempts`, `provider_attempt_outcomes`, `generation_recovery_extensions`, `langgraph_checkpoints` and `langgraph_checkpoint_writes`; the graph thread ID equals the run ID. Selection fingerprint includes all selected row values and active outbound handles. A run linked to an unselected job refuses deletion instead of deleting shared records. Profile rows, evidence revisions, other saved jobs, previous backups and already-exported files are never deletion targets.

A legacy consent accepted before analysis and then abandoned before this migration has no durable job identity. The old schema stored only a run ID with no job link. Such an orphan cannot be attributed without guessing and remains revoked on backup restore; it cannot dispatch after restart. Newly accepted consents have durable ownership and are deleted with their job.

## Focused acceptance

`tests/transactional-job-deletion-acceptance.test.ts` checks a concrete inventory. Before deletion, `jobs` has three IDs, `draft_revisions` has three rows, `generation_recovery_extensions` has one, `regeneration_proposals` has one and `document_fit_reports` has one for the third job. It adds an accepted but unstarted consent for the first job. After deleting the first two jobs, the jobs and drafts contain only the third ID. Every surviving direct-job row, run-linked consent/attempt/extension row, checkpoint row, profile skill and evidence revision is compared with the corresponding original row, not only counted. The third job's fit report and an exported file are unchanged. A new backup restores with only the surviving job. Old consent tokens and paused recovery are refused. Missing/duplicate/stale selections and active export are refused. Abort triggers at draft and job deletion stages roll back all rows and preserve authorization. `tests/workspace-backup.test.ts` covers older backup migration and restore. Tests do not invoke a provider.

The operation is synchronous inside a SQLite transaction. No provider or export starts between the final fingerprint/busy check and commit on the single main-process event loop. In-memory consent, preview and analysis references are invalidated only after commit. Export and page-fit operations hold a named job lease from before their first await through completion; model work holds its active run until its response settles, including cancellation. A fresh backup omits deleted rows. Older backups are not rewritten and can restore deleted jobs if the person chooses to restore them.

## Checks run

`./node_modules/.bin/vitest run tests/transactional-job-deletion*.test.ts tests/workspace-backup.test.ts --maxWorkers=1 --reporter=dot` passed 16 tests in three files. `npm run typecheck`, `node scripts/check-doc-links.cjs`, and `git diff --check a46aba1234193cc85b9d9d24899451e7cbb6c2a4 HEAD` passed. A parallel attempt hit the posting parser's 2-second deadline in one unrelated backup test under worker contention. The same test passed with one worker. No full suite, packaged executable or provider request ran.

## Remaining gates

D2 must wire the public methods into Saved jobs and Tailor CV with the approved design contract and keyboard/selection behavior. D3 must verify the real installed Windows application, SQLite reopen, cancel/busy/stale/error UX, backup and rollback, and both themes and responsive widths after the user's final executable permission. Neither an installed-app result nor secure erasure or remote-provider deletion is claimed here.
