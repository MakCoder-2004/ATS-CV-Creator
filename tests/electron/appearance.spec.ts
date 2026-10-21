import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Launch the built app twice, exercising the actual renderer → preload → IPC → SQLite path.
test('workbench opens and remembers a keyboard-accessible appearance choice', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-electron-'))
  const launch = () => electron.launch({ args: ['.'], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
  let first: Awaited<ReturnType<typeof electron.launch>> | undefined
  let reopened: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    first = await launch()
    const firstPage = await first.firstWindow()
    await expect(firstPage.locator('[data-ui-ready="true"]')).toBeVisible()
    await expect(firstPage.getByRole('heading', { name: 'Start with the right role.' })).toBeVisible()
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
      expect(await firstPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
    await expect(firstPage.getByRole('button', { name: 'Use dark mode' })).toBeVisible()
    await firstPage.getByRole('button', { name: 'Use dark mode' }).focus()
    await firstPage.keyboard.press('Enter')
    await expect(firstPage.getByRole('button', { name: 'Use dark mode' })).toHaveAttribute('aria-pressed', 'true')
    await first.close()
    first = undefined

    reopened = await launch()
    const page = await reopened.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Use dark mode' })).toHaveAttribute('aria-pressed', 'true')
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
