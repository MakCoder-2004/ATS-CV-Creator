# Issue 102 physical package feasibility

**Verdict: static package feasibility only.** A credential-free, temporary npm install resolved the exact public package `pi-web-access@0.44.0` with its runtime dependencies in a physical `node_modules` tree. This does not pass issue #102 or authorize application integration. Source-rights issue #103 still blocks production job-link integration.

## Reproduce the static check

Run this command from the repository root on Windows with Node.js and npm available:

```powershell
$env:ISSUE_102_TEMP_ROOT = 'C:\Temp'
node scripts/issue-102-package-feasibility.mjs
```

The script creates a unique `cv102-*` directory under `C:\Temp` and removes only that directory. It fails if the path contains spaces or exceeds 24 characters. It writes empty user and global npm config files and uses a cache inside the owned temporary directory. It removes inherited npm configuration and token environment variables, fixes the registry to `https://registry.npmjs.org/`, and installs with `--ignore-scripts --omit=dev --no-audit --no-fund`.

The check verifies the exact package version, the `dist` directory, `dist/mcp-cli.js`, the Node engine and MCP SDK dependency, the registry tarball and its lockfile integrity, `npm ls --omit=dev --all`, and physical dependency directories without symlinks. It scans each runtime dependency manifest and package root for declared licenses, `LICENSE` files, and `NOTICE` files. Its JSON output includes no credentials or package file contents. The sample of missing notices is capped at 40 entries.

## Observed package evidence

The successful run used Node.js `v24.21.0`. It resolved `pi-web-access@0.44.0` from `https://registry.npmjs.org/pi-web-access/-/pi-web-access-0.44.0.tgz` with integrity `sha512-8YK2Nb0P7ezRL0FS7P1cPYu7gDUOuhXWA3FOBev0bKsuPtG2QrDVm2GriKBgZI1Sq7SC8QRsfVFYYP8huUEo8w==`. The package declares Node `>=22.19.0` and runtime dependency `@modelcontextprotocol/sdk@1.32.1`. Its tarball contains `dist/mcp-cli.js`.

`npm ls --omit=dev --all` passed. The temporary install had 212 runtime dependency package entries, all under the owned physical stage, with no symlinked dependency directories. The app's declared Electron version is `39.8.10`. Electron 39 ships Node `22.22.1`, which meets the package's declared engine. The script reads the app's Electron package declaration, but does not launch Electron or assert its embedded Node runtime.

All 212 dependency manifests declared a license. One package root lacked a `LICENSE` file. No dependency root had a separate `NOTICE` file. The package scan does not decide whether a separate notice is legally required for each license. Transitive license and notice obligations remain unresolved. The script does not query vulnerability advisories; `npm audit` is disabled, so security review remains open.

## Current app packaging does not include this package

The app's `package.json` does not declare `pi-web-access`. Its Electron Builder `files` list includes only `out/**/*` and `package.json`. `asarUnpack` includes native `.node` files only. The eight `extraResources` entries do not include Pi Web Access. This static inspection says the current app package does not include the pinned package. It does not inspect or claim a generated app archive or installer layout.

The package was not added to app dependencies. The MCP server was not started. No job URL, provider query, credential, installed app, or packaged executable was used.

## Gates that remain open

- This result does not verify process ownership, cleanup after failed MCP connection, bounded protocol output, or OS-level egress controls. SDK transport limitations and the earlier rejected synthetic lifecycle experiment remain relevant. A JavaScript `fetch` stub is not network isolation.
- This result does not establish a complete redistribution license review or security posture.
- This result does not establish a packaged layout or installed Windows behavior. Do not infer either from the temporary npm stage.
- Source-rights issue #103 remains unresolved. Do not connect a production job URL or integrate production job-link access until that gate clears.

See the [earlier issue #102 MCP lifecycle findings](issue-102-mcp-lifecycle.md), the [keyless Exa probe limits](issue-102-exa-provider-probe-2026-10-26.md), and the [issue #95 Pi Web Access prototype](issue-95-pi-web-access-prototype.md) for prior negative evidence.
