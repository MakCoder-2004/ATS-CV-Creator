const assert = require('node:assert/strict')
const { existsSync, mkdtempSync } = require('node:fs')
const { rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron: electron } = require('@playwright/test')

const executable = resolve(process.argv[2] || '')
const reference = process.argv[3] || 'openai-codex/gpt-6-luna'
const effort = process.argv[4] || 'low'
const expected = process.argv[5] || 'stop'
const noAuth = process.argv.includes('--no-auth')
const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-sdk-proof-'))

async function main() {
  assert(existsSync(executable), 'Use a genuinely installed executable.')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  if (noAuth) for (const key of Object.keys(env)) if (/^(OPENAI|CODEX|PI)_.*(KEY|TOKEN|AUTH)$/.test(key)) delete env[key]
  const app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${userData}`, '--disable-gpu'], env, timeout: 60000 })
  try {
    const page = await app.firstWindow()
    await page.locator('[data-ui-ready="true"]').waitFor({ timeout: 30000 })
    const result = await app.evaluate(async ({ app }, input) => {
      const path = process.getBuiltinModule('node:path')
      const appRequire = process.getBuiltinModule('node:module').createRequire(path.join(app.getAppPath(), 'package.json'))
      const pi = appRequire(path.join(app.getAppPath(), 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'))
      const ai = appRequire(path.join(app.getAppPath(), 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'index.js'))
      const runtime = await pi.ModelRuntime.create({ refreshOnCreate: false, ...(input.noAuth ? { authPath: path.join(app.getPath('userData'), 'absent-auth.json'), modelsPath: null } : {}) })
      const options = runtime.getProviders().map(item => item.id).filter(provider => input.reference.startsWith(`${provider}/`))
        .map(provider => ({ provider, id: input.reference.slice(provider.length + 1) }))
        .filter(({ provider, id }) => runtime.getPhysicalModel(provider, id))
      if (options.length !== 1) return { status: 'invalid-model', matches: options.length, providerRegistered: runtime.getProviders().some(item => item.id === 'openai-codex'), modelCount: runtime.getModels('openai-codex').length, agentDirectory: pi.getAgentDir() }
      const { provider, id } = options[0]
      const model = runtime.getPhysicalModel(provider, id)
      const levels = ai.getSupportedThinkingLevels(model)
      if (!levels.includes(input.effort)) return { status: 'unsupported-effort', provider, id, levels }
      const available = await runtime.getAvailable(provider)
      if (!available.some(item => item.id === id)) return { status: 'missing-local-auth', provider, id }
      if (!await runtime.getAuth(model)) return { status: 'missing-local-auth', provider, id }
      const signal = new AbortController().signal
      const response = await runtime.completeSimple(model, {
        systemPrompt: 'Answer the harmless user request with only the required word. Do not call tools.',
        messages: [{ role: 'user', content: 'Reply with exactly PI_SDK_OK.', timestamp: Date.now() }],
        tools: []
      }, { reasoning: input.effort, maxTokens: 128, maxRetries: 0, signal })
      const text = response.content.filter(block => block.type === 'text').map(block => block.text).join('').trim()
      return { status: response.stopReason, provider: response.provider, model: response.model, responseModel: response.responseModel || null, textMatches: text === 'PI_SDK_OK', textLength: text.length, toolCalls: response.content.filter(block => block.type === 'toolCall').length, requestedEffort: input.effort }
    }, { reference, effort, noAuth })
    console.log(JSON.stringify(result))
    assert.equal(result.status, expected)
    if (expected === 'stop') assert.deepEqual({ textMatches: result.textMatches, toolCalls: result.toolCalls }, { textMatches: true, toolCalls: 0 })
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
