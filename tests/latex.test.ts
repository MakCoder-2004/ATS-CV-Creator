import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { canonicalDocumentSchema, canonicalDocumentTextParts, createCanonicalDocument, removeRepeatedEntryHeading } from '../src/shared/document'
import { escapeLatex, renderLatexSections } from '../src/shared/latex'

const document = canonicalDocumentSchema.parse({ version: 1, draftId: '11111111-1111-4111-8111-111111111111', jobId: '22222222-2222-4222-8222-222222222222', revision: 1, targetPages: 1, identity: { name: 'Candidate', phone: '+1 555', email: 'name@example.test', contact: ['+1 555', 'name@example.test'], links: [{ label: 'GitHub', url: 'https://github.com/example' }], headline: 'OLD_HEADLINE', summary: 'OLD_SUMMARY' }, sections: [{ name: 'Experience', entries: [{ id: 'experience-0', heading: 'Software Engineer', organization: 'Example & Co', dates: 'Jan 2025 – Present', text: 'Built reliable APIs.', bullets: ['Built reliable APIs.'], links: [] }] }, { name: 'Skills', entries: [{ id: 'skills-0', heading: 'Python', skillGroup: 'Languages', text: '', links: [] }, { id: 'skills-1', heading: 'React', skillGroup: 'Technologies', text: '', links: [] }] }, { name: 'Certificates', entries: [{ id: 'certificates-0', heading: 'OLD_CERTIFICATE', text: '', links: [] }] }], style: { fontFamily: 'Lato', bodyPt: 11, pageSize: 'Letter', background: '#ffffff' } })

