import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('real Electron UI generates and exposes cited draft with a DEV-only scripted provider', async () => {
  test.setTimeout(90000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-generation-ui-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: ['.'], timeout: 60000, env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'generation' } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'My profile' }).click()
    await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('button', { name: 'Skills' }).click()
    await page.getByLabel('Skill name').fill('TypeScript')
    await page.getByRole('button', { name: 'Add skill' }).click()
    await expect(page.getByText('TypeScript', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Saved jobs' }).click()
    await page.getByLabel('Job title').fill('Fictional Systems Engineer')
    await page.getByLabel('Company').fill('Northwind Labs')
    await page.getByLabel('Job description and requirements').fill('TypeScript and reliable systems experience are required.')
    await page.getByRole('button', { name: 'Save posting' }).click()
    await page.getByRole('button', { name: 'Tailor CV' }).click()
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const review = page.getByRole('region', { name: 'Outgoing data review' })
    await review.getByRole('checkbox', { name: /I understand the Gemini free-tier data-use terms/ }).check()
    await review.getByRole('button', { name: 'Authorize this run' }).click()
    await review.getByRole('button', { name: 'Analyze posting' }).click()
    await expect(review.getByRole('button', { name: 'Generate tailored draft' })).toBeVisible({ timeout: 60000 })
    await review.getByRole('button', { name: 'Generate tailored draft' }).click()
    await expect(review.getByRole('region', { name: 'Source-linked draft' })).toContainText('Draft · unverified and unapproved', { timeout: 60000 })
    const draft = review.getByRole('region', { name: 'Source-linked draft' })
    await expect(draft).toContainText('TypeScript')
    await expect(draft).toContainText('Source revision')
    await expect(draft).toContainText('No verification, approval, or export is available yet.')
    await expect(review.getByRole('button', { name: /Export|Approve|Verify/ })).toHaveCount(0)
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
