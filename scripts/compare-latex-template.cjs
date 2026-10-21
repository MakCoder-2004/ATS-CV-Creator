#!/usr/bin/env node
'use strict';
// Optional visual regression against the user's supplied baseline; never downloads assets.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

async function main() {
  const reference = process.argv[2];
  if (!reference) throw new Error('Usage: node scripts/compare-latex-template.cjs <reference.pdf> [toolchain-root]');
  const root = path.resolve(__dirname, '..');
  const toolchain = path.resolve(process.argv[3] || path.join(root, '.tools', 'latex'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-template-compare-'));
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = require('@napi-rs/canvas');
  let expected, actual;
  try {
    fs.cpSync(path.join(root, 'resources', 'cv-template'), work, { recursive: true });
    for (let pass = 0; pass < 2; pass++) {
      const result = spawnSync(path.join(toolchain, 'bin', 'windows', 'pdflatex.exe'), ['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', 'resume.tex'], { cwd: work, windowsHide: true, encoding: 'utf8', timeout: 30_000 });
      if (result.error || result.status !== 0) throw new Error('Local template compilation failed. Run npm run verify:latex.');
    }
    expected = getDocument({ data: new Uint8Array(fs.readFileSync(path.resolve(reference))) });
    actual = getDocument({ data: new Uint8Array(fs.readFileSync(path.join(work, 'resume.pdf'))) });
    const [left, right] = await Promise.all([expected.promise, actual.promise]);
    if (left.numPages !== right.numPages) throw new Error('Template page counts differ.');
    let differences = 0, channels = 0;
    async function render(pdf, pageNo) {
      const page = await pdf.getPage(pageNo);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
    }
    for (let pageNo = 1; pageNo <= left.numPages; pageNo++) {
      const [a, b] = await Promise.all([render(left, pageNo), render(right, pageNo)]);
      if (a.width !== b.width || a.height !== b.height) throw new Error('Template page dimensions differ.');
      channels += a.data.length;
      for (let index = 0; index < a.data.length; index++) if (a.data[index] !== b.data[index]) differences++;
    }
    console.log(`${left.numPages} page(s), 2x render: ${differences} differing channels of ${channels}.`);
    if (differences) process.exitCode = 1;
  } finally {
    await expected?.destroy();
    await actual?.destroy();
    fs.rmSync(work, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
