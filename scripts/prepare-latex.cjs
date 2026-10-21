#!/usr/bin/env node
'use strict';

// Build-time provisioning only. Never call this from the app/runtime export path.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const repoRoot = path.resolve(__dirname, '..');
const lockPath = path.join(repoRoot, 'resources', 'latex-toolchain-lock.json');
const destination = path.join(repoRoot, '.tools', 'latex');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

function fail(message) {
  throw new Error(`prepare-latex: ${message}`);
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function parseTlpdb(file) {
  const text = fs.readFileSync(file, 'utf8');
  const packages = [];
  for (const record of text.split(/\n\s*\n/)) {
    const name = record.match(/^name (.+)$/m)?.[1];
    const revision = record.match(/^revision (\d+)$/m)?.[1];
    if (!name || !revision) continue;
    const pkg = { name, revision: Number(revision) };
    const catalogueVersion = record.match(/^catalogue-version (.+)$/m)?.[1];
    const catalogueLicense = record.match(/^catalogue-license (.+)$/m)?.[1];
    if (catalogueVersion) pkg.catalogueVersion = catalogueVersion;
    if (catalogueLicense) pkg.catalogueLicense = catalogueLicense;
    packages.push(pkg);
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

function manifestDigest(packages) {
  return crypto.createHash('sha256').update(JSON.stringify(packages)).digest('hex');
}

function checkManifest(tree) {
  const tlpdb = path.join(tree, 'tlpkg', 'texlive.tlpdb');
  if (!fs.existsSync(tlpdb)) fail(`not a TinyTeX/TeX Live tree (missing ${tlpdb})`);
  const actual = parseTlpdb(tlpdb);
  const expected = [...lock.packages].sort((a, b) => a.name.localeCompare(b.name));
  const expectedByName = new Map(expected.map((pkg) => [pkg.name, pkg]));
  const actualByName = new Map(actual.map((pkg) => [pkg.name, pkg]));
  const differences = [];
  for (const [name, pkg] of expectedByName) {
    const found = actualByName.get(name);
    if (!found) differences.push(`missing ${name}`);
    else if (JSON.stringify(found) !== JSON.stringify(pkg)) differences.push(`${name}: expected ${JSON.stringify(pkg)}, got ${JSON.stringify(found)}`);
  }
  for (const name of actualByName.keys()) if (!expectedByName.has(name)) differences.push(`unexpected ${name}`);
  if (differences.length) fail(`installed package manifest differs from pinned lock:\n  ${differences.join('\n  ')}`);
  for (const name of lock.requiredPackages) {
    if (!actualByName.has(name)) fail(`required package is not installed: ${name}`);
  }
  return actual;
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeout ?? 10 * 60 * 1000,
  });
  if (result.error) fail(`${path.basename(executable)} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    fail(`${path.basename(executable)} exited ${result.status ?? result.signal}${output ? `:\n${output}` : ''}`);
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function runTlmgr(tree, args) {
  if (process.platform !== 'win32') fail('the pinned toolchain is Windows x64; prepare it on Windows');
  const batch = path.join(tree, 'bin', 'windows', 'tlmgr.bat');
  if (!fs.existsSync(batch)) fail(`missing package manager: ${batch}`);
  // Use PowerShell to invoke the batch wrapper without cmd.exe's nested-quote ambiguity.
  // The path and arguments are passed through environment variables, never interpolated as code.
  const powershell = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
  const result = spawnSync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    '$a=ConvertFrom-Json -InputObject $env:CV_TLMGR_ARGS; & $env:CV_TLMGR_BATCH @a; exit $LASTEXITCODE',
  ], {
    cwd: tree,
    env: { ...process.env, CV_TLMGR_BATCH: batch, CV_TLMGR_ARGS: JSON.stringify(args) },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
  });
  if (result.error) fail(`tlmgr ${args[0]} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    fail(`tlmgr ${args.join(' ')} exited ${result.status ?? result.signal}${output ? `:\n${output}` : ''}`);
  }
}

function locate7zip() {
  const candidates = [
    process.env.SEVEN_ZIP,
    '7z.exe',
    '7zz.exe',
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['i'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (!result.error && result.status === 0) return candidate;
  }
  fail('7-Zip was not found. Install/use 7z.exe or set SEVEN_ZIP; the archive is extracted, never executed.');
}

async function downloadPinnedAsset(file) {
  const response = await fetch(lock.distribution.assetUrl, { redirect: 'follow', signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!response.ok || !response.body) fail(`download failed (${response.status}) from ${lock.distribution.assetUrl}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(file, { flags: 'wx' }));
  const stat = fs.statSync(file);
  if (stat.size !== lock.distribution.assetSizeBytes) fail(`asset size mismatch: expected ${lock.distribution.assetSizeBytes}, got ${stat.size}`);
  const actualHash = sha256File(file);
  if (actualHash !== lock.distribution.assetSha256) fail(`asset SHA-256 mismatch: ${actualHash}`);
}

function findTree(extractDir) {
  const candidates = [extractDir, path.join(extractDir, 'TinyTeX')];
  for (const entry of fs.readdirSync(extractDir, { withFileTypes: true })) {
    if (entry.isDirectory()) candidates.push(path.join(extractDir, entry.name));
  }
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'tlpkg', 'texlive.tlpdb')));
}

function rejectLinks(root) {
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`toolchain contains a symlink (not supported in bundled tree): ${full}`);
      if (entry.isDirectory()) pending.push(full);
    }
  }
}

function metadataFor(tree, packages) {
  const enginePath = path.join(tree, ...lock.engine.relativePath.split('/'));
  const versionOutput = run(enginePath, ['--version'], { cwd: tree, timeout: 30000 });
  const version = versionOutput.split(/\r?\n/).find((line) => line.startsWith('pdfTeX '));
  if (version !== lock.engine.version) fail(`engine version differs from lock: ${version ?? 'unknown'}`);
  return {
    schemaVersion: 1,
    engine: 'pdfTeX',
    version,
    executableSha256: sha256File(enginePath),
    distribution: lock.distribution.name,
    release: lock.distribution.release,
    texLiveYear: lock.distribution.texLiveYear,
    packageManifestSha256: manifestDigest(packages),
  };
}

async function main() {
  if (process.platform !== 'win32') fail('this preparation script provisions a Windows x64 toolchain and must run on Windows');
  const args = process.argv.slice(2);
  let source = null;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--from') fail('usage: node scripts/prepare-latex.cjs [--from <existing TinyTeX tree>]');
    source = path.resolve(args[1]);
  }

  const toolsDir = path.dirname(destination);
  fs.mkdirSync(toolsDir, { recursive: true });
  const staging = fs.mkdtempSync(path.join(toolsDir, '.latex-stage-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-tailor-latex-prepare-'));
  let tree;
  try {
    if (source) {
      tree = fs.existsSync(path.join(source, 'tlpkg', 'texlive.tlpdb')) ? source : findTree(source);
      if (!tree) fail(`could not find a TeX Live tree under ${source}`);
      if (path.resolve(tree) === path.resolve(destination) || path.resolve(tree).startsWith(`${path.resolve(destination)}${path.sep}`)) {
        fail('--from source cannot be the destination or a child of it');
      }
      checkManifest(tree);
      rejectLinks(tree);
      fs.cpSync(tree, staging, { recursive: true, dereference: false, preserveTimestamps: true });
    } else {
      const archive = path.join(work, path.basename(new URL(lock.distribution.assetUrl).pathname));
      await downloadPinnedAsset(archive);
      const sevenZip = locate7zip();
      const listing = run(sevenZip, ['l', '-slt', archive], { cwd: work, timeout: 30000 });
      const listedPaths = [...listing.matchAll(/^Path = (.+)$/gm)].slice(1).map((match) => match[1]);
      if (!listedPaths.length || listedPaths.some((item) => path.win32.isAbsolute(item) || item.split(/[\\/]/).includes('..') || !item.startsWith('TinyTeX'))) {
        fail('archive contains unexpected paths; refusing to extract');
      }
      run(sevenZip, ['x', '-y', `-o${staging}`, archive], { cwd: work, timeout: 5 * 60 * 1000 });
      tree = findTree(staging);
      if (!tree) fail('pinned archive did not contain a TinyTeX tree');
      const relative = path.relative(staging, tree);
      if (relative && relative !== 'TinyTeX') fail(`unexpected extracted root: ${relative}`);
      runTlmgr(tree, ['option', 'repository', lock.packageManager.repository]);
      runTlmgr(tree, ['update', '--self']);
      runTlmgr(tree, ['install', ...lock.requiredPackages]);
      checkManifest(tree); // Deliberately fail closed if the rolling repository changed any package revision.
      rejectLinks(tree);
      if (tree !== staging) {
        const contents = fs.readdirSync(tree);
        for (const name of contents) fs.renameSync(path.join(tree, name), path.join(staging, name));
        fs.rmSync(tree, { recursive: true, force: true });
        tree = staging;
      }
    }

    const packages = checkManifest(staging);
    const requiredTreeLicenses = ['LICENSE.TL', 'LICENSE.CTAN'];
    for (const name of requiredTreeLicenses) {
      if (!fs.existsSync(path.join(staging, name))) fail(`toolchain license file missing: ${name}`);
    }
    for (const relative of lock.licenses.additionalNoticeFiles) {
      const file = path.resolve(repoRoot, relative);
      if (!file.startsWith(`${repoRoot}${path.sep}`) || !fs.existsSync(file)) fail(`checked-in license/notice file missing: ${relative}`);
    }
    fs.writeFileSync(path.join(staging, 'cv-tailor-toolchain.json'), `${JSON.stringify(metadataFor(staging, packages), null, 2)}\n`);

    // Replace only after the new tree passes every validation. Keep rollback if rename fails.
    const backup = `${destination}.old-${process.pid}`;
    fs.rmSync(backup, { recursive: true, force: true });
    if (fs.existsSync(destination)) fs.renameSync(destination, backup);
    try {
      fs.renameSync(staging, destination);
      fs.rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      if (!fs.existsSync(destination) && fs.existsSync(backup)) fs.renameSync(backup, destination);
      throw error;
    }
    console.log(`Prepared pinned TinyTeX toolchain: ${destination}`);
    console.log(`Engine: ${lock.engine.version}`);
    console.log(`Package entries locked: ${packages.length}`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
