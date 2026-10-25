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
    await expect(page.locator('.settings-grid > .settings-block')).toHaveCount(2)

    await tavilyKey.fill('tvly-settings-focus-test-key')
    await page.getByRole('button', { name: 'Save Tavily key' }).click()
    const card = page.getByRole('region', { name: 'Tavily search key' })
    const savedKey = card.getByLabel('Tavily API key', { exact: true })
    await expect(card.locator('input')).toHaveCount(1)
    await expect(savedKey).toHaveAttribute('readonly', '')
    await expect(savedKey).toHaveAttribute('type', 'password')
    await expect(savedKey).not.toHaveValue('tvly-settings-focus-test-key')
    await card.getByRole('button', { name: 'Replace', exact: true }).click()
    await expect(savedKey).toBeFocused()
    await expect(savedKey).toHaveValue('')
    await savedKey.fill('tvly-cancelled-replacement')
    await card.getByRole('button', { name: 'Show typed key' }).click()
    await expect(savedKey).toHaveAttribute('type', 'text')
    await card.getByRole('button', { name: 'Cancel replacement' }).click()
    await expect(card.getByRole('button', { name: 'Replace', exact: true })).toBeFocused()
    await expect(savedKey).toHaveAttribute('readonly', '')
    await expect(savedKey).toHaveAttribute('type', 'password')
    await card.getByRole('button', { name: 'Replace', exact: true }).click()
    await savedKey.fill('tvly-next-key-keep-this')
    await expect(card.getByRole('button', { name: 'Copy' })).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Revoke locally' })).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Reveal' })).toHaveCount(0)
    const status = await page.evaluate(() => window.workbench.getResearchSearchKeyStatus())
    expect(status.configured).toBe(true)
    expect(JSON.stringify(status).includes('tvly-settings-focus-test-key')).toBe(false)
    expect(JSON.stringify(await page.evaluate(() => window.workbench.getSettings())).includes('tvly-settings-focus-test-key')).toBe(false)
    await card.getByRole('button', { name: 'Save replacement key' }).click()
    await expect(savedKey).toHaveAttribute('readonly', '')
    await expect(savedKey).toHaveAttribute('type', 'password')
    await expect(card.getByRole('button', { name: 'Replace', exact: true })).toBeFocused()
    await card.getByRole('button', { name: 'Reveal' }).click()
    expect(await savedKey.evaluate(input => (input as HTMLInputElement).value === 'tvly-next-key-keep-this')).toBe(true)
    expect(await savedKey.evaluate(input => (input as HTMLInputElement).value === 'tvly-settings-focus-test-key')).toBe(false)
    await card.getByRole('button', { name: 'Hide' }).click()
    await expect(savedKey).toHaveAttribute('type', 'password')
    expect(await savedKey.evaluate(input => (input as HTMLInputElement).value === 'tvly-next-key-keep-this')).toBe(false)

    const modelReference = page.getByLabel('Provider/model reference')
    await modelReference.fill('scripted/cv-tailor-fixture')
    await card.getByRole('button', { name: 'Reveal' }).click()
    await expect(savedKey).toHaveAttribute('type', 'text')
    await modelReference.fill('scripted/cv-tailor-fixture-v2')
    await expect(savedKey).toHaveAttribute('type', 'password')
    expect(await savedKey.evaluate(input => (input as HTMLInputElement).value)).not.toBe('tvly-settings-focus-test-key')

    await modelReference.fill('scripted/cv-tailor-fixture')
    await card.getByRole('button', { name: 'Reveal' }).click()
    await expect(savedKey).toHaveAttribute('type', 'text')
    const thinkingLevel = page.getByLabel('Thinking level')
    await thinkingLevel.click()
    await page.getByRole('option', { name: 'low', exact: true }).click()
    await expect(savedKey).toHaveAttribute('type', 'password')
    await modelCard.getByRole('button', { name: 'Save Pi model' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Pi model preference saved.' })).toBeVisible()
    await card.getByRole('button', { name: 'Replace', exact: true }).click()
    await savedKey.fill('tvly-unsaved-draft-remains')
    await modelReference.fill('scripted/cv-tailor-fixture-v3')
    await expect(savedKey).toHaveValue('tvly-unsaved-draft-remains')
    await card.getByRole('button', { name: 'Cancel replacement' }).click()
    await card.getByRole('button', { name: 'Copy' }).click()
    await expect(card.getByRole('status').filter({ hasText: 'Search key copied.' })).toBeVisible()
    expect(await app.evaluate(({ app }) => (app as typeof app & { __testKeyClipboardWrites: number }).__testKeyClipboardWrites)).toBe(1)
    await card.getByRole('button', { name: 'Reveal' }).click()
    await page.getByRole('button', { name: 'Saved jobs' }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(savedKey).toHaveAttribute('type', 'password')
    expect(await savedKey.evaluate(input => (input as HTMLInputElement).value === 'tvly-next-key-keep-this')).toBe(false)
    const removeKey = card.getByRole('button', { name: 'Revoke locally' })
    await expect(removeKey).toBeVisible()
    const ciphertextPath = join(storage.appData, 'CV Tailor Search Credentials', 'tavily-key.dpapi')
    expect(existsSync(ciphertextPath)).toBe(true)
    const ciphertext = readFileSync(ciphertextPath)
    expect(ciphertext.length).toBeGreaterThan(0)
    expect(ciphertext.includes(Buffer.from('tvly-next-key-keep-this'))).toBe(false)
    // The main-process appData assertion gates Save; this proves the isolated write.
    expect(realpathSync.native(ciphertextPath)).toBe(realpathSync.native(join(storage.root, 'appdata', 'CV Tailor Search Credentials', 'tavily-key.dpapi')))
    expect(existsSync(join(storage.userData, 'CV Tailor Search Credentials', 'tavily-key.dpapi'))).toBe(false)
    await removeKey.click()
    const cancelRemoval = card.getByRole('button', { name: 'Cancel', exact: true })
    await expect(cancelRemoval).toBeFocused()
    await cancelRemoval.click()
    await expect(removeKey).toBeFocused()
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 950 })
      for (const mode of ['light', 'dark'] as const) {
        await page.getByRole('button', { name: `Use ${mode} mode` }).filter({ visible: true }).click()
        await expect(page.locator('html')).toHaveAttribute('data-appearance', mode)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        const modelBounds = await modelCard.boundingBox()
        const keyBounds = await card.boundingBox()
        expect(modelBounds).not.toBeNull()
        expect(keyBounds).not.toBeNull()
        if (width === 1440) {
          expect(Math.abs(modelBounds!.y - keyBounds!.y)).toBeLessThan(2)
          expect(keyBounds!.x).toBeGreaterThan(modelBounds!.x + modelBounds!.width - 2)
        } else {
          expect(keyBounds!.y).toBeGreaterThan(modelBounds!.y + modelBounds!.height - 2)
        }
        if (width === 1440 && mode === 'light') await page.screenshot({ path: 'docs/validation/artifacts/settings-single-key/settings-masked-light-1440.png', fullPage: true })
        if (width === 375 && mode === 'dark') await page.screenshot({ path: 'docs/validation/artifacts/settings-single-key/settings-masked-dark-375.png', fullPage: true })
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
