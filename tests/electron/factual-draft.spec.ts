import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('visible failed-draft findings can be corrected and rechecked without losing the source draft', async () => {
  test.setTimeout(90000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-factual-ui-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: ['.'], timeout: 60000, env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'factual' } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'My profile' }).click()
    await page.getByLabel('Full name').fill('Local Candidate')
    await page.getByRole('button', { name: 'Save contact details' }).click()
    await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('button', { name: 'Experience' }).click()
    await page.getByRole('button', { name: 'Add role' }).click()
    await page.getByLabel('Role or training title').fill('Engineer')
    await page.getByLabel('Company or institution').fill('Example')
    await page.getByLabel('Original description').fill('Reduced delivery time by 12 percent.')
    await page.getByRole('button', { name: 'Save role' }).click()
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.getByLabel('Job title').fill('Engineer')
    await page.getByLabel('Company').fill('Example')
    await page.getByLabel('Posting and requirements').fill('Engineering experience required.')
    await page.getByRole('button', { name: 'Save job' }).click()
    await page.getByRole('button', { name: 'Tailor CV', exact: true }).click()
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const review = page.getByRole('region', { name: 'Tailoring workflow' })
    await review.getByRole('checkbox', { name: /reviewed what is sent/ }).check()
    await review.getByRole('button', { name: 'Authorize this run' }).click()
    await review.getByRole('button', { name: 'Analyze posting' }).click()
    await review.getByRole('button', { name: 'Generate tailored draft' }).click()
    const draft = review.getByRole('region', { name: 'CV review' })
    await expect(draft).toContainText('Changes needed', { timeout: 60000 })
    await draft.locator('details.review-findings summary').click()
    await expect(draft).toContainText('900 percent')
    await expect(draft).toContainText('not present in the cited evidence')
    const correction = draft.getByLabel('Correct experience draft wording')
    await correction.fill('Reduced delivery time by 12 percent.')
    await draft.getByRole('button', { name: 'Save wording and recheck' }).click()
    await expect(draft).toContainText('Finish reviewing', { timeout: 10000 })
    await expect(page.getByRole('article', { name: 'Draft CV preview' })).toContainText('Reduced delivery time by 12 percent.')
    await expect(draft.getByRole('button', { name: 'Approve CV' })).toBeDisabled()
    await expect(review.getByRole('button', { name: 'Export editable DOCX' })).toHaveCount(0)
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
