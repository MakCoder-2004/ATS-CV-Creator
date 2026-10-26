# Issue 102 keyless Exa provider probe

**Verdict: one useful public search result was verified, but the provider and integration gates remain incomplete.** A single explicit keyless Exa query returned RFC 2606 text from the RFC Editor at `https://www.rfc-editor.org/rfc/rfc2606.html` and `.txt`. This corrects the earlier example.com result, which surfaced unrelated ExaSearchBot trace metadata. The result supports Exa as a nonpaid search candidate for harmless public queries. It does not approve application integration or prove reliability across queries. The MCP lifecycle, runtime packaging, source rights, and installed-app gates remain open.

## Isolated probe

The probe used the locally installed Pi Web Access `0.44.0` stdio MCP server and a temporary configuration with `provider: "exa"` and `allowedProviders: ["exa"]`. It exposed only `web_search`, with the remaining tools disabled, and submitted exactly one additional request: `site:rfc-editor.org/rfc/rfc2606 RFC 2606 Reserved Top Level DNS Names`, with `provider: "exa"` and `numResults: 2`. The only query values are hard-coded, selected by an explicit CLI flag. The script rejects arbitrary query text. It did not use `auto`, `all`, batches, `includeContent`, cookies, user Pi configuration, profile/CV data, a real posting, an API key, or another provider. No retry was made.

The MCP result labeled itself `Provider: exa` and returned RFC 2606 title text and matching passages from `https://www.rfc-editor.org/rfc/rfc2606.html` and `https://www.rfc-editor.org/rfc/rfc2606.txt`. The result matched the requested document. It establishes useful exact-source search for this one harmless public query, not general result quality or reliability.

The client and server ran with isolated `HOME`, `USERPROFILE`, `PI_CODING_AGENT_DIR`, and `PI_WEB_ACCESS_CACHE_ROOT`; the child received only a small allowlist of system environment variables. The script now places root creation, config setup, imports, and MCP operations inside one `try/finally`. The MCP call has a 30-second SDK request deadline. On exit, the SDK transport closes stdin and waits up to two seconds before SIGTERM, then two more seconds before SIGKILL. The script removes only its created temporary root and asserts that the root is gone. The one live run observed an empty cache and successful root deletion.

These controls bound the harness's request and transport cleanup paths. They do not prove cleanup under an injected setup failure, cancellation, deletion failure, restart, or every possible socket and descendant-process condition. No fetched content was requested. Pi Web Access stores MCP search results in server-process memory; its configured disk cache is for fetched content.

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
PI_WEB_ACCESS_PACKAGE='C:/Users/Makrious/.pi/agent/npm/node_modules/pi-web-access' node scripts/issue-102-exa-probe.mjs rfc2606
```

The script accepts either `rfc2606` or `exampleCom`; both choices map to fixed harmless public queries. The RFC Editor query was selected for this run. The script pins Exa in isolated provider configuration, submits one query, prints at most 5,000 result characters, then removes its temporary data. It makes a live external request whenever rerun. Do not retry automatically after a provider error.
