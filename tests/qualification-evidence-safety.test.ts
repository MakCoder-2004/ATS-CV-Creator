import { test, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { qualificationCoverage } from '../src/main/qualification-coverage'
import type { DraftRevision } from '../src/shared/draft'
import type { PostingAnalysis } from '../src/shared/posting-analysis'

function assess(requirement: string, snapshots: unknown[], draftEvidence: DraftRevision['evidence'] = []) {
  const analysis = { required: [requirement], preferred: [], tools: [], responsibilities: [], keywords: [] } as PostingAnalysis
  const evidence = snapshots.map(snapshot => ({ evidenceId: randomUUID(), revision: 1, snapshot }))
  const draft = { evidence: draftEvidence, content: { education: [], experience: [], projects: [], skills: [], certificates: [] } } as unknown as DraftRevision
  return qualificationCoverage(randomUUID(), analysis, draft, evidence).assessments![0]
}
test('recognizes exact saved skills and related API/database/pipeline evidence without a whole-sentence match', () => {
  expect(assess('Python', [{ name: 'Python', category: 'Languages' }])).toMatchObject({ status: 'supported', inDraft: false })
  expect(assess('JavaScript', [{ title: 'Developer', description: 'Built JS services.' }])).toMatchObject({ status: 'supported', inDraft: false })
  const result = assess('Experience working with APIs, databases, data processing pipelines, and software integration', [
    { name: 'FastAPI', category: 'Technologies' },
    { name: 'PostgreSQL', category: 'Technologies' },
    { name: 'Data service', description: 'Built data processing pipelines and integrated APIs.' }
  ])
  expect(result.status).toBe('supported')
  expect(result.evidence.length).toBeGreaterThan(0)
})
test('degree field support comes from degree metadata, not unrelated description wording', () => {
  expect(assess('Bachelor’s degree in Computer Science', [{ section: 'education', title: 'Bachelor of Biology', description: 'Attended an introductory Computer Science workshop.' }]).status).not.toBe('supported')
  expect(assess('Bachelor’s degree in Computer Science and Data Science', [{ section: 'education', title: 'B.Sc. in Computer Science' }]).status).not.toBe('supported')
  expect(assess('Bachelor’s degree in Computer Science and Data Science', [{ section: 'education', title: 'B.Sc. in Computer Science and Data Science' }]).status).toBe('supported')
})
test('unrelated ML, production, and deployment records do not prove production ML deployment', () => {
  const result = assess('Machine learning deployment in production', [
    { name: 'Machine learning', category: 'Concepts' },
    { title: 'Production manager', description: 'Managed factory operations.' },
    { name: 'Static website', description: 'Deployed a personal website.' }
  ])
  expect(result.status).toBe('partial')
  expect(assess('Machine learning', [{ name: 'Learning notes', description: 'No experience with machine learning.' }]).status).not.toBe('supported')
})
test('deleted saved facts and unreferenced old manual snapshots cannot satisfy current profile requirements', () => {
  const source = { evidenceId: randomUUID(), revision: 1, snapshot: { name: 'ML', category: 'Technologies' } }
  expect(assess('Machine learning', [], [source]).evidence).toEqual([])
  expect(assess('Machine learning', [], [{ ...source, provenance: 'manual' }]).evidence).toEqual([])
})
