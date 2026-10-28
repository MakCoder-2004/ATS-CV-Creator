import { describe, expect, test } from 'vitest'
import { countEnglishWords, cvTitleUnsupportedTerms, draftRevisionSchema, isGeneratedDescriptionParagraph } from '../src/shared/draft'

test('CV title rejects protected credential phrases even when mentioned incidentally in cited prose', () => {
  const cited = ['Software Engineer', 'Built tools for a licensed professional engineer.', 'Machine Learning']
  expect(cvTitleUnsupportedTerms('Software Engineer · Machine Learning', cited, ['Software Engineer'])).toEqual([])
  for (const title of ['Licensed Software Engineer', 'Licenced Software Engineer', 'Professional Engineer', 'Professional Eng.', 'Prof. Engineer', 'P.Eng', 'P.E.', 'PE', 'Certified Software Engineer', 'Registered Nurse', 'Ph.D. Software Engineer']) {
    expect(cvTitleUnsupportedTerms(title, cited, ['Software Engineer']), title).not.toEqual([])
  }
})

describe('generated description format', () => {
  test('counts contractions and hyphenated technical terms as single words', () => {
    expect(countEnglishWords("Built role-specific API workflows with a user's review.")).toBe(8)
  })

  test('generation accepts 60 words and rejects 61 words, line breaks and list prefixes', () => {
    const accepted = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ')
    const rejected = Array.from({ length: 61 }, (_, index) => `word${index}`).join(' ')
    expect(isGeneratedDescriptionParagraph(accepted)).toBe(true)
    expect(isGeneratedDescriptionParagraph(rejected)).toBe(false)
    expect(isGeneratedDescriptionParagraph('First sentence.\nSecond sentence.')).toBe(false)
    expect(isGeneratedDescriptionParagraph('• Listed text.')).toBe(false)
  })

  test('legacy drafts remain valid without description-format metadata', () => {
    const parsed = draftRevisionSchema.parse({ id: '11111111-1111-4111-8111-111111111111', jobId: '22222222-2222-4222-8222-222222222222', revision: 1, pageTarget: 1, status: 'unverified', approved: false, lockedFields: { fullName: 'Candidate', experience: [], education: [], projects: [], certificates: [] }, content: { education: [], experience: [], projects: [], skills: [], certificates: [] }, evidence: [], progress: 'Legacy draft', attempts: 0, createdAt: new Date(0).toISOString() })
    expect(parsed.content.experience).toEqual([])
    expect(parsed).not.toHaveProperty('descriptionFormat')
  })
})