test('fixed template preserves its Letter Lato pdfLaTeX layout and exact includes', () => {
  const source = readFileSync('resources/cv-template/resume.tex', 'utf8')
  expect(source).toContain('\\documentclass[letterpaper,11pt]{article}')
  expect(source).toContain('\\usepackage[default]{lato}')
  expect(source).toContain('\\pdfgentounicode=1')
  expect(source).toContain('\\input{glyphtounicode}')
  expect(source).not.toMatch(/summary|certificates|headline/i)
  expect(Object.keys(renderLatexSections(document))).toEqual(['heading.tex', 'education.tex', 'experience.tex', 'projects.tex', 'skills.tex'])
})
test('template sections render employer once before locked role and use short content-only bullets', () => {
  const files = renderLatexSections(document)
  expect(files['experience.tex']).toContain('{Example \\& Co}{Jan 2025 – Present}\n    {Software Engineer}{}')
  expect(files['experience.tex']).toContain('\\resumeItem{Built reliable APIs.}')
  expect(files['experience.tex'].match(/Software Engineer/g)).toHaveLength(1)
  expect(files['skills.tex']).toContain('\\textbf{Languages}{: Python}')
  expect(files['skills.tex']).toContain('\\textbf{Technologies}{: React}')
  expect(files['heading.tex']).toContain('\\seticon{faPhone}')
  expect(files['heading.tex']).toContain('mailto:name@example.test')
  const output = Object.values(files).join('\n')
  expect(output).not.toMatch(/OLD_|Professional summary|Certificates/)
  expect(files['education.tex']).toBe('')
  expect(files['projects.tex']).toBe('')
})
test('explicit paragraph descriptions compile as prose and legacy descriptions remain bullet items', () => {
  const paragraph = { ...document, sections: [{ ...document.sections[0], entries: [{ ...document.sections[0].entries[0], text: 'Contributed to reliable services with supported deployment practices.', descriptionFormat: 'paragraph' as const }] }] }
  const tex = renderLatexSections(paragraph)['experience.tex']
  expect(tex).toContain('\\small{Contributed to reliable services with supported deployment practices.}\\par')
  expect(tex).not.toContain('\\resumeItem{Contributed')
  expect(renderLatexSections(document)['experience.tex']).toContain('\\resumeItem{Built reliable APIs.}')
})
test('frozen legacy role and project canonical JSON keeps its released hash', () => {
  const legacy = canonicalDocumentSchema.parse({ ...document, sections: [
    { name: 'Experience', entries: [{ id: 'experience-0', heading: 'Engineer', organization: 'Example Co', dates: 'Jan 2020 – Present', text: 'Built reliable services.', bullets: ['Built reliable services.'], links: [] }] },
    { name: 'Projects', entries: [{ id: 'projects-0', heading: 'Compiler', text: 'Added diagnostics.', bullets: ['Added diagnostics.'], technologies: ['Rust'], links: [] }] }
  ] })
  expect(legacy.sections.flatMap(section => section.entries).every(entry => !('descriptionFormat' in entry))).toBe(true)
  expect(createHash('sha256').update(JSON.stringify(legacy)).digest('hex')).toBe('df2f99c2991874ddd952d660114f910e128c341cf875668d26a81a3104869006')
})
test('mixed-format grouped items keep paragraph and legacy bullet siblings independent', () => {
  const mixed = { ...document, sections: [{ ...document.sections[0], entries: [{ ...document.sections[0].entries[0], text: 'First bullet.\\nLater paragraph.', bullets: ['First bullet.', 'Later paragraph.'], reviewItems: [
    { id: 'old-item', text: 'First bullet.', bullets: ['First bullet.'] },
    { id: 'new-item', text: 'Later paragraph.', bullets: ['Later paragraph.'], descriptionFormat: 'paragraph' as const }
  ] }] }] }
  const latex = renderLatexSections(mixed)['experience.tex']
  expect(latex).toContain('\\resumeItem{First bullet.}')
  expect(latex).toContain('\\small{Later paragraph.}\\par')
  expect(latex).not.toContain('\\resumeItem{Later paragraph.}')
})
test('all user and model content is escaped once, not accepted as executable TeX', () => {
  expect(escapeLatex('\\input{secret} 50% & C# $ _ ~ ^')).toBe('\\textbackslash{}input\\{secret\\} 50\\% \\& C\\# \\$ \\_ \\textasciitilde{} \\textasciicircum{}')
  const files = renderLatexSections({ ...document, identity: { ...document.identity, name: '\\write18{calc.exe}' } })
  expect(files['heading.tex']).not.toContain('\\write18{')
  expect(files['heading.tex']).toContain('\\textbackslash{}write18\\{calc.exe\\}')
  expect(() => renderLatexSections({ ...document, identity: { ...document.identity, links: [{ label: 'bad', url: 'https://example.test/{\\input}' }] } })).toThrow(/safely compiled/)
})
test('canonical reading order follows the literal template and ignores legacy narrative/certificates', () => {
  expect(canonicalDocumentTextParts(document)).toEqual(['Candidate', '+1 555', 'name@example.test', 'GitHub', 'Experience', 'Example & Co', 'Jan 2025 – Present', 'Software Engineer', 'Built reliable APIs.', 'Technical Skills', 'Languages:', 'Python', 'Technologies:', 'React'])
})
test('exact metadata prefixes are removed without removing legitimate accomplishments', () => {
  expect(removeRepeatedEntryHeading('Software Engineer — Example Co (Remote) | Built reliable APIs.', 'Software Engineer', 'Example Co')).toBe('Built reliable APIs.')
  expect(removeRepeatedEntryHeading('Software Engineer\n• Built APIs.\n• Led software engineer mentoring.', 'Software Engineer')).toBe('Built APIs.\nLed software engineer mentoring.')
  expect(removeRepeatedEntryHeading('Software Engineer tooling improved deployment.', 'Software Engineer')).toBe('Software Engineer tooling improved deployment.')
})
test('new canonical CV omits old narrative and certificates without modifying stored source data', () => {
  const citation = { evidenceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 1 }
  const draft = { id: document.draftId, jobId: document.jobId, revision: 1, pageTarget: 1, lockedFields: { fullName: 'Candidate', experience: [{ evidenceId: citation.evidenceId, title: 'Software Engineer', organization: 'Example Co', startDate: '2025-12' }], education: [], projects: [], certificates: [] }, content: { education: [], experience: [{ text: 'Software Engineer — Example Co (Remote) | Built reliable APIs.', citations: [citation], rationale: 'Relevant' }], projects: [], skills: [], certificates: [{ text: 'Certificate', citations: [citation], rationale: 'Legacy' }] }, tailoring: { headline: 'Legacy headline', summary: { text: 'Legacy summary', citations: [citation], rationale: 'Legacy' } } }
  const profile = { contact: null, education: [], certificates: [], skills: [], summary: [], languages: [], extras: [] }
  const before = JSON.stringify({ draft, profile })
  const canonical = createCanonicalDocument(draft as never, profile, { experience: [], projects: [] })
  expect(canonical.identity).not.toHaveProperty('summary')
  expect(canonical.identity).not.toHaveProperty('headline')
  expect(canonical.sections.map(section => section.name)).toEqual(['Experience'])
  expect(canonical.sections[0].entries[0].text).toBe('Built reliable APIs.')
  expect(canonical.style).toMatchObject({ fontFamily: 'Lato', pageSize: 'Letter' })
  expect(JSON.stringify({ draft, profile })).toBe(before)
})
