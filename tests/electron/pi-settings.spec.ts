import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function isolatedStorage(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const userData = join(root, 'workspace')
  const appData = join(root, 'appdata')
  mkdirSync(userData)
  mkdirSync(appData)
  return {
    root, userData, appData,
    env: {
      ...process.env,
      APPDATA: appData,
      CV_TAILOR_TEST_STORAGE_ROOT: root,
      CV_TAILOR_TEST_USER_DATA_DIR: userData,
      CV_TAILOR_TEST_APP_DATA_DIR: appData,
      CV_TAILOR_TEST_KEY_CLIPBOARD: '1'
    }
  }
}

async function assertIsolatedPaths(app: Awaited<ReturnType<typeof electron.launch>>, storage: ReturnType<typeof isolatedStorage>) {
  // Main-process Electron paths, not renderer assumptions: fail BEFORE saving a key.
  const paths = await app.evaluate(({ app }) => ({ appData: app.getPath('appData'), userData: app.getPath('userData') }))
  expect(realpathSync.native(paths.appData)).toBe(realpathSync.native(storage.appData))
  expect(realpathSync.native(paths.userData)).toBe(realpathSync.native(storage.userData))
}

test('Settings exposes Pi model preferences without in-app credentials or analysis budgets', async () => {
  test.setTimeout(90000)
  const storage = isolatedStorage('cv-tailor-pi-settings-')
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: storage.env, timeout: 20000 })
    await assertIsolatedPaths(app, storage)
    const page = await app.firstWindow({ timeout: 20000 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    const modelCard = page.getByRole('region', { name: 'Pi preferences' }).getByRole('region', { name: 'Pi model' })
    await expect(modelCard.getByLabel('Provider/model reference')).toHaveValue('')
    await expect(modelCard.getByLabel('Thinking level')).toContainText('medium')
    await expect(page.getByText(/sign in through Pi outside CV Tailor/i)).toBeVisible()
    await expect(page.getByLabel('API key', { exact: true })).toHaveCount(0)
    const tavilyKey = page.getByLabel('Tavily API key', { exact: true })
    await expect(tavilyKey).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Analysis request budgets' })).toHaveCount(0)
    await expect(page.getByText(/never asks for or stores Pi credentials/i)).toBeVisible()

    const faithfulness = page.getByRole('switch', { name: 'Enable optional faithfulness review for newly authorized runs' })
    await expect(faithfulness).toBeVisible()
    await expect(page.getByText(/A model check is not proof/i)).toBeVisible()

    await tavilyKey.fill('tvly-settings-focus-test-key')
    await page.getByRole('button', { name: 'Save Tavily key' }).click()
    const card = page.getByRole('region', { name: 'Tavily search key' })
    const savedKey = card.getByRole('textbox', { name: 'Saved Tavily key' })
    await expect(savedKey).toHaveAttribute('type', 'password')
    await expect(savedKey).not.toHaveValue('tvly-settings-focus-test-key')
    const status = await page.evaluate(() => window.workbench.getResearchSearchKeyStatus())
    expect(status.configured).toBe(true)
    expect(JSON.stringify(status).includes('tvly-settings-focus-test-key')).toBe(false)
    expect(JSON.stringify(await page.evaluate(() => window.workbench.getSettings())).includes('tvly-settings-focus-test-key')).toBe(false)
    await card.getByRole('button', { name: 'Reveal' }).click()
    expect(await savedKey.evaluate(input => (input as HTMLInputElement).value === 'tvly-settings-focus-test-key')).toBe(true)
    await card.getByRole('button', { name: 'Hide' }).click()
    await expect(savedKey).toHaveAttribute('type', 'password')
    expect(await savedKey.evaluate(input => (input as HTMLInputElement).value === 'tvly-settings-focus-test-key')).toBe(false)
    await card.getByRole('button', { name: 'Copy' }).click()
    await expect(card.getByRole('status').filter({ hasText: 'Search key copied.' })).toBeVisible()
    expect(await app.evaluate(({ app }) => (app as typeof app & { __testKeyClipboardWrites: number }).__testKeyClipboardWrites)).toBe(1)
    await card.getByRole('button', { name: 'Reveal' }).click()
    await page.getByRole('button', { name: 'Saved jobs' }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(savedKey).toHaveAttribute('type', 'password')
    expect(await savedKey.evaluate(input => (input as HTMLInputElement).value === 'tvly-settings-focus-test-key')).toBe(false)
    const removeKey = card.getByRole('button', { name: 'Revoke locally' })
    await expect(removeKey).toBeVisible()
    const ciphertextPath = join(storage.appData, 'CV Tailor Search Credentials', 'tavily-key.dpapi')
    expect(existsSync(ciphertextPath)).toBe(true)
    const ciphertext = readFileSync(ciphertextPath)
    expect(ciphertext.length).toBeGreaterThan(0)
    expect(ciphertext.includes(Buffer.from('tvly-settings-focus-test-key'))).toBe(false)
    // The main-process appData assertion gates Save; this proves the isolated write.
    expect(realpathSync.native(ciphertextPath)).toBe(realpathSync.native(join(storage.root, 'appdata', 'CV Tailor Search Credentials', 'tavily-key.dpapi')))
    expect(existsSync(join(storage.userData, 'CV Tailor Search Credentials', 'tavily-key.dpapi'))).toBe(false)
    const replacement = card.getByLabel('New or replacement API key')
    await replacement.fill('tvly-next-key-keep-this')
    await removeKey.click()
    const cancelRemoval = card.getByRole('button', { name: 'Cancel', exact: true })
    await expect(cancelRemoval).toBeFocused()
    expect(await replacement.evaluate(input => (input as HTMLInputElement).value === 'tvly-next-key-keep-this')).toBe(true)
    await cancelRemoval.click()
    await expect(removeKey).toBeFocused()
    await replacement.fill('')
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 950 })
      for (const mode of ['light', 'dark'] as const) {
        await page.getByRole('button', { name: `Use ${mode} mode` }).filter({ visible: true }).click()
        await expect(page.locator('html')).toHaveAttribute('data-appearance', mode)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        if (width === 1440 && mode === 'light') await page.screenshot({ path: 'docs/validation/artifacts/tavily-key-card-0.6-followup/settings-masked-light-1440.png', fullPage: true })
      }
    }
    await removeKey.click()
    await expect(cancelRemoval).toBeFocused()
    await card.getByRole('button', { name: 'Remove local key' }).click()
    await expect(card.getByText('No Tavily key is saved on this device.')).toBeVisible()
    expect(existsSync(ciphertextPath)).toBe(false)
    expect(existsSync(join(storage.userData, 'research-model-requests.log'))).toBe(false)
    expect(existsSync(join(storage.userData, 'research-direct-requests.log'))).toBe(false)
  } finally {
    await app?.close().catch(() => {})
    await rm(storage.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})

