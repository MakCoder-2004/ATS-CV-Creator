import { expect, test, _electron as electron } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('manual posting text stays local until the visible Save job action', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-issue-94-manual-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: {
      ...process.env,
      CV_TAILOR_TEST_USER_DATA_DIR: userData,
      CV_TAILOR_TEST_MODEL_DISPATCH_LOG: 'model-dispatches.log',
      CV_TAILOR_SCRIPTED_ANALYSIS: '1', CV_TAILOR_TEST_RESEARCH: '1'
    } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.locator('.saved-jobs-heading').getByRole('button', { name: 'New job' }).click()
    await page.getByRole('button', { name: 'Paste posting text instead' }).click()
    await page.getByLabel('Job title').fill('Synthetic Manual Engineer')
    await page.getByLabel('Company').fill('Example Works')
    await page.getByLabel('Posting and requirements').fill('Build fictional TypeScript tools and document operational decisions.')
    expect(existsSync(join(userData, 'model-dispatches.log'))).toBe(false)
    expect(existsSync(join(userData, 'research-direct-requests.log'))).toBe(false)
    await expect(page.getByRole('button', { name: 'Save job' })).toBeVisible()
    await page.getByRole('button', { name: 'Save job' }).click()
    await expect(page.locator('.saved-job-row')).toContainText('Synthetic Manual Engineer')
    expect(existsSync(join(userData, 'model-dispatches.log'))).toBe(false)
    expect(existsSync(join(userData, 'research-direct-requests.log'))).toBe(false)
    expect(readFileSync(join(userData, 'workbench.sqlite')).byteLength).toBeGreaterThan(0)
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
