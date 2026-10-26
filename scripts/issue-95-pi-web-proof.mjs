import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const installedPackageDir = resolve(process.env.PI_WEB_ACCESS_PACKAGE || "C:/Users/Makrious/.pi/agent/npm/node_modules/pi-web-access");
let packageDir = installedPackageDir;
const packageJson = JSON.parse(readFileSync(join(installedPackageDir, "package.json"), "utf8"));
assert.equal(packageJson.version, "0.44.0", "the proof requires pinned pi-web-access 0.44.0");
const fixtureUrl = "https://www.rfc-editor.org/rfc/rfc2606.txt";
const fixtureQuery = "site:example.com RFC 2606 example domain";
const recordShape = "ProofCase(route, operation, inputUrlOrQuery, provider, allowedDestinationOrigins, observedDestinationOrigins, outcome, outputCharacters, cacheFilesBeforeCleanup, cleanup, restartObservation)";
const origins = new Set();

if (process.env.ISSUE95_TRACE_FILE) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.hostname === "html.duckduckgo.com") {
      origins.add("local://duckduckgo-stub");
      appendFileSync(process.env.ISSUE95_TRACE_FILE, `${init?.method ?? "GET"} local://duckduckgo-stub${url.pathname}${url.search}\n`);
      const html = '<html><div class="result"><a class="result__a" href="https://example.com/">Example Domain</a><a class="result__snippet">Synthetic local result</a></div></html>';
      if (process.env.ISSUE95_STUB_DELAY === "1") {
        return new Promise((resolveResponse, rejectResponse) => {
          const timer = setTimeout(() => resolveResponse(new Response(html, { status: 200, headers: { "content-type": "text/html" } })), 500);
          init?.signal?.addEventListener("abort", () => { clearTimeout(timer); rejectResponse(init.signal.reason ?? new DOMException("Aborted", "AbortError")); }, { once: true });
        });
      }
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    }
    origins.add(url.origin);
    appendFileSync(process.env.ISSUE95_TRACE_FILE, `${init?.method ?? "GET"} ${url.origin}${url.pathname}${url.search}\n`);
    return originalFetch(input, init);
  };
}

const appOperation = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("operation must be an object");
  const keys = Object.keys(input).sort().join(",");
  if (keys === "query,type" && input.type === "search" && typeof input.query === "string" && input.query.trim().length > 0 && input.query.length <= 240) {
    if (input.query.trim().toLowerCase() === "auto" || input.query.trim().toLowerCase() === "all") throw new TypeError("implicit provider selection is forbidden");
    return { type: "search", query: input.query.trim(), provider: "duckduckgo", maxResults: 2 };
  }
  if (keys === "type,url" && input.type === "fetch" && typeof input.url === "string") {
    const url = new URL(input.url);
    if (url.protocol !== "https:" || url.hostname !== "www.rfc-editor.org" || url.username || url.password || url.port) throw new TypeError("fetch URL is outside the proof allowlist");
    return { type: "fetch", url: url.href };
  }
  throw new TypeError("unsupported operation shape or option");
};

function safeEnv(configDir, cacheRoot, traceFile) {
  const env = {};
  for (const key of ["PATH", "Path", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "ComSpec"]) if (process.env[key]) env[key] = process.env[key];
  env.HOME = configDir;
  env.USERPROFILE = configDir;
  env.PI_CODING_AGENT_DIR = configDir;
  env.PI_WEB_ACCESS_PACKAGE = packageDir;
  env.PI_WEB_ACCESS_CACHE_ROOT = cacheRoot;
  env.ISSUE95_TRACE_FILE = traceFile;
  env.PI_OFFLINE = "1";
  return env;
}

