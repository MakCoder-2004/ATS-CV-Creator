// Deterministic issue #39 research harness; not a production import API.
import fs from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import mammoth from 'mammoth';

const out = new URL('./cv-upload-39-corpus/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const sections = [
  'Ada Example | Software Engineer | ada@example.test | +1 555 0100 | Example City',
  'LINK: Portfolio https://ada.example.test | SKILLS: Python, SQL, React',
  'SPOKEN LANGUAGES: English (native), Arabic (conversational)',
  'EXPERIENCE: Example Labs — Engineer — 2021-03 to 2023-11',
  'FACT: Built ingestion pipeline; throughput increased 20% (participated with team).',
  'TRAINING: Sample Institute — Cloud training — 2020',
  'PROJECT: Atlas — Python, Flask — https://code.example.test/atlas',
  'EDUCATION: BSc Computer Science — Example University — 2020-09 to 2024-06 — GPA 3.7',
  'CERTIFICATE: Safety Fundamentals — Example Board — 2022',
  'SUMMARY: Curious engineer focused on reliable systems.',
  'EXTRA: Volunteer mentor; dates not stated.',
  'UNKNOWN FIELD: Community cohort (source wording retained).',
];
function pdfEscape(s) { return s.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)'); }
function makePdf(lines, pages = 1, twoColumn = false, repeatedHeader = true) {
  const objects = [];
  const add = (s) => { objects.push(Buffer.from(s, 'binary')); return objects.length; };
  // Placeholder page tree gets filled once page refs exist.
  add('');
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageRefs = [];
  for (let p = 0; p < pages; p++) {
    const pageLines = lines.slice(p * 6, p * 6 + 6);
    let commands = 'BT /F1 9 Tf\n';
    if (repeatedHeader) commands += '1 0 0 1 40 785 Tm (Synthetic CV - repeated page header) Tj\n';
    pageLines.forEach((line, i) => { const column = twoColumn && i % 2 ? 330 : 40; const row = twoColumn ? Math.floor(i / 2) : i; commands += `1 0 0 1 ${column} ${760 - row * 35} Tm (${pdfEscape(line)}) Tj\n`; });
    commands += 'ET';
    const stream = Buffer.from(commands, 'binary');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${commands}\nendstream`);
    const annotation = p === 0 ? add('<< /Type /Annot /Subtype /Link /Rect [40 730 120 750] /Border [0 0 0] /A << /S /URI /URI (https://ada.example.test) >> >>') : null;
    const annots = annotation ? `/Annots [${annotation} 0 R]` : '';
    const page = add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R ${annots} >>`);
    pageRefs.push(`${page} 0 R`);
  }
  objects[0] = Buffer.from(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  objects[pagesObj - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pages} >>`);
  let result = Buffer.from('%PDF-1.4\n', 'binary'); const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(result.length); result = Buffer.concat([result, Buffer.from(`${i + 1} 0 obj\n`), obj, Buffer.from('\nendobj\n')]); });
  const xref = result.length; let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(x => table += `${String(x).padStart(10, '0')} 00000 n \n`);
  result = Buffer.concat([result, Buffer.from(`${table}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)]);
  return result;
}
const pdfPath = new URL('synthetic-profile.pdf', out);
await fs.writeFile(pdfPath, makePdf(sections, 2));
const twoColumnLines = ['Ada Example | Software Engineer | ada@example.test', 'SKILLS: Python, SQL', 'EXPERIENCE: Example Labs — Engineer', 'FACT: Built ingestion pipeline', 'PROJECT: Atlas — Flask', 'EDUCATION: BSc Computer Science', 'CERTIFICATE: Safety Fundamentals', 'UNKNOWN: Community cohort'];
const twoColumnPath = new URL('synthetic-two-column.pdf', out);
await fs.writeFile(twoColumnPath, makePdf(twoColumnLines, 2, true));

