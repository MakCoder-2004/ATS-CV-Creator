'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flags = new Set(['--toolchain-root', '--audit-root', '--module-root', '--record-assets']);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
  return path.resolve(args[index + 1]);
}
for (let index = 0; index < args.length; index++) {
  if (!flags.has(args[index])) throw new Error(`Unknown argument ${args[index]}`);
  if (args[index] !== '--record-assets') index++;
}
const toolchain = option('--toolchain-root', path.join(root, '.tools', 'latex'));
const audit = option('--audit-root', path.join(root, '.audit', 'cover-letter-layout'));
const modules = option('--module-root', root);
const app = path.join(root, 'resources', 'cover-letter-template', 'application');
const manifestPath = path.join(app, 'assets.json');
const fixture = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'cover-letter-layout', 'content.tex'), 'utf8');
const executable = path.join(toolchain, 'bin', 'windows', 'pdflatex.exe');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const resolveIn = (base, relative) => {
  assert.ok(relative && !path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..'), 'Asset path must be relative and contained');
  return path.join(base, relative);
};
function verifyAssets(manifest, roots) {
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(Array.isArray(manifest.assets) && manifest.assets.length > 10);
  const seen = new Set();
  for (const asset of manifest.assets) {
    assert.ok(['application', 'toolchain'].includes(asset.root));
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    const key = `${asset.root}/${asset.path}`;
    assert.ok(!seen.has(key), `Duplicate asset ${key}`);
    seen.add(key);
    assert.equal(sha256(fs.readFileSync(resolveIn(roots[asset.root], asset.path))), asset.sha256, `Asset changed: ${key}`);
  }
}
function compile(name, content) {
  const directory = fs.mkdtempSync(path.join(audit, `${name}-`));
  fs.copyFileSync(path.join(app, 'cover-letter.tex'), path.join(directory, 'cover-letter.tex'));
  fs.writeFileSync(path.join(directory, 'content.tex'), content);
  fs.writeFileSync(path.join(directory, 'sentinel.txt'), 'SECRET_DO_NOT_READ');
  fs.mkdirSync(path.join(directory, 'home'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:TEX|MIKTEX|BIB|LUA|OSFONTDIR|FONTCONFIG|GS_|HOME$)/i.test(key)));
  Object.assign(env, {
    PATH: `${path.dirname(executable)};${path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')}`,
    HOME: path.join(directory, 'home'), TEXMFHOME: path.join(directory, 'home'),
    TEXMFCONFIG: path.join(directory, 'home'), TEXMFVAR: path.join(directory, 'home'),
    TEXMFOUTPUT: directory, openin_any: 'p', openout_any: 'p', shell_escape: 'f',
    SOURCE_DATE_EPOCH: '946684800', FORCE_SOURCE_DATE: '1',
  });
  let failed = false;
  for (let pass = 1; pass <= 2; pass++) {
    const result = spawnSync(executable, ['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-recorder', 'cover-letter.tex'], {
      cwd: directory, env, timeout: 20000, maxBuffer: 1024 * 1024, encoding: 'utf8', windowsHide: true,
    });
    fs.writeFileSync(path.join(directory, `pass-${pass}.txt`), `${result.stdout || ''}${result.stderr || ''}`);
    if (result.error) throw result.error;
    if (result.status !== 0) { failed = true; break; }
  }
  const log = fs.readFileSync(path.join(directory, 'cover-letter.log'), 'utf8');
  return {
    name, directory, failed, log,
    missingGlyph: /Missing character:|Unicode character[^]*not set up|not set up for use with LaTeX/i.test(log),
    overflow: /Overfull \\[hv]box \((?:[1-9]\d{1,}|[5-9])(?:\.\d+)?pt too (?:wide|high)\)/.test(log),
  };
}
async function main() {
  fs.mkdirSync(audit, { recursive: true });
  const requireModules = createRequire(path.join(modules, 'package.json'));
  const { getDocument } = await import(pathToFileURL(requireModules.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const { createCanvas } = requireModules('@napi-rs/canvas');
  async function inspect(result, expected, image = false) {
    assert.equal(result.failed, false, `${result.name}: compile failed`);
    assert.equal(result.missingGlyph, false, `${result.name}: missing glyph`);
    assert.equal(result.overflow, false, `${result.name}: overfull box`);
    const bytes = fs.readFileSync(path.join(result.directory, 'cover-letter.pdf'));
    assert.ok(bytes.length > 0 && bytes.length < 20 * 1024 * 1024);
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, fontExtraProperties: true });
    try {
      const document = await task.promise;
      assert.equal(document.numPages, 1, `${result.name}: expected exactly one page`);
      const page = await document.getPage(1);
      assert.deepEqual(page.view, [0, 0, 612, 792]);
      await page.getOperatorList();
      const content = await page.getTextContent();
      const fonts = [...new Set(content.items.map(item => item.fontName).filter(Boolean))].map(name => page.commonObjs.get(name));
      assert.ok(fonts.length >= 2 && fonts.every(font => /Lato/i.test(font.name) && !font.missingFile && font.data?.length > 0), 'Regular and bold Lato programs must be embedded');
      const text = content.items.map(item => item.str || '').join(' ').replace(/\s+/g, ' ');
      let cursor = 0;
      for (const value of expected) {
        const next = text.indexOf(value, cursor);
        assert.ok(next >= cursor, `${result.name}: missing or reordered text ${value}`);
        cursor = next + value.length;
      }
      assert.ok(!text.includes('SECRET_DO_NOT_READ'));
      const closing = content.items.find(item => item.str?.trim() === 'Sincerely,');
      const signature = content.items.filter(item => item.str?.trim() === 'Alex Rivera').at(-1);
      assert.ok(closing && signature && Math.abs(closing.transform[4] - 57.6) < 1 && signature.transform[5] < closing.transform[5], 'Closing and signature must have separate left-aligned lines');
      fs.writeFileSync(path.join(result.directory, 'extracted.txt'), text + '\n');
      if (image) {
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
        fs.writeFileSync(path.join(result.directory, 'preview.png'), canvas.toBuffer('image/png'));
      }
      return { pages: document.numPages, dimensions: page.view, fonts: fonts.map(font => font.name), bytes: bytes.length, directory: result.directory };
    } finally { await task.destroy(); }
  }
  const common = ['Alex Rivera', 'October 28, 2026', 'RE: Product Operations Analyst'];
  const generic = compile('generic', fixture);
  const observations = { generic: await inspect(generic, [...common, 'Dear Hiring Manager,', 'I am applying', 'Sincerely,', 'Alex Rivera'], true) };
  const named = compile('named', fixture.replace('Dear Hiring Manager,', 'Dear Priya Shah,'));
  observations.named = await inspect(named, [...common, 'Dear Priya Shah,', 'Sincerely,'], true);
  const escapedBody = 'Café résumé 100\\% R\\&D \\#1 A\\_B \\{literal\\} \\textbackslash{}input\\{sentinel.txt\\} \\$ \\textasciitilde{} \\textasciicircum{} \\textbar{} \\textless{} \\textgreater{}';
  const escaped = compile('escaped', fixture.replace('I am applying', escapedBody + '\\par I am applying'));
  observations.escaped = await inspect(escaped, [...common, 'Dear Hiring Manager,', 'Café résumé 100% R&D #1 A_B {literal} \\input{sentinel.txt} $ ~ ^ | < >', 'I am applying', 'Sincerely,'], true);
  const longRecipient = compile('long-recipient', fixture.replace('Dear Hiring Manager,', `Dear ${'W'.repeat(250)},`));
  assert.ok(!longRecipient.failed && longRecipient.overflow, 'Long recipient must exhibit actual overfull output');
  observations.longRecipient = { rejected: 'overfull box', directory: longRecipient.directory };
  const longBody = compile('long-body', fixture.replace('I am applying', 'A readable paragraph repeated for pagination. '.repeat(700) + '\\par I am applying'));
  assert.equal(longBody.failed, false);
  const longTask = getDocument({ data: new Uint8Array(fs.readFileSync(path.join(longBody.directory, 'cover-letter.pdf'))) });
  try { assert.ok((await longTask.promise).numPages > 1, 'Long body must really exceed one page'); } finally { await longTask.destroy(); }
  observations.longBody = { rejected: 'multiple pages', directory: longBody.directory };
  const unsupported = compile('unsupported', fixture.replace('I am applying', 'م I am applying'));
  assert.ok(unsupported.missingGlyph, 'Unsupported-character gate must observe a glyph/Unicode error, not an unrelated failure');
  observations.unsupported = { rejected: 'unsupported character', directory: unsupported.directory };
  const assets = new Map();
  const addAsset = (kind, relative, file) => assets.set(`${kind}/${relative}`, { root: kind, path: relative.replaceAll('\\', '/'), sha256: sha256(fs.readFileSync(file)) });
  addAsset('application', 'cover-letter.tex', path.join(app, 'cover-letter.tex'));
  addAsset('toolchain', 'bin/windows/pdflatex.exe', executable);
  addAsset('toolchain', 'cv-tailor-toolchain.json', path.join(toolchain, 'cv-tailor-toolchain.json'));
  for (const result of [generic, named, escaped]) {
    const fls = fs.readFileSync(path.join(result.directory, 'cover-letter.fls'), 'utf8');
    for (const line of fls.split(/\r?\n/)) {
      if (!line.startsWith('INPUT ')) continue;
      const input = path.resolve(result.directory, line.slice(6));
      const relative = path.relative(toolchain, input);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) addAsset('toolchain', relative.replaceAll('\\', '/'), input);
    }
  }
  const generated = { schemaVersion: 1, entry: 'cover-letter.tex', contentFilename: 'content.tex', assets: [...assets.values()].sort((a, b) => `${a.root}/${a.path}`.localeCompare(`${b.root}/${b.path}`)) };
  const roots = { application: app, toolchain };
  verifyAssets(generated, roots);
  if (args.includes('--record-assets')) fs.writeFileSync(manifestPath, JSON.stringify(generated, null, 2) + '\n');
  const pinned = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(generated, pinned, 'Recorder closure differs from the committed asset manifest; update deliberately');
  verifyAssets(pinned, roots);
  const probe = fs.mkdtempSync(path.join(audit, 'corruption-'));
  const fakeRoots = { application: path.join(probe, 'application'), toolchain: path.join(probe, 'toolchain') };
  for (const asset of pinned.assets) {
    const target = resolveIn(fakeRoots[asset.root], asset.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(resolveIn(roots[asset.root], asset.path), target);
  }
  const corruptTarget = path.join(fakeRoots.application, 'cover-letter.tex');
  fs.appendFileSync(corruptTarget, '\n% corrupt\n');
  assert.throws(() => verifyAssets(pinned, fakeRoots), /Asset changed/);
  fs.copyFileSync(path.join(app, 'cover-letter.tex'), corruptTarget);
  const font = pinned.assets.find(asset => asset.path.endsWith('Lato-Regular.pfb'));
  assert.ok(font, 'Manifest must pin the embedded regular font');
  fs.appendFileSync(resolveIn(fakeRoots.toolchain, font.path), 'corrupt');
  assert.throws(() => verifyAssets(pinned, fakeRoots), /Asset changed/);
  observations.assets = { count: pinned.assets.length, corruptionRefused: ['template', 'font'], runtimeEnforcement: 'not integrated' };
  fs.writeFileSync(path.join(audit, 'summary.json'), JSON.stringify(observations, null, 2) + '\n');
  console.log(`VERIFIED generic/named/escaped PDFs, overflow and unsupported-character refusals, ${pinned.assets.length} pinned assets and template/font corruption probes`);
  console.log(path.join(audit, 'summary.json'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
