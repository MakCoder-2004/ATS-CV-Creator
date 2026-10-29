import { expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createWorkbench } from '../src/main/workbench'

test('empty career facts refuse CV generation clearly before scoring or tailoring', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-empty-profile-'))
  const prompts: string[] = []
  const workspace = createWorkbench(directory, undefined, { generate: async ({ prompt }) => {
    prompts.push(prompt)
    if (prompt.startsWith('Extract only explicit')) return JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) return JSON.stringify({ relevance: [] })
    throw new Error('No empty-profile tailoring request should occur')
  } })
  try {
    const job = await workspace.api.saveJob({ title: 'Engineer', company: 'Example Co', description: 'Build dependable services.' })
    if (!job.ok) throw new Error(job.error.message)
    const preview = await workspace.api.prepareOutboundConsent(job.value.id, 'cv+cover-letter')
    if (!preview.ok) throw new Error(preview.message)
    expect((await workspace.api.acceptOutboundConsent(preview.token, true, true)).ok).toBe(true)
    expect((await workspace.api.startAnalysis(preview.token)).status).toBe('complete')
    const result = await workspace.api.generateRequestedDocuments(preview.token, 1)
    expect(result.cv).toMatchObject({ ok: false, message: expect.stringMatching(/profile.*no.*career facts/i) })
    expect(prompts).toHaveLength(1)
    expect(await workspace.api.getDraft(job.value.id)).toBeNull()
    expect(await workspace.api.getGenerationRecovery(job.value.id)).toBeNull()
  } finally { workspace.close(); rmSync(directory, { recursive: true, force: true }) }
})
