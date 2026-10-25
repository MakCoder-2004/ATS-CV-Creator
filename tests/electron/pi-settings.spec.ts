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
      CV_TAILOR_TEST_APP_DATA_DIR: appData
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
    await expect(modelCard.getByText('Sign in through Pi outside CV Tailor. There is no Pi key here.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Provider sign-in' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Optional faithfulness review' })).toHaveCount(0)
    await expect(page.getByRole('switch')).toHaveCount(0)

    await tavilyKey.fill('tvly-settings-focus-test-key')
    await page.getByRole('button', { name: 'Save Tavily key' }).click()
    const removeKey = page.getByRole('button', { name: 'Remove local key' })
    await expect(removeKey).toBeVisible()
    const ciphertextPath = join(storage.appData, 'CV Tailor Search Credentials', 'tavily-key.dpapi')
    expect(existsSync(ciphertextPath)).toBe(true)
    const ciphertext = readFileSync(ciphertextPath)
    expect(ciphertext.length).toBeGreaterThan(0)
    expect(ciphertext.includes(Buffer.from('tvly-settings-focus-test-key'))).toBe(false)
    // The main-process appData assertion gates Save; this proves the isolated write.
    expect(realpathSync.native(ciphertextPath)).toBe(realpathSync.native(join(storage.root, 'appdata', 'CV Tailor Search Credentials', 'tavily-key.dpapi')))
    expect(existsSync(join(storage.userData, 'CV Tailor Search Credentials', 'tavily-key.dpapi'))).toBe(false)
    await tavilyKey.fill('tvly-next-key-keep-this')
    await removeKey.click()
    const cancelRemoval = page.getByRole('button', { name: 'Cancel', exact: true })
    await expect(cancelRemoval).toBeFocused()
    await expect(tavilyKey).toHaveValue('tvly-next-key-keep-this')
    await cancelRemoval.click()
    await expect(removeKey).toBeFocused()
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
