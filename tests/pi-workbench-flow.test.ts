import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Api, Model } from '@earendil-works/pi-ai'
import { createWorkbench } from '../src/main/workbench'
import type { PiModelRuntime } from '../src/main/pi-model'

const directories: string[] = []
const workbenches: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => {
  for (const workbench of workbenches.splice(0)) workbench.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const model = {
  id: 'author/chat', provider: 'sample', name: 'Synthetic chat', api: 'openai-completions' as Api,
  baseUrl: 'https://example.invalid', input: ['text'], reasoning: true, contextWindow: 16384, maxTokens: 8192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
} as Model<Api>
const output = JSON.stringify({ required: ['TypeScript'], preferred: [], tools: [], responsibilities: ['Build systems'], keywords: ['TypeScript'] })

function workspace(authorized = true, answer: (prompt: string) => string = () => output) {
  const directory = mkdtempSync(join(tmpdir(), 'pi-workbench-flow-'))
  directories.push(directory)
  const completeSimple = vi.fn(async (_model: unknown, context: { messages: Array<{ content: string }> }) => ({ role: 'assistant', provider: model.provider, model: model.id, stopReason: 'stop', content: [{ type: 'text', text: answer(context.messages.at(-1)!.content) }], usage: { output: 28 } }))
  const runtime = {
    getProviders: () => [{ id: model.provider, getModels: () => [model] }],
    getPhysicalModel: (providerId: string, modelId: string) => providerId === model.provider && modelId === model.id ? model : undefined,
    getAvailable: async () => authorized ? [model] : [],
    getAuth: async () => authorized ? { source: 'synthetic' } : undefined,
    completeSimple
  } as unknown as PiModelRuntime
  const workbench = createWorkbench(directory, undefined, undefined, undefined, undefined, runtime)
  workbenches.push(workbench)
  return { workbench, completeSimple }
}

test('Pi posting analysis and cache retain fresh run authorization and effort scope', async () => {
  const { workbench, completeSimple } = workspace()
  expect((await workbench.api.getSettings()).pi).toBeNull()
  await workbench.api.setPiModel({ reference: 'sample/author/chat', thinkingLevel: 'low' })
  const saved = await workbench.api.saveJob({ title: 'Engineer', company: 'Example', description: 'TypeScript required.' })
  if (!saved.ok) throw new Error('Could not create the synthetic posting.')
  const preview = await workbench.api.prepareOutboundConsent(saved.value.id)
  if (!preview.ok) throw new Error(preview.message)
  expect(preview.outgoing.model).toMatchObject({ providerId: 'sample', name: 'author/chat', thinkingLevel: 'low' })
  expect(await workbench.api.acceptOutboundConsent(preview.token, true, true)).toMatchObject({ ok: true })
  expect(await workbench.api.startAnalysis(preview.token)).toMatchObject({ status: 'complete', cacheHit: false, analysis: { required: ['TypeScript'] } })
  expect(completeSimple).toHaveBeenCalledTimes(1)
  const next = await workbench.api.prepareOutboundConsent(saved.value.id)
  if (!next.ok) throw new Error(next.message)
  expect(await workbench.api.acceptOutboundConsent(next.token, true, true)).toMatchObject({ ok: true })
  expect(await workbench.api.generateDraft(next.token)).toMatchObject({ ok: false, message: expect.stringMatching(/analysis.*this run/i) })
  expect(await workbench.api.startAnalysis(next.token)).toMatchObject({ status: 'complete', cacheHit: true })
  expect(completeSimple).toHaveBeenCalledTimes(1)
  const stale = await workbench.api.prepareOutboundConsent(saved.value.id)
  if (!stale.ok) throw new Error(stale.message)
  expect(await workbench.api.acceptOutboundConsent(stale.token, true, true)).toMatchObject({ ok: true })
  await workbench.api.setPiModel({ reference: 'sample/author/chat', thinkingLevel: 'high' })
  await expect(workbench.api.startAnalysis(stale.token)).rejects.toThrow(/authorize/i)
  expect(await workbench.api.getAnalysis(saved.value.id)).toMatchObject({ status: 'stale' })
  expect(completeSimple).toHaveBeenCalledTimes(1)
  const fresh = await workbench.api.prepareOutboundConsent(saved.value.id)
  if (!fresh.ok) throw new Error(fresh.message)
  expect(fresh.outgoing.model).toMatchObject({ thinkingLevel: 'high' })
}, 15_000)

test('Pi wording keeps evidence citations and saved career facts in a reviewable draft', async () => {
  const response = (prompt: string) => {
    if (prompt.includes('Extract only explicit qualifications')) return output
    if (prompt.startsWith('Score these numbered')) {
      const { items } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ relevance: items.map((item: { index: number }) => ({ index: item.index, score: 0.9, rationale: 'Saved evidence.' })) })
    }
    if (prompt.startsWith('Factual repair cycle')) return JSON.stringify({ corrections: [] })
    if (prompt.startsWith('Propose conservative replacement wording')) {
      const { sourcesByItem } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ items: sourcesByItem.map(() => ({ text: 'Built reliable services with TypeScript.', rationale: 'Supported by the selected source.' })) })
    }
    if (prompt.startsWith('Compare all rewritten/source pairs')) {
      const { pairs } = JSON.parse(prompt.slice(prompt.indexOf('{')))
      return JSON.stringify({ results: pairs.map((pair: { itemPath: string }) => ({ itemPath: pair.itemPath, supported: true, explanation: 'Grounded in saved evidence.' })) })
    }
    const { selected } = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const paragraphs = (category: string) => selected.filter((item: { category: string }) => item.category === category).map((item: { index: number; text: string }) => ({ text: item.text, evidence: [item.index], rationale: 'Saved evidence.' }))
    return JSON.stringify({ education: paragraphs('education'), experience: paragraphs('experience'), projects: paragraphs('projects'), skills: selected.filter((item: { category: string }) => item.category === 'skills').map((item: { index: number; text: string }) => ({ name: JSON.parse(item.text).name, evidence: [item.index], rationale: 'Saved skill.' })) })
  }
  const { workbench, completeSimple } = workspace(true, response)
  await workbench.api.setPiModel({ reference: 'sample/author/chat', thinkingLevel: 'low' })
  expect((await workbench.api.saveContact({ fullName: 'Synthetic Candidate' })).ok).toBe(true)
  const savedSkill = await workbench.api.saveSkill({ name: 'TypeScript', category: 'Programming' })
  const savedRole = await workbench.api.saveExperience({ kind: 'employment', title: 'Developer', organization: 'Synthetic Company', description: 'Built reliable services with TypeScript.', startDate: '2021', endDate: '2023' })
  if (!savedSkill.ok || !savedRole.ok) throw new Error('Could not create the synthetic profile.')
  const job = await workbench.api.saveJob({ title: 'Engineer', company: 'Example', description: 'TypeScript services required.' })
  if (!job.ok) throw new Error('Could not create the synthetic job.')
  await workbench.api.setFaithfulnessCheck(true)
  const preview = await workbench.api.prepareOutboundConsent(job.value.id)
  if (!preview.ok) throw new Error(preview.message)
  expect(await workbench.api.acceptOutboundConsent(preview.token, true, true)).toMatchObject({ ok: true })
  expect(await workbench.api.startAnalysis(preview.token)).toMatchObject({ status: 'complete' })
  const result = await workbench.api.generateDraft(preview.token)
  expect(result).toMatchObject({ ok: true, draft: { approved: false, lockedFields: { fullName: 'Synthetic Candidate', experience: [expect.objectContaining({ title: 'Developer', organization: 'Synthetic Company' })] } } })
  expect(result.draft?.content.experience[0].citations[0].evidenceId).toBe(savedRole.value.experience[0].id)
  expect(completeSimple).toHaveBeenCalledTimes(4)
  const next = await workbench.api.prepareOutboundConsent(job.value.id)
  if (!next.ok) throw new Error(next.message)
  const acceptedNext = await workbench.api.acceptOutboundConsent(next.token, true, true)
  if (!acceptedNext.ok) throw new Error(acceptedNext.message)
  const proposed = await workbench.api.regenerateDraft(next.token, { kind: 'section', section: 'experience' })
  expect(proposed).toMatchObject({ ok: true, proposal: { status: 'pending' } })
  expect(await workbench.api.getAnalysis(job.value.id)).toMatchObject({ status: 'complete', cacheHit: true, runId: acceptedNext.runId })
  expect(completeSimple).toHaveBeenCalledTimes(5)
})

test('a missing local Pi login never dispatches posting text', async () => {
  const { workbench, completeSimple } = workspace(false)
  await expect(workbench.api.setPiModel({ reference: 'sample/author/chat', thinkingLevel: 'low' })).rejects.toThrow(/sign-in|Sign in/i)
  expect(completeSimple).not.toHaveBeenCalled()
})
