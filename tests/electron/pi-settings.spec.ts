import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
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

test('Settings shows Pi preferences and no retired-search controls when no legacy key exists', async () => {
  test.setTimeout(90000)
  const storage = isolatedStorage('cv-tailor-pi-settings-')
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: storage.env, timeout: 30000 })
    await assertIsolatedPaths(app, storage)
    const page = await app.firstWindow({ timeout: 20000 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Settings' }).click()
    const modelCard = page.getByRole('region', { name: 'Pi preferences' }).getByRole('region', { name: 'Pi model' })
    await expect(modelCard.getByLabel('Provider/model reference')).toHaveValue('')
    await expect(modelCard.getByLabel('Thinking level')).toContainText('medium')
    await expect(page.getByText(/sign in through Pi outside CV Tailor/i)).toBeVisible()
    await expect(page.getByLabel('API key', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/Search retired|Tavily|search key/i)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Remove local key' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Analysis request budgets' })).toHaveCount(0)
    await expect(page.locator('.settings-grid > .settings-block')).toHaveCount(1)
    const dimensions = await modelCard.evaluate(block => ({
      grid: block.parentElement!.getBoundingClientRect().width,
      block: block.getBoundingClientRect().width
    }))
    expect(Math.abs(dimensions.grid - dimensions.block)).toBeLessThan(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  } finally {
    await app?.close().catch(() => {})
    await rm(storage.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})

test('a failed legacy-key inspection stays truthful inside the full-width Pi block', async () => {
  test.setTimeout(90000)
  const storage = isolatedStorage('cv-tailor-key-status-failure-')
  writeFileSync(join(storage.appData, 'CV Tailor Search Credentials'), 'blocks credential-directory creation')
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: storage.env, timeout: 30000 })
    await assertIsolatedPaths(app, storage)
    const page = await app.firstWindow({ timeout: 20000 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Settings' }).click()
    const piBlock = page.getByRole('region', { name: 'Pi model' })
    await expect(piBlock.getByRole('status')).toContainText('storage could not be checked')
    await expect(piBlock.getByRole('status')).toContainText('Any saved key was left unchanged')
    await expect(piBlock.getByRole('button', { name: 'Remove local key' })).toHaveCount(0)
    const dimensions = await page.locator('.settings-grid').evaluate(grid => {
      const gridRect = grid.getBoundingClientRect()
      const blockRect = grid.querySelector('.settings-block--pi')!.getBoundingClientRect()
      return { grid: gridRect.width, block: blockRect.width }
    })
    expect(Math.abs(dimensions.grid - dimensions.block)).toBeLessThan(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  } finally {
    await app?.close().catch(() => {})
    await rm(storage.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})

test('a synthetic legacy key offers confirmed local removal only and disappears after removal', async () => {
  test.setTimeout(90000)
  const storage = isolatedStorage('cv-tailor-retired-key-')
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: storage.env, timeout: 30000 })
    await assertIsolatedPaths(app, storage)
    const encrypted = await app.evaluate(({ safeStorage }) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Synthetic legacy key requires device encryption.')
      return Array.from(safeStorage.encryptString('tvly-synthetic-retired-key-never-live'))
    })
    const credentialDirectory = join(storage.appData, 'CV Tailor Search Credentials')
    mkdirSync(credentialDirectory, { recursive: true })
    const credentialFile = join(credentialDirectory, 'tavily-key.dpapi')
    writeFileSync(credentialFile, Buffer.from(encrypted))
    const page = await app.firstWindow({ timeout: 20000 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Settings' }).click()
    const cleanup = page.getByRole('region', { name: 'Remove an old local search key' })
    await expect(cleanup.getByText('An encrypted legacy key is saved on this device.')).toBeVisible()
    await expect(cleanup.getByText('This removes only the encrypted local copy. It does not revoke the key in your Tavily account.')).toBeVisible()
    await expect(cleanup.getByLabel(/key/i)).toHaveCount(0)
    await expect(cleanup.getByRole('button', { name: 'Reveal' })).toHaveCount(0)
    await expect(cleanup.getByRole('button', { name: 'Copy' })).toHaveCount(0)
    expect(JSON.stringify(await page.locator('body').innerText())).not.toContain('tvly-synthetic-retired-key-never-live')
    await cleanup.getByRole('button', { name: 'Remove local key' }).click()
    await expect(cleanup.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await cleanup.getByRole('button', { name: 'Cancel' }).click()
    await expect(cleanup.getByRole('button', { name: 'Remove local key' })).toBeFocused()
    expect(existsSync(credentialFile)).toBe(true)
    await cleanup.getByRole('button', { name: 'Remove local key' }).click()
    const heldDirectory = `${credentialDirectory}-held`
    renameSync(credentialDirectory, heldDirectory)
    writeFileSync(credentialDirectory, 'blocks directory creation to simulate a storage failure')
    await cleanup.getByRole('button', { name: 'Confirm removal' }).click()
    await expect(cleanup.getByRole('alert')).toContainText('could not be removed from this device')
    expect(existsSync(join(heldDirectory, 'tavily-key.dpapi'))).toBe(true)
    expect(JSON.stringify(await page.locator('body').innerText())).not.toContain('tvly-synthetic-retired-key-never-live')
    unlinkSync(credentialDirectory)
    renameSync(heldDirectory, credentialDirectory)
    await cleanup.getByRole('button', { name: 'Confirm removal' }).click()
    await expect(page.getByRole('region', { name: 'Remove an old local search key' })).toHaveCount(0)
    expect(existsSync(credentialFile)).toBe(false)
    expect(JSON.stringify(await page.locator('body').innerText())).not.toContain('tvly-synthetic-retired-key-never-live')
  } finally {
    await app?.close().catch(() => {})
    await rm(storage.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})

test('Settings saves a Pi model and thinking level across a real Electron reopen', async () => {
  test.setTimeout(90000)
  const storage = isolatedStorage('cv-tailor-pi-selection-')
  const launch = () => electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...storage.env, CV_TAILOR_SCRIPTED_ANALYSIS: '1', CV_TAILOR_SCRIPTED_PI_MODEL: '1' }, timeout: 30000 })
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
