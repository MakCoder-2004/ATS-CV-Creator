import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

const packageName = 'pi-web-access';
const pinnedVersion = '0.44.0';
const npmRegistry = 'https://registry.npmjs.org/';
const repoRoot = path.resolve(import.meta.dirname, '..');
const expectedIntegrity = 'sha512-8YK2Nb0P7ezRL0FS7P1cPYu7gDUOuhXWA3FOBev0bKsuPtG2QrDVm2GriKBgZI1Sq7SC8QRsfVFYYP8huUEo8w==';
const nodeRoot = path.dirname(await realpath(process.execPath));
const npmCli = path.join(nodeRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js');
const tempParent = process.env.ISSUE_102_TEMP_ROOT || 'C:\\Temp';
const tempRoot = await mkdtemp(path.join(tempParent, 'cv102-'));

function buildNpmEnvironment(root, parentEnv = process.env) {
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR']) {
    if (parentEnv[key]) env[key] = parentEnv[key];
  }
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']) {
    env[key] = root;
  }
  if (process.platform === 'win32') {
    env.HOMEDRIVE = path.parse(root).root.replace(/[\\/]+$/, '');
    env.HOMEPATH = root.slice(env.HOMEDRIVE.length);
  }
  env.PATH = '';
  env.NPM_CONFIG_USERCONFIG = path.join(root, 'npmrc');
  env.NPM_CONFIG_GLOBALCONFIG = path.join(root, 'global-npmrc');
  env.NPM_CONFIG_CACHE = path.join(root, 'cache');
  env.NPM_CONFIG_REGISTRY = npmRegistry;
  return env;
}

function verifyEnvironmentIsolation(root) {
  const parent = {
    ...process.env,
    PATH: 'ISSUE_102_PATH_CANARY',
    ISSUE_102_CREDENTIAL_CANARY: 'ISSUE_102_CREDENTIAL_CANARY_VALUE',
  };
  const env = buildNpmEnvironment(root, parent);
  const script = 'process.stdout.write(JSON.stringify({ path: process.env.PATH ?? null, credential: process.env.ISSUE_102_CREDENTIAL_CANARY ?? null }))';
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    env,
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { path: '', credential: null });
  assert.equal(parent.PATH, 'ISSUE_102_PATH_CANARY');
  assert.equal(parent.ISSUE_102_CREDENTIAL_CANARY, 'ISSUE_102_CREDENTIAL_CANARY_VALUE');
}

function displayLicense(value) {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').slice(0, 100);
  if (Array.isArray(value)) return value.map(displayLicense).join(' OR ').slice(0, 100);
  if (value && typeof value === 'object') return String(value.type || 'SEE LICENSE IN').slice(0, 100);
  return 'UNKNOWN';
}

async function assertPhysicalTree(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    const stat = await lstat(entryPath);
    assert(!stat.isSymbolicLink(), `dependency tree contains link: ${entryPath}`);
    if (stat.isDirectory()) await assertPhysicalTree(entryPath);
  }
}

async function walkDependencyPackages(root) {
  const records = [];
  async function visitModules(modulesDir) {
    let entries;
    try {
      entries = await readdir(modulesDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const entryPath = path.join(modulesDir, entry.name);
      const stat = await lstat(entryPath);
      assert(!stat.isSymbolicLink(), `dependency tree contains link: ${entryPath}`);
      if (entry.name.startsWith('@')) {
        assert(stat.isDirectory(), `scope is not a directory: ${entryPath}`);
        await visitModules(entryPath);
        continue;
      }
      assert(stat.isDirectory(), `dependency is not a physical directory: ${entryPath}`);
      const manifestPath = path.join(entryPath, 'package.json');
      let manifest;
      try {
        manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') throw new Error(`dependency manifest is missing: ${manifestPath}`);
        throw error;
      }
      const files = await readdir(entryPath);
      const licenseFiles = files.filter((file) => /^(license|licence)(\.|$)/i.test(file));
      const noticeFiles = files.filter((file) => /^notice(\.|$)/i.test(file));
      records.push({
        name: manifest.name || entry.name,
        version: manifest.version || 'unknown',
        license: displayLicense(manifest.license),
        licenseFile: licenseFiles.length > 0,
        noticeFile: noticeFiles.length > 0,
      });
      await visitModules(path.join(entryPath, 'node_modules'));
    }
  }
  await visitModules(path.join(root, 'node_modules'));
  return records.sort((a, b) => a.name.localeCompare(b.name));
}

function npm(args, stage, env) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: stage,
    env,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.slice(-4000);
    throw new Error(`npm exited ${result.status}: ${detail}`);
  }
  return `${result.stdout || ''}${result.stderr || ''}`;
}

