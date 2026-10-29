import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Review retains local title editing and removal without advanced options', async () => {
  test.setTimeout(120000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-title-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'generation' } })
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.evaluate(async () => {
      await window.workbench.saveContact({ fullName: 'Synthetic Candidate', headline: 'Old profile headline', email: 'candidate@example.test' })
      await window.workbench.saveExperience({ kind: 'employment', title: 'Operations Analyst', organization: 'Example Freight', description: 'Prepared operations dashboards and checked shipment records.' })
      await window.workbench.saveSkill({ name: 'SQL', category: 'Languages' })
      const job = await window.workbench.saveJob({ title: 'Operations Data Analyst', company: 'Example Co', description: 'Prepare weekly reports and inspect operational trends.' })
      if (!job.ok) throw new Error(job.error.message)
    })
    await page.reload()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.locator('.sidebar-job-items').getByRole('button', { name: /Operations Data Analyst/ }).click()
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const flow = page.getByRole('region', { name: 'Tailoring workflow' })
    await flow.getByRole('button', { name: 'Authorize and start this run' }).click()
    await flow.getByRole('button', { name: 'Generate tailored draft' }).click()
    const paper = page.getByRole('article', { name: 'Draft CV review layout' })
    await expect(paper.locator('.paper-cv-title')).toHaveText('Operations Analyst', { timeout: 30000 })
    await expect(paper.locator('.paper-cv-title')).toHaveCSS('font-size', '16px')
    await expect(paper).not.toContainText('Old profile headline')
    await expect(paper.locator('.paper-cv-title')).not.toHaveText('Operations Data Analyst')
    const profile = await page.evaluate(() => window.workbench.getProfile())
    const editTitle = page.getByRole('region', { name: 'CV document' }).getByRole('button', { name: 'Edit CV title' })
    await editTitle.click()
    const titleEditor = page.getByRole('dialog', { name: 'Edit CV title' })
    await expect(titleEditor.getByRole('textbox', { name: 'CV title for this CV' })).toBeFocused()
    await titleEditor.getByRole('textbox', { name: 'CV title for this CV' }).fill('Senior Operations Analyst')
    await titleEditor.getByRole('button', { name: 'Save CV title' }).click()
    await expect(titleEditor).not.toBeVisible()
    await expect(paper.locator('.paper-cv-title')).toHaveText('Senior Operations Analyst')
    await expect(page.getByRole('button', { name: 'Approve CV' })).toBeDisabled()
    expect(await page.evaluate(() => window.workbench.getProfile())).toEqual(profile)
    await page.setViewportSize({ width: 375, height: 812 })
    await editTitle.click()
    await expect(titleEditor).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(titleEditor).not.toBeVisible()
    await expect(editTitle).toBeFocused()
    await editTitle.click()
    await titleEditor.getByRole('button', { name: 'Remove CV title' }).click()
    await expect(paper.locator('.paper-cv-title')).toHaveCount(0)
    await expect(editTitle).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Suggest CV title' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Checks & options/ })).toHaveCount(0)
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
