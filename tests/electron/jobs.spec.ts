import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('paused source reads fail visibly while manual posting text remains available', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-source-pause-'))
  let running: ElectronApplication | undefined
  try {
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    const page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await expect(page.getByText('Automatic LinkedIn, Indeed, and Lever reads are paused', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Import from link' }).click()
    const cases = [
      ['https://jobs.lever.co/example-board/123', /Lever.*paused|paused.*Lever/i],
      ['https://www.linkedin.com/jobs/view/123/', /LinkedIn.*paused|paused.*LinkedIn/i],
      ['https://www.indeed.com/viewjob?jk=123', /Indeed.*paused|paused.*Indeed/i]
    ] as const
    for (const [url, message] of cases) {
      await page.getByLabel('Public job posting link').fill(url)
      await page.getByRole('button', { name: 'Fetch posting' }).click()
      await expect(page.getByRole('alert')).toContainText(message)
      await expect(page.getByRole('region', { name: 'Temporary direct posting preview' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Save job' })).toHaveCount(0)
    }
    const requestLog = join(userData, 'research-direct-requests.log')
    expect(existsSync(requestLog) ? readFileSync(requestLog, 'utf8') : '').toBe('')

    await page.getByRole('button', { name: 'Paste posting text instead' }).click()
    await page.getByLabel('Job title').fill('Manual Platform Engineer')
    await page.getByLabel('Company').fill('Example Research')
    await page.getByLabel('Posting and requirements').fill('Build and test fictional TypeScript services.')
    await page.getByRole('button', { name: 'Save job' }).click()
    const row = page.locator('.saved-job-row').filter({ hasText: 'Manual Platform Engineer' })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Edit Manual Platform Engineer posting' }).click()
    await expect(page.getByRole('region', { name: 'Posting source and revision history' })).toContainText('Unknown — this manual posting has no captured source snapshot.')
    await expect(page.getByLabel('Posting and requirements')).toHaveValue('Build and test fictional TypeScript services.')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.setViewportSize({ width: 375, height: 812 })
    const narrow = await page.locator('.saved-jobs-page').evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }))
    expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.clientWidth)
  } finally {
    await running?.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