// OOXML fixture includes text paragraphs, table, hyperlink relationship, and an unknown field.
const zip = new JSZip();
zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
zip.file('word/_rels/document.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://ada.example.test" TargetMode="External"/></Relationships>`);
const para = s => `<w:p><w:r><w:t xml:space="preserve">${s}</w:t></w:r></w:p>`;
const rows = sections.map((s, i) => i === 1 ? `<w:p><w:hyperlink r:id="rLink"><w:r><w:t>Portfolio</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> https://ada.example.test | SKILLS: Python, SQL, React</w:t></w:r></w:p>` : para(s));
rows.splice(5, 0, `<w:tbl><w:tr><w:tc>${para('Training: Sample Institute')}</w:tc><w:tc>${para('Cloud training | 2020')}</w:tc></w:tr></w:tbl>`);
const docXml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${rows.join('')}<w:sectPr/></w:body></w:document>`;
zip.file('word/document.xml', docXml);
const docxPath = new URL('synthetic-profile.docx', out);
await fs.writeFile(docxPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

const gold = [
  ['contact.name', 'Ada Example'], ['contact.email', 'ada@example.test'], ['contact.phone', '+1 555 0100'],
  ['contact.location', 'Example City'], ['contact.link.label', 'Portfolio'], ['contact.link.target', 'https://ada.example.test'],
  ['skills.programming', 'Python'], ['skills.programming', 'SQL'], ['spoken_languages', 'Arabic'], ['experience.parent', 'Example Labs — Engineer'],
  ['experience.fact', 'throughput increased 20%'], ['training.parent', 'Sample Institute'], ['project.parent', 'Atlas'], ['project.technology', 'Flask'],
  ['education.degree', 'BSc Computer Science'], ['education.institution', 'Example University'], ['education.start', '2020-09'], ['education.end', '2024-06'],
  ['education.grade', 'GPA 3.7'], ['certificate.title', 'Safety Fundamentals'], ['certificate.year', '2022'], ['summary', 'Curious engineer'], ['extras', 'Volunteer mentor'], ['unknown', 'Community cohort'],
];
function normalized(s) { return s.toLowerCase().replace(/\s+/g, ' '); }
function score(text, hasLink) {
  const n = normalized(text); const checks = gold.map(([field, value]) => [field, n.includes(normalized(value)) || (field === 'contact.link.target' && hasLink)]);
  return { matched: checks.filter(x => x[1]).length, total: checks.length, misses: checks.filter(x => !x[1]).map(x => x[0]) };
}
function categoryBaseline(text) {
  const n = normalized(text);
  const markers = [['contact', 'ada example'], ['skills', 'skills:'], ['spoken languages', 'spoken languages:'], ['experience', 'experience:'], ['training', 'training:'], ['projects', 'project: atlas'], ['education', 'education:'], ['certificates', 'certificate:'], ['summary', 'summary:'], ['extras', 'extra:'], ['unknown', 'unknown field:']];
  const matched = markers.filter(([, marker]) => n.includes(marker)).map(([name]) => name);
  const parentLinks = [n.includes('experience: example labs') && n.includes('engineer') && n.indexOf('fact:') > n.indexOf('experience:'), n.includes('training: sample institute'), n.includes('project: atlas') && n.includes('flask')];
  return { categoriesMatched: matched.length, categoriesTotal: markers.length, categories: matched, parentLinksMatched: parentLinks.filter(Boolean).length, parentLinksTotal: parentLinks.length };
}
const pdf = await getDocument({ data: new Uint8Array(await fs.readFile(pdfPath)), useSystemFonts: true, isEvalSupported: false, enableXfa: false }).promise;
let pdfText = ''; let pdfLinks = 0;
for (let p = 1; p <= pdf.numPages; p++) { const page = await pdf.getPage(p); const content = await page.getTextContent(); pdfText += content.items.map(x => x.str).join(' ') + '\n'; pdfLinks += (await page.getAnnotations()).filter(x => x.subtype === 'Link').length; }
const docxBuffer = await fs.readFile(docxPath);
const docxText = (await mammoth.extractRawText({ buffer: docxBuffer })).value;
const docxHtml = (await mammoth.convertToHtml({ buffer: docxBuffer })).value;
const linkMatch = docxHtml.match(/<a href="([^"]+)">([^<]*)<\/a>/);
const twoColPdf = await getDocument({ data: new Uint8Array(await fs.readFile(twoColumnPath)), useSystemFonts: true, isEvalSupported: false, enableXfa: false }).promise;
let twoColText = ''; for (let p = 1; p <= twoColPdf.numPages; p++) { const page = await twoColPdf.getPage(p); twoColText += (await page.getTextContent()).items.map(x => x.str).join(' ') + '\n'; }
console.log(JSON.stringify({ fixtures: { pdf: pdfPath.pathname, docx: docxPath.pathname, twoColumnPdf: twoColumnPath.pathname }, pdf: { pages: pdf.numPages, chars: pdfText.length, fields: score(pdfText, pdfLinks > 0), categoryParentMapping: categoryBaseline(pdfText), linkAnnotations: pdfLinks, sourceLocationAvailable: true, orderExcerpt: pdfText.slice(0, 260) }, docx: { bytes: docxBuffer.length, chars: docxText.length, fields: score(docxText, !!linkMatch), categoryParentMapping: categoryBaseline(docxText), hyperlink: linkMatch ? { label: linkMatch[2], target: linkMatch[1] } : null, sourceParagraphs: docxText.split(/\n\s*\n/).length, tablePreserved: docxText.includes('Training: Sample Institute') && docxText.includes('Cloud training') }, twoColumnPdf: { pages: twoColPdf.numPages, chars: twoColText.length, text: twoColText, orderKnown: false }, goldFieldCount: gold.length }, null, 2));

// ZIP/XML preflight candidate (limits checked before XML parsing/extraction).
export async function preflight(buffer, limits = { bytes: 15 * 1024 * 1024, entries: 100, expanded: 50 * 1024 * 1024, part: 20 * 1024 * 1024 }) {
  if (buffer.length > limits.bytes) throw Error('file-size');
  const z = await JSZip.loadAsync(buffer, { checkCRC32: false, createFolders: false });
  const names = Object.values(z.files);
  if (names.length > limits.entries) throw Error('entry-count');
  let total = 0;
  for (const f of names) {
    const name = f.unsafeOriginalName ?? f.name;
    if (/(^|\/)(\.\.?)(\/|$)|^(\/|[A-Za-z]:)|\\/.test(name)) throw Error('unsafe-path');
    if (f.dir) continue;
    const size = f._data?.uncompressedSize ?? 0;
    total += size;
    if (size > limits.part || total > limits.expanded) throw Error('expanded-size');
    if (name.toLowerCase().endsWith('.rels')) {
      const rel = await f.async('string');
      if (/TargetMode\s*=\s*["']External["']/i.test(rel) && /Type\s*=\s*["'][^"']*\/(?:attachedTemplate|oleObject|package|image)["']/i.test(rel)) throw Error('external-resource');
    }
    if (/\.xml$/i.test(name)) {
      const xml = await f.async('string');
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('xml-dtd-entity');
    }
    if (/vbaProject\.bin|embeddings\//i.test(name)) throw Error('macro-or-embedded-payload');
  }
  if (!z.file('word/document.xml')) throw Error('missing-document');
  return true;
}
const policies = [];
const check = async (name, make, expected, limits) => { try { const buf = await make(); await preflight(buf, limits); policies.push([name, expected === 'pass' ? 'pass' : 'MISSED']); } catch (e) { policies.push([name, String(e.message) === expected ? 'pass' : `reject:${e.message}`]); } };
await check('normal DOCX', async () => docxBuffer, 'pass');
await check('path traversal entry', async () => { const z = await JSZip.loadAsync(docxBuffer); z.file('../evil.xml', '<evil/>'); return z.generateAsync({ type: 'nodebuffer' }); }, 'unsafe-path');
await check('DTD/entity declaration', async () => { const z = await JSZip.loadAsync(docxBuffer); z.file('word/document.xml', '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><x>&e;</x>'); return z.generateAsync({ type: 'nodebuffer' }); }, 'xml-dtd-entity');
await check('external image relationship', async () => { const z = await JSZip.loadAsync(docxBuffer); z.file('word/_rels/document.xml.rels', '<Relationships><Relationship Id="x" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://invalid.test/x.png" TargetMode="External"/></Relationships>'); return z.generateAsync({ type: 'nodebuffer' }); }, 'external-resource');
await check('embedded macro payload', async () => { const z = await JSZip.loadAsync(docxBuffer); z.file('word/vbaProject.bin', 'synthetic'); return z.generateAsync({ type: 'nodebuffer' }); }, 'macro-or-embedded-payload');
await check('oversized input', async () => docxBuffer, 'file-size', { bytes: 10, entries: 100, expanded: 50 * 1024 * 1024, part: 20 * 1024 * 1024 });
await check('too many ZIP entries', async () => docxBuffer, 'entry-count', { bytes: 15 * 1024 * 1024, entries: 2, expanded: 50 * 1024 * 1024, part: 20 * 1024 * 1024 });
await check('expanded-size limit', async () => docxBuffer, 'expanded-size', { bytes: 15 * 1024 * 1024, entries: 100, expanded: 10, part: 20 * 1024 * 1024 });
let malformedXmlRejected = false; try { const z = await JSZip.loadAsync(docxBuffer); z.file('word/document.xml', '<w:document><w:body><broken></w:body></w:document>'); await mammoth.extractRawText({ buffer: await z.generateAsync({ type: 'nodebuffer' }) }); } catch { malformedXmlRejected = true; }
const noTextPdf = await getDocument({ data: new Uint8Array(makePdf([], 1, false, false)), useSystemFonts: true, isEvalSupported: false, enableXfa: false }).promise;
const noText = (await noTextPdf.getPage(1)).getTextContent();
let malformedPdfRejected = false; try { await getDocument({ data: new Uint8Array(Buffer.from('not a PDF')), useSystemFonts: true }).promise; } catch { malformedPdfRejected = true; }
console.log('boundaries', JSON.stringify({ noTextPageCount: noTextPdf.numPages, noTextChars: (await noText).items.length, malformedPdfRejected, malformedXmlRejected }));
console.log('preflight', JSON.stringify(policies));
