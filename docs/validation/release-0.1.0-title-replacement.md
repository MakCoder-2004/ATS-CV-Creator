# Windows 0.1.0 same-version title replacement — build evidence

The user explicitly chose to replace the already-public **v0.1.0** asset and move its tag instead of using v0.1.1. The earlier public installer had four recorded downloads and SHA-256 `ef8d655d87764c4ea34abfd77ac5a97a4e10e0dd582029bd4c8bf4cb7531fb28`; its bytes, manifest, release metadata and original tag were archived outside the repository before replacement. Anyone who downloaded or cached the earlier 0.1.0 may still have different bytes under the same version and filename. Check the new digest rather than relying on the version string.

The integrated source adds an optional AI-suggested, evidence-grounded CV title under the name, rendered slightly larger in Review (16px), PDF (12pt) and editable Word (12pt). A new run may omit an unsupported title; existing CVs require a fresh, inspected Pi authorization, a title proposal and explicit acceptance. Editing or removing the title creates a new draft revision and requires renewed checks, real PDF page fit and approval. Legacy narrative headlines remain ignored. The source integration also relocates the seven supplied LaTeX files unchanged and indexes two older plans as historical; the ignored placeholder PDF was not published.

## Verified before replacing the old installer

- Main integration: `npm ls --depth=0`, TypeScript typecheck, **354/354** Node tests in 63 files, four focused development Electron flows, and local documentation links passed.
- One `npm run dist:win` exited successfully: pinned LaTeX/template smoke; Electron-native SQLite ABI 140 build/query; NSIS x64 packaging; packaged SQLite and LaTeX smoke.
- New `release/CV-Tailor-Setup-0.1.0.exe`: **257,012,604 bytes**; SHA-256 **`87eda85f18f16a6a62658e8ed2de805232b90071a4f0993db44e7442ae2bec27`**. The new `latest.yml` lists the matching SHA-512 and size. The binary is **unsigned**.
- With an isolated fictional profile and scripted offline generation, the new **unpacked packaged app** reported version 0.1.0 and the expected isolated `userData`, displayed the title under the name in Review, and compiled a one-page selectable PDF whose extracted text included it. No real provider was contacted. This is **not installed-app validation**.

The original [0.1.0 build candidate](release-0.1.0-candidate.md) and [first installed observations](release-0.1.0-installed.md) are historical evidence for the earlier bytes. This record describes only the newly built replacement before its download and installation. Real Pi/provider quality, public redistribution notice completeness and a new genuinely installed-app check remain separate gates.
