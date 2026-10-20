import { expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { containsPdfTextInOrder, pdfFilename, sanitizeFilenamePart, writePdfAtomically } from '../src/shared/export'

test('PDF names keep useful candidate and role context while removing path/control characters', () => {
  expect(pdfFilename('Zoë Candidate', 'A/B: Co.', 'Senior Engineer?')).toBe('Zoë Candidate - A B Co - Senior Engineer.pdf')
  expect(sanitizeFilenamePart('CON')).toBe('_CON')
  expect(sanitizeFilenamePart('...')).toBe('CV')
})

test('PDF content validation tolerates extractor run splits and Unicode canonical composition but preserves reading order', () => {
  expect(containsPdfTextInOrder(['Zo', 'ë ', 'Café', 'Script', ' Experience'], ['Zoë', 'CaféScript', 'Experience'])).toBe(true)
  expect(containsPdfTextInOrder(['Experience Education'], ['Education', 'Experience'])).toBe(false)
})

test('PDF reading-order check rejects reordered entries and paragraphs', () => {
  const expected = ['Education', 'Experience', 'Engineer', '2022 – Present', 'Built reliable services.', 'Senior Engineer', '2020 – 2022', 'Led platform migration.']
  expect(containsPdfTextInOrder(['EDUCATION', 'EXPERIENCE', 'Engineer', '2022 – Present', 'Built reliable services.', 'Senior Engineer', '2020 – 2022', 'Led platform migration.'], expected)).toBe(true)
  expect(containsPdfTextInOrder(['Education Experience Senior Engineer 2020 – 2022 Led platform migration. Engineer 2022 – Present Built reliable services.'], expected)).toBe(false)
  expect(containsPdfTextInOrder(['Education Experience Engineer 2022 – Present Led platform migration. Built reliable services. Senior Engineer 2020 – 2022'], expected)).toBe(false)
})

test('unapproved no-overwrite commit cannot replace a destination that appears during rendering', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pdf-atomic-'))
  const destination = join(directory, 'candidate.pdf')
  try {
    writeFileSync(destination, 'concurrently-created file')
    expect(() => writePdfAtomically(destination, Buffer.from('%PDF-new'), false)).toThrow()
    expect(readFileSync(destination, 'utf8')).toBe('concurrently-created file')
    writePdfAtomically(destination, Buffer.from('%PDF-replacement'), true)
    expect(readFileSync(destination, 'utf8')).toBe('%PDF-replacement')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
