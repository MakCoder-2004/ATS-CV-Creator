import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('analysis that cannot start reports the error without claiming the run is in progress', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-analysis-error-ui-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: '' } })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.getByLabel('Job title').fill('Systems engineer')
    await page.getByLabel('Company').fill('Example Systems')
    await page.getByLabel('Posting and requirements').fill('TypeScript experience is required.')
    await page.getByRole('button', { name: 'Save job' }).click()
    await page.getByRole('button', { name: 'Tailor CV', exact: true }).click()
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    await page.getByRole('checkbox', { name: /reviewed what is sent/ }).check()
    await page.getByRole('button', { name: 'Authorize this run' }).click()
    await page.getByRole('button', { name: 'Analyze posting' }).click()
    await expect(page.getByRole('alert')).toContainText('OpenRouter API key')
    await expect(page.getByRole('status').filter({ hasText: 'Your authorized run is in progress.' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Cancel analysis' })).toHaveCount(0)
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})

test('saved posting analysis does not skip analysis for a newly authorized draft run', async () => {
  test.setTimeout(120000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-run-scope-ui-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'generation' } })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'My profile' }).click()
    await page.getByLabel('Full name').fill('Ada Example')
    await page.getByRole('button', { name: 'Save contact details' }).click()
    await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('button', { name: 'Skills' }).click()
    await page.getByLabel('Skill name').fill('TypeScript')
    await page.getByRole('button', { name: 'Add skill' }).click()
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.getByLabel('Job title').fill('Systems engineer')
    await page.getByLabel('Company').fill('Example Systems')
    await page.getByLabel('Posting and requirements').fill('TypeScript experience is required.')
    await page.getByRole('button', { name: 'Save job' }).click()
    await page.getByRole('button', { name: 'Tailor CV', exact: true }).click()
    const authorize = async () => {
      await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
      await page.getByRole('checkbox', { name: /reviewed what is sent/ }).check()
      await page.getByRole('button', { name: 'Authorize this run' }).click()
    }
    await authorize()
    await page.getByRole('button', { name: 'Analyze posting' }).click()
    await expect(page.getByRole('button', { name: 'Generate tailored draft' })).toBeVisible()
    await page.getByRole('button', { name: 'Revoke this run' }).click()
    await authorize()
    await expect(page.getByRole('button', { name: 'Analyze posting' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Generate tailored draft' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Analyze posting' }).click()
    await expect(page.getByRole('button', { name: 'Generate tailored draft' })).toBeVisible()
    await page.getByRole('button', { name: 'Generate tailored draft' }).click()
    await expect(page.getByRole('region', { name: 'CV review' })).toBeVisible({ timeout: 30000 })
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
