import { test, expect, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
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
      CV_TAILOR_TEST_KEY_CLIPBOARD: '1',
      CV_TAILOR_SCRIPTED_ANALYSIS: '1',
      CV_TAILOR_SCRIPTED_PI_MODEL: '1'
    }
  }
}

async function assertIsolatedPaths(app: Awaited<ReturnType<typeof electron.launch>>, storage: ReturnType<typeof isolatedStorage>) {
  // Main-process Electron paths, not renderer assumptions: fail BEFORE saving a key.
  const paths = await app.evaluate(({ app }) => ({ appData: app.getPath('appData'), userData: app.getPath('userData') }))
  expect(realpathSync.native(paths.appData)).toBe(realpathSync.native(storage.appData))
  expect(realpathSync.native(paths.userData)).toBe(realpathSync.native(storage.userData))
}

test('Settings keeps Pi preferences and retired-search recovery controls', async () => {
  test.setTimeout(90000)
  const storage = isolatedStorage('cv-tailor-pi-settings-')
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: storage.env, timeout: 20000 })
    await assertIsolatedPaths(app, storage)
    const page = await app.firstWindow({ timeout: 20000 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Settings' }).click()
    const modelCard = page.getByRole('region', { name: 'Pi preferences' }).getByRole('region', { name: 'Pi model' })
    await expect(modelCard.getByLabel('Provider/model reference')).toHaveValue('')
    await expect(modelCard.getByLabel('Thinking level')).toContainText('medium')
    await expect(page.getByText(/sign in through Pi outside CV Tailor/i)).toBeVisible()
    await expect(page.getByLabel('API key', { exact: true })).toHaveCount(0)
    const card = page.getByRole('region', { name: 'Search retired' })
    await expect(card).toBeVisible()
    await expect(card.getByText('No Tavily key is saved on this device.')).toBeVisible()
    await expect(card.getByLabel('Existing encrypted Tavily key')).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Save Tavily key' })).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Replace' })).toHaveCount(0)
    await expect(card.getByText('No credential is sent to search')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Analysis request budgets' })).toHaveCount(0)
    await expect(page.locator('.settings-grid > .settings-block')).toHaveCount(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
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