function prepareCase(root, route, caseName) {
  const caseRoot = join(root, route, caseName);
  const configDir = join(caseRoot, "config");
  const cacheRoot = join(caseRoot, "cache-root");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(cacheRoot, { recursive: true });
  writeFileSync(join(configDir, "web-search.json"), JSON.stringify({
    provider: "duckduckgo",
    webSearch: { enabled: true, allowedProviders: ["duckduckgo"] },
    fetchRouting: { providers: ["http"], allowRemoteHostedProviders: false },
    fetchContent: { domainPolicy: { allow: ["rfc-editor.org"] }, redirects: "same-origin" },
    fetch: { timeout: 8, defaultMode: "readable", allowedModes: ["readable", "raw"] },
    maxInlineContentChars: 1000,
    tools: {
      webSearch: { enabled: true }, sourceCheck: { enabled: false },
      fetchContent: { enabled: true }, getSearchContent: { enabled: true },
    },
    githubClone: { enabled: false }, githubPrIssue: { enabled: false },
    youtube: { enabled: false }, video: { enabled: false }, pdf: { enabled: false },
    allowBrowserCookies: false,
  }, null, 2));
  const traceFile = join(caseRoot, "origins.txt");
  writeFileSync(traceFile, "");
  return { caseRoot, configDir, cacheRoot, traceFile, env: safeEnv(configDir, cacheRoot, traceFile) };
}

function fetchCacheFiles(cacheRoot) {
  const files = [];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push(path.slice(cacheRoot.length + 1));
    }
  };
  visit(cacheRoot);
  return files;
}

