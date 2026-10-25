import { expect, test } from 'vitest'
import { buildDocxSourceEvidence, buildPdfSourceEvidence } from '../src/shared/profile-source-evidence'

const nextId = (() => { let id = 0; return () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}` })()
const hash = 'a'.repeat(64)

test('builds ordered PDF evidence units from all readable page text and attached links', () => {
  const document = buildPdfSourceEvidence(hash, [{
    page: 1,
    text: 'Riley Example\nData Analyst at Harbor Cooperative, 2019 to 2022\nPrepared monthly risk reports.\n',
    links: [{ label: 'Risk reports', url: 'https://example.test/reports', lineIndex: 2 }],
    warnings: ['Reading order may be ambiguous.']
  }], nextId)
  expect(document.pages).toEqual([{ page: 1, text: 'Riley Example\nData Analyst at Harbor Cooperative, 2019 to 2022\nPrepared monthly risk reports.\n' }])
  expect(document.units.map(unit => ({ position: unit.position, text: unit.text, links: unit.links }))).toEqual([
    { position: 0, text: 'Riley Example', links: [] },
    { position: 1, text: 'Data Analyst at Harbor Cooperative, 2019 to 2022', links: [] },
    { position: 2, text: 'Prepared monthly risk reports.', links: [{ label: 'Risk reports', url: 'https://example.test/reports' }] }
  ])
  for (const unit of document.units) expect(document.pages[0]!.text.slice(unit.start, unit.end)).toBe(unit.text)
  expect(document.units.some(unit => unit.text.includes('Reading order'))).toBe(false)
})

test('keeps DOCX paragraph positions and paragraph-local links separate from page text', () => {
  const document = buildDocxSourceEvidence(hash, [{
    page: 1,
    text: 'PROJECT: Atlas | React\nBuilt a local route planner. Repository\nUnclassified note.',
    paragraphs: [
      { text: 'PROJECT: Atlas | React', links: [] },
      { text: 'Built a local route planner. Repository', links: [{ label: 'Repository', url: 'https://github.com/riley/atlas' }] },
      { text: 'Unclassified note.', links: [] }
    ]
  }], nextId)
  expect(document.units.map(unit => ({ position: unit.position, start: unit.start, text: unit.text, links: unit.links }))).toEqual([
    { position: 0, start: 0, text: 'PROJECT: Atlas | React', links: [] },
    { position: 1, start: 23, text: 'Built a local route planner. Repository', links: [{ label: 'Repository', url: 'https://github.com/riley/atlas' }] },
    { position: 2, start: 63, text: 'Unclassified note.', links: [] }
  ])
  for (const unit of document.units) expect(document.pages[0]!.text.slice(unit.start, unit.end)).toBe(unit.text)
})

test('rejects source units that cannot be bound to exact captured page text', () => {
  expect(() => buildDocxSourceEvidence(hash, [{ page: 1, text: 'A different captured paragraph', paragraphs: [{ text: 'Claimed paragraph', links: [] }] }], nextId)).toThrow(/captured text/)
})

test('refuses excessive source-unit counts rather than dropping readable text', () => {
  const text = Array.from({ length: 15_001 }, (_, index) => `line ${index}`).join('\n')
  expect(() => buildPdfSourceEvidence(hash, [{ page: 1, text }], nextId)).toThrow(/source-unit limit/)
})
