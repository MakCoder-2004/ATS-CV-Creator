import { expect, test } from 'vitest'
import { coverLetterSourceCopy } from '../src/shared/cover-letter-source-copy'
import { buildCoverLetterPrompt } from '../src/main/cover-letter-prompt'

test('education evidence reads as plain text without changing the frozen record', () => {
  const source = { category: 'education' as const, passage: JSON.stringify({ title: 'B.Sc. Computer Science', institution: 'Example University', field: 'Data Science', description: 'Study period: 2023–2027.' }) }
  const original = source.passage
  const display = coverLetterSourceCopy(source)
  expect(display).toBe('B.Sc. Computer Science\nInstitution: Example University\nField of study: Data Science\nDetails: Study period: 2023–2027.')
  expect(display).not.toMatch(/[{}]/)
  expect(source.passage).toBe(original)
})

test('skill evidence is readable rather than serialized data', () => {
  expect(coverLetterSourceCopy({ category: 'skill', passage: JSON.stringify({ name: 'Python', category: 'Languages', proficiency: 'intermediate', years: 2 }) })).toBe('Python\nCategory: Languages\nProficiency: intermediate\nYears of use: 2')
})

test('unrecognized or narrative source material is not silently rewritten or lost', () => {
  for (const passage of ['A saved source sentence.', '{broken record', '{"name":"Python","unknown":"Keep this context"}', '{"title":{"nested":"Keep this too"}}']) expect(coverLetterSourceCopy({ category: 'education', passage })).toBe(passage)
  const passage = '{"name":"This is project code, not a profile record"}'
  expect(coverLetterSourceCopy({ category: 'project', passage })).toBe(passage)
})

test('writing instructions organize three friendly experience-led paragraphs, not a technical inventory', () => {
  const posting = { title: 'Engineer', company: 'Example', description: 'Build reliable applications using Python.' }
  const sources = [{ ordinal: 1, category: 'experience' as const, heading: 'Engineer', passage: 'Built reliable applications.' }]
  const prompt = buildCoverLetterPrompt(posting, sources)
  expect(prompt).toMatch(/^Write one cover letter/)
  for (const phrase of ['professional and friendly', 'exactly three', '150–200 words', 'Summarize one or two', 'at most two named tools', 'Never add a skills paragraph', 'Omit grades, GPA', 'not proof of graduation', 'Do not copy serialized source records', 'required JSON response envelope', 'not CV indexes']) expect(prompt).toContain(phrase)
  expect(JSON.parse(prompt.slice(prompt.indexOf('{')))).toEqual({ posting, sources })
})
