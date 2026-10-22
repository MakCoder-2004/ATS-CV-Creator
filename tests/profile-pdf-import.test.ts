import { expect, test } from 'vitest'
import { mapProfilePdfPages } from '../src/shared/profile-pdf-import'

test('automatically organizes marker-led PDF facts into profile-shaped, source-backed proposals', () => {
  const result = mapProfilePdfPages([{ page: 1, text: [
    'NAME: Ada Example', 'EMAIL: ada@example.test', 'HEADLINE: Software engineer',
    'SKILLS: Python, SQL', 'CONTACT LINK: Portfolio | https://example.test', 'EXPERIENCE: Example Labs | Engineer | 2020-01 – 2022-03', 'FACT: Built a data pipeline', 'UNKNOWN: Community mentor'
  ].join('\n') }])
  expect(result.contact).toMatchObject({ fullName: 'Ada Example', email: 'ada@example.test', headline: 'Software engineer' })
  expect(result.contact?.links).toEqual([{ label: 'Portfolio', url: 'https://example.test' }])
  expect(result.skills).toMatchObject([{ name: 'Python', category: 'Technical' }, { name: 'SQL', category: 'Technical' }])
  expect(result.experience).toMatchObject([{ organization: 'Example Labs', title: 'Engineer', startDate: '2020-01', endDate: '2022-03', factualItems: [{ text: 'Built a data pipeline' }] }])
  expect(result.sources).toContainEqual(expect.objectContaining({ page: 1, field: 'experience.factualItem', passage: 'FACT: Built a data pipeline', proposalRef: 'experience:0:fact:0' }))
  expect(result.unmapped).toContainEqual({ page: 1, text: 'UNKNOWN: Community mentor' })
})

test('maps a conventional contact header without requiring explicit labels', () => {
  const result = mapProfilePdfPages([{ page: 1, text: 'Ada Example | Software engineer | ada@example.test | +1 555 0100' }])
  expect(result.contact).toMatchObject({ fullName: 'Ada Example', headline: 'Software engineer', email: 'ada@example.test', phone: '+1 555 0100' })
  expect(result.sources.map(source => source.field)).toEqual(['contact.fullName', 'contact.email', 'contact.headline', 'contact.phone'])
})

test('maps programming languages, tools, and concepts into their distinct profile skill categories', () => {
  const result = mapProfilePdfPages([{ page: 3, text: ['PROGRAMMING LANGUAGES: Python, Java', 'TOOLS: React, Git', 'CONCEPTS: Distributed systems', 'SKILLS: Git'].join('\n') }])
  expect(result.skills).toMatchObject([{ name: 'Python', category: 'Languages' }, { name: 'Java', category: 'Languages' }, { name: 'React', category: 'Tools' }, { name: 'Git', category: 'Tools' }, { name: 'Distributed systems', category: 'Domain' }, { name: 'Git', category: 'Technical' }])
})

