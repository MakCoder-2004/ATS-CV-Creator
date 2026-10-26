# Issue 95 Pi Web Access prototype

**Verdict: STOP.** The isolated harness demonstrates that the pinned package exposes direct fetch and search tools over extension and stdio MCP routes. It does not satisfy issue #95 acceptance. Keep web search disabled and use manual paste as the fallback. No production `src/` files changed.

## Scope and command

The harness uses Pi Web Access `0.44.0` installed at `C:/Users/Makrious/.pi/agent/npm/node_modules/pi-web-access`, Pi `1.4.0` peer modules, and Node `v24.21.0`. It creates isolated configuration and cache roots, and never reads private Pi settings, credentials, sessions, cookies, CV/profile data, or job data. It exercises synthetic public RFC text and a locally stubbed DuckDuckGo response. There were no Tavily, paid-provider, live posting, LinkedIn, packaged-app, or installed-app requests.

```sh
PI_WEB_ACCESS_PACKAGE='C:/Users/Makrious/.pi/agent/npm/node_modules/pi-web-access' \
PI_WEB_ACCESS_RUNTIME_NODE_MODULES='C:/Users/Makrious/.pi/agent/install/releases/1.4.0/node_modules' \
node scripts/issue-95-pi-web-proof.mjs
```

## Observed proof

The latest focused run passed all six tool cases. Both routes fetched `GET https://www.rfc-editor.org/rfc/rfc2606.txt`, returned 1,144 visible characters, and traced the exact method and path. Extension fetch created one JSON cache file; MCP fetch created none. Both routes searched the local stub with `GET /html/?q=site%3Aexample.com+RFC+2606+example+domain` and returned 354 visible characters. No real search-provider usability was tested. Both cancellation cases reached the delayed stub before abort and returned an abort error. Each normal case's harness-owned temporary root was removed.

The harness also defines a small app-owned operation shape. Its `search` shape only accepts the `duckduckgo` provider and a bounded query, and its `fetch` shape only accepts HTTPS `www.rfc-editor.org` URLs. It rejects extra keys such as batches, `includeContent`, provider lists, proxy settings, implicit `auto`/`all`, and disallowed fetch hosts before the harness launches a child. This is a harness validation demonstration, not integrated application code or evidence that Pi Web Access MCP enforces the same boundary.

## Why this is a STOP

- **Cancellation is only a tool-call abort.** The synthetic delay is set in the environment before worker/server spawn, the request is observed at the stub, and the tool reports abort. The run does not establish server process death before shutdown, forced-death behavior, or cancellation cleanup/restart safety.
- **Cache deletion is incomplete evidence.** The successful extension fetch produced a disk cache file, while the MCP fetch did not. The harness deletes the enclosing temporary case root after each normal case. It does not prove cleanup after every error, cancellation, clean shutdown, forced death, or restart, and it does not simulate deletion failure or fail-closed behavior. The extension's persisted cache makes it an unsuitable candidate on this evidence. MCP's lack of an observed file is not proof of its full lifecycle contract.
- **The transport trace has limits.** The harness observes Node's global `fetch` only. Exact observed fetch and local stub requests are nonempty and asserted. Other transport mechanisms would not be visible, so this is not a complete outbound network boundary proof.
- **Real search remains unverified.** An earlier harmless keyless DuckDuckGo request returned HTTP 202 bot-check. This harness uses a stub, not a live result. No Exa attempt was made, so provider usefulness is not established. Do not enable the provider based on these cases.
- **Packaging and licensing remain open.** Runtime peer modules are linked into a temporary adapter for this Node proof. Junction-based loading is not a packaging test. No complete transitive license/security inventory or Windows packaged runtime validation was performed. The public npm query returned 404 for the scoped package name, so this report relies on the locally installed pinned package rather than a reproducible public registry install.
- **Authentication and source rights remain open.** No real credentials were inspected and Pi model login does not establish MCP search authorization. Public fetch success does not establish content rights or downstream retention permission.

## Acceptance decision and next gates

Issue #95 acceptance does not permit a **VERIFIED candidate**. Recommend negative feasibility closure only if the issue owner accepts these explicit unmet gates. Otherwise keep #95 open as NOT VERIFIED. A future reconsideration needs app-owned validation integrated before any tool launch; cache lifecycle coverage for success, error, cancellation, clean close, forced death, and restart; deletion-failure simulation that fails closed; complete file-tree inspection; process-stop assertions; a usable explicitly permitted free search provider or manual-paste-only scope; installed-app credential review; and transitive license/security plus actual packaging checks. No production integration should proceed first.

## Artifacts

- [`scripts/issue-95-pi-web-proof.mjs`](../../scripts/issue-95-pi-web-proof.mjs) is the rerunnable, disposable harness.
- This report records prototype observations, not shipped behavior or source-rights approval.
