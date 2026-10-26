# Issue 102 keyless Exa provider probe

**Verdict: the prior probe reported one matching public result. It did not establish provider reliability or approve integration.** The result was described as RFC 2606 text from the RFC Editor at `https://www.rfc-editor.org/rfc/rfc2606.html` and `.txt`. The raw provider response was not retained in this report. This correction made no provider request. The MCP lifecycle, runtime packaging, source rights, and installed-app gates remain open.

## Prior probe

The prior probe used locally installed Pi Web Access `0.44.0` with `provider: "exa"` and `allowedProviders: ["exa"]`. It exposed only `web_search` and submitted one additional query: `site:rfc-editor.org/rfc/rfc2606 RFC 2606 Reserved Top Level DNS Names`, with `provider: "exa"` and `numResults: 2`. The script accepts only fixed public query names. It did not use `auto`, `all`, batches, `includeContent`, cookies, user Pi configuration, profile or CV data, a real job posting, an API key, or another configured provider. No retry was made.

The report from that run said the MCP result labeled itself `Provider: exa` and returned RFC 2606 text matching the requested document. The second Exa RFC result is reported evidence from that one query, not retained raw response or a repeatable artifact. It does not establish search reliability for role-specific queries or prove that a server never uses another provider.

The current probe sets the client and child `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `HOMEDRIVE`, `HOMEPATH`, `USERNAME`, `PI_CODING_AGENT_DIR`, and `PI_WEB_ACCESS_CACHE_ROOT` to its temporary root or a fixed synthetic identity. The MCP SDK adds default Windows environment variables before applying explicit child overrides. The current script explicitly overrides the five Windows identity and configuration variables checked by the offline canary, so the child receives no inherited personal values for those keys. It does not inspect the user's real configuration or read the actual values of those environment variables.

`scripts/issue-102-stdio-env-canary.mjs` is an offline harness. It puts synthetic values in its own process environment, observes that an SDK child inherits them by default, then observes that explicit values replace them. It prints only pass/fail facts and removes its temporary directory. The harness does not make a provider request or inspect actual user environment values.

## Bounds and lifecycle

The SDK call to `client.callTool()` has a 30-second timeout. Connection setup, `listTools()`, and total probe duration have no whole-operation deadline. The script joins and slices result text when it prints JSON, but this does not bound the response held in memory. It accumulates stderr without a byte limit, then slices it only when printing. These gates remain open.

The SDK transport closes stdin, waits up to two seconds, sends SIGTERM, waits up to two more seconds, and then sends SIGKILL if needed. The script removes its created temporary root and asserts that the root is gone. The prior live run reported an empty cache and successful root deletion. These observations do not prove cleanup under injected setup failure, cancellation, deletion failure, restart, or every socket and descendant-process condition. The probe did not request fetched content. Pi Web Access stores MCP search results in server-process memory; its configured disk cache is for fetched content.

## Provider endpoint and selection evidence

The installed package source `exa.ts` pins the anonymous MCP endpoint to `https://mcp.exa.ai/mcp`, calls the basic tool `web_search_exa`, and sends a JSON-RPC `tools/call` request. The derived request target is `https://mcp.exa.ai/mcp?tools=web_search_exa`. The endpoint string comes from inspected installed source. The prior probe used stdio to run the local MCP server. No socket or TLS destination was captured.

The current script reports `configuredProvider: "exa"` from its explicit config and request, and reports a provider label only if the returned text contains one. It makes no claim that an alternate provider was or was not used at the network layer. The MCP SDK's [`StdioClientTransport` source](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/client/stdio.ts) merges its default environment with the explicit `env` object, with explicit values taking precedence. The same behavior is exercised offline by the canary.

## Cost, privacy, and package disclosures

Exa's official [MCP page](https://exa.ai/mcp) says that the MCP server is free to use and requires no API key. This supports a keyless path, but does not specify anonymous MCP rate limits or guarantee future availability. Exa's official [pricing page](https://exa.ai/pricing?tab=api) describes paid API rates and says Zero Data Retention is an Enterprise offering. It does not promise zero retention for free MCP use. API pricing must not be assumed to describe MCP billing. The prior probe confirms only Exa's published free-use claim for MCP, not an independent billing guarantee.

The locally installed package metadata identifies Pi Web Access `0.44.0` as MIT licensed. This checks the package's declared license only, not transitive dependency licenses, vulnerability posture, or Windows application packaging.

## Next gates

Keep Exa as a candidate for later evaluation, not an authorization to integrate. Before app wiring, prove reliable exact-source search for the intended role-search workflow, app-owned request and result bounds, endpoint and redirect handling, and provider behavior beyond the explicit config. Complete cleanup tests for success, error, cancellation, close, forced death, restart, and deletion failure. Inspect all transitive licenses and security advisories, then verify physical Windows packaging. Source rights remain a separate blocker. Do not launch a packaged application without user approval.

## Reproduction

Run the offline SDK canary with Node.js `>=22.19` and the installed Pi Web Access package available:

```sh
PI_WEB_ACCESS_PACKAGE='C:/Users/Makrious/.pi/agent/npm/node_modules/pi-web-access' node scripts/issue-102-stdio-env-canary.mjs
```

The canary spawns local Node.js child processes and sends no network requests. To repeat the provider probe, run one fixed query name:

```sh
PI_WEB_ACCESS_PACKAGE='C:/Users/Makrious/.pi/agent/npm/node_modules/pi-web-access' node scripts/issue-102-exa-probe.mjs rfc2606
```

The provider probe makes a live external request whenever it runs. It accepts `rfc2606` or `exampleCom`, submits one query, prints at most 5,000 result characters, and removes its temporary data. The print limit does not limit the response held in memory. Do not retry automatically after a provider error.
