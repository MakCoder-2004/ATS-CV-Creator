import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const executablePath = process.env.CV_TAILOR_INSTALLED_EXE
test.skip(!executablePath, 'Set CV_TAILOR_INSTALLED_EXE to a genuinely installed executable')

test('installed app opens and writes SQLite across reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-installed-'))
  const launch = () => electron.launch({ executablePath, args: [`--user-data-dir=${directory}`] })
  try {
    const first = await launch()
    const page = await first.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Use dark mode' }).click()
    await expect(page.getByRole('button', { name: 'Use dark mode' })).toHaveAttribute('aria-pressed', 'true')
    await first.close()
    expect(existsSync(join(directory, 'workbench.sqlite'))).toBe(true)
    const reopened = await launch()
    await expect((await reopened.firstWindow()).getByRole('button', { name: 'Use dark mode' })).toHaveAttribute('aria-pressed', 'true')
    await reopened.close()
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