test('associates recognizable contact and current-project hyperlinks without losing their targets', () => {
  const result = mapProfilePdfPages([{ page: 1, text: [
    'NAME: Ada Example', 'EMAIL: ada@example.test', 'PROJECT: Atlas | React',
    'Repository', 'Project description that explicitly names the Atlas repository.',
  ].join('\n'), links: [
    { label: 'LinkedIn', url: 'https://www.linkedin.com/in/ada-example' },
    { label: 'Repository', url: 'https://github.com/ada/atlas' },
    { label: 'Mystery', url: 'https://example.test/unknown' },
  ] }])
  expect(result.contact?.links).toEqual([{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/ada-example' }])
  expect(result.projects[0]?.links).toEqual([{ label: 'Repository', url: 'https://github.com/ada/atlas' }])
  expect(result.unmapped).toContainEqual({ page: 1, text: 'Unassigned PDF hyperlink: Mystery — https://example.test/unknown' })
  expect(result.sources).toContainEqual(expect.objectContaining({ field: 'contact.links', passage: expect.stringContaining('https://www.linkedin.com/in/ada-example') }))
  expect(result.sources).toContainEqual(expect.objectContaining({ field: 'projects.links', passage: expect.stringContaining('https://github.com/ada/atlas') }))
})

test('maps ordinary section headings and common unlabeled role, project, and skill patterns conservatively', () => {
  const result = mapProfilePdfPages([{ page: 1, text: [
    'Work Experience', 'Software Engineer — Example Labs | 2021 – 2023', '• Built the internal reporting service',
    'Projects', 'Atlas — React, SQLite', '• Added offline support',
    'Technical Skills', 'TypeScript, SQL', 'Other section', 'Volunteer mentor',
  ].join('\n') }])
  expect(result.experience).toMatchObject([{ title: 'Software Engineer', organization: 'Example Labs', startDate: '2021', endDate: '2023', factualItems: [{ text: '• Built the internal reporting service' }] }])
  expect(result.projects).toMatchObject([{ name: 'Atlas', technologies: [{ text: 'React' }, { text: 'SQLite' }], factualItems: [{ text: 'Added offline support' }] }])
  expect(result.skills).toMatchObject([{ name: 'TypeScript' }, { name: 'SQL' }])
  expect(result.unmapped).toContainEqual({ page: 1, text: 'Volunteer mentor' })
})

test('maps a section-based CV with stacked work, education, project, and certificate records', () => {
  const pages = [{ page: 1, text: [
    'Ada Example', 'Machine Learning Engineer', '0123456789 | ada@example.test | Egypt',
    'Education', '• BSc Computer Science 2020 – 2024', 'Example University, Egypt CGPA: 3.8',
    'Experience', '• Machine Learning Engineer Remote', 'Example Labs June 2022 – Present',
    'Built a recommendation service for customer support.',
    '• Data Science Trainee Online', 'Sample Institute Jan – Apr 2021', 'Completed a hands-on machine learning program.',
    'Projects', '', '• Transit Insights GitHub', 'Built a route-planning dashboard with live transit data.',
    'Skills', 'ML Engineering: Machine Learning, Deep Learning, Feature', 'Engineering, Model Evaluation',
    'Languages: Python, SQL',
    'Certificates', '• Applied ML Certificate – Example Institute View Certificate'
  ].join('\n'), links: [
    { label: 'GitHub', url: 'https://github.com/ada/transit-insights', lineIndex: 14 },
    { label: 'LinkedIn', url: 'https://www.linkedin.com/in/ada-example' },
    { label: 'Certificate', url: 'https://example.test/certificate', lineIndex: 21 },
    { label: 'Unrelated site', url: 'https://example.test/unrelated' }
  ] }]
  const result = mapProfilePdfPages(pages)
  expect(result.contact).toMatchObject({ fullName: 'Ada Example', headline: 'Machine Learning Engineer', email: 'ada@example.test', phone: '0123456789', location: 'Egypt' })
  expect(result.contact?.links).toEqual([{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/ada-example' }])
  expect(result.entries).toContainEqual(expect.objectContaining({ section: 'education', title: 'BSc Computer Science', institution: 'Example University, Egypt', startDate: '2020', endDate: '2024', description: 'CGPA: 3.8' }))
  expect(result.entries).toContainEqual(expect.objectContaining({ section: 'certificates', title: 'Applied ML Certificate', issuer: 'Example Institute', link: 'https://example.test/certificate' }))
  expect(result.experience).toMatchObject([
    { title: 'Machine Learning Engineer', organization: 'Example Labs', kind: 'unresolved', startDate: 'June 2022', endDate: 'Present', factualItems: [{ text: 'Built a recommendation service for customer support.' }] },
    { title: 'Data Science Trainee', organization: 'Sample Institute', kind: 'unresolved', startDate: 'Jan 2021', endDate: 'Apr 2021', factualItems: [{ text: 'Completed a hands-on machine learning program.' }] }
  ])
  expect(result.projects).toMatchObject([{ name: 'Transit Insights', factualItems: [{ text: 'Built a route-planning dashboard with live transit data.' }] }])
  expect(result.skills.map(skill => skill.name)).toEqual(expect.arrayContaining(['Machine Learning', 'Deep Learning', 'Feature Engineering', 'Model Evaluation', 'Python', 'SQL']))
  expect(result.skills.map(skill => skill.name)).not.toEqual(expect.arrayContaining(['Feature', 'Engineering']))
  expect(result.unmapped).toEqual([{ page: 1, text: 'Unassigned PDF hyperlink: Unrelated site — https://example.test/unrelated' }])
})

test('keeps a role header pending across a PDF page break until its organization and date follow', () => {
  const result = mapProfilePdfPages([
    { page: 1, text: ['Ada Example', 'Machine Learning Engineer', 'ada@example.test', 'Education', 'BSc Computer Science 2020 - 2024', 'Example University', 'Experience', '• Data Engineer Remote'].join('\n') },
    { page: 2, text: ['Example Labs'].join('\n') },
    { page: 3, text: ['June 2020 - Present', 'Built a data pipeline for internal teams.', '• Product Engineer', 'Contoso Systems', 'Jan 2018 - Dec 2019', 'Designed offline collaboration tools.', 'Projects', 'Transit Dashboard — Python, React', 'Added real-time route updates.', 'Skills', 'Languages: Python, SQL', 'Certificates', '• Cloud Fundamentals — Sample Institute'].join('\n') }
  ])
  expect(result.experience).toMatchObject([
    { kind: 'unresolved', title: 'Data Engineer', organization: 'Example Labs', startDate: 'June 2020', endDate: 'Present', factualItems: [{ text: 'Built a data pipeline for internal teams.' }] },
    { kind: 'unresolved', title: 'Product Engineer', organization: 'Contoso Systems', startDate: 'Jan 2018', endDate: 'Dec 2019', factualItems: [{ text: 'Designed offline collaboration tools.' }] }
  ])
  expect(result.projects).toMatchObject([{ name: 'Transit Dashboard', technologies: [{ text: 'Python' }, { text: 'React' }], factualItems: [{ text: 'Added real-time route updates.' }] }])
  expect(result.unmapped).toEqual([])
})

test('maps spoken languages separately from programming skills and preserves source date precision', () => {
  const exactEducation = 'EDUCATION: BSc Computer Science | Example University | 2020-09-14 – 2024-06-20 | GPA 3.7'
  const result = mapProfilePdfPages([{ page: 2, text: ['SPOKEN LANGUAGES: Arabic, English', 'TECHNICAL SKILLS: Python', exactEducation, 'PROJECT: Atlas | Python, Flask', 'PROJECT LINK: Repository | https://example.test/atlas', 'FACT: Built a recommendation service'].join('\n') }])
  expect(result.skills).toMatchObject([{ name: 'Python', category: 'Technical' }])
  expect(result.entries).toContainEqual(expect.objectContaining({ section: 'languages', title: 'Arabic' }))
  expect(result.entries).toContainEqual(expect.objectContaining({ section: 'languages', title: 'English' }))
  expect(result.entries).toContainEqual(expect.objectContaining({ section: 'education', title: 'BSc Computer Science', institution: 'Example University', description: 'GPA 3.7' }))
  expect(result.unmapped).toContainEqual({ page: 2, text: `Date precision needs review: ${exactEducation}` })
  expect(result.projects).toMatchObject([{ name: 'Atlas', technologies: [{ text: 'Python' }, { text: 'Flask' }], links: [{ label: 'Repository', url: 'https://example.test/atlas' }], factualItems: [{ text: 'Built a recommendation service' }] }])
})
