import { expect, test } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { canonicalDocumentTextParts, createCanonicalDocument } from '../src/shared/document'
import { createLatexCompiler } from '../src/main/latex-compiler'
import { assertCompiledContent, inspectCompiledPdf } from '../src/main/pdf-document'
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
test('repeated education heading, institution, grade and matching years occupy only two metadata rows', async () => {
  const { draft, profile, experience } = fixture('B.S. in Applied Statistics (Analytics), Fictional State University, Testland; CGPA 3.3; 2023-2027')
  draft.lockedFields.education[0].title = 'B.S. in Applied Statistics(Analytics)'
  draft.lockedFields.education[0].institution = 'Fictional State University, Testland'
  const document = createCanonicalDocument(draft as never, profile, experience as never)
  expect(document.sections[0].entries[0]).toMatchObject({ organization: 'Fictional State University, Testland', heading: 'B.S. in Applied Statistics(Analytics)', dates: '2023 – 2027', grade: 'CGPA: 3.3', text: '', bullets: [] })
  const latex = renderLatexSections(document)['education.tex']
  expect(latex).not.toContain('\\resumeItem{')
  expect(latex.match(/Fictional State University/g)).toHaveLength(1)
  expect(latex.match(/CGPA: 3.3/g)).toHaveLength(1)
  const docx = await extractCanonicalDocx(await renderCanonicalDocx(document))
  expect(docx.text.filter(value => value.includes('Fictional State University'))).toHaveLength(1)
  expect(docx.text.filter(value => value.includes('CGPA: 3.3'))).toHaveLength(1)
})

test('education dedup keeps unique details and does not erase unrelated mentions or nonmatching dates', () => {
  const { draft, profile, experience } = fixture('B.S. in Applied Statistics, Fictional State University, Testland; CGPA: 3.3; 2023-2027; Presented a capstone project.\nWorked with Fictional State University, Testland mentors.\nCGPA: 3.3 | 2021 - 2022')
  draft.lockedFields.education[0].title = 'B.S. in Applied Statistics'
  draft.lockedFields.education[0].institution = 'Fictional State University, Testland'
  const document = createCanonicalDocument(draft as never, profile, experience as never)
  expect(document.sections[0].entries[0]).toMatchObject({ grade: 'CGPA: 3.3', text: 'Presented a capstone project.\nWorked with Fictional State University, Testland mentors.\n2021 - 2022' })
  expect(draft.content.education[0].text).toContain('B.S. in Applied Statistics, Fictional State University')
})

test.skipIf(process.platform !== 'win32' || !existsSync(resolve('.tools/latex/cv-tailor-toolchain.json')))('compiled CV has two education metadata rows without a repeated bullet', async () => {
  const { draft, profile, experience } = fixture('B.S. in Applied Statistics (Analytics), Fictional State University, Testland; CGPA 3.3; 2023-2027')
  draft.lockedFields.education[0].title = 'B.S. in Applied Statistics(Analytics)'
  draft.lockedFields.education[0].institution = 'Fictional State University, Testland'
  const document = createCanonicalDocument(draft as never, profile, experience as never)
  const tempRoot = await mkdtemp(join(tmpdir(), 'cv-education-layout-'))
  try {
    const compiler = createLatexCompiler({ toolchainRoot: resolve('.tools/latex'), templateRoot: resolve('resources/cv-template'), tempRoot })
    const compiled = await compiler.compile(document)
    const inspected = await inspectCompiledPdf(compiled.pdf)
    expect(inspected.actualPages).toBe(1)
    expect(() => assertCompiledContent(document, inspected)).not.toThrow()
    const text = inspected.extractedText.join(' ')
    expect(text.match(/Fictional State University/g)).toHaveLength(1)
    expect(text.match(/B\.S\. in Applied Statistics/g)).toHaveLength(1)
    expect(text.match(/CGPA/g)).toHaveLength(1)
    expect(text.match(/2023/g)).toHaveLength(1)
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const loading = getDocument({ data: new Uint8Array(compiled.pdf) })
    try {
      const page = await (await loading.promise).getPage(1)
      const items = (await page.getTextContent()).items.filter((item): item is typeof item & { str: string; transform: number[]; width: number } => 'str' in item)
      const school = items.find(item => item.str.includes('Fictional State University'))!
      const dates = items.find(item => item.str.includes('2023'))!
      const degree = items.find(item => item.str.includes('B.S. in Applied Statistics'))!
      const grade = items.find(item => item.str.includes('CGPA'))!
      expect(school.transform[5]).toBeGreaterThan(degree.transform[5])
      expect(grade.transform[5]).toBeCloseTo(degree.transform[5], 0)
      expect(grade.transform[4] + grade.width).toBeCloseTo(dates.transform[4] + dates.width, 0)
    } finally { await loading.destroy() }
  } finally { await rm(tempRoot, { recursive: true, force: true }) }
}, 60_000)

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
