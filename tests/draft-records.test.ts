import { expect, test } from 'vitest'
import { listDraftRecords, mutateDraftRecordInputSchema } from '../src/shared/draft-records'
import type { DraftRevision } from '../src/shared/draft'

const uuid = '00000000-0000-4000-8000-000000000001'

test('record mutation contract requires an explicit revision and target for updates/removes', () => {
  const base = { jobId: uuid, draftId: uuid, sourceRevision: 1, section: 'skills', scope: 'cv-only' }
  expect(mutateDraftRecordInputSchema.safeParse({ ...base, operation: 'update', value: { name: 'TypeScript', category: 'Technologies' } }).success).toBe(false)
  expect(mutateDraftRecordInputSchema.safeParse({ ...base, operation: 'remove', index: 0 }).success).toBe(true)
  expect(mutateDraftRecordInputSchema.safeParse({ ...base, operation: 'add', value: { name: 'TypeScript', category: 'Technologies' } }).success).toBe(true)
})

test('record list resolves editable values only from frozen evidence snapshots', () => {
  const draft = {
    id: uuid, jobId: uuid, revision: 1,
    evidence: [{ evidenceId: uuid, revision: 1, provenance: 'manual', snapshot: { name: 'Prototype', description: 'Built a thing', technologies: [{ id: uuid, revision: 1, text: 'TypeScript' }], factualItems: [], links: [] } }],
    content: { education: [], experience: [], projects: [{ text: 'Built a thing', citations: [{ evidenceId: uuid, revision: 1 }], rationale: 'manual' }], skills: [], certificates: [] }
  } as unknown as DraftRevision
  expect(listDraftRecords(draft)).toEqual([{ section: 'projects', index: 0, sourceId: uuid, sourceRevision: 1, value: { name: 'Prototype', description: 'Built a thing', factualItems: [], technologies: [{ text: 'TypeScript' }], links: [] } }])
})
