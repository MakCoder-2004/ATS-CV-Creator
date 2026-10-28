# 0.1.0 private prerelease candidate — Windows

This candidate is built from the integrated `main` app (Review inline evidence, wider details panel, and Saved jobs title/company first-line alignment). The user requested a version reset from 0.6.2 to **0.1.0**, deletion of every previous local release artifact including old synthetic test data, and publication as the first **private GitHub prerelease**. This lower version is not promised as an automatic update or an in-place upgrade from 0.6.2.

## Build evidence

- `npm test`: **344/344** tests passed in 63 files after rebuilding SQLite for Node.
- `npm run typecheck`, `npm ls --depth=0`, and `node scripts/check-doc-links.cjs`: passed.
- `npm run dist:win`: exited successfully; verified the pinned LaTeX tree and template smoke, rebuilt/queried SQLite under Electron ABI 140, built the NSIS x64 installer, then verified packaged SQLite and packaged LaTeX with a template smoke.
- `release/CV-Tailor-Setup-0.1.0.exe`: **257,006,177 bytes**, SHA-256 **`ef8d655d87764c4ea34abfd77ac5a97a4e10e0dd582029bd4c8bf4cb7531fb28`**. `release/latest.yml` lists version `0.1.0`, the matching size, and matching SHA-512. The installer is **unsigned** (`Get-AuthenticodeSignature: NotSigned`).
- A separate **unpacked**, isolated-user-data launch reported app version `0.1.0`, showed the title and company on one desktop row, saved a synthetic job through the public preload, and reopened that job from native SQLite after closing and relaunching. This is **not** an installed-app check.
- The integrated UI had previously passed three focused development Electron tests for Review, Saved jobs layout at desktop/375px, and selected paragraph/source editing; main passed two of those after integration. Those development tests do not establish packaged or installed review behavior.

## Remaining gates

No NSIS installation, real Pi provider run, installed PDF/DOCX export, installed SQLite reopen, or user approval of an installed 0.1.0 build occurred in this task. The existing private repository has no earlier GitHub Release. The bundled third-party notice inventory is incomplete for public redistribution; this artifact is intended only as a **private prerelease**, not a signed or publicly cleared stable release. Do not claim installer acceptance from the unpacked smoke. Installing this lower-version NSIS over an existing 0.6.2 installation is unverified; preserve existing workspace data and exported files before attempting it.
