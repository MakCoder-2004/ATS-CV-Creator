import { expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { diagnoseCoverLetterFailure, coverLetterFailureMessage } from '../src/main/cover-letter-failure'
import { AnalysisError } from '../src/main/posting-analysis'
import { createWorkbench } from '../src/main/workbench'

test.each([
  [new Error('The letter attributes a fact to an uncited source.'), 'uncited-fact', true],
  [new Error('The letter contains an unsupported numeric expression.'), 'unsupported-number', true],
  [new Error('The letter contains a detectably unsupported skill.'), 'unsupported-skill', true],
  [new Error('A named source is not cited.'), 'wrong-source', true],
  [new AnalysisError('MALFORMED', 'PRIVATE_PROVIDER_TEXT'), 'structured-response', true],
  [new AnalysisError('PROVIDER', 'The response exceeded the task output limit.'), 'provider-output', false],
  [new Error('PRIVATE_REJECTED_LETTER'), 'save-or-state', false],
] as const)('classifies failures without exposing rejected text: %s', (error, code, invalidResponse) => {
  expect(diagnoseCoverLetterFailure(error)).toEqual({ code, invalidResponse })
  expect(coverLetterFailureMessage(code)).not.toMatch(/PRIVATE_/)
})

test('specific letter rejection survives reopening without retaining rejected prose or changing the CV', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'letter-failure-'))
  const prompts: string[] = []
  const transport = { generate: async ({ prompt }: { prompt: string }) => {
    prompts.push(prompt)
    if (prompt.startsWith('Extract only explicit')) return JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] })
    if (prompt.startsWith('Score these numbered')) return JSON.stringify({ relevance: [{ index: 0, score: 1, rationale: 'Saved skill.' }] })
    if (prompt.startsWith('Write one cover letter')) return JSON.stringify({ paragraphs: [{ text: 'I use Python.', citations: [{ ordinal: 1 }] }] })
    return JSON.stringify({ education: [], experience: [], projects: [], skills: [{ name: 'TypeScript', evidence: [0], rationale: 'Saved skill.' }] })
  } }
  let workspace = createWorkbench(directory, undefined, transport)
  try {
    await workspace.api.saveSkill({ name: 'TypeScript', category: 'Programming' })
    const job = await workspace.api.saveJob({ title: 'Developer', company: 'Example Co', description: 'Build reliable services.' })
    if (!job.ok) throw new Error(job.error.message)
    const profile = await workspace.api.getProfile()
    const preview = await workspace.api.prepareOutboundConsent(job.value.id, 'cv+cover-letter')
    if (!preview.ok) throw new Error(preview.message)
    expect((await workspace.api.acceptOutboundConsent(preview.token, true, true)).ok).toBe(true)
    expect((await workspace.api.startAnalysis(preview.token)).status).toBe('complete')
    const result = await workspace.api.generateRequestedDocuments(preview.token)
    expect(result.cv.ok).toBe(true)
    expect(result.letter).toMatchObject({ status: 'failed', message: expect.stringContaining('technical skill') })
    const letterCalls = prompts.filter(prompt => prompt.startsWith('Write one cover letter'))
    expect(letterCalls).toHaveLength(1)
    expect(letterCalls[0]).toContain('not CV indexes')
    expect(letterCalls[0]).toContain('never exceed 400 words')
    expect(letterCalls[0]).toContain("Use 'this role' and 'your organization'")
    const savedCv = await workspace.api.getDraft(job.value.id)
    workspace.close()
    const db = new Database(join(directory, 'workbench.sqlite'), { readonly: true })
    try {
      const row = db.prepare('SELECT data FROM cover_letter_operations').get() as { data: string }
      expect(JSON.parse(row.data)).toMatchObject({ status: 'failed', failureCode: 'unsupported-skill' })
      expect(row.data).not.toContain('I use Python')
      const storedCv = db.prepare('SELECT data FROM draft_revisions').get() as { data: string }
      expect(JSON.parse(storedCv.data)).toEqual(result.cv.draft)
    } finally { db.close() }
    workspace = createWorkbench(directory, undefined, transport)
    expect((await workspace.api.getCoverLetterGenerationStatus(job.value.id)).reason).toContain('technical skill')
    expect(await workspace.api.getDraft(job.value.id)).toEqual(savedCv)
    expect(await workspace.api.getProfile()).toEqual(profile)
    expect(prompts.filter(prompt => prompt.startsWith('Write one cover letter'))).toHaveLength(1)
  } finally { workspace.close(); rmSync(directory, { recursive: true, force: true }) }
})