function cleanupCase(testCase) {
  const files = fetchCacheFiles(testCase.cacheRoot);
  rmSync(testCase.caseRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  return { files, deleted: !existsSync(testCase.caseRoot) };
}

async function extensionCase(testCase, operation) {
  process.env.PI_CODING_AGENT_DIR = testCase.configDir;
  process.env.PI_WEB_ACCESS_CACHE_ROOT = testCase.cacheRoot;
  process.env.ISSUE95_TRACE_FILE = testCase.traceFile;
  const extensionFile = join(packageDir, "dist", "index.js");
  const registrations = new Map();
  const extension = (await import(pathToFileURL(extensionFile).href)).default;
  extension({
    registerTool: (tool) => registrations.set(tool.name, tool),
    on: () => {}, registerCommand: () => {}, registerShortcut: () => {},
    appendEntry: () => {}, sendMessage: () => {}, exec: async () => ({ stdout: "", stderr: "", code: 0 }),
  });
  const name = operation === "fetch" ? "fetch_content" : "web_search";
  const tool = registrations.get(name);
  assert.ok(tool, `${name} was registered`);
  const params = operation === "fetch"
    ? { url: fixtureUrl, mode: "readable", redirects: "same-origin" }
    : { query: fixtureQuery, provider: "duckduckgo", numResults: 2, workflow: "none" };
  const controller = new AbortController();
  const pending = tool.execute("issue95-proof", params, controller.signal, () => {}, undefined);
  if (operation === "cancel") setTimeout(() => controller.abort(), 30);
  let result;
  try { result = await pending; } catch (error) { result = { content: [], details: { error: error instanceof Error ? error.message : String(error) } }; }
  const output = JSON.stringify(result);
  const visibleCharacters = (result.content ?? []).reduce((total, item) => total + (typeof item.text === "string" ? item.text.length : 0), 0);
  return { outcome: result.details?.error ? `error: ${result.details.error}` : "success", outputCharacters: output.length, visibleCharacters, output };
}

async function mcpCase(testCase, operation) {
  const require = createRequire(join(packageDir, "package.json"));
  const { Client } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
  const { StdioClientTransport } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href);
  const client = new Client({ name: "issue-95-isolated-proof", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", pathToFileURL(resolve(process.argv[1])).href, join(packageDir, "dist", "mcp-cli.js")],
    env: { ...testCase.env, ...(operation === "cancel" ? { ISSUE95_STUB_DELAY: "1" } : {}) },
    stderr: "pipe",
  });
  let serverStderr = "";
  transport.stderr?.on("data", (chunk) => { serverStderr += chunk.toString(); });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    assert.ok(names.includes(operation === "fetch" ? "fetch_content" : "web_search"));
    const params = operation === "fetch"
      ? { url: fixtureUrl, mode: "readable" }
      : { query: fixtureQuery, provider: "duckduckgo", numResults: 2 };
    const controller = new AbortController();
    const pending = client.callTool({ name: operation === "fetch" ? "fetch_content" : "web_search", arguments: params }, undefined, { signal: controller.signal });
    if (operation === "cancel") setTimeout(() => controller.abort(), 30);
    let result;
    try { result = await pending; } catch (error) { result = { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] }; }
    const output = JSON.stringify(result);
    const visibleCharacters = (result.content ?? []).reduce((total, item) => total + (typeof item.text === "string" ? item.text.length : 0), 0);
    return { outcome: result.isError ? `error: ${output.slice(0, 300)}` : "success", outputCharacters: output.length, visibleCharacters, output };
  } catch (error) {
    throw new Error(`MCP server failed. stderr=${serverStderr}`, { cause: error });
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

async function runWorker(mode) {
  if (mode === "extension") {
    const traceFile = process.env.ISSUE95_TRACE_FILE;
    const testCase = { configDir: process.env.PI_CODING_AGENT_DIR, cacheRoot: process.env.PI_WEB_ACCESS_CACHE_ROOT, traceFile };
    const operation = process.env.ISSUE95_OPERATION;
    const result = await extensionCase(testCase, operation);
    process.stdout.write(JSON.stringify({ ...result, origins: [...origins] }));
    return;
  }
  throw new Error(`Unknown worker ${mode}`);
}

async function run() {
  const root = resolve(tmpdir(), `cv-tailor-issue95-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  try {
  const runtimeModules = resolve(process.env.PI_WEB_ACCESS_RUNTIME_NODE_MODULES || "C:/Users/Makrious/.pi/agent/install/releases/1.4.0/node_modules");
  assert.ok(existsSync(join(runtimeModules, "@earendil-works", "pi-coding-agent", "package.json")), "the isolated extension runtime needs the installed Pi peer dependencies");
  const mirror = join(root, "adapter", "pi-web-access");
  mkdirSync(join(mirror, "dist"), { recursive: true });
  cpSync(join(installedPackageDir, "dist"), join(mirror, "dist"), { recursive: true });
  cpSync(join(installedPackageDir, "package.json"), join(mirror, "package.json"));
  const adapterModules = join(mirror, "node_modules");
  mkdirSync(adapterModules, { recursive: true });
  const requiredModules = new Set([...Object.keys(packageJson.dependencies), ...Object.keys(packageJson.peerDependencies)]);
  for (const source of [runtimeModules, resolve(process.env.PI_WEB_ACCESS_MODULES || "C:/Users/Makrious/.pi/agent/npm/node_modules")]) {
    for (const moduleName of requiredModules) {
      const sourcePath = join(source, moduleName);
      const targetPath = join(adapterModules, moduleName);
      if (!existsSync(sourcePath) || existsSync(targetPath)) continue;
      mkdirSync(join(targetPath, ".."), { recursive: true });
      symlinkSync(sourcePath, targetPath, "junction");
    }
  }
  packageDir = mirror;
  const proofCases = [];
    for (const invalid of [
      { type: "search", query: "x", provider: "auto" },
      { type: "search", query: "x", includeContent: true },
      { type: "search", query: "x", providers: ["duckduckgo", "tavily"] },
      { type: "fetch", url: fixtureUrl, proxy: "http://127.0.0.1" },
      { type: "fetch", url: "https://example.org/" },
    ]) assert.throws(() => appOperation(invalid), /unsupported|implicit|allowlist/, "app boundary rejects unsafe shape before launch");
    assert.deepEqual(appOperation({ type: "search", query: fixtureQuery }), { type: "search", query: fixtureQuery, provider: "duckduckgo", maxResults: 2 });
    for (const route of ["extension", "mcp"]) {
      for (const operation of ["fetch", "search", "cancel"]) {
        const testCase = prepareCase(root, route, operation);
        let result;
        if (route === "extension") {
          const child = spawn(process.execPath, [resolve(process.argv[1]), "--worker", "extension"], {
            env: { ...testCase.env, ISSUE95_OPERATION: operation, ...(operation === "cancel" ? { ISSUE95_STUB_DELAY: "1" } : {}) }, stdio: ["ignore", "pipe", "inherit"],
          });
          let stdout = "";
          for await (const chunk of child.stdout) stdout += chunk;
          const status = await new Promise((resolveExit, reject) => { child.once("error", reject); child.once("exit", (code) => resolveExit(code)); });
          assert.equal(status, 0, `extension worker exited ${status}`);
          result = JSON.parse(stdout);
        } else {
          result = await mcpCase(testCase, operation);
        }
        const traces = readFileSync(testCase.traceFile, "utf8").split(/\r?\n/).filter(Boolean);
        assert.ok(traces.length > 0, `${route}/${operation} produced a nonempty transport trace`);
        if (operation === "fetch") assert.ok(traces.includes("GET https://www.rfc-editor.org/rfc/rfc2606.txt"), `${route} observed exact fetch method/path`);
        if (operation === "search") assert.ok(traces.some((trace) => trace.includes("local://duckduckgo-stub/html/") && trace.includes("q=")), `${route} observed search request path/query`);
        if (operation === "cancel") assert.ok(traces.some((trace) => trace.startsWith("GET local://duckduckgo-stub/")), `${route} cancellation reached delayed stub before abort`);
        const unexpected = traces.filter((trace) => operation === "fetch" ? !trace.startsWith("GET https://www.rfc-editor.org/") : !trace.startsWith("GET local://duckduckgo-stub/"));
        assert.deepEqual(unexpected, [], `${route}/${operation} contacted only observed destination`);
        if (operation === "fetch") assert.match(result.output, /Reserved Top Level DNS Names/i, `${route} fetch contains the expected harmless RFC text`);
        if (operation === "search") assert.match(result.output, /duckduckgo/i, `${route} search identifies selected provider`);
        if (operation === "cancel") assert.match(result.outcome, /abort|cancel/i, `${route} reports an abort or cancellation, not an unrelated error`);
        if (operation !== "cancel") assert.ok(result.visibleCharacters <= 2000, `${route}/${operation} visible output is bounded to 2000 characters`);
        const cleanup = cleanupCase(testCase);
        assert.equal(cleanup.deleted, true, `${route}/${operation} isolated cache removed by harness owner`);
        proofCases.push({ route, operation, inputUrlOrQuery: operation === "fetch" ? fixtureUrl : fixtureQuery,
          provider: operation === "search" ? "duckduckgo" : "direct-http", allowedDestinationOrigins: [operation === "fetch" ? "https://www.rfc-editor.org" : "local://duckduckgo-stub"],
          observedDestinationOrigins: [...new Set(traces.map((trace) => trace.split(" ")[1]?.split("/").slice(0, 3).join("/")))], outcome: result.outcome,
          outputCharacters: result.visibleCharacters, cacheFilesBeforeCleanup: cleanup.files,
          cleanup: cleanup.deleted ? "temporary case removed" : "FAILED", restartObservation: "not separately run" });
        process.stdout.write(`${route}/${operation}: ${result.outcome}; visible characters ${result.visibleCharacters}; trace ${traces.join(" | ")}; cache files ${cleanup.files.length}; isolated cleanup ${cleanup.deleted ? "PASS" : "FAIL"}\n`);
      }
    }
    process.stdout.write(`ProofCase shape: ${recordShape}\n`);
    process.stdout.write(`Cases: ${JSON.stringify(proofCases)}\n`);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv[2] === "--worker") await runWorker(process.argv[3]);
  else await run();
}
