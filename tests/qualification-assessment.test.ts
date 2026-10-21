import { expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { qualificationCoverage } from '../src/main/qualification-coverage'
import { qualificationAssessmentSchema, type QualificationAssessmentEvidence } from '../src/shared/qualification-coverage'
import type { DraftRevision } from '../src/shared/draft'
import type { PostingAnalysis } from '../src/shared/posting-analysis'

function fixture() {
  const educationId = randomUUID(), projectId = randomUUID(), skillId = randomUUID()
  const evidence: QualificationAssessmentEvidence[] = [
    { evidenceId: educationId, revision: 1, snapshot: { title: 'BS', field: 'Data Science', description: '' } },
    { evidenceId: projectId, revision: 1, snapshot: { name: 'Image classifier', description: 'Built and evaluated a machine learning model.' } },
    { evidenceId: skillId, revision: 1, snapshot: { name: 'Python', category: 'Technical' } },
  ]
  const analysis = { required: ["Bachelor's degree in Computer Science, Data Science, or related field", 'Machine learning experience', 'Machine learning model deployment in production', 'Leadership', 'Python'], preferred: [], tools: [], responsibilities: [], keywords: [] } as PostingAnalysis
  const draft = {
    evidence: [evidence[1]],
    suggestedSkills: [{ id: randomUUID(), name: 'Python', postingTerm: 'Python', sourceJobRevision: 1, status: 'pending' }],
    content: { education: [], experience: [], projects: [{ text: 'Built an image classifier using a machine learning model.', citations: [{ evidenceId: projectId, revision: 1 }] }], skills: [], certificates: [] },
  } as unknown as DraftRevision
  return { evidence, analysis, draft, educationId, projectId, skillId }
}

test('assesses compound degree and ML qualifications from full profile evidence without claiming draft coverage', () => {
  const { evidence, analysis, draft, educationId, projectId } = fixture()
  const result = qualificationCoverage(randomUUID(), analysis, draft, evidence)
  const assessments = result.assessments
  expect(assessments).toEqual(expect.arrayContaining([
    expect.objectContaining({ qualification: "Bachelor's degree in Computer Science, Data Science, or related field", status: 'supported', inDraft: false, evidence: [{ evidenceId: educationId, revision: 1 }] }),
    expect.objectContaining({ qualification: 'Machine learning experience', status: 'supported', inDraft: true, evidence: [{ evidenceId: projectId, revision: 1 }] }),
    expect.objectContaining({ qualification: 'Machine learning model deployment in production', status: 'partial', inDraft: true, matchedConcepts: ['machine learning'], remainingConcepts: expect.arrayContaining(['production']) }),
    expect.objectContaining({ qualification: 'Leadership', status: 'unknown', inDraft: false, matchedConcepts: [], remainingConcepts: ['Leadership'] }),
  ]))
  expect(qualificationAssessmentSchema.array().parse(assessments)).toHaveLength(5)
  expect(result.gaps.map(item => item.qualification)).toContain('Leadership')
})

test.each(['B.Sc. in Computer Science (Data Science)', 'BS in Data Science', 'B.S. in Computer Science', 'BSc Data Science'])('supports an OR-listed degree field from one education record: %s', title => {
  const id = randomUUID()
  const analysis = { required: ['Bachelor’s degree in Computer Science, Engineering, Artificial Intelligence, Data Science, or a related field'], preferred: [], tools: [], responsibilities: [], keywords: [] } as PostingAnalysis
  const draft = { evidence: [], content: { education: [], experience: [], projects: [], skills: [], certificates: [] } } as unknown as DraftRevision
  const result = qualificationCoverage(randomUUID(), analysis, draft, [{ evidenceId: id, revision: 1, snapshot: { section: 'education', title } }])
  expect(result.assessments?.[0]).toMatchObject({ status: 'supported', inDraft: false, evidence: [{ evidenceId: id, revision: 1 }] })
})

test('does not combine a biology degree with a separate computer-science skill to satisfy one education requirement', () => {
  const degreeId = randomUUID(), skillId = randomUUID()
  const analysis = { required: ['Bachelor’s degree in Computer Science, Engineering, Artificial Intelligence, Data Science, or a related field'], preferred: [], tools: [], responsibilities: [], keywords: [] } as PostingAnalysis
  const draft = { evidence: [], content: { education: [], experience: [], projects: [], skills: [], certificates: [] } } as unknown as DraftRevision
  const result = qualificationCoverage(randomUUID(), analysis, draft, [
    { evidenceId: degreeId, revision: 1, snapshot: { section: 'education', title: 'Bachelor of Biology' } },
    { evidenceId: skillId, revision: 1, snapshot: { name: 'Computer Science', category: 'Technical' } },
  ])
  expect(result.assessments?.[0]).toMatchObject({ status: 'not-evidenced', evidence: [], inDraft: false })
})

test('marks future education and ML research evidence partial for production and years requirements', () => {
  const educationId = randomUUID(), projectId = randomUUID()
  const analysis = { required: ['Bachelor’s degree in Computer Science or Data Science', 'Machine learning deployment in production with 3–6 years experience'], preferred: [], tools: [], responsibilities: [], keywords: [] } as PostingAnalysis
  const draft = { evidence: [], content: { education: [], experience: [], projects: [], skills: [], certificates: [] } } as unknown as DraftRevision
  const result = qualificationCoverage(randomUUID(), analysis, draft, [
    { evidenceId: educationId, revision: 1, snapshot: { section: 'education', title: 'B.Sc. Computer Science', startDate: '2025', endDate: '2090' } },
    { evidenceId: projectId, revision: 1, snapshot: { name: 'ML research', description: 'Built a machine learning research model.' } },
  ])
  expect(result.assessments?.[0]).toMatchObject({ status: 'partial', remainingConcepts: expect.arrayContaining(['degree completion']) })
  expect(result.assessments?.[1]).toMatchObject({ status: 'partial', matchedConcepts: ['machine learning'], remainingConcepts: expect.arrayContaining(['production', 'deployment', '3–6 years experience']) })
})

test('a superseded source revision cannot satisfy current profile assessment', () => {
  const id = randomUUID()
  const analysis = { required: ['Machine learning'], preferred: [], tools: [], responsibilities: [], keywords: [] } as PostingAnalysis
  const draft = { evidence: [{ evidenceId: id, revision: 1, snapshot: { name: 'ML research', description: 'Machine learning project' } }], content: { education: [], experience: [], projects: [], skills: [{ name: 'ML', citations: [{ evidenceId: id, revision: 1 }] }], certificates: [] } } as unknown as DraftRevision
  const result = qualificationCoverage(randomUUID(), analysis, draft, [{ evidenceId: id, revision: 2, snapshot: { name: 'Python', category: 'Technical' } }])
  expect(result.assessments?.[0]).toMatchObject({ status: 'not-evidenced', evidence: [], inDraft: false })
})

test('uses explicitly manual cited evidence and ignores uncited suggested skills', () => {
  const { analysis, draft } = fixture()
  draft.evidence = draft.evidence.map(source => ({ ...source, provenance: 'manual' }))
  const result = qualificationCoverage(randomUUID(), analysis, draft, [])
  const assessments = result.assessments ?? []
  expect(assessments.find(item => item.qualification === 'Machine learning experience')).toMatchObject({ status: 'supported', inDraft: true })
  expect(assessments.find(item => item.qualification.startsWith("Bachelor's"))).toMatchObject({ status: 'not-evidenced', inDraft: false })
  expect(assessments.find(item => item.qualification === 'Python')).toMatchObject({ status: 'unknown', evidence: [], inDraft: false })
})
