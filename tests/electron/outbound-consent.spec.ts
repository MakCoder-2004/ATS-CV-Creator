import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selectScriptedPiModel } from './pi-model-fixture'

test('user inspects minimized data, declines or explicitly authorizes only one run', async () => {
  test.setTimeout(120000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-consent-ui-'))
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: '1', CV_TAILOR_SCRIPTED_PI_MODEL: '1' } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await selectScriptedPiModel(page)
    await page.getByRole('button', { name: 'My profile' }).click()
    await page.getByLabel('Full name').fill('Ada Canary')
    await page.getByLabel('Email').fill('ada.private@example.test')
    await page.getByRole('button', { name: 'Save contact details' }).click()
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.getByLabel('Job title').fill('Canary Engineer')
    await page.getByLabel('Company').fill('Northstar Canary')
    await page.getByLabel('Posting and requirements').fill('Northstar Canary needs an engineer. Send details to hiring@example.test.')
    await page.getByRole('button', { name: 'Save job' }).click()
    await page.getByRole('button', { name: 'Tailor CV', exact: true }).click()

    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const review = page.getByRole('region', { name: 'Tailoring workflow' })
    await expect(review.getByRole('heading', { name: 'Your data, before it leaves' })).toBeVisible()
    const phaseNav = page.getByRole('navigation', { name: 'Tailoring phases' })
    await expect(phaseNav.locator('[aria-current="step"]')).toContainText('Outgoing data')
    const [reviewBounds, phaseBounds] = await Promise.all([review.boundingBox(), phaseNav.boundingBox()])
    expect(reviewBounds).not.toBeNull()
    expect(phaseBounds).not.toBeNull()
    expect(Math.abs((reviewBounds!.x + reviewBounds!.width / 2) - (phaseBounds!.x + phaseBounds!.width / 2))).toBeLessThan(2)
    await expect(review.getByRole('heading', { name: 'What your selected model provider receives' })).toBeVisible()
    await expect(review.getByText('Read the included posting and profile details')).toBeVisible()
    await expect(review.locator('pre')).toHaveCount(0)
    await review.getByText('Read the included posting and profile details').click()
    await expect(review).toContainText('[[EMPLOYER_1]]')
    await expect(review).not.toContainText('Northstar Canary')
    await expect(review).not.toContainText('Ada Canary')
    await expect(review).not.toContainText('hiring@example.test')
    await expect(review).not.toContainText('ada.private@example.test')
    await review.getByText('Full privacy notice').click()
    await expect(review).toContainText('cannot guarantee anonymity')
    await expect(review.getByText(/Pi uses your existing sign-in/)).toBeVisible()
    await expect(review.getByRole('checkbox', { name: /reviewed what is sent/ })).toHaveCount(0)
    await expect(review.getByRole('button', { name: 'Authorize and start this run' })).toBeEnabled()
    await review.getByRole('button', { name: 'Back to posting' }).click()
    await expect(review).toHaveCount(0)

    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const secondReview = page.getByRole('region', { name: 'Tailoring workflow' })
    await expect(secondReview.getByRole('checkbox', { name: /reviewed what is sent/ })).toHaveCount(0)
    await secondReview.getByRole('button', { name: 'Authorize and start this run' }).click()
    await expect(secondReview.getByRole('heading', { name: 'What this role calls for' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('navigation', { name: 'Tailoring phases' }).locator('[aria-current="step"]')).toContainText('Generate')
    await secondReview.getByRole('button', { name: 'Revoke this run' }).click()
    await expect(secondReview).toHaveCount(0)
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    await expect(page.getByRole('region', { name: 'Tailoring workflow' }).getByRole('checkbox', { name: /reviewed what is sent/ })).toHaveCount(0)
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
