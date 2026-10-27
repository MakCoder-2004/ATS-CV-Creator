import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Api, Model } from '@earendil-works/pi-ai'
import { createWorkbench } from '../src/main/workbench'
import type { PiModelRuntime } from '../src/main/pi-model'
import { freezePiModelSelection } from '../src/shared/pi-model'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const model = {
  id: 'author/chat/model', name: 'Offline fixture', api: 'synthetic' as Api, provider: 'provider/with/slash',
  baseUrl: 'https://example.invalid', input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  reasoning: false, contextWindow: 8192, maxTokens: 1024,
} as Model<Api>

function runtime(options: { listed?: boolean; available?: boolean; auth?: boolean } = {}): PiModelRuntime {
  return {
    getProviders: () => options.listed === false ? [] : [{ id: model.provider, getModels: () => [model] }],
    getPhysicalModel: (providerId: string, modelId: string) => providerId === model.provider && modelId === model.id ? model : undefined,
    getAvailable: async () => options.available === false ? [] : [model],
    getAuth: async () => options.auth === false ? undefined : ({ source: 'synthetic' }),
  } as unknown as PiModelRuntime
}

function open(piRuntime: PiModelRuntime) {
  const directory = mkdtempSync(join(tmpdir(), 'cv-pi-settings-'))
  directories.push(directory)
  return { directory, workbench: createWorkbench(directory, undefined, undefined, undefined, piRuntime) }
}

test('stores exact slash-containing Pi selection and reloads it from SQLite', async () => {
  const fixture = open(runtime())
  const selection = freezePiModelSelection(model.provider, model.id, 'off')
  expect((await fixture.workbench.api.getSettings()).pi).toBeNull()
  const saved = await fixture.workbench.api.setPiModel({ reference: `${selection.providerId}/${selection.modelId}`, thinkingLevel: selection.thinkingLevel })
  expect(saved.pi).toEqual(selection)
  fixture.workbench.close()
  const reopened = createWorkbench(fixture.directory, undefined, undefined, undefined, runtime())
  expect((await reopened.api.getSettings()).pi).toEqual(selection)
  reopened.close()
})

test('rejects unlisted models, missing auth, and unsupported effort without changing the saved choice', async () => {
  const fixture = open(runtime())
  const prior = freezePiModelSelection(model.provider, model.id, 'off')
  const priorInput = { reference: `${prior.providerId}/${prior.modelId}`, thinkingLevel: prior.thinkingLevel }
  await fixture.workbench.api.setPiModel(priorInput)
  await expect(fixture.workbench.api.setPiModel({ reference: `${model.provider}/unknown/model`, thinkingLevel: 'off' })).rejects.toThrow(/model/i)
  const unauthenticated = createWorkbench(fixture.directory, undefined, undefined, undefined, runtime({ auth: false }))
  try { await expect(unauthenticated.api.setPiModel(priorInput)).rejects.toThrow(/sign-in/i) }
  finally { unauthenticated.close() }
  await expect(fixture.workbench.api.setPiModel({ ...priorInput, thinkingLevel: 'low' })).rejects.toThrow(/does not support/)
  expect((await fixture.workbench.api.getSettings()).pi).toEqual(prior)
  fixture.workbench.close()
})
