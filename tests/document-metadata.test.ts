import { expect, test } from 'vitest'
import { canonicalDocumentTextParts, createCanonicalDocument } from '../src/shared/document'
import { renderLatexSections } from '../src/shared/latex'
import { extractCanonicalDocx, renderCanonicalDocx } from '../src/main/docx-export'

const educationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', projectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const citation = (evidenceId: string) => ({ evidenceId, revision: 1 })
function fixture(text = 'CGPA: 3.3 | 2023 - 2027\nStudied data science.', projectLink = { label: 'GitHub', url: 'https://github.com/example/dino' }) {
  const draft = { id: '11111111-1111-4111-8111-111111111111', jobId: '22222222-2222-4222-8222-222222222222', revision: 1, pageTarget: 1, lockedFields: { fullName: 'Candidate', experience: [], education: [{ evidenceId: educationId, title: 'B.Sc. in Computer Science (Data Science)', institution: 'Alexandria University, Egypt', startDate: '2023', endDate: '2027' }], projects: [{ evidenceId: projectId, name: 'Dino Chrome Game Using Hand Gestures' }], certificates: [] }, content: { education: [{ text, citations: [citation(educationId)], rationale: 'Saved education' }], experience: [], projects: [{ text: 'Developed a gesture-controlled game.', citations: [citation(projectId)], rationale: 'Saved project' }], skills: [], certificates: [] } }
  const profile = { contact: null, education: [], certificates: [], skills: [], summary: [], languages: [], extras: [] }
  const experience = { experience: [], projects: [{ id: projectId, name: 'Dino Chrome Game Using Hand Gestures', technologies: ['Python', 'OpenCV', 'MediaPipe', 'PyInstaller'].map(text => ({ text })), links: [projectLink] }] }
  return { draft, profile, experience, document: createCanonicalDocument(draft as never, profile, experience as never) }
}
test('education moves supported CGPA below the dates without repeating chronology or mutating saved facts', () => {
  const { document, draft } = fixture()
  expect(document.sections[0].entries[0]).toMatchObject({ dates: '2023 – 2027', grade: 'CGPA: 3.3', text: 'Studied data science.', bullets: ['Studied data science.'] })
  expect(draft.content.education[0].text).toBe('CGPA: 3.3 | 2023 - 2027\nStudied data science.')
  expect(document.style).toMatchObject({ templateRevision: 2 })
  const latex = renderLatexSections(document)
  expect(latex['education.tex']).toContain('{B.Sc. in Computer Science (Data Science)}{CGPA: 3.3}')
  expect(latex['education.tex']).not.toContain('\\resumeItem{CGPA')
  expect(latex['education.tex'].match(/2023/g)).toHaveLength(1)
})
test('grade extraction preserves denominators, substantive clauses and nonmatching years', () => {
  expect(fixture('GPA: 3.75/4.0; Graduated with honors.').document.sections[0].entries[0]).toMatchObject({ grade: 'GPA: 3.75/4.0', text: 'Graduated with honors.' })
  expect(fixture('CGPA: 3.3 | 2021 - 2022').document.sections[0].entries[0]).toMatchObject({ grade: 'CGPA: 3.3', text: '2021 - 2022' })
  expect(fixture('CGPA: 3.3 | [REDACTED_PHONE]').document.sections[0].entries[0]).toMatchObject({ grade: 'CGPA: 3.3', text: '' })
  expect(fixture('CGPA: 3.3 expected next year.').document.sections[0].entries[0]).not.toHaveProperty('grade')
  expect(fixture('CGPA: 3.3\nCGPA: 3.8').document.sections[0].entries[0]).not.toHaveProperty('grade')
  const withoutGrade = fixture('Completed a statistics course.').document.sections[0].entries[0]
  expect(withoutGrade).not.toHaveProperty('grade')
  expect(withoutGrade.text).toBe('Completed a statistics course.')
})
test('project repository labels come from the URL without changing source labels or link targets', () => {
  for (const [url, label] of [
    ['https://github.com/owner/my-project.git?tab=readme#usage', 'github/my-project'],
    ['https://www.github.com/owner/my-project/tree/main', 'github/my-project'],
    ['https://github.com/owner/r%C3%A9sum%C3%A9', 'github/résumé'],
    ['https://github.com/orgs/example/repositories', 'Source'],
    ['https://example.test/project', 'Source']
  ]) {
    const { document, experience } = fixture(undefined, { label: 'Source', url })
    expect(document.sections.find(section => section.name === 'Projects')!.entries[0].links).toEqual([{ label, url }])
    expect(experience.projects[0].links[0]).toEqual({ label: 'Source', url })
  }
})
test('project hyperlinks belong in the heading before accomplishment bullets in every export', async () => {
  const { document } = fixture()
  const project = renderLatexSections(document)['projects.tex']
  expect(project).toContain('\\resumeLinkedProjectHeading')
  expect(project.indexOf('github/dino')).toBeLessThan(project.indexOf('\\resumeItemListStart'))
  expect(project.match(/github\/dino/g)).toHaveLength(1)
  const parts = canonicalDocumentTextParts(document)
  expect(parts.indexOf('CGPA: 3.3')).toBeGreaterThan(parts.indexOf('2023 – 2027'))
  expect(parts.indexOf('github/dino')).toBeLessThan(parts.indexOf('Developed a gesture-controlled game.'))
  const docx = await extractCanonicalDocx(await renderCanonicalDocx(document))
  expect(docx.text.indexOf('github/dino')).toBeLessThan(docx.text.indexOf('Developed a gesture-controlled game.'))
  expect(docx.links).toContainEqual({ label: 'github/dino', url: 'https://github.com/example/dino' })
})
