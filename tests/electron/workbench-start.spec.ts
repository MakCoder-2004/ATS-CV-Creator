import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Tailor CV follows the focused workbench phases and keeps the selected posting in view', async () => {
  test.setTimeout(90000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-workbench-start-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  const launch = async () => { app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'retry' } }); return app }
  try {
    let page = await (await launch()).firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Start with the right role.', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Choose a posting first' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Tailoring phases' }).locator('[aria-current="step"]')).toContainText('Job posting')

    await page.getByRole('button', { name: 'Open saved jobs' }).click()
    await expect(page.getByRole('heading', { name: 'Your first job starts here' })).toBeVisible()
    await page.getByLabel('Job title').fill('Fictional Data Engineer')
    await page.getByLabel('Company').fill('Example Works')
    await page.getByLabel('Full job posting').fill('Build reliable data pipelines with TypeScript.')
    await page.getByRole('button', { name: 'Save job' }).click()
    await page.getByRole('button', { name: 'Tailor CV', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Fictional Data Engineer' })).toBeVisible()
    await expect(page.getByText('Build reliable data pipelines with TypeScript.')).toBeVisible()
    const phases = page.getByRole('navigation', { name: 'Tailoring phases' })
    await expect(phases.locator('[aria-current="step"]')).toContainText('Job posting')
    const phaseBar = await phases.boundingBox()
    const phaseSteps = await phases.locator('ol').boundingBox()
    expect(phaseBar).not.toBeNull()
    expect(phaseSteps).not.toBeNull()
    expect(phaseSteps!.width).toBeGreaterThan(phaseBar!.width * 0.9)
    await expect(phases).toHaveCSS('border-left-style', 'solid')
    await expect(phases).toHaveCSS('border-right-style', 'solid')
    await expect(phases).toHaveCSS('border-radius', '6px')
    await expect(page.locator('.posting-overview')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'A profile to build from' })).toBeVisible()

    await page.getByRole('button', { name: 'My profile' }).click()
    await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible()
    await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('button', { name: 'Skills' }).click()
    await page.getByLabel('Skill name').fill('TypeScript')
    await page.getByRole('button', { name: 'Add skill' }).click()
    await expect(page.getByText('Skill added')).toBeVisible()

    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.locator('.saved-jobs-page-header').getByRole('button', { name: 'New job' }).click()
    await page.getByLabel('Job title').fill('Fictional Product Analyst')
    await page.getByLabel('Company').fill('Contoso Labs')
    await page.getByLabel('Full job posting').fill('Review fictional product metrics and share findings.')
    await page.getByRole('button', { name: 'Save job' }).click()
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Tailor CV' }).click()
    await page.locator('.sidebar-job-items').getByRole('button', { name: /Fictional Data Engineer/ }).click()
    await expect(page.locator('.posting-overview').getByText('Example Works')).toBeVisible()

    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const review = page.getByRole('region', { name: 'Tailoring workflow' })
    await expect(review.getByRole('heading', { name: 'Your data, before it leaves' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Tailoring phases' }).locator('[aria-current="step"]')).toContainText('Outgoing data')
    await review.getByRole('button', { name: 'Authorize and start this run' }).click()
    await expect(review.getByRole('alert').first()).toContainText('The provider could not complete the request.', { timeout: 30000 })
    await expect(review.getByRole('alert')).toHaveCount(1)
    await expect(review.getByRole('alert').first()).not.toContainText('Check the connection or Settings')
    await expect(review.getByRole('heading', { name: 'Required qualifications' })).toHaveCount(0)
    await review.getByRole('button', { name: 'Review outgoing data again' }).click()
    await expect(review.getByRole('heading', { name: 'Your data, before it leaves' })).toBeVisible()
    await review.getByRole('button', { name: 'Authorize and start this run' }).click()
    await expect(review.getByRole('heading', { name: 'Required qualifications' })).toBeVisible({ timeout: 60000 })
    await expect(review.getByRole('button', { name: 'Generate tailored draft' })).toBeVisible()
    await expect(review.getByRole('button', { name: 'Analyze posting' })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Tailoring phases' }).locator('[aria-current="step"]')).toContainText('Generate')
    await expect(review.getByRole('region', { name: 'Posting analysis' })).toBeVisible()
    await page.getByRole('button', { name: 'Use dark mode' }).click()
    await expect(review.getByRole('heading', { name: 'Required qualifications' })).toBeVisible()

    await page.setViewportSize({ width: 375, height: 812 })
    const layout = await page.locator('.cv-workbench-start').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }))
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width)
    await page.setViewportSize({ width: 812, height: 375 })
    const landscapeLayout = await page.locator('.cv-workbench-start').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }))
    expect(landscapeLayout.scrollWidth).toBeLessThanOrEqual(landscapeLayout.width)

    await app?.close(); app = undefined
    page = await (await launch()).firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.locator('.sidebar-job-items').getByRole('button', { name: /Fictional Data Engineer/ }).click()
    await expect(page.getByRole('heading', { name: 'Start with the right role.', exact: true })).toBeVisible()
    await expect(page.locator('.posting-overview')).toBeVisible()
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
