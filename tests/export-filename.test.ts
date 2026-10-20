import { expect, test } from 'vitest'
import { containsPdfTextInOrder, pdfFilename, sanitizeFilenamePart } from '../src/shared/export'

test('PDF names keep useful candidate and role context while removing path/control characters', () => {
  expect(pdfFilename('Zoë Candidate', 'A/B: Co.', 'Senior Engineer?')).toBe('Zoë Candidate - A B Co - Senior Engineer.pdf')
  expect(sanitizeFilenamePart('CON')).toBe('_CON')
  expect(sanitizeFilenamePart('...')).toBe('CV')
})

test('PDF content validation tolerates extractor run splits and Unicode canonical composition but preserves reading order', () => {
  expect(containsPdfTextInOrder(['Zo', 'ë ', 'Café', 'Script', ' Experience'], ['Zoë', 'CaféScript', 'Experience'])).toBe(true)
  expect(containsPdfTextInOrder(['Experience Education'], ['Education', 'Experience'])).toBe(false)
})
