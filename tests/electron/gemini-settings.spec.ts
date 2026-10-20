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
    const faithfulness = page.getByRole('checkbox', { name: 'Enable optional faithfulness review for newly authorized runs' })
    await expect(faithfulness).not.toBeChecked()
    await faithfulness.check()
    await expect(page.getByText('Faithfulness preference saved locally. Existing unresolved findings are not waived.')).toBeVisible()
    await page.reload()
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('checkbox', { name: 'Enable optional faithfulness review for newly authorized runs' })).toBeChecked()
    await page.getByRole('checkbox', { name: 'Enable optional faithfulness review for newly authorized runs' }).uncheck()
    await expect(page.getByText(/free tier sends data to Google/i)).toBeVisible()
    await expect(page.getByText(/LLM check is not proof/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /Google's Gemini API terms/ })).toHaveAttribute('href', 'https://ai.google.dev/gemini-api/terms')
    await expect(page.getByRole('combobox', { name: 'Gemini model' })).toHaveText('gemini-3.6-flash')
    await expect(page.getByRole('spinbutton', { name: 'Minimum spacing (milliseconds)' })).toHaveValue('5000')
    await expect(page.getByRole('spinbutton', { name: 'Attempts per rate window' })).toHaveValue('12')
    await expect(page.getByRole('spinbutton', { name: 'Local daily attempt limit' })).toHaveValue('50')
    await page.getByRole('spinbutton', { name: 'Local daily attempt limit' }).fill('25')
    await page.getByRole('button', { name: 'Save analysis budgets' }).click()
    await expect(page.getByText('Analysis budgets saved locally. No provider request was sent.')).toBeVisible()
    await page.reload()
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('spinbutton', { name: 'Local daily attempt limit' })).toHaveValue('25')
    await page.getByRole('combobox', { name: 'Gemini model' }).click()
    await page.getByRole('option', { name: 'gemini-2.5-flash' }).click()
    await expect(page.getByText('Model preference saved. No provider request was sent.')).toBeVisible()

    const result = await page.evaluate(() => window.workbench.getSettings())
    expect(result.gemini.credential.configured).toBe(false)
    expect(JSON.stringify(result)).not.toContain('apiKey')
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
