import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const packageDir = process.env.PI_WEB_ACCESS_PACKAGE || "C:/Users/Makrious/.pi/agent/npm/node_modules/pi-web-access";
const root = mkdtempSync(join(tmpdir(), "issue102-exa-"));
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
  PI_CODING_AGENT_DIR: configDir,
  PI_WEB_ACCESS_CACHE_ROOT: cacheRoot,
  PI_OFFLINE: "1",
});

const require = createRequire(join(packageDir, "package.json"));
const { Client } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
const { StdioClientTransport } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href);
const client = new Client({ name: "issue-102-exa-probe", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(packageDir, "dist/mcp-cli.js")],
  env,
  stderr: "pipe",
});
let stderr = "";
transport.stderr?.on("data", chunk => { stderr += chunk.toString(); });

try {
  await client.connect(transport);
  const names = (await client.listTools()).tools.map(tool => tool.name);
  if (!names.includes("web_search")) throw new Error("web_search tool is unavailable");
  const result = await client.callTool({
    name: "web_search",
    arguments: {
      query: "site:example.com RFC 2606 example domain",
      provider: "exa",
      numResults: 2,
    },
  });
  console.log(JSON.stringify({
    provider: "exa",
    query: "site:example.com RFC 2606 example domain",
    outcome: result.isError ? "error" : "success",
    isError: Boolean(result.isError),
    result: result.content?.filter(item => item.type === "text").map(item => item.text).join("\n").slice(0, 5000),
    stderr: stderr.slice(0, 1000),
    isolatedCacheEntries: readdirSync(cacheRoot, { recursive: true }),
  }));
} finally {
  await client.close().catch(() => {});
  await transport.close().catch(() => {});
  const cacheEntriesBeforeCleanup = readdirSync(cacheRoot, { recursive: true });
  rmSync(root, { recursive: true, force: true });
  console.log(JSON.stringify({
    isolatedRootRemoved: !existsSync(root),
    cacheEntriesBeforeCleanup,
  }));
}
