import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('fictional postings save, validate, select independently, and reopen after restart', async () => {
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
    await page.getByRole('button', { name: 'Saved jobs' }).click()
    await expect(page.locator('.jobs-empty')).toBeVisible()
    await page.getByRole('button', { name: 'Save posting' }).click()
    await expect(page.getByRole('alert')).toContainText('Enter a title')
    await expect(page.getByLabel('Job title')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Company')).toHaveAttribute('aria-invalid', 'true')

    await page.getByLabel('Job title').fill('Fictional Platform Engineer')
    await page.getByLabel('Company').fill('Northwind Research')
    await page.getByLabel('Job description and requirements').fill('Build reliable data tools.\nRequirements: TypeScript and testing.')
    await page.getByRole('button', { name: 'Save posting' }).click()
    await expect(page.getByText('Posting saved on this device.')).toBeVisible()
    await expect(page.locator('.saved-job-list').getByRole('button', { name: /Fictional Platform Engineer Northwind Research/ })).toBeVisible()

    await page.getByRole('button', { name: 'New posting' }).first().click()
    await page.getByLabel('Job title').fill('Fictional Product Analyst')
    await page.getByLabel('Company').fill('Contoso Labs')
    await page.getByLabel('Job description and requirements').fill('Review fictional product metrics and share findings.')
    await page.getByRole('button', { name: 'Save posting' }).click()
    await expect(page.getByText('Posting saved on this device.')).toBeVisible()

    await page.getByRole('button', { name: /Fictional Platform Engineer/ }).last().click()
    await expect(page.getByLabel('Job description and requirements')).toHaveValue('Build reliable data tools.\nRequirements: TypeScript and testing.')
    await page.getByRole('button', { name: 'Tailor CV' }).click()
    await expect(page.getByText('Target: Fictional Platform Engineer · Northwind Research')).toBeVisible()
    await page.getByRole('button', { name: /Fictional Product Analyst/ }).click()
    await expect(page.getByText('Target: Fictional Product Analyst · Contoso Labs')).toBeVisible()

    await app.close()
    running = undefined
    const reopened = await launch()
    const reopenedPage = await reopened.firstWindow()
    await expect(reopenedPage.locator('[data-ui-ready="true"]')).toBeVisible()
    await reopenedPage.getByRole('button', { name: 'Saved jobs' }).click()
    await reopenedPage.locator('.saved-job-list').getByRole('button', { name: /Fictional Platform Engineer/ }).click()
    await expect(reopenedPage.getByLabel('Job description and requirements')).toHaveValue('Build reliable data tools.\nRequirements: TypeScript and testing.')
    await reopenedPage.getByRole('button', { name: 'Tailor CV' }).click()
    await expect(reopenedPage.getByText('Target: Fictional Platform Engineer · Northwind Research')).toBeVisible()
    await expect(reopenedPage.getByText('Target: Fictional Product Analyst · Contoso Labs')).toHaveCount(0)
    await reopened.close()
    running = undefined
  } finally {
    await running?.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
