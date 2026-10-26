import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const packageDir = resolve(process.env.PI_WEB_ACCESS_PACKAGE || "C:/Users/Makrious/.pi/agent/npm/node_modules/pi-web-access");
const fixtureUrl = "https://www.rfc-editor.org/rfc/rfc2606.txt";
const exaUrl = "https://mcp.exa.ai/mcp?tools=web_search_exa";
const fixtureText = "Reserved Top Level DNS Names. RFC 2606. Synthetic lifecycle fixture.";
const searchText = `Title: RFC 2606\nURL: https://www.rfc-editor.org/rfc/rfc2606.html\nText: Synthetic public RFC search result.`;
const query = "site:rfc-editor.org/rfc/rfc2606 RFC 2606 Reserved Top Level DNS Names";
const MAX_INPUT_BYTES = 512;
const MAX_RESULT_BYTES = 16_384;
const MAX_STDERR_BYTES = 8_192;
const TOTAL_MS = 10_000;
const CASES = [];

function operation(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("operation must be an object");
  if (input.kind === "search" && Object.keys(input).sort().join(",") === "kind,provider,query" && input.provider === "exa" && input.query === query) {
    if (Buffer.byteLength(input.query) > MAX_INPUT_BYTES) throw new TypeError("input exceeds byte limit");
    return { kind: "search", provider: "exa", query: input.query, tool: "web_search" };
  }
  if (input.kind === "fetch" && Object.keys(input).sort().join(",") === "kind,url" && input.url === fixtureUrl) {
    if (Buffer.byteLength(input.url) > MAX_INPUT_BYTES) throw new TypeError("input exceeds byte limit");
    return { kind: "fetch", url: input.url, tool: "fetch_content" };
  }
  throw new TypeError("unsupported operation shape, provider, or destination");
}

function withDeadline(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} deadline exceeded`)), ms); })]).finally(() => clearTimeout(timer));
}

async function tree(root) {
  const files = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else {
        const bytes = await readFile(path);
        files.push({ path: path.slice(root.length + 1), bytes: bytes.length, hasFixtureText: bytes.includes(Buffer.from(fixtureText)), hasSearchText: bytes.includes(Buffer.from(searchText)) });
      }
    }
  }
  await visit(root);
  return files;
}

function childEnvironment(runRoot, configRoot, cacheRoot, caseMode) {
  const env = {};
  for (const key of ["PATH", "Path", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "ComSpec"]) if (process.env[key]) env[key] = process.env[key];
  const syntheticHome = join(runRoot, "home");
  Object.assign(env, {
    HOME: syntheticHome, USERPROFILE: syntheticHome,
    APPDATA: join(runRoot, "appdata"), LOCALAPPDATA: join(runRoot, "local-appdata"),
    HOMEDRIVE: runRoot.slice(0, 2), HOMEPATH: runRoot.slice(2), USERNAME: "issue102-lifecycle",
    PI_CODING_AGENT_DIR: configRoot, PI_WEB_ACCESS_CACHE_ROOT: cacheRoot,
    PI_WEB_ACCESS_PACKAGE: packageDir, PI_OFFLINE: "1",
    ISSUE102_STUB_RECEIPT: join(runRoot, "stub-receipt"), ISSUE102_CASE_MODE: caseMode,
  });
  return env;
}

async function makeConfig(configRoot, cacheRoot) {
  await mkdir(configRoot, { recursive: true });
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(join(configRoot, "web-search.json"), JSON.stringify({
    provider: "exa", webSearch: { enabled: true, allowedProviders: ["exa"] },
    fetchRouting: { providers: ["http"], allowRemoteHostedProviders: false },
    fetchContent: { domainPolicy: { allow: ["rfc-editor.org"] }, redirects: "same-origin" },
    fetch: { timeout: 5, defaultMode: "readable", allowedModes: ["readable", "raw"] },
    tools: { webSearch: { enabled: true }, sourceCheck: { enabled: false }, fetchContent: { enabled: true }, getSearchContent: { enabled: true } },
    githubClone: { enabled: false }, youtube: { enabled: false }, video: { enabled: false }, pdf: { enabled: false }, allowBrowserCookies: false,
  }));
}

async function makeStub(runRoot) {
  const stubPath = join(runRoot, "fetch-stub.mjs");
  const code = `import { appendFileSync } from "node:fs";
