import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('saved-job deletion confirms single and bulk choices, preserves cancel state, and clears the active target', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-delete-ui-'))
  let running: ElectronApplication | undefined
  const launch = async () => {
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    return running
  }
  const pageOf = (app: ElectronApplication): Promise<Page> => app.firstWindow()
  try {
    let app = await launch()
    let page = await pageOf(app)
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    const jobs = await page.evaluate(async () => {
      const records = []
      for (const [title, company] of [['Platform Engineer', 'Northwind Research'], ['Product Analyst', 'Contoso Labs'], ['Systems Designer', 'Fabrikam Works']]) {
        const result = await window.workbench.saveJob({ title, company, description: `Synthetic posting for ${title}.` })
        if (!result.ok) throw new Error(result.error.message)
        records.push(result.value)
      }
      return records.map(({ id }) => id)
    })
    await app.close()
    running = undefined
    app = await launch()
    page = await pageOf(app)
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await expect(page.locator('.saved-job-row')).toHaveCount(3)
    await page.screenshot({ path: 'docs/validation/spec-72-d2/saved-jobs-light.png', fullPage: true })

    const activeRow = page.locator('.saved-job-row').filter({ hasText: 'Platform Engineer' })
    await activeRow.getByRole('button', { name: 'Open posting' }).click()
    await expect(page.getByRole('heading', { name: 'Platform Engineer', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()

    const selectedRow = page.locator('.saved-job-row').filter({ hasText: 'Product Analyst' })
    await selectedRow.getByRole('checkbox', { name: 'Select Product Analyst at Contoso Labs' }).check()
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Saved jobs' })).toHaveAttribute('aria-current', 'page')
    await expect(selectedRow).not.toHaveAttribute('aria-current', 'true')
    await page.getByRole('button', { name: 'Delete 1' }).click()
    const confirm = page.getByRole('dialog', { name: 'Delete this saved job?' })
    await expect(confirm).toBeVisible()
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await expect(confirm).toContainText('Product Analyst')
    await expect(confirm).toContainText('Contoso Labs')
    await expect(confirm).toContainText('Profile facts and exported files stay untouched')
    await expect(confirm).toContainText('Older history without a job link may remain in this workspace and in new backups.')
    await page.screenshot({ path: 'docs/validation/spec-72-d2/deletion-confirm-light.png', fullPage: true })
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(selectedRow.getByRole('checkbox', { name: 'Select Product Analyst at Contoso Labs' })).toBeChecked()
    await expect(page.getByRole('button', { name: 'Delete 1' })).toBeFocused()
    await expect(page.locator('.saved-job-row')).toHaveCount(3)

    await selectedRow.getByRole('button', { name: 'Delete' }).click()
    const singleConfirm = page.getByRole('dialog', { name: 'Delete this saved job?' })
    await expect(singleConfirm).toBeVisible()
    await expect(singleConfirm).toContainText('0 drafts will be deleted')
    const updated = await page.evaluate(async id => window.workbench.saveJob({ id, title: 'Product Analyst', company: 'Contoso Research', description: 'Updated synthetic posting.' }), jobs[1])
    expect(updated.ok).toBe(true)
    await singleConfirm.getByRole('button', { name: 'Delete 1 job' }).click()
    await expect(page.getByRole('alert')).toContainText('changed')
    await expect(page.getByRole('button', { name: 'Review selection again' })).toBeVisible()
    await expect(page.locator('.saved-job-row')).toHaveCount(3)
    await expect(page.locator('.saved-job-row').filter({ hasText: 'Product Analyst' }).getByRole('checkbox')).toBeChecked()
    await page.getByRole('button', { name: 'Review selection again' }).click()
    const freshConfirm = page.getByRole('dialog', { name: 'Delete this saved job?' })
    await expect(freshConfirm).toContainText('Contoso Research')
    await freshConfirm.getByRole('button', { name: 'Delete 1 job' }).click()
    await expect(page.locator('.saved-job-row')).toHaveCount(2)
    await expect(page.getByRole('status')).toContainText('Selected saved jobs and their local CV work were deleted.')

    await page.getByRole('button', { name: 'Use dark mode' }).click()
    await page.setViewportSize({ width: 375, height: 812 })
    const narrow = await page.locator('.saved-jobs-page').evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }))
    expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.clientWidth)
    await page.screenshot({ path: 'docs/validation/spec-72-d2/saved-jobs-dark-narrow.png', fullPage: true })

    await page.getByRole('checkbox', { name: 'Select all saved jobs' }).check()
    await expect(page.getByText('2 selected')).toBeVisible()
    await page.getByRole('button', { name: 'Delete 2' }).click()
    const bulkConfirm = page.getByRole('dialog', { name: 'Delete 2 saved jobs?' })
    await expect(bulkConfirm).toContainText('Platform Engineer')
    await expect(bulkConfirm).toContainText('Northwind Research')
    await expect(bulkConfirm).toContainText('Systems Designer')
    await expect(bulkConfirm).not.toContainText('Contoso Research')
    await expect(bulkConfirm).toContainText('2 jobs and 0 drafts will be deleted')
    await page.screenshot({ path: 'docs/validation/spec-72-d2/deletion-confirm-dark-narrow.png', fullPage: true })
    await bulkConfirm.getByRole('button', { name: 'Delete 2 jobs' }).click()
    await expect(page.locator('.saved-jobs-empty')).toBeVisible()
    await expect(page.locator('.saved-job-row')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Give every CV a clear target.' })).toBeFocused()

    await page.getByRole('button', { name: 'Tailor CV', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Choose a posting first' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Platform Engineer', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Generate tailored draft' })).toHaveCount(0)
    await expect(page.getByText(/Analyzing the authorized posting|Draft generation/i)).toHaveCount(0)
    await app.close()
    running = undefined
  } finally {
    await running?.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
