# Issue 95 Pi Web Access prototype

**Verdict:** NOT VERIFIED for production integration. The pinned prototype demonstrated direct fetch and explicit search through both adapters, but required cache lifecycle deletion, Pi-auth behavior, packaging, and real installed-app gates remain incomplete. This is disposable research evidence, not a shipped app capability or source-rights approval.

## Proof record shape

The harness records one `ProofCase` per route and lifecycle: `{ route, operation, inputUrlOrQuery, provider, allowedDestinationOrigins, observedDestinationOrigins, outcome, outputCharacters, cacheFilesBeforeCleanup, cleanup, restartObservation }`. It contains synthetic public examples and query text only. It must not contain user profile, CV, credential, session, or real job data.

## Setup and exact command

Pinned package: Pi Web Access `0.44.0`, from `C:/Users/Makrious/.pi/agent/npm/node_modules/pi-web-access`. Pi `1.4.0` peer modules came from `C:/Users/Makrious/.pi/agent/install/releases/1.4.0/node_modules`. Node `v24.21.0` satisfies the package's `>=22.19.0` requirement.

The focused proof command was:

```sh
PI_WEB_ACCESS_PACKAGE='C:/Users/Makrious/.pi/agent/npm/node_modules/pi-web-access' \
PI_WEB_ACCESS_RUNTIME_NODE_MODULES='C:/Users/Makrious/.pi/agent/install/releases/1.4.0/node_modules' \
node scripts/issue-95-pi-web-proof.mjs
```

The harness copies the pinned package distribution to a temp adapter and links only installed runtime modules needed to load it. Before child start, it creates separate temporary `HOME`, `USERPROFILE`, `PI_CODING_AGENT_DIR`, and `PI_WEB_ACCESS_CACHE_ROOT` values and a restrictive `web-search.json`. It inherits only process-launch environment fields, not provider keys, proxy settings, Pi settings, sessions, extensions, or browser auth. It allows only explicit `duckduckgo` search, restricts fetch to the test hostname, disables remote extraction fallbacks and browser cookies, bounds inline output to 1,000 content characters, and observes global `fetch` destinations.

## Observations

- Both the manually hosted extension tool and stdio MCP returned `fetch_content` for `https://www.rfc-editor.org/rfc/rfc2606.txt`. The visible response contained 1,144 characters, including truncation/continuation framing. The request went only to `https://www.rfc-editor.org`; full fetched content remained in extension cache storage, not just the visible bounded slice.
- Both routes returned explicit `web_search` results using provider `duckduckgo` against a locally stubbed response. The stub produced a synthetic `example.com` result and made no outbound request. No Tavily or other provider was dispatched in this final proof.
- Cancellation against a delayed local DuckDuckGo stub surfaced `AbortError` for both routes. The extension adapter threw the abort to its caller; MCP returned a cancelled request error.
- After the extension fetch completed, one JSON cache file existed in the isolated `web-search-cache`. The successful MCP fetch produced no disk cache file in its isolated root. The harness deleted each temporary case root after closing the route and verified the path was absent. This proves parent-owned temp-root cleanup for the observed successful fetch, not package-native cleanup on all lifecycle paths.
- Error, process-close/restart recovery, cleanup failure, and deletion-cancellation paths were not separately proven. The package documents a one-hour cache TTL; extension session shutdown releases in-memory references but leaves disk cache entries for resumable sessions. Therefore the cache acceptance gate is **NOT VERIFIED**. An app-owned MCP child with an isolated cache root is the narrower candidate, but must be explicitly stopped and its per-run directory reliably removed, including after abnormal termination and restart, before acceptance.
- One earlier attempted live keyless DuckDuckGo call, before replacing it with the local stub, went to `https://html.duckduckgo.com/html/` with the synthetic query `site:example.com RFC 2606 example domain`. DuckDuckGo returned HTTP 202 bot-check/rate-limit response. No fallback provider was called. That endpoint was not contacted in the final stubbed proof.
- Pi model login is not MCP web-search authorization. The package MCP implementation rejects OpenAI/Codex sign-in use and requires a standalone API key for OpenAI search; it likewise excludes Kimi's Pi-only login. The extension can resolve eligible Pi credentials inside a real Pi host. This proof loaded the extension with a mock host and no credentials, so neither authenticated Pi extension behavior nor credentials available in the installed CV Tailor app were established. No real credentials were inspected.

## Package and Windows assessment

The package declares MIT and requires Node `>=22.19.0`; the tested host had Node `24.21.0`. It declares MCP SDK `1.32.1`, Readability, Defuddle, LinkeDOM, p-limit, promise.try, Turndown, Undici, and unpdf runtime dependencies. Pi extension peers are optional in package metadata but the extension needs Pi runtime APIs. This is not a complete transitive-license or security audit. Windows support is claimed upstream, but this harness used Node on Windows rather than the packaged Electron runtime. The app-owned MCP child model has fewer Pi coupling assumptions; its runtime inclusion, dependency layout, shutdown ownership, signing/packaging impact, and license notices remain **NOT VERIFIED**. No package was installed and no new packaged app was launched.

## Remaining #95 acceptance gates

1. Prove temporary cache cleanup on success, fetch error, cancellation, clean close, abnormal close, and restart; prove cleanup errors fail closed and cannot leave unaccepted text behind. Current source explicitly retains extension cache files across session shutdown; do not accept extension integration on this evidence.
2. Verify installed-app MCP credentials independently from Pi model login. Do not infer model authorization transfers to the MCP child.
3. Complete transitive dependency/license and Windows packaging review, then test the actual installed app only under the project's accepted fresh Windows environment and user approval.
4. Verify permitted source terms and downstream use/retention separately. Public reachability and successful fetch do not grant rights. LinkedIn remains unsupported without an approved route.
5. Keep exact-role review/save, provenance, durable-storage exclusion, and manual paste fallback for later issue work; this prototype does not address them.

## Artifacts

- [`scripts/issue-95-pi-web-proof.mjs`](../../scripts/issue-95-pi-web-proof.mjs) is the bounded, isolated rerunnable harness. It creates and removes only its own temp roots.
- No production `src/` file or app UI changed.
