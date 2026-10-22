import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('saved posting above the previous limit stays complete and readable after restart', async ({}, testInfo) => {
  testInfo.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-long-posting-'))
  let running: ElectronApplication | undefined
  const launch = async () => {
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    return running
  }
  const completeText = `Responsibilities:\n${'Build reliable fictional systems and document every requirement.\n'.repeat(700)}`
  try {
    const app = await launch()
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.locator('.saved-jobs-heading').getByRole('button', { name: 'New job' }).click()
    await page.getByLabel('Job title').fill('Long posting engineer')
    await page.getByLabel('Company').fill('Example Systems')
    const postingField = page.getByLabel('Posting and requirements')
    await expect(postingField).toHaveAttribute('aria-describedby', /job-description-help/)
    await postingField.fill(completeText)
    await page.getByRole('button', { name: 'Save job' }).click()
    await expect(page.getByRole('status')).toContainText('Job saved on this device.')
    await expect(page.locator('.saved-job-row')).toContainText('Long posting engineer')
    await app.close()
    running = undefined

    const reopened = await launch()
    const reopenedPage = await reopened.firstWindow()
    await expect(reopenedPage.locator('[data-ui-ready="true"]')).toBeVisible()
    await reopenedPage.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await reopenedPage.locator('.saved-job-row').getByRole('button', { name: 'Edit Long posting engineer posting' }).click()
    await expect(reopenedPage.getByLabel('Posting and requirements')).toHaveValue(completeText)
    await reopened.close()
    running = undefined
  } finally {
    await running?.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
