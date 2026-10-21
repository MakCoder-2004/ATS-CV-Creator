import { expect, test } from 'vitest'
import { mapProfilePdfPages } from '../src/shared/profile-pdf-import'

test('automatically organizes marker-led PDF facts into profile-shaped, source-backed proposals', () => {
  const result = mapProfilePdfPages([{ page: 1, text: [
    'NAME: Ada Example', 'EMAIL: ada@example.test', 'HEADLINE: Software engineer',
    'SKILLS: Python, SQL', 'CONTACT LINK: Portfolio | https://example.test', 'EXPERIENCE: Example Labs | Engineer | 2020-01 – 2022-03', 'FACT: Built a data pipeline', 'UNKNOWN: Community mentor'
  ].join('\n') }])
  expect(result.contact).toMatchObject({ fullName: 'Ada Example', email: 'ada@example.test', headline: 'Software engineer' })
  expect(result.contact?.links).toEqual([{ label: 'Portfolio', url: 'https://example.test' }])
  expect(result.skills).toEqual([{ name: 'Python', category: 'Technical' }, { name: 'SQL', category: 'Technical' }])
  expect(result.experience).toMatchObject([{ organization: 'Example Labs', title: 'Engineer', startDate: '2020-01', endDate: '2022-03', factualItems: [{ text: 'Built a data pipeline' }] }])
  expect(result.sources).toContainEqual({ page: 1, field: 'experience.factualItem', passage: 'FACT: Built a data pipeline' })
  expect(result.unmapped).toContainEqual({ page: 1, text: 'UNKNOWN: Community mentor' })
})

test('maps programming languages, tools, and concepts into their distinct profile skill categories', () => {
  const result = mapProfilePdfPages([{ page: 3, text: ['PROGRAMMING LANGUAGES: Python, Java', 'TOOLS: React, Git', 'CONCEPTS: Distributed systems'].join('\n') }])
  expect(result.skills).toEqual([{ name: 'Python', category: 'Languages' }, { name: 'Java', category: 'Languages' }, { name: 'React', category: 'Tools' }, { name: 'Git', category: 'Tools' }, { name: 'Distributed systems', category: 'Domain' }])
})

test('maps spoken languages separately from programming skills and preserves source date precision', () => {
  const exactEducation = 'EDUCATION: BSc Computer Science | Example University | 2020-09-14 – 2024-06-20 | GPA 3.7'
  const result = mapProfilePdfPages([{ page: 2, text: ['SPOKEN LANGUAGES: Arabic, English', 'TECHNICAL SKILLS: Python', exactEducation, 'PROJECT: Atlas | Python, Flask', 'PROJECT LINK: Repository | https://example.test/atlas', 'FACT: Built a recommendation service'].join('\n') }])
  expect(result.skills).toEqual([{ name: 'Python', category: 'Technical' }])
  expect(result.entries).toContainEqual({ section: 'languages', title: 'Arabic' })
  expect(result.entries).toContainEqual({ section: 'languages', title: 'English' })
  expect(result.entries).toContainEqual(expect.objectContaining({ section: 'education', title: 'BSc Computer Science', institution: 'Example University', description: 'GPA 3.7' }))
  expect(result.unmapped).toContainEqual({ page: 2, text: `Date precision needs review: ${exactEducation}` })
  expect(result.projects).toMatchObject([{ name: 'Atlas', technologies: [{ text: 'Python' }, { text: 'Flask' }], links: [{ label: 'Repository', url: 'https://example.test/atlas' }], factualItems: [{ text: 'Built a recommendation service' }] }])
})
