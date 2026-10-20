import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('CV workbench guides setup without implying a generated draft and tracks the chosen job', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-workbench-start-'))
  let app: ElectronApplication | undefined
  const launch = async () => { app = await electron.launch({ args: ['.'], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'retry' } }); return app }
  try {
    let page = await (await launch()).firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your CV workbench' })).toBeVisible()
    await expect(page.getByText('No CV draft yet')).toBeVisible()
    const document = page.getByRole('region', { name: 'CV document' })
    await expect(document.getByText('Five CV sections')).toBeVisible()
    await expect(document.getByRole('heading', { level: 2 })).toHaveText(['Education', 'Experience', 'Projects', 'Skills', 'Certificates'])
    await expect(page.getByRole('complementary', { name: 'Workspace guide' }).getByText('Add your name and genuine career facts.')).toBeVisible()
    await expect(document.getByText('No job selected')).toBeVisible()
    await expect(document.locator('.paper')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(document.locator('.paper')).toHaveCSS('font-family', 'Arial, sans-serif')

    await page.getByRole('button', { name: 'Build your profile' }).click()
    await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible()
    await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('button', { name: 'Skills' }).click()
    await page.getByLabel('Skill name').fill('TypeScript')
    await page.getByRole('button', { name: 'Add skill' }).click()
    await expect(page.getByText('Skill added')).toBeVisible()
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Tailor CV' }).click()
    await expect(page.getByRole('complementary', { name: 'Workspace guide' }).getByText(/1 record across CV sections/)).toBeVisible()
    await expect(page.getByRole('region', { name: 'CV document' }).getByRole('heading', { name: 'Skills' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'CV document' }).getByText('TypeScript')).toBeVisible()

    await page.getByRole('button', { name: 'Save a job posting' }).click()
    await page.getByLabel('Job title').fill('Fictional Data Engineer')
    await page.getByLabel('Company').fill('Example Works')
    await page.getByLabel('Job description and requirements').fill('Build reliable data pipelines with TypeScript.')
    await page.getByRole('button', { name: 'Save posting' }).click()
    await expect(page.getByText('Posting saved on this device.')).toBeVisible()
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Tailor CV' }).click()
    await expect(page.getByText('Target: Fictional Data Engineer · Example Works')).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Workspace guide' }).getByText('Fictional Data Engineer at Example Works is selected.')).toBeVisible()
    await expect(page.getByText('No CV draft yet')).toBeVisible()
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    await expect(page.getByRole('region', { name: 'Outgoing data review' })).toBeVisible()
    await page.getByRole('checkbox', { name: /understand the Gemini free-tier/i }).check()
    await page.getByRole('button', { name: 'Authorize this run' }).click()
    await page.getByRole('button', { name: 'Analyze posting' }).click()
    await expect(page.getByText(/Temporary provider failure\. Retrying after a bounded/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Required qualifications' })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.outbound-review').getByText('TypeScript', { exact: true }).last()).toBeVisible()
    await page.getByRole('button', { name: 'Use dark mode' }).click()
    await expect(page.getByRole('region', { name: 'CV document' }).locator('.paper')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await page.setViewportSize({ width: 700, height: 800 })
    const layout = await page.locator('.cv-workbench-start').evaluate(element => {
      const guide = element.querySelector('.inspector')!.getBoundingClientRect()
      const document = element.querySelector('.document-area')!.getBoundingClientRect()
      return { guideTop: guide.top, documentTop: document.top, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }
    })
    expect(layout.guideTop).toBeLessThan(layout.documentTop)
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)

    await app?.close(); app = undefined
    page = await (await launch()).firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await expect(page.getByText('No CV draft yet')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Choose a saved job' })).toBeVisible()
    await page.getByRole('button', { name: 'Choose a saved job' }).click()
    await page.locator('.saved-job-list').getByRole('button', { name: /Fictional Data Engineer/ }).click()
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Tailor CV' }).click()
    await expect(page.getByText('Target: Fictional Data Engineer · Example Works')).toBeVisible()
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
