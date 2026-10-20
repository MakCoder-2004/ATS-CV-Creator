import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { SqliteCheckpointSaver } from '../src/main/sqlite-checkpoint'
import { runSourceLinkedGraph } from '../src/main/source-linked-generation'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))

describe('SQLite LangGraph checkpoints', () => {
  it('reopens after interruption without replaying the last confirmed graph node', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-checkpoint-'))
    directories.push(directory)
    const path = join(directory, 'workbench.sqlite')
    let database = new Database(path)
    let scores = 0, tailorCalls = 0
    const base = {
      job: { title: 'Engineer' }, analysis: { required: [], preferred: [], tools: [], responsibilities: [], keywords: [] },
      items: [{ id: randomUUID(), revision: 1, category: 'experience' as const, snapshot: { text: 'Built backend services.' }, text: 'Built backend services.' }],
      identity: { id: randomUUID(), jobId: randomUUID(), revision: 1, createdAt: new Date(0).toISOString(), lockedFields: { fullName: 'Candidate', experience: [], education: [], projects: [], certificates: [] } },
      threadId: randomUUID()
    }
    try {
      await runSourceLinkedGraph({ ...base, checkpointer: new SqliteCheckpointSaver(database), call: async (prompt: string) => {
        if (prompt.startsWith('Score these')) { scores++; return { value: { relevance: [{ index: 0, score: 1, rationale: 'Relevant.' }] }, attempts: 1 } }
        tailorCalls++
        throw new Error('simulated interruption while tailoring')
      } })
      throw new Error('expected simulated interruption')
    } catch (error) { expect(String(error)).toContain('simulated interruption') }
    expect(scores).toBe(1)
    database.close()

    database = new Database(path)
    try {
      const reopened = await runSourceLinkedGraph({ ...base, resume: true, checkpointer: new SqliteCheckpointSaver(database), call: async (prompt: string) => {
        if (prompt.startsWith('Score these')) { scores++; throw new Error('confirmed scoring step replayed') }
        tailorCalls++
        return { value: { education: [], experience: [{ text: 'Built backend services.', evidence: [0], rationale: 'Relevant.' }], projects: [], skills: [], certificates: [] }, attempts: 1 }
      } })
      expect(reopened.draft.content.experience).toHaveLength(1)
      expect(scores).toBe(1)
      expect(tailorCalls).toBe(2)
    } finally { database.close() }
  })
})
