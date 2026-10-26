# Issue 102 keyless Exa provider probe

**Verdict: provider feasibility candidate only.** One explicit keyless Exa query returned a result, but it did not return the RFC 2606 material sought. The query surfaced `http://www.example.com/cdn-cgi/trace` with ExaSearchBot request metadata instead. Do not treat this as evidence of useful result quality or approve application integration. The MCP lifecycle, runtime packaging, source rights, and installed-app gates remain open.

## Isolated probe

The probe used the locally installed Pi Web Access `0.44.0` stdio MCP server and a temporary configuration with `provider: "exa"` and `allowedProviders: ["exa"]`. It exposed only `web_search`, with the remaining tools disabled, and submitted exactly one request: `site:example.com RFC 2606 example domain`, with `provider: "exa"` and `numResults: 2`. It did not use `auto`, `all`, batches, `includeContent`, cookies, user Pi configuration, profile/CV data, a real posting, an API key, or another provider. No retry was made.

The observed MCP result labeled itself `Provider: exa` and returned one source titled `Trace`, at `http://www.example.com/cdn-cgi/trace`. Its text exposed ExaSearchBot request metadata rather than RFC 2606. Thus the live query completed, but the requested source quality was not demonstrated.

The client and server ran with isolated `HOME`, `USERPROFILE`, `PI_CODING_AGENT_DIR`, and `PI_WEB_ACCESS_CACHE_ROOT`; the child received only a small allowlist of system environment variables. The separate cache directory was empty before cleanup, and the harness removed its temporary root after closing the MCP client and child. This is one normal-success observation, not proof of cleanup under failure, cancellation, forced termination, restart, or deletion failure. Pi Web Access documents MCP search-result storage as in-memory for the server process; the configured disk cache is for fetched content. No fetched content was requested.

## Provider endpoint and transport evidence

The installed package source `exa.ts` pins the anonymous MCP endpoint to `https://mcp.exa.ai/mcp`, calls the basic tool `web_search_exa`, and sends a JSON-RPC `tools/call` request. The derived request target is `https://mcp.exa.ai/mcp?tools=web_search_exa`. The Pi Web Access MCP server ran locally over stdio. This harness did not independently capture sockets or TLS destinations; the external endpoint is confirmed from inspected installed source, not from a global network trace. No claim is made that all outbound transports were observed.

A first local harness invocation submitted no provider request because the MCP schema rejected an unsupported `workflow` property. The next invocation removed that parameter and made the one live Exa query above. That validation error did not trigger a retry or external request.

## Cost, privacy, and package disclosures

Exa's official [MCP page](https://exa.ai/mcp) states that the MCP server is free to use and requires no API key. This supports a keyless path, but does not specify anonymous MCP rate limits or guarantee future availability. Exa's official [pricing page](https://exa.ai/pricing?tab=api) describes paid API rates and says Zero Data Retention is an Enterprise offering. It does not promise zero retention for free MCP use. API pricing must not be assumed to describe the MCP path's billing; this probe confirms only the official free-use claim for MCP, not an independent billing guarantee.

The locally installed package metadata identifies Pi Web Access `0.44.0` as MIT licensed. This checks the package's declared license only, not its transitive dependency licenses, vulnerability posture, or Windows application packaging.

## Next gates

Keep this as an explicit candidate for later evaluation, not an authorization to integrate. Before any app wiring, prove a consistently usable exact-source search, app-owned request/result bounds, endpoint and redirect handling, and no uncontrolled provider fallback. Complete cleanup tests for success, error, cancellation, close, forced death, restart, and deletion failure. Inspect all transitive licenses and security advisories; verify physical Windows packaging. Source rights remain a separate blocker. Do not launch a packaged application without user approval.

## Reproduction

Run from the repository with Node.js `>=22.19` and the local package path available:

```sh
PI_WEB_ACCESS_PACKAGE='C:/Users/Makrious/.pi/agent/npm/node_modules/pi-web-access' node scripts/issue-102-exa-probe.mjs
```

The script pins Exa in isolated provider configuration, submits one query, prints the bounded tool result and cache observations, then removes its temporary data. It is a live external request whenever rerun; do not retry automatically after a provider error.
