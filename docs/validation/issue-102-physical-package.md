# Issue 102 physical package feasibility

**Verdict: static package feasibility only.** One isolated npm install resolved `pi-web-access@0.44.0` and its dependencies into a physical temporary tree. This result does not pass issue #102 or authorize application integration. Source-rights issue #103 still blocks production job-link integration.

## Reproduce the static check

Run this command from the repository root on Windows with Node.js and npm installed:

```powershell
$env:ISSUE_102_TEMP_ROOT = 'C:\Temp'
node scripts/issue-102-package-feasibility.mjs
```

The script invokes `process.execPath` and the `npm-cli.js` located under that Node installation. It verifies the npm CLI's resolved path stays under the Node install root. It does not look up `npm` through `PATH` or use a shell. The child environment contains only selected Windows system variables, the owned temporary paths, an empty `PATH`, and explicit npm config paths. Empty user and global npm config files and an isolated cache live under the temporary root. The registry is fixed to `https://registry.npmjs.org/`.

A synthetic credential and `PATH` canary checks that child Node processes receive neither canary. The check does not read or print real credential values. The script uses `--ignore-scripts --omit=dev --no-audit --no-fund`. It does not test OS-level network egress.

The script verifies the package version, `dist` directory, `dist/mcp-cli.js`, declared Node engine, declared MCP SDK version, lockfile registry URL, and exact root tarball integrity recorded in earlier evidence. That integrity string is not independent trust provenance. The script runs `npm ls --omit=dev --all`, rejects symlinks, and fails if an installed dependency directory lacks a manifest. It prints its result only after it removes the owned temporary root and confirms that the root no longer exists.

## Evidence from this run

The run used Node.js `v24.21.0` and resolved `pi-web-access@0.44.0` from `https://registry.npmjs.org/pi-web-access/-/pi-web-access-0.44.0.tgz`. The root package lock integrity matched the recorded value `sha512-8YK2Nb0P7ezRL0FS7P1cPYu7gDUOuhXWA3FOBev0bKsuPtG2QrDVm2GriKBgZI1Sq7SC8QRsfVFYYP8huUEo8w==`. The package declares Node `>=22.19.0` and `@modelcontextprotocol/sdk@1.32.1`. The tarball included `dist/mcp-cli.js`.

`npm ls --omit=dev --all` passed. This run found 212 physical installed package manifests, including peer dependencies. All package directories were under the owned temporary tree, with no symlinked directories. The app's Electron package declaration is `39.8.10`. The script did not assert the Node runtime inside packaged Electron.

All 212 manifests declared a license. One package root lacked a `LICENSE` file, and 208 lacked a root `NOTICE` file. A manifest license declaration or a missing root notice does not determine the applicable legal obligations. Redistribution review remains open. The run skipped npm audit, so vulnerability review also remains open.

The package lock from this temporary install was removed during cleanup. The repository does not track transitive versions for this package. This run does not provide archived dependency-tree proof.

## App packaging was not inspected as an artifact

The current root `package.json` does not list `pi-web-access` as a dependency. Its Electron Builder configuration lists `out/**/*` and `package.json`, unpacks native `.node` files, and names eight extra resources. The extra resources do not explicitly name Pi Web Access. Electron Builder may include production dependencies beyond those literal file patterns. No archive or installer was generated or inspected, so this report makes no claim about packaged contents.

The package was not added to app dependencies. The MCP server was not started. No job URL, provider query, credential, installed app, or packaged executable was used.

## Gates that remain open

- Source-rights issue #103 blocks production job-link access.
- This run did not verify process ownership, failed-connection cleanup, bounded protocol output, OS egress controls, or security advisories.
- The temporary dependency install does not complete license or redistribution review.
- This run did not build or inspect an application archive, launch an installed app, or test Windows installation behavior.

See the [earlier issue #102 MCP lifecycle findings](issue-102-mcp-lifecycle.md), the [keyless Exa probe limits](issue-102-exa-provider-probe-2026-10-26.md), and the [issue #95 Pi Web Access prototype](issue-95-pi-web-access-prototype.md) for prior negative evidence.
