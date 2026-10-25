# Tavily Settings key card — development follow-up

Issue [#90](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/90), integration branch `feat/settings-controls-integration`. This is development-build evidence, **not** an installed-app or real Tavily account check. The user's running unpacked 0.6 app and installed executable were not touched.

The Settings grid now mounts `TavilyKeyCard` instead of the earlier inline key form. The saved value starts masked; Reveal alone returns decrypted plaintext to the renderer, Hide clears it, and leaving Settings unmounts the card. Any edit to the Pi provider/model reference or thinking level, and each successful Pi model save, also clears revealed plaintext in a layout effect before paint without remounting the key card or clearing replacement input. A model-context change invalidates a pending reveal response while leaving unrelated work alone. Copy decrypts only in trusted main IPC and writes to Electron's clipboard in normal use; it returns a secret-free notice. At the time of this earlier validation, a separate replacement field did not overwrite the saved key until Save. The later single-field correction is documented in [Settings controls integration](settings-followup.md): Replace now empties the same labeled field; Cancel restores the masked saved view, and successful Save replaces it. Removing the device copy requires confirmation, initially focuses Cancel, and explains that Tavily account revocation is separate. Ordinary status, Settings and workspace backups exclude the key; these controls do not initiate search or Pi model work.

## Focused receipts

- `npm run typecheck` — passed.
- `vitest run tests/research-search-settings-ipc.test.ts tests/pi-settings-preload.test.ts tests/tavily-key-card.test.ts --maxWorkers=1` — 15 passed. Includes trusted exact-arity IPC, malformed and unauthorized calls, encrypted-store failure paths, secret-free Copy, and preload schema parsing.
- `npm run build` — passed (Electron Vite main, preload and renderer). No npm reinstall or native module rebuild.
- `playwright test tests/electron/pi-settings.spec.ts -g 'Settings exposes Pi model preferences' --workers=1 --reporter=line` — passed, then passed again after adding the page-leave clearance assertion. The test gates synthetic Save on separately verified sibling `appData` and `userData` paths, confirms the encrypted file lives outside the workspace, checks default masking, explicit Reveal/Hide/Copy, clearing plaintext on navigation, preserved replacement input and Cancel focus restoration, local removal and ciphertext deletion. It checks secret-free Settings/status, absence of scripted provider requests and no page horizontal overflow at 1440px and 375px in both appearances. The dev-only clipboard stub increments a count without writing to the real OS clipboard or persisting clipboard contents; production uses Electron's clipboard. No real key or account was used.
- [Masked 1440px light screenshot](artifacts/tavily-key-card-0.6-followup/settings-masked-light-1440.png). It predates the separately owned Provider sign-in and faithfulness removal; those older cards are intentionally visible in this branch's evidence, not the requested final two-card arrangement. No screenshot was captured while plaintext was revealed.

## Model-context masking follow-up

- A focused Settings Electron regression now reveals the synthetic saved key, edits the provider/model field, and verifies it is masked; it repeats for a thinking-level change before saving the scripted Pi selection. The existing Hide/page-exit checks remain in the same bounded UI case.
- `tests/tavily-key-card.test.ts` verifies layout-effect invalidation, generation protection against late responses, stable card mounting, and preservation of replacement input. No delayed IPC response was injected into the Electron test.

## Later single-field correction

The redundant lower input was removed after user screenshot feedback. The current card has one `Tavily API key` field, saved view masked first, explicit Replace to edit an empty field, Cancel without a storage write and success only after persisted Save. Saved-key actions do not appear while editing. Failed private-storage inspection explicitly leaves saved-key existence unknown. See [single-field development checks and new masked screenshots](settings-followup.md#single-field-correction-on-this-branch). Earlier screenshots and results above are historical evidence, not the current field arrangement.

## Open gates

This section records the earlier component-only branch: the separate Provider sign-in and faithfulness cards still appear in its screenshot. The [combined Settings report](settings-followup.md) records their removal and the later one-field Tavily correction. Installed-app behavior and a manual check that the real clipboard receives the key remain outstanding. Do not treat the pre-merge image as the final two-card layout or replace the user's running app without approval.
