import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const queries = {
  rfc2606: "site:rfc-editor.org/rfc/rfc2606 RFC 2606 Reserved Top Level DNS Names",
  exampleCom: "site:example.com RFC 2606 example domain",
};
const selectedQuery = process.argv[2];
if (!selectedQuery || !Object.hasOwn(queries, selectedQuery) || process.argv.length !== 3) {
  throw new Error(`Choose one fixed public query: ${Object.keys(queries).join(" or ")}`);
}
const query = queries[selectedQuery];
const packageDir = process.env.PI_WEB_ACCESS_PACKAGE || "C:/Users/Makrious/.pi/agent/npm/node_modules/pi-web-access";
let root;
let client;
let transport;
let stderr = "";
let cacheEntriesBeforeCleanup = [];
try {
  root = mkdtempSync(join(tmpdir(), "issue102-exa-"));
  const configDir = join(root, "config");
  const cacheRoot = join(root, "cache");
  mkdirSync(configDir);
  mkdirSync(cacheRoot);
  writeFileSync(join(configDir, "web-search.json"), JSON.stringify({
    provider: "exa",
    webSearch: { enabled: true, allowedProviders: ["exa"] },
    tools: {
      webSearch: { enabled: true },
      sourceCheck: { enabled: false },
      fetchContent: { enabled: false },
      getSearchContent: { enabled: false },
    },
    allowBrowserCookies: false,
  }));

  const env = {};
  for (const key of ["PATH", "Path", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "ComSpec"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, {
    HOME: configDir,
    USERPROFILE: configDir,
    APPDATA: join(root, "appdata"),
    LOCALAPPDATA: join(root, "local-appdata"),
    HOMEDRIVE: root.slice(0, 2),
    HOMEPATH: root.slice(2),
    USERNAME: "issue102-probe",
    PI_CODING_AGENT_DIR: configDir,
    PI_WEB_ACCESS_CACHE_ROOT: cacheRoot,
    PI_OFFLINE: "1",
  });

  const require = createRequire(join(packageDir, "package.json"));
  const { Client } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
  const { StdioClientTransport } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href);
  client = new Client({ name: "issue-102-exa-probe", version: "1.0.0" });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(packageDir, "dist/mcp-cli.js")],
    env,
    stderr: "pipe",
  });
  transport.stderr?.on("data", chunk => { stderr += chunk.toString(); });
  await client.connect(transport);
  const names = (await client.listTools()).tools.map(tool => tool.name);
  if (!names.includes("web_search")) throw new Error("web_search tool is unavailable");
  const result = await client.callTool({
    name: "web_search",
    arguments: {
      query,
      provider: "exa",
      numResults: 2,
    },
  }, undefined, { timeout: 30_000 });
  console.log(JSON.stringify({
    provider: "exa",
    endpoint: "https://mcp.exa.ai/mcp?tools=web_search_exa (from installed provider source; not socket-captured)",
    cost: "Exa states its MCP server is free to use and requires no API key; no independent billing guarantee",
    configuredProvider: "exa",
    providerReportedByResult: result.content?.filter(item => item.type === "text").map(item => item.text).join("\n").match(/Provider:\s*([^\r\n]+)/i)?.[1] ?? null,
    query,
    outcome: result.isError ? "error" : "success",
    isError: Boolean(result.isError),
    result: result.content?.filter(item => item.type === "text").map(item => item.text).join("\n").slice(0, 5000),
    stderr: stderr.slice(0, 1000),
    isolatedCacheEntries: readdirSync(cacheRoot, { recursive: true }),
  }));
} finally {
  if (root && existsSync(root)) {
    const cacheRoot = join(root, "cache");
    if (existsSync(cacheRoot)) cacheEntriesBeforeCleanup = readdirSync(cacheRoot, { recursive: true });
  }
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  if (root && existsSync(root)) rmSync(root, { recursive: true });
  if (root) {
    assert.equal(existsSync(root), false, "isolated root must be removed");
    console.log(JSON.stringify({ isolatedRootRemoved: true, cacheEntriesBeforeCleanup }));
  }
}
