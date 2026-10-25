import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// One dev-only synthetic direct read and Pi runtime, with isolated sibling credential/workspace roots.
test('unsafe LinkedIn identity shows a visible no-search refusal without accepting evidence', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-research-unsafe-'))
  const userData = join(root, 'workspace'), appData = join(root, 'appdata')
  mkdirSync(userData); mkdirSync(appData)
  const directRequests = join(userData, 'research-direct-requests.log')
  const modelRequests = join(userData, 'research-model-requests.log')
  const count = (path: string) => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).length : 0
  const submittedUrl = 'https://www.linkedin.com/jobs/search-results/?currentJobId=4482137197&keywords=unique-context-never-share&origin=JOB_SEARCH_PAGE_JOB_FILTER&geoId=12345&trackingId=dummy-tracking'
  const canonicalUrl = 'https://www.linkedin.com/jobs/view/4482137197/'
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], timeout: 45_000, env: {
      ...process.env, APPDATA: appData, CV_TAILOR_TEST_STORAGE_ROOT: root, CV_TAILOR_TEST_APP_DATA_DIR: appData,
      CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_TEST_RESEARCH: 'unsafe'
    } })
    const page = await app.firstWindow({ timeout: 20_000 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    const backupStatus = await page.evaluate(() => window.workbench.getWorkspaceBackupStatus())
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.getByRole('button', { name: 'Import from link' }).click()
    await page.getByLabel('Public job posting link').fill(submittedUrl)
    await page.getByRole('button', { name: 'Fetch posting' }).click()
    await expect(page.getByRole('button', { name: 'Inspect captured findings' })).toBeVisible()
    await expect(page.getByLabel('Public job posting link')).toHaveValue(submittedUrl)
    expect(count(directRequests)).toBe(1)
    await page.getByRole('button', { name: 'Inspect captured findings' }).click()

    const research = page.getByRole('region', { name: 'Temporary job research' })
    await expect(research.getByText(canonicalUrl, { exact: true })).toBeVisible()
    await expect(research).toContainText('The page canonical identity differs from the selected role.')
    await expect(research).toContainText('No Tavily request or credit was used by this action because the source identity is unsafe.')
    await expect(research).not.toContainText('unique-context-never-share')
    await expect(research).not.toContainText('trackingId')
    await expect(research.getByRole('region', { name: 'Direct role source' })).toContainText('No usable direct role wording.')
    await expect(research.getByRole('button', { name: 'Search indexed details' })).toHaveCount(0)
    await expect(research.getByText(/search-key status|search key is stored|No search key is stored|Checking local search-key/i)).toHaveCount(0)
    await expect(research.getByRole('checkbox', { name: 'Include this role finding in review' })).toHaveCount(0)
    await expect(research.getByRole('button', { name: 'Review selected role findings' })).toHaveCount(0)
    expect(count(directRequests)).toBe(1)
    expect(count(modelRequests)).toBe(0)
    expect(await page.evaluate(() => window.workbench.listJobs())).toHaveLength(0)
    expect(await page.evaluate(() => window.workbench.getWorkspaceBackupStatus())).toEqual(backupStatus)

    await research.getByRole('button', { name: 'Cancel and discard research' }).click()
    await expect(research.getByRole('button', { name: 'Fetch posting again' })).toBeVisible()
    // Recovery is offered explicitly; merely cancelling must not reread the source.
    expect(count(directRequests)).toBe(1)
    expect(count(modelRequests)).toBe(0)
    expect(await page.evaluate(() => window.workbench.listJobs())).toHaveLength(0)
    expect(await page.evaluate(() => window.workbench.getWorkspaceBackupStatus())).toEqual(backupStatus)
  } finally {
    await app?.close().catch(() => {})
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})

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
