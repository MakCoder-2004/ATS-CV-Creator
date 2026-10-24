const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync } = require('node:fs')
const { rm } = require('node:fs/promises')
const { createServer } = require('node:http')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron: electron } = require('@playwright/test')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-pi-cancel-'))
  let requests = 0
  let outbound
  const server = createServer((request, response) => {
    requests++
    assert.equal(request.url, '/v1/chat/completions')
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      outbound = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"id":"proof","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n')
    })
  })
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const port = server.address().port
  const modelsPath = join(directory, 'models.json')
  writeFileSync(modelsPath, JSON.stringify({ providers: { 'proof/custom': { baseUrl: `http://127.0.0.1:${port}/v1`, api: 'openai-completions', apiKey: 'synthetic', models: [{ id: 'author/chat', contextWindow: 16384, maxTokens: 128 }] } } }))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  let app
  try {
    app = await electron.launch({ executablePath: resolve(process.argv[2]), args: [`--user-data-dir=${directory}`, '--disable-gpu'], env, timeout: 60000 })
    const page = await app.firstWindow()
    await page.locator('[data-ui-ready="true"]').waitFor({ timeout: 30000 })
    const result = await app.evaluate(async ({ app }, config) => {
      const path = process.getBuiltinModule('node:path')
      const appRequire = process.getBuiltinModule('node:module').createRequire(path.join(app.getAppPath(), 'package.json'))
      const { ModelRuntime } = appRequire(path.join(app.getAppPath(), 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'))
      const runtime = await ModelRuntime.create({ authPath: path.join(config.directory, 'empty-auth.json'), modelsPath: config.modelsPath, refreshOnCreate: false })
      const model = runtime.getModel('proof/custom', 'author/chat')
      if (!model) return { status: 'missing-model' }
      const abort = new AbortController()
      const request = runtime.completeSimple(model, { messages: [{ role: 'user', content: 'Reply with one word.', timestamp: Date.now() }], tools: [] }, { reasoning: 'off', maxTokens: 32, maxRetries: 0, signal: abort.signal })
      setTimeout(() => abort.abort(), 1500)
      const response = await request
      return { status: response.stopReason, model: response.model, provider: response.provider, configuredMaxTokens: model.maxTokens, configuredContextWindow: model.contextWindow, toolCalls: response.content.filter(item => item.type === 'toolCall').length }
    }, { directory, modelsPath })
    console.log(JSON.stringify({ ...result, requests, outboundModel: outbound?.model, fields: Object.keys(outbound || {}), maxTokens: outbound?.max_tokens, maxCompletionTokens: outbound?.max_completion_tokens, toolDeclarations: outbound?.tools?.length ?? 0 }))
    assert.equal(outbound?.model, 'author/chat')
    assert.equal(outbound?.max_completion_tokens, 32)
    assert.equal(outbound?.tools, undefined)
    assert.equal(result.status, 'aborted')
    assert.equal(result.provider, 'proof/custom')
    assert.equal(result.model, 'author/chat')
    assert.equal(requests, 1)
  } finally {
    await app?.close().catch(() => {})
    server.closeAllConnections()
    server.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
