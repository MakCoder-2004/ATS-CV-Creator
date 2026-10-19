import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('education editor persists and clearly labels local-only profile sections', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-extra-profile-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  const launch = () => electron.launch({ args: ['.'], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
  try {
    app = await launch()
    let page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'My profile' }).click()
    const sections = page.getByRole('navigation', { name: 'Profile sections' })
    await sections.getByRole('button', { name: 'Education' }).click()
    await page.getByLabel('Title').fill('BSc')
    await page.getByLabel('Institution').fill('Example University')
    await page.getByLabel('Degree or field').fill('Computing')
    await page.getByLabel('Start date (YYYY or YYYY-MM)').fill('2020')
    await page.getByLabel('End date (YYYY or YYYY-MM)').fill('2024')
    await page.getByRole('button', { name: 'Add education' }).click()
    await expect(page.getByRole('heading', { name: 'BSc' })).toBeVisible()
    await sections.getByRole('button', { name: 'Summary' }).click()
    await expect(page.getByText('Stored locally · not exported')).toBeVisible()
    await expect(page.getByText('not included in CV output')).toBeVisible()
    await page.getByRole('textbox', { name: 'Summary' }).fill('A local note')
    await page.getByRole('button', { name: 'Add summary' }).click()
    await expect(page.getByRole('heading', { level: 3, name: 'Summary' })).toBeVisible()
    await app.close(); app = undefined
    app = await launch(); page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'My profile' }).click()
    await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('button', { name: 'Education' }).click()
    await expect(page.getByRole('heading', { name: 'BSc' })).toBeVisible()
    await app.close(); app = undefined
  } finally { await app?.close(); await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})
