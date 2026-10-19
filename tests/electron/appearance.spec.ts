import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Launch the built app twice, exercising the actual renderer → preload → IPC → SQLite path.
test('workbench opens and remembers a keyboard-accessible appearance choice', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-electron-'))
  const launch = () => electron.launch({ args: ['.'], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
  try {
    const first = await launch()
    const firstPage = await first.firstWindow()
    await expect(firstPage.locator('[data-ui-ready="true"]')).toBeVisible()
    await expect(firstPage.getByRole('heading', { name: 'Start with your experience' })).toBeVisible()
    await expect(firstPage.getByRole('button', { name: 'Use light mode' })).toHaveAttribute('aria-pressed', 'true')
    expect(await firstPage.evaluate(() => Object.keys(window.workbench).sort())).toEqual(['deleteContact', 'deleteProfileEntry', 'deleteSkill', 'getEvidenceHistory', 'getProfile', 'getSettings', 'removeGeminiApiKey', 'saveContact', 'saveGeminiApiKey', 'saveProfileEntry', 'saveSkill', 'setAppearance', 'setGeminiModel'])
    expect(await firstPage.evaluate(() => typeof (window as Window & { require?: unknown }).require)).toBe('undefined')
    await firstPage.setViewportSize({ width: 680, height: 700 })
    await expect(firstPage.getByRole('button', { name: 'Use dark mode' })).toBeVisible()
    await firstPage.getByRole('button', { name: 'Use dark mode' }).focus()
    await firstPage.keyboard.press('Enter')
    await expect(firstPage.getByRole('button', { name: 'Use dark mode' })).toHaveAttribute('aria-pressed', 'true')
    await first.close()

    const reopened = await launch()
    const page = await reopened.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Use dark mode' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.paper')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(page.locator('.paper')).toHaveCSS('font-family', 'Arial, sans-serif')
    await reopened.close()
  } finally {
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
