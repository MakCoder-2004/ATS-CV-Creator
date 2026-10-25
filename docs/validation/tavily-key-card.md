# Tavily Settings key card — development follow-up

Issue [#90](https://github.com/Makrious/cv-tailor/issues/90), integration branch `feat/settings-controls-integration`. This is development-build evidence, **not** an installed-app or real Tavily account check. The user's running unpacked 0.6 app and installed executable were not touched.

The Settings grid now mounts `TavilyKeyCard` instead of the earlier inline key form. The saved value starts masked; Reveal alone returns decrypted plaintext to the renderer, Hide clears it, and leaving Settings unmounts the card. Copy decrypts only in trusted main IPC and writes to Electron's clipboard in normal use; it returns a secret-free notice. A separate replacement field does not overwrite the saved key until Save. Removing the device copy requires confirmation, initially focuses Cancel, and explains that Tavily account revocation is separate. Ordinary status, Settings and workspace backups exclude the key; these controls do not initiate search or Pi model work.

## Focused receipts

- `npm run typecheck` — passed.
- `vitest run tests/research-search-settings-ipc.test.ts tests/pi-settings-preload.test.ts tests/tavily-key-card.test.ts --maxWorkers=1` — 15 passed. Includes trusted exact-arity IPC, malformed and unauthorized calls, encrypted-store failure paths, secret-free Copy, and preload schema parsing.
- `npm run build` — passed (Electron Vite main, preload and renderer). No npm reinstall or native module rebuild.
- `playwright test tests/electron/pi-settings.spec.ts -g 'Settings exposes Pi model preferences' --workers=1 --reporter=line` — passed, then passed again after adding the page-leave clearance assertion. The test gates synthetic Save on separately verified sibling `appData` and `userData` paths, confirms the encrypted file lives outside the workspace, checks default masking, explicit Reveal/Hide/Copy, clearing plaintext on navigation, preserved replacement input and Cancel focus restoration, local removal and ciphertext deletion. It checks secret-free Settings/status, absence of scripted provider requests and no page horizontal overflow at 1440px and 375px in both appearances. The dev-only clipboard stub increments a count without writing to the real OS clipboard or persisting clipboard contents; production uses Electron's clipboard. No real key or account was used.
- [Masked 1440px light screenshot](artifacts/tavily-key-card-0.6-followup/settings-masked-light-1440.png). It predates the separately owned Provider sign-in and faithfulness removal; those older cards are intentionally visible in this branch's evidence, not the requested final two-card arrangement. No screenshot was captured while plaintext was revealed.

## Open gates

Faithfulness feature retirement and Provider sign-in card removal are owned by another branch. Central merge, combined independent review, updated final design-system contract, installed-app behavior, and a manual check that the real clipboard receives the key remain outstanding. Do not claim the pictured pre-merge grid is the final Settings layout. Do not replace or launch the user's existing unpacked/installed application without explicit approval.
