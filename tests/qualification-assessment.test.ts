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

test('uses draft-local cited evidence when no full profile evidence is supplied and ignores uncited suggested skills', () => {
  const { analysis, draft } = fixture()
  const result = qualificationCoverage(randomUUID(), analysis, draft, [])
  const assessments = result.assessments ?? []
  expect(assessments.find(item => item.qualification === 'Machine learning experience')).toMatchObject({ status: 'supported', inDraft: true })
  expect(assessments.find(item => item.qualification.startsWith("Bachelor's"))).toMatchObject({ status: 'not-evidenced', inDraft: false })
  expect(assessments.find(item => item.qualification === 'Python')).toMatchObject({ status: 'unknown', evidence: [], inDraft: false })
})
