import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('user inspects minimized data, declines or explicitly authorizes only one run', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-consent-ui-'))
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ args: ['.'], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'My profile' }).click()
    await page.getByLabel('Full name').fill('Ada Canary')
    await page.getByLabel('Email').fill('ada.private@example.test')
    await page.getByRole('button', { name: 'Save contact details' }).click()
    await page.getByRole('button', { name: 'Saved jobs' }).click()
    await page.getByLabel('Job title').fill('Canary Engineer')
    await page.getByLabel('Company').fill('Northstar Canary')
    await page.getByLabel('Job description and requirements').fill('Northstar Canary needs an engineer. Send details to hiring@example.test.')
    await page.getByRole('button', { name: 'Save posting' }).click()
    await page.getByRole('button', { name: 'Tailor CV' }).click()

    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const review = page.getByRole('region', { name: 'Outgoing data review' })
    const outgoing = review.getByLabel('Eligible outgoing bundle')
    await expect(outgoing).toContainText('[[EMPLOYER_1]]')
    await expect(outgoing).not.toContainText('Northstar Canary')
    await expect(outgoing).not.toContainText('Ada Canary')
    await expect(outgoing).not.toContainText('hiring@example.test')
    await expect(outgoing).not.toContainText('ada.private@example.test')
    await expect(review).toContainText('cannot guarantee anonymity')
    await expect(review.getByRole('link', { name: 'Gemini API terms' })).toHaveAttribute('href', 'https://ai.google.dev/gemini-api/terms')
    await expect(review.getByRole('button', { name: 'Authorize this run' })).toBeDisabled()
    await review.getByRole('button', { name: 'Cancel review' }).click()
    await expect(review).toHaveCount(0)

    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const secondReview = page.getByRole('region', { name: 'Outgoing data review' })
    await expect(secondReview.getByRole('checkbox', { name: /I understand the Gemini free-tier data-use terms/ })).not.toBeChecked()
    await secondReview.getByRole('checkbox', { name: /I understand the Gemini free-tier data-use terms/ }).check()
    await secondReview.getByRole('button', { name: 'Authorize this run' }).click()
    await expect(secondReview).toContainText('No provider request was sent')
    await secondReview.getByRole('button', { name: 'Revoke this run' }).click()
    await expect(secondReview).toHaveCount(0)
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    await expect(page.getByRole('region', { name: 'Outgoing data review' }).getByRole('checkbox', { name: /I understand the Gemini free-tier data-use terms/ })).not.toBeChecked()
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
