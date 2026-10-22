import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Launch the built app twice, exercising the actual renderer → preload → IPC → SQLite path.
test('workbench opens and remembers a keyboard-accessible appearance choice', async () => {
  test.setTimeout(180000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-electron-'))
  const launch = () => electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
  let first: Awaited<ReturnType<typeof electron.launch>> | undefined
  let reopened: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    first = await launch()
    const firstPage = await first.firstWindow()
    await expect(firstPage.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    await expect(firstPage.getByRole('heading', { name: 'Start with the right role.' })).toBeVisible()
    await firstPage.setViewportSize({ width: 1440, height: 900 })
    const sidebar = firstPage.getByRole('complementary', { name: 'Workspace navigation' })
    const mainNav = firstPage.getByRole('navigation', { name: 'Main navigation' })
    const collapse = firstPage.getByRole('button', { name: 'Collapse sidebar' })
    await expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(Math.round((await sidebar.boundingBox())!.width)).toBe(220)
    await collapse.focus()
    await firstPage.keyboard.press('Enter')
    const expand = firstPage.getByRole('button', { name: 'Expand sidebar' })
    await expect(expand).toBeFocused()
    await expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(Math.round((await sidebar.boundingBox())!.width)).toBe(64)
    await expect(sidebar.locator('.sidebar-jobs')).toBeHidden()
    await expect(mainNav.getByRole('button', { name: 'Tailor CV' })).toHaveAttribute('aria-current', 'page')
    await mainNav.getByRole('button', { name: 'My profile' }).click()
    await expect(firstPage.getByRole('heading', { name: 'My profile' })).toBeVisible()
    await mainNav.getByRole('button', { name: 'Tailor CV' }).click()
    await firstPage.screenshot({ path: 'test-results/sidebar-collapsed-light.png' })
    await expand.click()
    await expect(firstPage.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
    await expect(sidebar.locator('.sidebar-jobs')).toBeVisible()
    await firstPage.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(firstPage.getByRole('button', { name: 'Use light mode' })).toHaveAttribute('aria-pressed', 'true')
    const bridgeMethods = await firstPage.evaluate(() => Object.keys(window.workbench))
    expect(bridgeMethods).toEqual(expect.arrayContaining(['getSettings', 'setAppearance', 'getProfile', 'listJobs']))
    expect(bridgeMethods).not.toEqual(expect.arrayContaining(['invoke', 'require', 'applyReferencePdf', 'selectReferencePdf']))
    expect(await firstPage.evaluate(() => typeof (window as Window & { require?: unknown }).require)).toBe('undefined')
    for (const [width, columns] of [[680, 4], [375, 2]]) {
      await firstPage.setViewportSize({ width, height: 700 })
      const nav = firstPage.getByRole('navigation', { name: 'Main navigation' })
      const rows = await nav.locator('button').evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().top)))
      expect(new Set(rows).size).toBe(4 / columns)
      expect(rows.slice(0, columns).every(top => top === rows[0])).toBe(true)
      await expect(firstPage.getByRole('group', { name: 'Color appearance' })).toBeVisible()
      await expect(firstPage.getByRole('button', { name: 'Expand sidebar' })).toBeHidden()
      await expect(mainNav.getByRole('button', { name: 'Tailor CV' }).locator('.sidebar-nav-label')).toBeVisible()
      expect(await firstPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
    await expect(firstPage.getByRole('button', { name: 'Use dark mode' })).toBeVisible()
    await firstPage.getByRole('button', { name: 'Use dark mode' }).focus()
    await firstPage.keyboard.press('Enter')
    await expect(firstPage.getByRole('button', { name: 'Use dark mode' })).toHaveAttribute('aria-pressed', 'true')
    await firstPage.setViewportSize({ width: 1440, height: 900 })
    expect(Math.round((await sidebar.boundingBox())!.width)).toBe(64)
    await firstPage.screenshot({ path: 'test-results/sidebar-collapsed-dark.png' })
    await first.close()
    first = undefined

    reopened = await launch()
    const page = await reopened.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: 'Use dark mode' })).toHaveAttribute('aria-pressed', 'true')
    await page.setViewportSize({ width: 1024, height: 768 })
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
    expect(Math.round((await page.getByRole('complementary', { name: 'Workspace navigation' }).boundingBox())!.width)).toBe(64)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
    await page.getByRole('button', { name: 'Expand sidebar' }).click()
    expect(Math.round((await page.getByRole('complementary', { name: 'Workspace navigation' }).boundingBox())!.width)).toBe(220)
    await expect(page.getByRole('region', { name: 'CV document' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your tailored CV will appear here' })).toBeVisible()
    await reopened.close()
    reopened = undefined
  } finally {
    await first?.close().catch(() => {})
    await reopened?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
