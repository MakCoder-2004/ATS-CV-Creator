# Issue 102 offline MCP lifecycle proof

**Verdict: the isolated stdio lifecycle harness passes its synthetic cases. This is not production integration or a live-provider retest.** It demonstrates an app-owned one-operation boundary around pinned Pi Web Access `0.44.0`, plus child termination and temporary-root cleanup. No package, installed executable, application source, job data, or real network request was used.

## Reproduction and bounds

Run from the repository with Node.js `>=22.19` and the locally installed package at `C:/Users/Makrious/.pi/agent/npm/node_modules/pi-web-access`:

```sh
node --check scripts/issue-102-mcp-lifecycle.mjs
node scripts/issue-102-mcp-lifecycle.mjs
```

The harness runs the package's actual stdio MCP child. A child `--import` stub replaces `globalThis.fetch`, accepts only `GET https://www.rfc-editor.org/rfc/rfc2606.txt` and `POST https://mcp.exa.ai/mcp?tools=web_search_exa`, returns synthetic fixtures, and throws for every other fetch URL or method. The Exa response is synthetic JSON-RPC, not an Exa request. The response stub does not redirect. This proves only requests routed through that fetch seam, not every possible socket or transport a future package could use.

The operation shape is one `search` with exact query and `provider: "exa"`, or one `fetch` with the exact RFC fixture URL. Extra keys, provider `auto`/`all`/arrays, query/url batches, `includeContent`, proxy options, and other URLs reject before child creation. The input cap is 512 bytes, the result cap is 16,384 bytes, the stderr cap is 8,192 bytes, and one shared 10-second deadline covers startup, tool listing, and a call. Child environment explicitly supplies isolated `APPDATA`, `LOCALAPPDATA`, `HOMEDRIVE`, `HOMEPATH`, `USERNAME`, `HOME`, `USERPROFILE`, `PI_CODING_AGENT_DIR`, and `PI_WEB_ACCESS_CACHE_ROOT` values.

## Observed cases

All seven cases passed in the focused run. Every case's full cache directory tree was inspected before cleanup and was empty. The synthetic fetched and search text therefore appeared only in MCP results and process memory in these observations. Successful and failed operations closed their children and removed their temporary roots. The forced-death case observed SIGKILL and a dead PID, then removed a stale root by its owner PID on next reconciliation. A deliberately injected cleanup deletion failure remained visible, blocked the next run, and was removed only by owned cleanup retry. The final run root was empty, with no fixture text left behind.

| Case | Observed result |
| --- | --- |
| Fetch success | Exact fixture GET observed; synthetic RFC text returned; child exited normally. |
| Search success | Exact Exa JSON-RPC URL observed; synthetic search result returned; child exited normally. |
| Provider error | Synthetic provider error was returned as an MCP error; child exited normally. |
| Cancel after request receipt | Stub receipt preceded forced child termination; exit and dead PID observed; no late result delivered. |
| Normal close | Child exit and dead PID observed. |
| Forced death and next-run reconciliation | SIGKILL and dead PID observed; stale owned root removed on reconciliation. |
| Cleanup deletion failure | Failure surfaced; next operation failed closed; owned retry removed the root. |

The harness also rejected invalid operation shapes before spawning any child. It inspected the full cache tree, not only JSON files. The observed cache trees were empty before owner cleanup, and all owned per-run roots were absent afterward.

## What remains unproved

- The proof is a standalone wrapper demonstration. No application code currently owns or invokes this wrapper, and no UI, IPC, model orchestration, credentials, or installed-app behavior was exercised.
- The stub covers the Node global `fetch` path only. It does not establish an OS-level network allowlist or rule out another transport path. The synthetic redirect case is not exercised; the stub returns no redirects and rejects any destination other than the two exact targets.
- The exact RFC fixture URL and query are deliberately fixed test inputs, not a general source-selection policy. One prior Exa dummy query is separate evidence; this run makes no live-provider, provider reliability, billing, authorization, or source-rights claim.
- Empty cache-tree observations apply only to this synthetic run and package configuration. They do not guarantee persistence behavior across other package options or future versions.
- Physical Windows packaging, transitive license/security review, production credential handling, and source-use/retention rights remain open gates. Do not enable a provider or package the MCP child based on this proof alone.

This report adds lifecycle evidence to the earlier [keyless Exa probe](issue-102-exa-provider-probe-2026-10-26.md). It does not change that report's integration or release verdict.
