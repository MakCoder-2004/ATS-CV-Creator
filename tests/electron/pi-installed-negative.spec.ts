import { expect, test, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PiModelPreferenceInput } from '../../src/shared/pi-model'

const executablePath = process.env.CV_TAILOR_INSTALLED_EXE
const modelReference = process.env.CV_TAILOR_PI_LIVE_MODEL
const effort = process.env.CV_TAILOR_PI_LIVE_EFFORT
test.skip(!executablePath || !modelReference || !effort, 'Explicit installed executable and Pi model selection required')

function isolatedPiEnvironment(piDir: string) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(name)))
  return { ...inherited, PI_CODING_AGENT_DIR: piDir, PI_OFFLINE: '1' }
}

test('installed Pi rejects unsupported effort before saving a selection or dispatching', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-pi-negative-effort-'))
  const userData = join(root, 'user-data'), piDir = join(root, 'empty-pi')
  mkdirSync(userData); mkdirSync(piDir)
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ executablePath: executablePath!, args: [`--user-data-dir=${userData}`], env: isolatedPiEnvironment(piDir), timeout: 30_000 })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    const outcome = await page.evaluate(async () => {
      try { await window.workbench.setPiModel({ reference: 'azure/gpt-4', thinkingLevel: 'high' }); return { saved: true, message: '' } }
      catch (error) { return { saved: false, message: error instanceof Error ? error.message : String(error) } }
    })
    expect(outcome.saved).toBe(false)
    expect(outcome.message).toMatch(/does not support that thinking level/i)
    expect((await page.evaluate(() => window.workbench.getSettings())).pi).toBeNull()
  } finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})

test('installed Pi keeps a selected model but makes zero requests when sign-in is absent', async () => {
  test.setTimeout(130_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-pi-negative-auth-'))
  const userData = join(root, 'user-data'), piDir = join(root, 'empty-pi')
  mkdirSync(userData); mkdirSync(piDir)
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const launch = (env?: Record<string, string>) => electron.launch({ executablePath: executablePath!, args: [`--user-data-dir=${userData}`], ...(env ? { env } : {}), timeout: 30_000 })
    app = await launch()
    let page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    await page.evaluate(selection => window.workbench.setPiModel(selection), { reference: modelReference!, thinkingLevel: effort as PiModelPreferenceInput['thinkingLevel'] })
    await app.close(); app = undefined

    app = await launch(isolatedPiEnvironment(piDir))
    page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    const selection = (await page.evaluate(() => window.workbench.getSettings())).pi
    expect(`${selection?.providerId}/${selection?.modelId}`).toBe(modelReference)
    expect(selection?.thinkingLevel).toBe(effort)
    const availability = await app.evaluate(async ({ app }, requested) => {
      const path = process.getBuiltinModule('node:path')
      const requireApp = process.getBuiltinModule('node:module').createRequire(path.join(app.getAppPath(), 'package.json'))
      const { ModelRuntime } = requireApp(path.join(app.getAppPath(), 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'))
      const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false })
      const slash = requested.indexOf('/')
      const provider = requested.slice(0, slash), model = requested.slice(slash + 1)
      return { registered: Boolean(runtime.getPhysicalModel(provider, model)), available: (await runtime.getAvailable(provider)).length }
    }, modelReference!)
    expect(availability).toEqual({ registered: true, available: 0 })

    const jobId = await page.evaluate(async () => {
      const contact = await window.workbench.saveContact({ fullName: 'Isolated Test', email: 'isolated@example.test' })
      const skill = await window.workbench.saveSkill({ name: 'TypeScript', category: 'Programming' })
      const job = await window.workbench.saveJob({ title: 'Synthetic Engineer', company: 'Imaginary Company', description: 'TypeScript service maintenance required.' })
      if (!contact.ok || !skill.ok || !job.ok) throw new Error('Could not seed isolated synthetic records.')
      return job.value.id
    })
    const preview = await page.evaluate(id => window.workbench.prepareOutboundConsent(id), jobId)
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const consent = await page.evaluate(token => window.workbench.acceptOutboundConsent(token, true, true), preview.token)
    expect(consent.ok).toBe(true)
    const analysis = await page.evaluate(token => window.workbench.startAnalysis(token), preview.token)
    expect(analysis.status).toBe('failed')
    expect(analysis.attempts).toBe(0)
    expect(analysis.progress).toMatch(/model or authentication is unavailable|no .* authentication/i)
    expect((await page.evaluate(id => window.workbench.getAnalysis(id), jobId))?.attempts).toBe(0)
  } finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})
