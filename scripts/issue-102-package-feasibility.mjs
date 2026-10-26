import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

const packageName = 'pi-web-access';
const pinnedVersion = '0.44.0';
const npmRegistry = 'https://registry.npmjs.org/';
const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = process.env.ISSUE_102_TEMP_ROOT || 'C:\\Temp';
const tempRoot = await mkdtemp(path.join(tempParent, 'cv102-'));

function sanitizeNpmEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(npm_config_|npm_config$|node_auth_token$|npm_token$)/i.test(key)) delete env[key];
  }
  return env;
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
        if (error.code === 'ENOENT') continue;
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
  const result = spawnSync('npm', args, {
    cwd: stage,
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.slice(-4000);
    throw new Error(`npm exited ${result.status}: ${detail}`);
  }
  return `${result.stdout || ''}${result.stderr || ''}`;
}

try {
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

  const env = sanitizeNpmEnvironment();
  Object.assign(env, {
    NPM_CONFIG_USERCONFIG: config,
    NPM_CONFIG_GLOBALCONFIG: globalConfig,
    NPM_CONFIG_CACHE: cache,
    NPM_CONFIG_REGISTRY: npmRegistry,
    npm_config_userconfig: config,
    npm_config_globalconfig: globalConfig,
    npm_config_cache: cache,
    npm_config_registry: npmRegistry,
  });
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
  assert.match(lockPackage?.integrity || '', /^sha512-/);

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

  console.log(JSON.stringify({
    verdict: 'STATIC_PACKAGE_FEASIBILITY_ONLY',
    package: `${packageName}@${rootManifest.version}`,
    resolved: lockPackage.resolved,
    integrity: lockPackage.integrity,
    engine: rootManifest.engines.node,
    runtimeMcpSdk: sdkVersion,
    currentNode: process.version,
    electronPackageSpec,
    packageFiles: { dist: true, mcpCli: true },
    stage: tempRoot,
    physicalNodeModules: dependencyReal,
    npmLs: 'passed',
    runtimeDependencyCount: dependencyCount,
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
  }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
  await lstat(tempRoot).then(
    () => assert.fail('owned temporary root was not removed'),
    (error) => assert.equal(error.code, 'ENOENT'),
  );
}
