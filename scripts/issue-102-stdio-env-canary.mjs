import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const packageDir = process.env.PI_WEB_ACCESS_PACKAGE || "C:/Users/Makrious/.pi/agent/npm/node_modules/pi-web-access";
const keys = ["APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "USERNAME"];
const syntheticParent = Object.fromEntries(keys.map(key => [key, `synthetic-parent-${key.toLowerCase()}`]));
const require = createRequire(join(packageDir, "package.json"));
const { StdioClientTransport } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href);
const childCode = `const keys=${JSON.stringify(keys)};process.stdout.write(JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized",params:Object.fromEntries(keys.map(key=>[key,process.env[key]??null]))})+"\\n");setInterval(()=>{},1000);`;
const root = mkdtempSync(join(tmpdir(), "issue102-stdio-env-"));

async function readChildEnvironment(env) {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["-e", childCode], env });
  let resolveMessage;
  const message = new Promise(resolve => { resolveMessage = resolve; });
  transport.onmessage = resolveMessage;
  try {
    await transport.start();
    const received = await Promise.race([
      message,
      new Promise((_, reject) => setTimeout(() => reject(new Error("SDK environment canary timed out")), 5000)),
    ]);
    return received.params;
  } finally {
    await transport.close();
  }
}

try {
  for (const [key, value] of Object.entries(syntheticParent)) process.env[key] = value;
  const inherited = await readChildEnvironment({});
  assert.deepEqual(inherited, syntheticParent, "SDK defaults inherit the synthetic Windows identity values");

  const temporaryValues = {
    APPDATA: join(root, "appdata"),
    LOCALAPPDATA: join(root, "local-appdata"),
    HOMEDRIVE: root.slice(0, 2),
    HOMEPATH: root.slice(2),
    USERNAME: "issue102-probe",
  };
  const overridden = await readChildEnvironment(temporaryValues);
  assert.deepEqual(overridden, temporaryValues, "explicit environment values replace SDK defaults");
  assert.ok(overridden.APPDATA.startsWith(root) && overridden.LOCALAPPDATA.startsWith(root), "app data paths stay in the temporary root");
  assert.equal(overridden.HOMEDRIVE + overridden.HOMEPATH, root, "the synthetic home path stays in the temporary root");
  assert.equal(overridden.USERNAME, "issue102-probe");
  console.log(JSON.stringify({
    offline: true,
    defaultInheritanceObserved: true,
    explicitOverridesObserved: true,
    inheritedValuesWereSynthetic: true,
    overrideValuesStayInTemporaryRoot: true,
  }));
} finally {
  for (const key of keys) delete process.env[key];
  rmSync(root, { recursive: true, force: true });
}
