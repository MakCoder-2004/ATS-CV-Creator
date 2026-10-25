# Version 0.6.0 universal job research integration

This report records reviewed code and development verification. The installed Windows app and real Pi output have **not** been validated for this version.

## Behavior delivered

- A selected LinkedIn search-results URL with `currentJobId` resolves to the exact canonical detail URL without sending its keywords, referral or tracking parameters. Public LinkedIn, Indeed and other supported HTTPS job pages use bounded direct reads. No universal access or right to reuse the page is claimed.
- A complete or partial new third-party capture remains **temporary**. The trusted import and refresh APIs refuse to save it to jobs, drafts or backups, even after research handoff. Existing manual postings, saved jobs and released Lever histories still work. The one-use temporary capture expires from main and renderer at the original 15-minute source deadline.
- A separate, explicit basic Tavily search can supply exact selected-role indexed details when direct public access is incomplete. The result is provisional, cites its source and must be reviewed; removed jobs, unsafe redirects and conflicting titles, employers or job IDs fail closed. General company background cannot establish role requirements.
- Research review does not authorize a model call. The person inspects exact role-only outgoing text, Pi provider/model/thinking level and the separate structured-output instruction notice, then authorizes and starts one temporary analysis. Results point back to accepted sources and require human review. They cannot generate or export a CV from rights-pending research.
- Tavily Settings use Windows `safeStorage` and a key file outside the SQLite workspace and workspace backups. The separate project-only Tavily MCP launcher reads the ignored `.env` key only in its child process; no secret is committed. The user confirmed that Tavily Pay-As-You-Go is disabled for the free Researcher account.

## Review and focused checks

Independent `openai-codex/gpt-6-sol` reviews found and gated conflicting source identities, unsafe indexed fallbacks, post-handoff Save bypass, late revoked suggestions and overlong temporary retention. Final integrated HEAD `7e369992c1b5ad52774ef48e3cff3cff946684aa` passed review. The later one-component UI change `e253491f6f317b941feab9f9dcbeb2a7e282a6a9` passed its own narrow review. Main code is at `a5980a51d5f9dbc0cebe787a6ecc0552a1eed5fc` after the version-only change.

| Check | Observed result |
| --- | --- |
| Final isolated research branch | Related Electron-ABI unit groups passed 118 and 94 tests. The corrected identity and expiry units, two public synthetic development Electron full/partial flows, and delayed original-deadline case passed. See [Stage D](universal-research-stage-d.md) and its earlier unit reports. No full historical suite was rerun for this follow-up. |
| Final `main` checkout | `npm run typecheck`, `npm run build`, `node scripts/check-doc-links.cjs` and native `npm run verify:electron-sqlite` passed. The first focused Playwright run passed full and partial research but timed out waiting for the window in the delayed-expiry case. That case alone passed on one bounded retry in 8.2 seconds. The observed first-window timeout happened before the feature action; it is not counted as a feature pass until the successful isolated retry. |
| Account metadata | A bounded `/usage` request through the ignored `.env` key returned HTTP 200, Researcher, one thousand monthly credits and zero pay-as-you-go usage at the check time. The user confirmed Pay-As-You-Go was disabled. One approved basic Tavily adapter search used one free credit and returned one source URL with the exact selected LinkedIn ID; no snippet was stored. These account observations are not a guarantee of future free credits, another user's billing status or general posting availability. |
| Visual review | The light desktop outgoing-data, dark desktop source-linked result and 375px dark full-page captures were inspected before the isolated task worktree was removed. Those temporary image files were not retained as release artifacts. No page-level horizontal overflow was observed at 375px. Keyboard focus traversal was not fully audited. |

The focused Electron specs use visible controls and the public preload seam with synthetic data, separate temporary `appData` and `userData`, and a scripted Pi runtime. The installed 0.5 app currently open for the user was not stopped or replaced. No real CV profile was sent to Tavily or to a Pi model during these checks.

## Installer artifact

The 0.6.0 Windows NSIS installer was built from source commit `a5980a51d5f9dbc0cebe787a6ecc0552a1eed5fc` into a **separate output directory** so the user's running 0.5 executable was not overwritten.

```text
E:\cv-tailor-main\release-0.6\CV-Tailor-Setup-0.6.0.exe
257,050,629 bytes
SHA-256 3dc230cd5ba69400a8012c4a5f36147f9d93e430d61e985aafdfb6282d8a011e
```

The packaging command timed out after 420 seconds; no successful final process exit was observed. The completed artifact and updater manifest independently matched in size and SHA-512. Its PE header and version-2 blockmap are valid. The packaged app declares `0.6.0`; all 23 built output files match its ASAR bytes. The unpacked native SQLite binary matches the Electron-ABI source binding, and the pinned LaTeX, template and license files are present. Windows reports the installer **unsigned**. The local build receipt at `.audit/linkedin-followup/package-0.6.json` contains the static checks, but `.audit` is ignored and is not part of the shared Git report. Static checks are not installed acceptance. The installer or packaged app was **not launched or installed** and requires fresh user approval.

## Open acceptance

[Installed validation #89](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/89) remains open. It requires the user's approved fresh Windows installation, native SQLite persistence and reopen, encrypted-key behavior, exact source review and run-specific consent, actual Pi output assessment, provider/network failure behavior and accessible light/dark/narrow interactions. A passing development build or a static installer inspection cannot satisfy those checks. Persistent rights for third-party fetched text and indexed snippets have not been established; the user chose temporary review and analysis, not storage. Existing saved drafts and exported files remain separate from this feature.
