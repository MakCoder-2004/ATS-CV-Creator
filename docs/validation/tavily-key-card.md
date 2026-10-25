# Tavily key card validation

The standalone `TavilyKeyCard` is implemented for later mounting beside the Pi model card. The central Settings integration is intentionally not included in this change.

## Behavior and security contract

- Key status contains configuration/storage state only; saved key display starts masked and replacement uses an independent password field.
- Reveal is an explicit main-process request. Plaintext exists only in component state/ref until Hide, replacement/removal, or unmount. Generation invalidation prevents a late reveal response from displaying after Hide or removal.
- Copy uses the main-process clipboard operation and returns only a secret-free message. The card warns clipboard contents may be read by other apps until replaced.
- “Revoke locally” is confirmed with Cancel focused first; this deletes only the local encrypted key and does not revoke the Tavily account key. Cancel restores focus to the trigger.
- Storage unavailable keeps local removal available when a key is configured while disabling reveal/copy and new key entry.
- Saving never starts a search. Errors do not render thrown backend error content or claim success.

## Checks

- `npx vitest run tests/tavily-key-card.test.ts`
- `npx tsc --noEmit`

These checks cover SSR markup and TypeScript only. The component is not mounted in Settings on this branch, so this is not an Electron UI or hands-on visual validation. Verify the mounted two-column desktop / single-column mobile layout and keyboard interaction after central integration.
