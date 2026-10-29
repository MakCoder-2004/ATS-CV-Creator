# Captured pre-letter workspace

`original-v3.workspace.json` is an actual version-3 backup emitted by `createWorkbench(...).backup.createBackup()` before any cover-letter storage or migration implementation was integrated into the parent checkout. The relevant workbench and backup source files were unchanged from `2a7a3a040304ab5e0e451f1a7c9df218b0b38418` when captured.

The capture used only public workspace operations to save a synthetic contact, Python skill, employment record, and manually entered job posting. Its scripted provider throws if called. No model request, user workspace, credential, generated letter, or fabricated table definition was used. It contains 22 real table definitions and the released migration ledger.

The exact LF bytes have SHA-256 `d905efcc3bc4cfa70ddb8c5669cfa13b11f0eeb4250fe3764cdf60c1e4b81641`. Git conversion is disabled for the fixture. Do not regenerate it using the newer backup engine or relabel a newer backup as version 3.

`tests/cover-letter-legacy-backup.test.ts` restores this static fixture and checks the actual retained facts/posting. Its corrupted-consent-schema case guards against a future version upgrade laundering untrusted legacy SQL into a trusted current definition.

The regression suite also derives the known pre-job-ownership v3 shape by removing migration 10 and its `job_id` consent column. Git history immediately before `b9c888e` confirms that the app emitted v3 with that older consent schema. The unchanged baseline engine accepts this known upgrade; the initial feature storage candidate rejected it, so preserving that transform is an explicit regression gate. This derived case is not presented as another captured backup.

This fixture has no draft, active consent, or checkpoint rows. Existing dedicated legacy canonical-hash, consent, recovery, and backup tests remain necessary; this fixture does not replace them.
