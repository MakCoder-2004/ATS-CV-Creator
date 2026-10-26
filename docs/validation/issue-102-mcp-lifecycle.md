# Issue 102 synthetic MCP lifecycle experiment

**Verdict: NOT VERIFIED. Do not use this script as an application adapter.** A pinned Pi Web Access `0.44.0` stdio child returned synthetic fetch and search results. The harness printed passing case labels, but independent review found that its failure and cleanup assertions do not establish a safe process lifecycle. No application source, real job posting, or packaged executable was used. The harness intended to use only synthetic provider responses, but it did not instrument every egress path; absence of real network requests is not established.

## What was observed

`scripts/issue-102-mcp-lifecycle.mjs` starts the installed package's MCP child with temporary Pi config and cache roots. Its child-only global `fetch` stub accepts a fixed RFC 2606 URL and a fixed Exa JSON-RPC URL. The script rejects a sample of invalid input shapes before launch. The focused synthetic run observed the stub receive those two requests, synthetic success and provider-error responses, an ordinary child exit, a forced child exit for one PID, and removal of the owned roots on healthy paths. The cache helper reported no files in the successful cases it could read; because that helper masks directory-read errors, this is not proof that no file persisted. These observations do not establish all outbound destinations or other transports.

The script uses only fixed public test inputs. It sets temporary `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `HOMEDRIVE`, `HOMEPATH`, `USERNAME`, `PI_CODING_AGENT_DIR`, and `PI_WEB_ACCESS_CACHE_ROOT` values. The MCP SDK still adds other inherited Windows defaults, and the script does not set an isolated child working directory or all temp paths. The package's standalone MCP core stores fetched results in process memory on the inspected path; the Pi extension has a separate one-hour disk cache. Neither fact proves an app-owned deletion lifecycle.

## Why the lifecycle gate failed review

- `createClient()` can spawn a child and then reject during connection or tool listing without returning a handle to its caller. Later assertion failures can also skip child cleanup. A `Promise.race` timeout does not stop the underlying request or process.
- The cache-tree helper treats any directory-read error as an empty tree. It cannot distinguish permission failures from absence. An empty read from this helper is not an absence assertion.
- The cleanup-failure test sets a blocked flag before injecting a throw. It does not prove that an actual failed deletion makes the next operation fail closed. The stale-root test writes its ownership marker after killing the child, and reconciliation deletes on any ownership-read or PID-check error, including errors other than a confirmed dead owner.
- The SDK's line buffer limit and the script's post-response `JSON.stringify()` check do not cap a complete JSON-RPC response before parsing. Stderr and total operation time are not bounded across shutdown. The cancellation check observes only 250 ms after child exit and cannot rule out a later settlement.
- Only one child PID is inspected. The global `fetch` stub does not intercept other socket, subprocess, proxy, or redirect paths. The synthetic provider response had no redirect. An app-owned egress policy and a physical Windows dependency layout were not tested.

These are review findings about this test, not evidence of a live app data leak. The full independent review is recorded in the issue #102 work trail. Do not infer that the seven printed case labels pass the privacy or release gates.

## Reproduction and next gate

```sh
node --check scripts/issue-102-mcp-lifecycle.mjs
node scripts/issue-102-mcp-lifecycle.mjs
```

The second command uses synthetic global-`fetch` responses and is intended to avoid network access, but other egress paths are unverified. It remains an exploratory test and can return a successful exit without proving cleanup on failed acquisition, true deletion failure, response overflow, or a redirect. Do not use its exit code as acceptance.

The maintainer paused further web integration work until source-rights issue #103 is resolved. Issue #102 stays open and blocks #97 through #99. Before restarting MCP engineering, use a dedicated app-owned private root, authenticate ownership before launch, abort and reap children on every failure, fail closed on ambiguous cleanup, bound ingress before JSON parsing, and verify physical Windows dependencies, license/security inventory, endpoint redirects, and installed-app behavior under separate approval. Preserve manual paste and the paused-source policy while these gates remain open.
