import { expect, test, _electron as electron } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const link = 'https://boards.greenhouse.io/acme/jobs/123'
const requestCount = (path: string) => existsSync(path) ? readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean).length : 0

test('visible Greenhouse preview is explicit, temporary and stale-result safe', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-named-preview-'))
  const appData = join(root, 'appdata'), userData = join(root, 'workspace')
  mkdirSync(appData); mkdirSync(userData)
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], timeout: 60_000, env: {
      ...process.env, APPDATA: appData, CV_TAILOR_TEST_STORAGE_ROOT: root,
      CV_TAILOR_TEST_APP_DATA_DIR: appData, CV_TAILOR_TEST_USER_DATA_DIR: userData,
      CV_TAILOR_TEST_NAMED_PREVIEW: '1', CV_TAILOR_SCRIPTED_POSTING_FETCH: '', CV_TAILOR_TEST_RESEARCH: ''
    } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.getByRole('button', { name: 'Import from link' }).click()
    const linkField = page.getByLabel('Public job posting link')
    await linkField.fill(link)
    const optIn = page.getByRole('checkbox', { name: /I understand and opt in for this run/ })
    await optIn.check()
    const fetch = page.getByRole('button', { name: 'Fetch Greenhouse preview' })
    await fetch.click()
    // A second click against the visibly disabled loading action cannot start another read.
    await expect(fetch).toBeDisabled()
    await expect(fetch.click({ timeout: 100 })).rejects.toThrow()
    await expect.poll(() => requestCount(join(userData, 'named-preview-request-count.log'))).toBe(1)
    await linkField.fill('https://boards.greenhouse.io/acme/jobs/124')
    await page.waitForTimeout(650)
    await expect(page.getByText('Synthetic Reliability Engineer', { exact: true })).toHaveCount(0)
    expect(requestCount(join(userData, 'named-preview-request-count.log'))).toBe(1)

    await linkField.fill(link)
    await optIn.check()
    await fetch.click()
    const preview = page.getByRole('region', { name: 'Temporary Greenhouse posting preview' })
    await expect(preview.getByRole('heading', { name: 'Synthetic Reliability Engineer' })).toBeVisible()
    await expect(preview).toContainText('Example Research')
    await expect(preview).toContainText('2026-10-25')
    await expect(preview).toContainText('NOT SAVED')
    await expect(preview).toContainText('Build and maintain synthetic systems')
    await expect(preview.getByRole('button', { name: /Save/ })).toHaveCount(0)
    expect(requestCount(join(userData, 'named-preview-request-count.log'))).toBe(2)

    const savedJobs = await page.evaluate(async () => (window as any).workbench.listJobs())
    expect(savedJobs).toEqual([])
    await linkField.fill('https://boards.greenhouse.io/acme/jobs/124')
    await page.getByRole('button', { name: 'Fetch posting', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Generic Greenhouse direct reads are unavailable' })).toBeVisible()
    expect(requestCount(join(userData, 'named-preview-request-count.log'))).toBe(2)

    await linkField.fill('https://jobs.eu.lever.co/acme/123')
    await page.getByRole('button', { name: 'Fetch posting', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Automatic Lever fetching' })).toBeVisible()
    expect(requestCount(join(userData, 'named-preview-request-count.log'))).toBe(2)
  } finally {
    await app?.close().catch(() => {})
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