const fixture=${JSON.stringify(fixtureUrl)}, exa=${JSON.stringify(exaUrl)}, receipt=process.env.ISSUE102_STUB_RECEIPT, mode=process.env.ISSUE102_CASE_MODE;
const original=globalThis.fetch;
globalThis.fetch=async (input, init={})=>{
 const url=new URL(typeof input==="string"||input instanceof URL?input:input.url);
 const method=init.method??(input instanceof Request?input.method:"GET");
 if (init.redirect && !["manual","error"].includes(init.redirect)) throw new Error("unexpected redirect mode");
 let key="";
 if (method==="GET"&&url.href===fixture) key="fixture";
 if (method==="POST"&&url.href===exa) key="exa";
 if (!key) throw new Error("offline fetch blocked unexpected destination: "+method+" "+url.href);
 appendFileSync(receipt,JSON.stringify({key,method,url:url.href})+"\\n");
 if (key==="fixture") return new Response(${JSON.stringify(fixtureText)},{status:200,headers:{"content-type":"text/plain; charset=utf-8"}});
 if (mode==="cancel") await new Promise(resolve=>setTimeout(resolve,30000));
 const body=JSON.parse(init.body);
 if (body.method!=="tools/call"||body.params?.name!=="web_search_exa"||body.params?.arguments?.query!==${JSON.stringify(query)}) throw new Error("unexpected synthetic Exa JSON-RPC request");
 const response=mode==="provider-error"?{jsonrpc:"2.0",id:body.id,error:{code:-32000,message:"synthetic provider failure"}}:{jsonrpc:"2.0",id:body.id,result:{content:[{type:"text",text:${JSON.stringify(searchText)}}]}};
 return new Response(JSON.stringify(response),{status:200,headers:{"content-type":"application/json"}});
};
`;
  await writeFile(stubPath, code);
  return stubPath;
}

async function createClient(runRoot, name, mode) {
  const require = createRequire(join(packageDir, "package.json"));
  const { Client } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
  const { StdioClientTransport } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href);
  const caseRoot = join(runRoot, name);
  const deadline = Date.now() + TOTAL_MS;
  const configRoot = join(caseRoot, "config");
  const cacheRoot = join(caseRoot, "cache");
  await mkdir(caseRoot, { recursive: true });
  await makeConfig(configRoot, cacheRoot);
  const stubPath = await makeStub(caseRoot);
  const client = new Client({ name: "issue-102-lifecycle", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", pathToFileURL(stubPath).href, join(packageDir, "dist/mcp-cli.js")],
    env: childEnvironment(caseRoot, configRoot, cacheRoot, mode), stderr: "pipe", maxBufferSize: MAX_RESULT_BYTES,
  });
  let stderr = "";
  let stderrOverflow = false;
  transport.stderr?.on("data", chunk => {
    const next = Buffer.byteLength(stderr) + chunk.length;
    if (next > MAX_STDERR_BYTES) { stderrOverflow = true; void transport.close(); }
    else stderr += chunk.toString();
  });
  let childClosedResolve;
  const childClosed = new Promise(resolve => { childClosedResolve = resolve; });
  await withDeadline(client.connect(transport), Math.max(1, deadline - Date.now()), "connect/listTools");
  const child = transport._process;
  assert.ok(child?.pid, "stdio MCP child has an observable PID");
  child.once("close", (code, signal) => childClosedResolve({ code, signal }));
  const names = (await withDeadline(client.listTools(), Math.max(1, deadline - Date.now()), "listTools")).tools.map(item => item.name);
  assert.ok(names.includes("web_search") && names.includes("fetch_content"), "expected pinned MCP tools are listed");
  return { caseRoot, cacheRoot, deadline, client, transport, child, childClosed, stderrOverflow: () => stderrOverflow };
}

async function closeAndWait(session, force = false) {
  const pid = session.child.pid;
  if (force && session.child.exitCode === null) session.child.kill("SIGKILL");
  if (!force) {
    await session.client.close().catch(() => {});
    await session.transport.close().catch(() => {});
  }
  const exit = await withDeadline(session.childClosed, 5_000, "child exit");
  let aliveAfterExit = true;
  try { process.kill(pid, 0); } catch { aliveAfterExit = false; }
  assert.equal(aliveAfterExit, false, `child ${pid} is not live after its close event`);
  assert.ok(exit.code !== null || exit.signal !== null, "exit status or signal was observed");
  return { pid, exitCode: exit.code, signal: exit.signal, aliveAfterExit };
}

async function waitForReceipt(path, session) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (session.child.exitCode !== null) throw new Error("child exited before stub request receipt");
    try { return (await readFile(path, "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line)); } catch (error) { if (error.code !== "ENOENT") throw error; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("stub request receipt deadline exceeded");
}

async function runOperation(session, op) {
  const parsed = operation(op);
  const args = parsed.kind === "fetch" ? { url: parsed.url, mode: "raw" } : { query: parsed.query, provider: parsed.provider, numResults: 1 };
  const start = Date.now();
  const remaining = Math.max(1, session.deadline - Date.now());
  const result = await withDeadline(session.client.callTool({ name: parsed.tool, arguments: args }, undefined, { timeout: remaining }), remaining, "complete operation");
  const bytes = Buffer.byteLength(JSON.stringify(result));
  assert.ok(bytes <= MAX_RESULT_BYTES, `result bounded to ${MAX_RESULT_BYTES} bytes`);
  assert.equal(session.stderrOverflow(), false, "stderr remained within its byte budget");
  assert.ok(Date.now() - start < TOTAL_MS, "operation completed within total budget");
  return result;
}

async function removeOwned(path, fail = false) {
  if (fail) throw new Error("injected owned-root cleanup failure");
  await rm(path, { recursive: true, force: true, maxRetries: 1, retryDelay: 50 });
}

async function main() {
  const packageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
  assert.equal(packageJson.version, "0.44.0", "proof uses the pinned local Pi Web Access version");
  const runRoot = await mkdtemp(join(tmpdir(), "issue102-mcp-lifecycle-"));
  const results = [];
  try {
    const stale = join(runRoot, "run-stale-dead-pid");
    await mkdir(stale);
    await writeFile(join(stale, "owner.json"), JSON.stringify({ pid: 2147483647, cacheText: fixtureText }));
    const owner = { blocked: false };
    async function reconcile() {
      if (owner.blocked) throw new Error("run owner is fail-closed");
      for (const entry of await readdir(runRoot, { withFileTypes: true })) {
        const path = join(runRoot, entry.name);
        if (!entry.isDirectory() || !entry.name.startsWith("run-stale-")) continue;
        try { process.kill(JSON.parse(await readFile(join(path, "owner.json"), "utf8")).pid, 0); } catch { await removeOwned(path); }
      }
    }
    await reconcile();
    await assert.rejects(access(stale), { code: "ENOENT" }, "next run reconciles a dead stale root");
    for (const invalid of [
      { kind: "search", provider: "auto", query }, { kind: "search", provider: "all", query },
      { kind: "search", provider: ["exa"], query }, { kind: "search", provider: "exa", query, queries: [query] },
      { kind: "search", provider: "exa", query, includeContent: true }, { kind: "search", provider: "exa", query, proxy: "http://localhost" },
      { kind: "fetch", url: "https://example.com/" }, { kind: "fetch", url: fixtureUrl, urls: [fixtureUrl] },
    ]) assert.throws(() => operation(invalid), /unsupported/, "invalid shape rejected before child creation");

    async function normalCase(name, op, expected) {
      const session = await createClient(runRoot, name, expected === "error" ? "provider-error" : "normal");
      const result = await runOperation(session, op);
      assert.equal(Boolean(result.isError), expected === "error", `${name} expected result class: ${JSON.stringify(result).slice(0, 2000)}`);
      const receiptPath = join(session.caseRoot, "stub-receipt");
      const receipts = await waitForReceipt(receiptPath, session);
      const treeBefore = await tree(session.cacheRoot);
      if (op.kind === "fetch") assert.match(JSON.stringify(result), /Reserved Top Level DNS Names/i, "fetch returns harmless fixture text");
      if (op.kind === "search" && expected === "success") assert.match(JSON.stringify(result), /RFC 2606/i, "search returns synthetic Exa result");
      if (expected === "error") assert.match(JSON.stringify(result), /synthetic provider failure/i, "provider error stays an error");
      const processEvidence = await closeAndWait(session);
      await removeOwned(session.caseRoot);
      await assert.rejects(access(session.caseRoot), { code: "ENOENT" });
      results.push({ name, observed: "synthetic response and ordinary cleanup", receipts, cacheTreeBeforeCleanup: treeBefore, process: processEvidence, rootRemoved: true });
    }

    await normalCase("fetch-success", { kind: "fetch", url: fixtureUrl }, "success");
    await normalCase("search-success", { kind: "search", provider: "exa", query }, "success");
    await normalCase("provider-error", { kind: "search", provider: "exa", query }, "error");

    const cancel = await createClient(runRoot, "cancel", "cancel");
    const receiptPath = join(cancel.caseRoot, "stub-receipt");
    const pending = cancel.client.callTool({ name: "web_search", arguments: { query, provider: "exa", numResults: 1 } }).then(() => true, () => false);
    const receipt = await waitForReceipt(receiptPath, cancel);
    assert.deepEqual(receipt.map(item => item.url), [exaUrl], "stub received exact allowlisted Exa request before cancellation");
    await closeAndWait(cancel, true);
    const late = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve(false), 250))]);
    assert.equal(late, false, "no result was observed within 250 ms after child exit");
    const cancelTree = await tree(cancel.cacheRoot);
    await removeOwned(cancel.caseRoot);
    await assert.rejects(access(cancel.cacheRoot), { code: "ENOENT" }, "owned cancelled root was removed");
    results.push({ name: "cancel-after-request", observed: "one child exited; no result within 250 ms", receipts: receipt, childKilledAndExitObserved: true, cacheTreeBeforeCleanup: cancelTree, rootRemoved: true });

    const normal = await createClient(runRoot, "normal-close", "normal");
    const normalClose = await closeAndWait(normal);
    await removeOwned(normal.caseRoot);
    results.push({ name: "normal-close", observed: "one child exit and healthy root removal", process: normalClose, rootRemoved: true });

    const forced = await createClient(runRoot, "run-stale-forced-death", "normal");
    const forcedEvidence = await closeAndWait(forced, true);
    const forcedFiles = await tree(forced.cacheRoot);
    await writeFile(join(forced.caseRoot, "owner.json"), JSON.stringify({ pid: forcedEvidence.pid, cacheText: fixtureText }));
    await reconcile();
    await assert.rejects(access(forced.caseRoot), { code: "ENOENT" }, "next operation removes the dead child's stale owned root");
    results.push({ name: "forced-death-next-run-reconcile", observed: "one killed child and same-process cleanup after a post-death marker", process: forcedEvidence, cacheTreeBeforeCleanup: forcedFiles, rootRemoved: true });

    const failed = await createClient(runRoot, "cleanup-failure", "normal");
    await closeAndWait(failed);
    owner.blocked = true;
    await assert.rejects(removeOwned(failed.caseRoot, true), /injected/, "injected cleanup deletion failure surfaces");
    await assert.rejects(reconcile(), /fail-closed/, "cleanup failure blocks next operation");
    assert.equal((await readdir(runRoot)).includes("cleanup-failure"), true, "failed deletion is visible and not misreported as clean");
    await removeOwned(failed.caseRoot);
    owner.blocked = false;
    await reconcile();
    assert.equal((await readdir(runRoot)).includes("cleanup-failure"), false, "owned cleanup retry removes failed root");
    results.push({ name: "cleanup-failure-fail-closed-retry", observed: "deletion throw with a manually set block flag, followed by retry", injectedFailureObserved: true, manuallyBlockedNextCall: true, ownedRetryRemovedRoot: true });

    const remaining = await readdir(runRoot);
    assert.deepEqual(remaining, [], "cleanup and restart leave no per-run root or unaccepted fixture text behind");
    console.log(JSON.stringify({ verdict: "NOT_VERIFIED", syntheticFetchStub: true, egressUnverified: true, package: packageJson.version, operationShape: "fixed search or fetch only; checks 512 input bytes and serialized result size after parsing", bounds: { deadlineRaceMs: TOTAL_MS, attemptedStderrCapBytes: MAX_STDERR_BYTES, preParseIngressCap: false }, cases: results }, null, 2));
  } finally {
    await rm(runRoot, { recursive: true, force: true });
  }
}

await main();
