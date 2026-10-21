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
        return { value: { headline: 'Engineer', summary: { text: 'Engineer with backend experience.', evidence: [0], rationale: 'Selected source.' }, education: [], experience: [{ text: 'Built backend services.', evidence: [0], rationale: 'Relevant.' }], projects: [], skills: [], certificates: [] }, attempts: 1 }
      } })
      expect(reopened.draft.content.experience).toHaveLength(1)
      expect(scores).toBe(1)
      expect(tailorCalls).toBe(2)
    } finally { database.close() }
  })

  it('revalidates a completed tailor checkpoint before constructing a draft without redispatching', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-invalid-checkpoint-'))
    directories.push(directory)
    const path = join(directory, 'workbench.sqlite'), threadId = randomUUID()
    let database = new Database(path), dispatched = 0
    const ids = [randomUUID(), randomUUID()]
    const base = {
      job: { title: 'Engineer' }, analysis: {}, threadId,
      items: ids.map((id, index) => ({ id, revision: 1, category: 'experience' as const, parentId: id, snapshot: { description: `Built system ${index}.` }, text: `Built system ${index}.` })),
      identity: { id: randomUUID(), jobId: randomUUID(), revision: 1, createdAt: new Date(0).toISOString(), lockedFields: { fullName: 'Candidate', experience: ids.map((evidenceId, index) => ({ evidenceId, title: `Role ${index}`, organization: `Company ${index}` })), education: [], projects: [], certificates: [] } }
    }
    const call = async (prompt: string) => {
      dispatched++
      if (prompt.startsWith('Score these')) return { value: { relevance: ids.map((_, index) => ({ index, score: 1, rationale: 'Relevant.' })) }, attempts: 1 }
      return { value: { education: [], projects: [], skills: [], experience: ids.map((_, index) => ({ text: `Built system ${index}.`, evidence: [index], rationale: 'Relevant.' })) }, attempts: 1 }
    }
    const initial = await runSourceLinkedGraph({ ...base, checkpointer: new SqliteCheckpointSaver(database), call })
    expect(initial.draft.content.experience).toHaveLength(2)
    expect(dispatched).toBe(2)
    const row = database.prepare('SELECT checkpoint_id,checkpoint FROM langgraph_checkpoints WHERE thread_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(threadId) as { checkpoint_id: string; checkpoint: string } | undefined
    expect(row).toBeDefined()
    const checkpoint = JSON.parse(row!.checkpoint) as { channel_values: { tailored: { experience: Array<{ evidence: number[] }> } } }
    checkpoint.channel_values.tailored.experience[0].evidence = [0, 1]
    database.prepare('UPDATE langgraph_checkpoints SET checkpoint=? WHERE thread_id=? AND checkpoint_id=?').run(JSON.stringify(checkpoint), threadId, row!.checkpoint_id)
    database.close()

    database = new Database(path)
    try {
      await expect(runSourceLinkedGraph({ ...base, resume: true, checkpointer: new SqliteCheckpointSaver(database), call: async () => { dispatched++; throw new Error('must not redispatch a completed tailor node') } })).rejects.toThrow(/checkpoint.*content|checkpoint.*evidence|incompatible/i)
      expect(dispatched).toBe(2)
    } finally { database.close() }
  })
})