test('Settings saves a Pi model and thinking level across a real Electron reopen', async () => {
  test.setTimeout(90000)
  const storage = isolatedStorage('cv-tailor-pi-selection-')
  const launch = () => electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...storage.env, CV_TAILOR_SCRIPTED_ANALYSIS: '1', CV_TAILOR_SCRIPTED_PI_MODEL: '1' }, timeout: 20000 })
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await launch()
    await assertIsolatedPaths(app, storage)
    let page = await app.firstWindow({ timeout: 20000 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Settings' }).click()
    const model = page.getByRole('region', { name: 'Pi preferences' }).getByRole('region', { name: 'Pi model' })
    await model.getByLabel('Provider/model reference').fill('scripted/cv-tailor-fixture')
    await model.getByLabel('Thinking level').click()
    await page.getByRole('option', { name: 'off', exact: true }).click()
    await model.getByRole('button', { name: 'Save Pi model' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Pi model preference saved.' })).toBeVisible()
    await app.close()
    app = await launch()
    await assertIsolatedPaths(app, storage)
    page = await app.firstWindow({ timeout: 20000 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Settings' }).click()
    const reopened = page.getByRole('region', { name: 'Pi preferences' }).getByRole('region', { name: 'Pi model' })
    await expect(reopened.getByLabel('Provider/model reference')).toHaveValue('scripted/cv-tailor-fixture')
    await expect(reopened.getByLabel('Thinking level')).toContainText('off')
    expect((await page.evaluate(() => window.workbench.getSettings())).pi).toEqual({ providerId: 'scripted', modelId: 'cv-tailor-fixture', thinkingLevel: 'off' })
  } finally {
    await app?.close().catch(() => {})
    await rm(storage.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
