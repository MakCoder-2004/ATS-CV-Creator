#!/usr/bin/env node
'use strict';

// Local verification only: this script never downloads or installs packages.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'resources', 'latex-toolchain-lock.json'), 'utf8'));

function fail(message) {
  throw new Error(`verify-latex: ${message}`);
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function parseTlpdb(file) {
  const packages = [];
  for (const record of fs.readFileSync(file, 'utf8').split(/\n\s*\n/)) {
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

function run(file, args, cwd, timeout = 30000) {
  const result = spawnSync(file, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout });
  if (result.error) fail(`${path.basename(file)} could not run: ${result.error.message}`);
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    fail(`${path.basename(file)} exited ${result.status ?? result.signal}${output ? `:\n${output}` : ''}`);
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function copyTemplate(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) fail(`template contains unsupported symlink: ${from}`);
    if (entry.isDirectory()) fs.cpSync(from, to, { recursive: true });
    else fs.copyFileSync(from, to);
  }
}

function main() {
  const args = process.argv.slice(2);
  let root = path.resolve(repoRoot, '.tools', 'latex');
  let smoke = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--root' && args[index + 1]) root = path.resolve(args[++index]);
    else if (args[index] === '--smoke') smoke = true;
    else fail('usage: node scripts/verify-latex.cjs [--root <tree>] [--smoke]');
  }
  if (process.platform !== 'win32') fail('the pinned toolchain is Windows x64; verify it on Windows');

  const metadataPath = path.join(root, 'cv-tailor-toolchain.json');
  const tlpdbPath = path.join(root, 'tlpkg', 'texlive.tlpdb');
  const metadata = fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, 'utf8')) : null;
  if (!metadata || metadata.schemaVersion !== 1) fail(`missing/unsupported metadata: ${metadataPath}`);
  const expectedPackages = [...lock.packages].sort((a, b) => a.name.localeCompare(b.name));
  const actualPackages = parseTlpdb(tlpdbPath);
  const expectedText = JSON.stringify(expectedPackages);
  const actualText = JSON.stringify(actualPackages);
  if (actualText !== expectedText) fail('installed package names/revisions/catalogue metadata differ from resources/latex-toolchain-lock.json');
  for (const name of lock.requiredPackages) {
    if (!actualPackages.some((pkg) => pkg.name === name)) fail(`required package missing: ${name}`);
  }

  const enginePath = path.join(root, ...lock.engine.relativePath.split('/'));
  if (!fs.existsSync(enginePath)) fail(`engine executable missing: ${enginePath}`);
  const executableSha256 = sha256File(enginePath);
  if (executableSha256 !== lock.engine.executableSha256 || metadata.executableSha256 !== executableSha256) {
    fail(`pdfLaTeX executable SHA-256 mismatch (lock=${lock.engine.executableSha256}, metadata=${metadata.executableSha256}, actual=${executableSha256})`);
  }
  const versionOutput = run(enginePath, ['--version'], root);
  const version = versionOutput.split(/\r?\n/).find((line) => line.startsWith('pdfTeX '));
  if (version !== lock.engine.version || metadata.version !== version || metadata.engine !== 'pdfTeX') {
    fail(`engine version/family mismatch: ${version ?? 'unknown'}`);
  }
  if (metadata.distribution !== lock.distribution.name || metadata.release !== lock.distribution.release || metadata.texLiveYear !== lock.distribution.texLiveYear) {
    fail('distribution metadata does not match the locked release');
  }
  if (metadata.packageManifestSha256 !== manifestDigest(actualPackages)) fail('toolchain package-manifest digest mismatch');

  for (const filename of lock.licenses.requiredFiles) {
    if (!fs.existsSync(path.join(root, filename))) fail(`required bundled TeX Live license file missing: ${filename}`);
  }
  for (const relative of lock.licenses.additionalNoticeFiles) {
    const file = path.resolve(repoRoot, relative);
    if (!file.startsWith(`${repoRoot}${path.sep}`) || !fs.existsSync(file)) fail(`required license/notice file missing: ${relative}`);
  }
  if (smoke) {
    const template = path.join(repoRoot, 'CV', 'overleaf template');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-tailor-latex-smoke-'));
    try {
      copyTemplate(template, work);
      for (let pass = 0; pass < 2; pass++) {
        run(enginePath, ['--no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', 'resume.tex'], work, 120000);
      }
      if (!fs.existsSync(path.join(work, 'resume.pdf'))) fail('template smoke did not produce resume.pdf');
      console.log(`Template smoke succeeded: ${path.join(work, 'resume.pdf')}`);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  console.log(`Verified pinned TinyTeX toolchain at ${root}`);
  console.log(`${version}; ${actualPackages.length} package records match the checked-in lock; license files present.`);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
