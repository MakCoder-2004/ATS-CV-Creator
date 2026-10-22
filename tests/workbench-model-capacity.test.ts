import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'
import { defaultOpenRouterModel } from '../src/shared/openrouter-settings'

const directories: string[] = []
const workbenches: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => {
  for (const workbench of workbenches.splice(0)) workbench.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-model-capacity-'))
  directories.push(directory)
  return directory
}

test('real SQLite consent and capacity path rejects unknown and oversized requests, while allowing the complete frozen payload when bounded', async () => {
  const model = defaultOpenRouterModel
  const plans = [
    null,
    { context: 8_000, output: 4_096, provider: 'provider-small' },
    { context: 100_000, output: 4_096, provider: 'provider-large' }
  ] as const
  let currentPlan: (typeof plans)[number] = null
  let modelLookup = 0
  const metadataFetch = async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/endpoints')) {
      if (!currentPlan) return new Response('{"data":{"id":"unknown","endpoints":[]}}', { status: 200 })
      return new Response(JSON.stringify({ data: { id: model, endpoints: [{ context_length: currentPlan.context, max_completion_tokens: currentPlan.output, tag: currentPlan.provider }] } }), { status: 200 })
    }
    currentPlan = plans[modelLookup++] ?? null
    return new Response(JSON.stringify({ data: currentPlan ? [{ id: model, context_length: currentPlan.context, architecture: { tokenizer: 'GPT' }, top_provider: { context_length: currentPlan.context, max_completion_tokens: currentPlan.output } }] : [] }), { status: 200 })
  }
  const modelPrompts: string[] = []
  const transport = { async generate({ prompt }: { prompt: string }) {
    modelPrompts.push(prompt)
    return JSON.stringify({ required: [], preferred: [], tools: [], responsibilities: [], keywords: [] })
  } }
  const workbench = createWorkbench(fixture(), undefined, transport, { modelCatalogFetcher: metadataFetch as typeof fetch })
  workbenches.push(workbench)
  await workbench.api.saveSkill({ name: 'PROFILE_CAPACITY_CANARY', category: 'Technical' })

  const run = async (description: string) => {
    const saved = await workbench.api.saveJob({ title: 'Capacity test role', company: 'Example', description })
    if (!saved.ok) throw new Error(saved.error.message)
    const preview = await workbench.api.prepareOutboundConsent(saved.value.id)
    if (!preview.ok) throw new Error(preview.message)
    await workbench.api.acceptOutboundConsent(preview.token, true, true)
    return { job: saved.value, analysis: await workbench.api.startAnalysis(preview.token) }
  }

  const unknownText = 'Unknown-metadata posting. '.repeat(100)
  const unknown = await run(unknownText)
  expect(unknown.analysis).toMatchObject({ status: 'failed', attempts: 0 })
  expect(modelPrompts).toHaveLength(0)
  expect((await workbench.api.openJob(unknown.job.id))?.description).toBe(unknownText)

  const oversizedText = `OVERSIZED_POSTING_CANARY ${'long requirements '.repeat(700)}`
  const oversized = await run(oversizedText)
  expect(oversized.analysis).toMatchObject({ status: 'failed', attempts: 0 })
  expect(modelPrompts).toHaveLength(0)
  expect((await workbench.api.openJob(oversized.job.id))?.description).toBe(oversizedText)

  const completeText = `FULL_POSTING_CANARY ${'complete requirements and responsibilities. '.repeat(600)}`
  const safe = await run(completeText)
  expect(safe.analysis).toMatchObject({ status: 'complete', attempts: 1 })
  expect(modelPrompts).toHaveLength(1)
  expect(modelPrompts[0]).toContain('FULL_POSTING_CANARY')
  expect(modelPrompts[0]).toContain('PROFILE_CAPACITY_CANARY')
  expect(modelPrompts[0]).toContain(completeText.slice(-80))
  expect(modelPrompts[0]).not.toContain('OVERSIZED_POSTING_CANARY')
  expect((await workbench.api.openJob(safe.job.id))?.description).toBe(completeText)
})