let report;
try {
  assert((await realpath(npmCli)).startsWith(nodeRoot + path.sep), 'npm CLI is outside the trusted Node install root');
  assert(!tempRoot.includes(' ') && tempRoot.length <= 24,
    `temporary path must be short and contain no spaces: ${tempRoot}`);
  const stage = path.join(tempRoot, 'stage');
  const config = path.join(tempRoot, 'npmrc');
  const globalConfig = path.join(tempRoot, 'global-npmrc');
  const cache = path.join(tempRoot, 'cache');
  await mkdir(stage);
  await mkdir(cache);
  await writeFile(config, '');
  await writeFile(globalConfig, '');
  await writeFile(path.join(stage, 'package.json'), JSON.stringify({
    private: true,
    dependencies: { [packageName]: pinnedVersion },
  }, null, 2));

  const env = buildNpmEnvironment(tempRoot);
  verifyEnvironmentIsolation(tempRoot);
  npm([
    'install', `${packageName}@${pinnedVersion}`,
    '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund',
    '--registry', npmRegistry,
  ], stage, env);

  const root = path.join(stage, 'node_modules', packageName);
  const rootManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(rootManifest.version, pinnedVersion);
  const distPath = path.join(root, 'dist');
  const cliPath = path.join(root, 'dist', 'mcp-cli.js');
  assert((await lstat(distPath)).isDirectory(), 'package dist directory is missing');
  assert((await lstat(cliPath)).isFile(), 'package mcp-cli.js is missing');

  const engine = rootManifest.engines?.node;
  assert.equal(engine, '>=22.19.0', 'unexpected Node engine declaration');
  const sdkVersion = rootManifest.dependencies?.['@modelcontextprotocol/sdk'];
  assert.equal(sdkVersion, '1.32.1', 'unexpected MCP SDK dependency pin');

  const lock = JSON.parse(await readFile(path.join(stage, 'package-lock.json'), 'utf8'));
  const lockPackage = lock.packages?.[`node_modules/${packageName}`];
  assert.equal(lockPackage?.version, pinnedVersion);
  assert.match(lockPackage?.resolved || '', /^https:\/\/registry\.npmjs\.org\//);
  assert.equal(lockPackage?.integrity, expectedIntegrity, 'package tarball integrity differs from recorded evidence');

  const stageReal = await realpath(stage);
  await assertPhysicalTree(path.join(stage, 'node_modules'));
  const treeRecords = await walkDependencyPackages(stage);
  const dependencyReal = await realpath(path.join(stage, 'node_modules'));
  assert(dependencyReal.startsWith(stageReal + path.sep), 'node_modules resolves outside owned stage');
  const dependencyCount = treeRecords.length;
  assert(dependencyCount > 0, 'no installed runtime dependency manifests found');
  npm(['ls', '--omit=dev', '--all'], stage, env);

  const missingDeclaredLicense = treeRecords.filter((item) => item.license === 'UNKNOWN');
  const missingLicenseFile = treeRecords.filter((item) => !item.licenseFile);
  const missingNoticeFile = treeRecords.filter((item) => !item.noticeFile);
  const unresolved = [...new Set([
    ...missingDeclaredLicense.map((item) => `${item.name}@${item.version}: no manifest license`),
    ...missingLicenseFile.map((item) => `${item.name}@${item.version}: no root LICENSE file`),
    ...missingNoticeFile.map((item) => `${item.name}@${item.version}: no root NOTICE file`),
  ])].sort();
  const currentManifest = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const appDependencySpec = currentManifest.dependencies?.[packageName] || null;
  const appIncludesPackage = appDependencySpec === pinnedVersion;
  const builderFiles = currentManifest.build?.files || [];
  const builderExtraResources = currentManifest.build?.extraResources || [];
  const electronPackageSpec = currentManifest.devDependencies?.electron || null;

  report = {
    verdict: 'STATIC_PACKAGE_FEASIBILITY_ONLY',
    package: `${packageName}@${rootManifest.version}`,
    resolved: lockPackage.resolved,
    integrity: lockPackage.integrity,
    engine: rootManifest.engines.node,
    runtimeMcpSdk: sdkVersion,
    currentNode: process.version,
    electronPackageSpec,
    packagedElectronNodeRuntimeAsserted: false,
    packageFiles: { dist: true, mcpCli: true },
    stage: tempRoot,
    physicalNodeModules: dependencyReal,
    npmLs: 'passed',
    physicalInstalledManifestCount: dependencyCount,
    lockfileTransitiveVersionsTrackedInRepository: false,
    license: {
      missingManifestLicenseCount: missingDeclaredLicense.length,
      missingLicenseFileCount: missingLicenseFile.length,
      missingNoticeFileCount: missingNoticeFile.length,
      unresolvedSample: unresolved.slice(0, 40),
      unresolvedTotal: unresolved.length,
      securityAdvisoryReview: 'NOT_RUN; npm install used --no-audit',
    },
    appDependencySpec,
    currentAppPackageIncludesPinnedDependency: appIncludesPackage,
    electronBuilderFiles: builderFiles,
    electronBuilderAsarUnpack: currentManifest.build?.asarUnpack || [],
    electronBuilderExtraResourceCount: builderExtraResources.length,
    electronBuilderHasPackageResource: builderExtraResources.some((item) => String(item.from).includes(packageName)),
    installedOrPackagedExecutableLaunched: false,
    mcpServerStarted: false,
  };
} finally {
  await rm(tempRoot, { recursive: true, force: true });
  await lstat(tempRoot).then(
    () => assert.fail('owned temporary root was not removed'),
    (error) => assert.equal(error.code, 'ENOENT'),
  );
}
console.log(JSON.stringify(report, null, 2));
