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
    const sourceUpdated = await page.evaluate(() => new Date('2026-10-25T12:00:00Z').toLocaleString())
    await expect(preview).toContainText(`Source updated: ${sourceUpdated}`)
    await expect(preview).toContainText('NOT SAVED')
    await expect(preview).toContainText('Build and maintain synthetic systems')
    await expect(preview.getByRole('button', { name: 'Save job' })).toBeDisabled()
    expect(requestCount(join(userData, 'named-preview-request-count.log'))).toBe(2)
    await preview.getByRole('checkbox', { name: /reviewed the exact role/ }).check()
    await preview.getByRole('checkbox', { name: /reviewed the complete posting text/ }).check()
    await preview.getByRole('button', { name: 'Confirm review' }).click()
    const saveButton = preview.getByRole('button', { name: 'Save job' })
    await expect(saveButton).toBeEnabled()
    await saveButton.click()
    await expect(page.getByRole('row').filter({ hasText: 'Synthetic Reliability Engineer' })).toBeVisible()
    const savedJobs = await page.evaluate(async () => (window as any).workbench.listJobs())
    expect(savedJobs).toHaveLength(1)
    expect(savedJobs[0]).toMatchObject({ title: 'Synthetic Reliability Engineer', sourceSnapshot: { description: expect.stringContaining('Build and maintain synthetic systems'), extractionMethod: 'greenhouse-job-board-api-v1' } })
    expect(await page.evaluate(async (id) => (window as any).workbench.openJob(id), savedJobs[0].id)).toMatchObject({ sourceSnapshot: { title: 'Synthetic Reliability Engineer' } })
    await page.reload()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: 'Synthetic Reliability Engineer' })).toBeVisible()
    await page.getByRole('button', { name: 'Delete Synthetic Reliability Engineer posting' }).click()
    await expect(page.getByText(/Older backups may still contain these jobs/)).toBeVisible()
    await page.getByRole('button', { name: 'Delete 1 job' }).click()
    await expect(page.getByRole('row').filter({ hasText: 'Synthetic Reliability Engineer' })).toHaveCount(0)
    expect(await page.evaluate(async () => (window as any).workbench.listJobs())).toEqual([])
    await page.locator('#content').getByRole('button', { name: 'New job' }).click()
    await page.getByRole('button', { name: 'Import from link' }).click()
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
