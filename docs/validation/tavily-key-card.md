# Tavily key card validation

The standalone `TavilyKeyCard` is implemented for later mounting beside the Pi model card. The central Settings integration is intentionally not included in this change.

## Behavior and security contract

- Key status contains configuration/storage state only; saved key display starts masked and replacement uses an independent password field.
- Reveal is an explicit main-process request. Plaintext exists only in component state/ref until Hide, replacement/removal, or unmount. Generation invalidation prevents a late reveal response from displaying after Hide or removal.
- Copy uses the main-process clipboard operation and returns only a secret-free message. The card warns clipboard contents may be read by other apps until replaced.
- “Revoke locally” is confirmed in an inline group with Cancel focused first; this deletes only the local encrypted key and does not revoke the Tavily account key. Cancel restores focus to the trigger.
- A failed initial status load announces the failure and replaces the loading summary with an explicit reopen-Settings retry path; it never claims a key is configured.
- Hide remains available while a reveal is pending, invalidates its response, masks the display, and releases the pending state.
- Search disclosure says Tavily may share the public query with other search-index providers and receive network metadata; no profile data is sent.
- Storage unavailable keeps local removal available when a key is configured while disabling reveal/copy and new key entry.
- Saving never starts a search. Errors do not render thrown backend error content or claim success.

## Checks

- `npx vitest run tests/tavily-key-card.test.ts --maxWorkers=1` — PASS, 4 tests
- `npx tsc --noEmit` — PASS
- `node scripts/check-doc-links.cjs` — PASS, 61 Markdown files
- `git diff --check` — PASS

These checks cover SSR markup, source-level guards for failure/reveal/confirmation semantics, and TypeScript only; no DOM testing dependency is installed for mounted interaction tests. The component is not mounted in Settings on this branch, so this is not an Electron UI or hands-on visual validation. Verify the mounted two-column desktop / single-column mobile layout and keyboard interaction after central integration.
