import { test, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { runSourceLinkedGraph } from '../src/main/source-linked-generation'
import { listDraftRecords } from '../src/shared/draft-records'

test('a CV paragraph citing a selected child retains frozen parent metadata for record editing', async () => {
  const parent = randomUUID(), child = randomUUID()
  const snapshot = { id: parent, revision: 3, kind: 'training', title: 'ML trainee', organization: 'Example Lab', description: 'Trained models.', factualItems: [{ id: child, revision: 2, text: 'Evaluated machine learning models.' }] }
  const items = [
    { id: parent, revision: 3, category: 'experience' as const, parentId: parent, snapshot, text: 'Trained models.' },
    { id: child, revision: 2, category: 'experience' as const, parentId: parent, snapshot: snapshot.factualItems[0], text: 'Evaluated machine learning models.' }
  ]
  const result = await runSourceLinkedGraph({ job: { title: 'Engineer' }, analysis: { tools: [], keywords: [] }, items,
    identity: { id: randomUUID(), jobId: randomUUID(), revision: 1, createdAt: new Date().toISOString(), lockedFields: { fullName: 'Candidate', experience: [{ evidenceId: parent, sourceIds: [parent, child], title: 'ML trainee', organization: 'Example Lab' }], education: [], projects: [], certificates: [] } },
    call: async prompt => ({ attempts: 1, value: prompt.startsWith('Score these numbered') ? { relevance: [{ index: 0, score: 0, rationale: 'Child is more specific.' }, { index: 1, score: 1, rationale: 'Specific evidence.' }] } : { education: [], experience: [{ text: 'Evaluated machine learning models.', evidence: [1], rationale: 'Source fact.' }], projects: [], skills: [] } })
  })
  expect(result.draft.content.experience[0].citations).toEqual([{ evidenceId: child, revision: 2 }])
  expect(result.draft.evidence).toContainEqual({ evidenceId: parent, revision: 3, snapshot })
  expect(listDraftRecords(result.draft)[0]).toMatchObject({ sourceId: parent, sourceRevision: 3, value: { kind: 'training', title: 'ML trainee', organization: 'Example Lab', description: 'Evaluated machine learning models.' } })
})
