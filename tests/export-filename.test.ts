import { expect, test } from 'vitest'
import { pdfFilename, sanitizeFilenamePart } from '../src/shared/export'

test('PDF names keep useful candidate and role context while removing path/control characters', () => {
  expect(pdfFilename('Zoë Candidate', 'A/B: Co.', 'Senior Engineer?')).toBe('Zoë Candidate - A B Co - Senior Engineer.pdf')
  expect(sanitizeFilenamePart('CON')).toBe('_CON')
  expect(sanitizeFilenamePart('...')).toBe('CV')
})
