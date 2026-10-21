import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('saved jobs follow the design-system list, support editing, and reopen for tailoring', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-jobs-'))
  let running: ElectronApplication | undefined
  const launch = async () => {
    running = await electron.launch({ args: ['.'], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    return running
  }
  try {
    const app = await launch()
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await expect(page.locator('.saved-jobs-empty')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your first job starts here' })).toBeVisible()
    await page.locator('.saved-jobs-heading').getByRole('button', { name: 'New job' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.getByRole('button', { name: 'Save job' }).click()
    await expect(page.getByRole('alert')).toContainText(/blank|title/i)
    await expect(page.getByLabel('Job title')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Job title')).toBeFocused()
    await expect(page.getByLabel('Company')).toHaveAttribute('aria-invalid', 'true')

    await page.getByLabel('Job title').fill('Fictional Platform Engineer')
    await page.getByLabel('Company').fill('Northwind Research')
    await page.getByLabel('Posting and requirements').fill('Build reliable data tools.\nRequirements: TypeScript and testing.')
    await page.getByRole('button', { name: 'Save job' }).click()
    await expect(page.locator('.saved-jobs-table')).toBeVisible()
    await expect(page.getByRole('status')).toContainText('Job saved on this device.')
    const firstRow = page.locator('.saved-job-row').filter({ hasText: 'Fictional Platform Engineer' })
    await expect(firstRow.getByText('No draft')).toBeVisible()
    await firstRow.getByRole('button', { name: 'Edit Fictional Platform Engineer posting' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByLabel('Posting and requirements')).toHaveValue('Build reliable data tools.\nRequirements: TypeScript and testing.')
    await page.getByLabel('Company').fill('Northwind Research Group')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status')).toContainText('Job saved on this device.')
    await expect(page.locator('.saved-job-row').filter({ hasText: 'Northwind Research Group' })).toBeVisible()

    await page.locator('.saved-jobs-heading').getByRole('button', { name: 'New job' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Job title').fill('Fictional Product Analyst')
    await page.getByLabel('Company').fill('Contoso Labs')
    await page.getByLabel('Posting and requirements').fill('Review fictional product metrics and share findings.')
    await page.getByRole('button', { name: 'Save job' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.locator('.saved-job-row')).toHaveCount(2)

    const firstTailor = page.locator('.saved-job-row').filter({ hasText: 'Fictional Platform Engineer' }).getByRole('button', { name: 'Open posting' })
    await firstTailor.click()
    await expect(page.getByRole('heading', { name: 'Fictional Platform Engineer', exact: true })).toBeVisible()
    await expect(page.locator('.posting-overview').getByText('Northwind Research Group')).toBeVisible()
    await page.locator('.sidebar-job-items').getByRole('button', { name: /Fictional Product Analyst/ }).click()
    await expect(page.getByRole('heading', { name: 'Fictional Product Analyst', exact: true })).toBeVisible()
    await expect(page.locator('.posting-overview').getByText('Contoso Labs')).toBeVisible()

    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.getByRole('button', { name: 'Use dark mode' }).click()
    await page.setViewportSize({ width: 375, height: 812 })
    const narrowLayout = await page.locator('.saved-jobs-page').evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }))
    expect(narrowLayout.scrollWidth).toBeLessThanOrEqual(narrowLayout.clientWidth)
    await page.setViewportSize({ width: 812, height: 375 })
    const landscapeLayout = await page.locator('.saved-jobs-page').evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }))
    expect(landscapeLayout.scrollWidth).toBeLessThanOrEqual(landscapeLayout.clientWidth)

    await app.close()
    running = undefined
    const reopened = await launch()
    const reopenedPage = await reopened.firstWindow()
    await expect(reopenedPage.locator('[data-ui-ready="true"]')).toBeVisible()
    await reopenedPage.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    const reopenedFirstRow = reopenedPage.locator('.saved-job-row').filter({ hasText: 'Fictional Platform Engineer' })
    await reopenedFirstRow.getByRole('button', { name: 'Edit Fictional Platform Engineer posting' }).click()
    await expect(reopenedPage.getByLabel('Posting and requirements')).toHaveValue('Build reliable data tools.\nRequirements: TypeScript and testing.')
    await reopenedPage.getByRole('button', { name: 'Cancel' }).click()
    await reopenedFirstRow.getByRole('button', { name: 'Open posting' }).click()
    await expect(reopenedPage.getByRole('heading', { name: 'Fictional Platform Engineer', exact: true })).toBeVisible()
    await expect(reopenedPage.locator('.posting-overview').getByText('Northwind Research Group')).toBeVisible()
    await expect(reopenedPage.locator('.posting-overview').getByText('Fictional Product Analyst')).toHaveCount(0)
    await reopened.close()
    running = undefined
  } finally {
    await running?.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
