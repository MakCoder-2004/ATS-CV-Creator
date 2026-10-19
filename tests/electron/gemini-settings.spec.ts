import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('visible Gemini settings save non-secret preferences and explain privacy and credential status', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-gemini-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.getByText(/free tier sends data to Google/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /Google's Gemini API terms/ })).toHaveAttribute('href', 'https://ai.google.dev/gemini-api/terms')
    await expect(page.getByRole('combobox', { name: 'Gemini model' })).toHaveText('gemini-3.6-flash')
    await page.getByRole('combobox', { name: 'Gemini model' }).click()
    await page.getByRole('option', { name: 'gemini-2.5-flash' }).click()
    await expect(page.getByText('Model preference saved. No provider request was sent.')).toBeVisible()

    const input = page.getByRole('textbox', { name: 'Gemini API key' })
    const availability = await page.evaluate(() => window.workbench.getSettings().then(result => result.gemini.credential.secureStorageAvailable))
    if (availability) {
      const canary = 'ui-test-gemini-key-canary'
      await input.fill(canary)
      await page.getByRole('button', { name: 'Save API key' }).click()
      await expect(page.getByText('API key saved securely. No provider request was sent.')).toBeVisible()
      await expect(input).toHaveValue('')
      await expect(page.getByText('An encrypted key is saved on this device. Its value is never shown here.')).toBeVisible()
      const result = await page.evaluate(() => window.workbench.getSettings())
      expect(JSON.stringify(result)).not.toContain(canary)
      await page.reload()
      await page.getByRole('button', { name: 'Settings' }).click()
      await expect(page.getByRole('combobox', { name: 'Gemini model' })).toHaveText('gemini-2.5-flash')
      await expect(page.getByText('An encrypted key is saved on this device. Its value is never shown here.')).toBeVisible()
      const replacement = 'ui-test-replacement-key-canary'
      await input.fill(replacement)
      await page.getByRole('button', { name: 'Replace API key' }).click()
      await expect(page.getByText('API key saved securely. No provider request was sent.')).toBeVisible()
      const replacementResult = await page.evaluate(() => window.workbench.getSettings())
      expect(JSON.stringify(replacementResult)).not.toContain(replacement)
      await page.getByRole('button', { name: 'Remove saved key' }).click()
      await expect(page.getByText('Saved API key removed. No provider request was sent.')).toBeVisible()
    } else {
      await expect(page.getByRole('alert')).toContainText('Secure storage is unavailable')
      await expect(input).toBeDisabled()
    }
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
