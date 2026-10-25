# Settings controls integration — development follow-up

Issue [#90](https://github.com/Makrious/cv-tailor/issues/90). This report covers the combined faithfulness retirement and Tavily key controls in the development worktree, not an installed build or real provider/account acceptance. The user's running unpacked 0.6 app and workspace were not touched. No installer or packaged executable was launched.

## Integrated behavior

Settings has exactly two cards in its responsive grid: Pi model (with one external Pi sign-in instruction) and Tavily search key. Workspace backup remains beneath the grid. Provider sign-in and Optional faithfulness review cards, named toggle API and new semantic comparison dispatch are removed. The obsolete `faithfulness-check` row is deleted on workspace open and old backup restore. New generation recovery snapshots are version 4 without that flag; version 1–3 snapshots remain backup-readable but cannot resume under earlier consent. Historical `semantic-unsupported` findings remain attached to their source wording and block approval unless corrected or removed with current checks. No legacy true preference can initiate a hidden second model call.

A saved Tavily key remains device encrypted outside the workspace and backups, masked by default in Settings. Only explicit Reveal sends plaintext to the renderer. Hide, model-context changes and page exit clear revealed plaintext; explicit Copy decrypts in trusted main and returns a secret-free notice. Replacement input is separate. Confirmed local removal deletes only the device copy, not the provider's account key. No Settings key action initiates Tavily search or Pi work.

## Focused evidence

- `npm run typecheck` — passed.
- `ELECTRON_RUN_AS_NODE=1 electron.exe vitest run` with `--maxWorkers=1` and nine focused files (`source-linked-generation`, `approval-contract`, `generation-recovery`, `workspace-backup`, `research-search-settings-ipc`, `research-search-credentials`, `tavily-key-card`, `pi-settings-preload`, `pi-settings-migration`) — **78 tests passed across 9 files**. Synthetic legacy true, historical finding attribution, old backup/recovery, malformed and unauthorized key IPC, credential storage and card behavior are covered. No real provider or credential was contacted.
- `npm run build` — passed for main, preload and renderer using the existing read-only shared dependencies; no reinstall or native rebuild.
- One bounded development Electron `tests/electron/pi-settings.spec.ts` Settings case — passed. It confirms appData and userData are separate isolated sibling directories **before** synthetic key Save; ciphertext stays outside the workspace. Visible UI and public preload checks cover absent cards, two-card desktop row, single-column 375px stack, no horizontal overflow, masked Save/Reveal/Hide, model-field and effort change masking, Copy (count-only fake clipboard, no actual OS clipboard write), page-leave masking, confirmation Cancel focus and local removal. It uses synthetic data only. The other Pi Settings reopen case was not run in this focused invocation.
- `node scripts/check-doc-links.cjs` — local targets resolve. The checker does not inspect external URLs or anchors.

Screenshots taken **only while the key is masked**: [light desktop 1440px](artifacts/settings-followup/settings-masked-light-1440.png) and [dark 375px](artifacts/settings-followup/settings-masked-dark-375.png). Screenshots show the final two-card grid and workspace backup underneath; no plaintext key or real user data is present.

## Open gates

An independent review of the combined head, central merge to main, user-approved installed-app validation (including native SQLite reopen), real Pi/Tavily account behavior and a manual real OS clipboard check remain open. Do not infer those results from synthetic development evidence or launch/replace the existing unpacked app without permission.
