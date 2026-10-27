import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('manual-only saved job contacts persist through edit and app reopen with source history visible', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-job-contacts-'))
  let running: ElectronApplication | undefined
  try {
    const launch = () => { const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>; env.CV_TAILOR_TEST_USER_DATA_DIR = userData; return electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env }) }
    running = await launch()
    let page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await expect(page.getByLabel('Public job posting link')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Open original posting' })).toHaveCount(0)
    await page.locator('#content').getByRole('button', { name: 'New job', exact: true }).click()
    await page.getByLabel('Job title').fill('Manual contact role')
    await page.getByLabel('Company').fill('Example Research')
    await page.getByLabel('Full job posting').fill('Complete manually entered posting text.')
    await page.getByRole('button', { name: 'Add contact' }).click()
    await page.getByLabel('Name').fill('Taylor Recruiter')
    await page.getByLabel('Role').fill('Recruiter')
    await page.getByLabel('Profile URL (HTTPS only)').fill('https://example.test/in/taylor')
    await page.getByRole('button', { name: 'Save job' }).click()
    const row = page.locator('.saved-job-row').filter({ hasText: 'Manual contact role' })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Edit Manual contact role posting' }).click()
    await expect(page.getByLabel('Name')).toHaveValue('Taylor Recruiter')
    await expect(page.getByRole('textbox', { name: 'Role' })).toHaveValue('Recruiter')
    await expect(page.getByLabel('Profile URL (HTTPS only)')).toHaveValue('https://example.test/in/taylor')
    await expect(page.getByText('Unknown — this manual posting has no captured source snapshot.')).toBeVisible()
    await running.close(); running = undefined
    running = await launch(); page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.locator('.saved-job-row').filter({ hasText: 'Manual contact role' }).getByRole('button', { name: 'Edit Manual contact role posting' }).click()
    await expect(page.getByLabel('Name')).toHaveValue('Taylor Recruiter')
    await expect(page.getByLabel('Profile URL (HTTPS only)')).toHaveValue('https://example.test/in/taylor')
    await expect(page.getByText('Unknown — this manual posting has no captured source snapshot.')).toBeVisible()
  } finally {
    await running?.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
