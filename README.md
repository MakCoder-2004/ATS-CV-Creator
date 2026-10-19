# CV Tailor

Personal Windows Workbench. This repository contains the early installable T01 baseline; profile editing, Gemini generation and document exports belong to later tickets and **are not implemented**. The approved browser-only prototype remains under `prototypes/cv-tailor-ui/` as design evidence, never part of the installed app.

## Develop and verify

```bash
npm install
npm run typecheck
npm test              # Vitest public application contract, real temporary SQLite (Node ABI)
npm run test:electron  # Rebuild native SQLite for Electron, then Playwright startup/reopen smoke
npm run dist:win       # Build a per-user NSIS installer in release/
```

`npm test` rebuilds the native database for Node. `npm run test:electron` rebuilds it for the installed Electron ABI; don't run the two suites concurrently against the same `node_modules`. Packaging also rebuilds native dependencies. The test override for temporary user data is disabled in packaged builds. The renderer only has the typed settings bridge, not generic IPC, Node or filesystem access. Settings are stored under Electron's per-user `userData` directory in `workbench.sqlite`.

The NSIS installer defaults to a per-user installation and lets you choose the location. On a clean Windows machine, install it and confirm the first window opens; choose Dark, close, reopen and confirm Dark remains selected. This exercises real native SQLite through the public UI. On this development machine, the installer was silently installed into a temporary location and the installed executable passed that reopen check with isolated temporary user data; **a clean-Windows-machine check is still outstanding**. An unsigned personal installer can trigger SmartScreen or an unknown-publisher warning. It is not a signed public release; only run installers you trust. There is no bundled API key, Python runtime, model or personal sample profile.

The approved [specification](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/1) and [T01 ticket](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/2) define the scope. [Visual approval and handoff](prototypes/cv-tailor-ui/docs/HANDOFF.md) record the Workbench direction; the prototype is not a backend or an assurance of privacy.
