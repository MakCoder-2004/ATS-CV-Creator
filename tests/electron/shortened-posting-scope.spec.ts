import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('LinkedIn and Indeed temporary reads are blocked before dispatch with manual fallback visible', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-paused-research-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.getByRole('button', { name: 'Import from link' }).click()
    for (const [url, source] of [
      ['https://www.linkedin.com/jobs/view/123/', 'LinkedIn'],
      ['https://www.indeed.com/viewjob?jk=123', 'Indeed']
    ]) {
      await page.getByLabel('Public job posting link').fill(url)
      await page.getByRole('button', { name: 'Fetch posting' }).click()
      await expect(page.getByRole('alert')).toContainText(new RegExp(`${source}.*paused|paused.*${source}`, 'i'))
      await expect(page.getByRole('button', { name: 'Paste posting text instead' })).toBeVisible()
    }
    const requestLog = join(userData, 'research-direct-requests.log')
    expect(existsSync(requestLog) ? readFileSync(requestLog, 'utf8') : '').toBe('')
    expect(await page.evaluate(() => window.workbench.listJobs())).toHaveLength(0)
  } finally {
    await app?.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
