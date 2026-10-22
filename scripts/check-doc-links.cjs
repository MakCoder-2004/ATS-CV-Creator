const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const tracked = execFileSync('git', ['ls-files', '-z', '--', '*.md'], { encoding: 'utf8' })
  .split('\0').filter(Boolean);
const added = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard', '--', '*.md'], { encoding: 'utf8' })
  .split('\0').filter(Boolean);
const missing = [];

for (const source of [...tracked, ...added]) {
  if (!fs.existsSync(source)) {
    missing.push(`${source} -> Markdown file is missing`);
    continue;
  }
  const text = fs.readFileSync(source, 'utf8');
  const references = new Map([...text.matchAll(/^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?/gm)]
    .map(match => [match[1].toLowerCase(), match[2]]));
  const inline = [...text.matchAll(/!?\[[^\]]*\]\(<([^>]+)>\)|!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)]
    .map(match => match[1] ?? match[2]);
  const used = [...text.matchAll(/!?\[([^\]]+)\]\[([^\]]*)\]/g)].map(match => (match[2] || match[1]).toLowerCase());
  for (const name of used) if (!references.has(name)) missing.push(`${source} -> undefined reference [${name}]`);
  for (const href of [...inline, ...references.values()]) {
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(href)) continue;
    const pathname = decodeURIComponent(href.split('#')[0].split('?')[0]);
    if (!pathname) continue;
    const target = path.resolve(path.dirname(source), pathname);
    if (!fs.existsSync(target)) missing.push(`${source} -> ${href}`);
  }
}

if (missing.length) {
  console.error(missing.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Local links resolve in ${tracked.length + added.length} Markdown files.`);
}
