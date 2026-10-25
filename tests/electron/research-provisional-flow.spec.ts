import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// One dev-only synthetic direct read and Pi runtime, with isolated sibling credential/workspace roots.
test('visible public link → partial review → exact outgoing consent → source-linked analysis, no saved job', async () => {
  test.setTimeout(150_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-research-provisional-'))
  const userData = join(root, 'workspace'), appData = join(root, 'appdata')
  mkdirSync(userData); mkdirSync(appData)
  const requests = join(userData, 'research-model-requests.log')
  const count = () => existsSync(requests) ? readFileSync(requests, 'utf8').trim().split('\n').length : 0
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], timeout: 45_000, env: {
      ...process.env, APPDATA: appData, CV_TAILOR_TEST_STORAGE_ROOT: root, CV_TAILOR_TEST_APP_DATA_DIR: appData,
      CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_TEST_RESEARCH: '1', CV_TAILOR_SCRIPTED_ANALYSIS: '1', CV_TAILOR_SCRIPTED_PI_MODEL: '1'
    } })
    const page = await app.firstWindow({ timeout: 20_000 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const model = page.getByRole('region', { name: 'Pi preferences' }).getByRole('region', { name: 'Pi model' })
    await model.getByLabel('Provider/model reference').fill('scripted/cv-tailor-fixture')
    await model.getByRole('button', { name: 'Save Pi model' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Pi model preference saved.' })).toBeVisible()
    const backupStatus = await page.evaluate(() => window.workbench.getWorkspaceBackupStatus())
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.getByRole('button', { name: 'Import from link' }).click()
    await page.getByLabel('Public job posting link').fill('https://jobs.example.org/role/123')
    expect(count()).toBe(0)
    await page.getByRole('button', { name: 'Fetch posting' }).click()
    await expect(page.getByRole('button', { name: 'Inspect captured findings' })).toBeVisible()
    await page.getByRole('button', { name: 'Inspect captured findings' }).click()
    await expect(page.getByRole('region', { name: 'Direct role source' }).getByText(/partial direct text/i)).toBeVisible()
    await page.getByLabel('Include this role finding in review').check()
    await page.getByLabel(/I understand these selected role details are partial/).check()
    await page.getByRole('button', { name: 'Review selected role findings' }).click()
    await expect(page.getByRole('button', { name: 'Inspect outgoing data' })).toBeVisible()
    expect(count()).toBe(0)
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    await expect(page.getByLabel('Exact outgoing analysis data')).toContainText('https://jobs.example.org/role/123')
    await expect(page.getByText('Provisional analysis', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Authorize analysis' })).toBeDisabled()
    expect(count()).toBe(0)
    await page.getByLabel('I reviewed the displayed user message and understand a separate JSON-schema instruction is sent to Pi').check()
    await page.getByRole('button', { name: 'Authorize analysis' }).click()
    await expect(page.getByRole('button', { name: 'Start analysis' })).toBeVisible()
    expect(count()).toBe(0)
    await page.getByRole('button', { name: 'Start analysis' }).click()
    await expect(page.getByRole('region', { name: 'Analysis suggestions' })).toContainText('finding 1')
    expect(count()).toBe(1)
    expect(await page.evaluate(() => window.workbench.listJobs())).toHaveLength(0)
    await expect(page.getByRole('button', { name: 'Export PDF' })).toHaveCount(0)

    // Missing local key is reported without suggesting that status check itself searches.
    await expect(page.getByText('No search key is stored on this device.', { exact: false })).toBeVisible()
    // Starting another search revokes the reviewed authority before any result is available.
    await page.getByRole('button', { name: 'Search indexed details' }).click()
    await expect(page.getByRole('region', { name: 'Analysis suggestions' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Inspect outgoing data' })).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: 'Include this role finding in review' })).not.toBeChecked()
    expect(count()).toBe(1)
    expect(await page.evaluate(() => window.workbench.listJobs())).toHaveLength(0)
    expect(await page.evaluate(() => window.workbench.getWorkspaceBackupStatus())).toEqual(backupStatus)
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByLabel('Exact outgoing analysis data')).toHaveCount(0)
    expect(await page.evaluate(() => window.workbench.listJobs())).toHaveLength(0)
  } finally {
    await app?.close().catch(() => {})
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
