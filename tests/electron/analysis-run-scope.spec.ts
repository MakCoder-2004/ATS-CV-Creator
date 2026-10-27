import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selectScriptedPiModel } from './pi-model-fixture'

test('missing Pi model blocks outgoing-data review before any analysis request', async () => {
  test.setTimeout(90000) // A cold Windows Electron launch can exceed the default 30-second test budget.
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-analysis-error-ui-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: '' } })
  try {
    const page = await app.firstWindow({ timeout: 60000 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.getByLabel('Job title').fill('Systems engineer')
    await page.getByLabel('Company').fill('Example Systems')
    await page.getByLabel('Full job posting').fill('TypeScript experience is required.')
    await page.getByRole('button', { name: 'Save job' }).click()
    await page.getByRole('button', { name: 'Tailor CV', exact: true }).click()
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    await expect(page.getByRole('alert')).toContainText(/Choose an available Pi model/i)
    await expect(page.getByRole('checkbox', { name: /reviewed what is sent/ })).toHaveCount(0)
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
  const app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'generation', CV_TAILOR_SCRIPTED_PI_MODEL: '1' } })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await selectScriptedPiModel(page)
    await page.getByRole('button', { name: 'My profile' }).click()
    await page.getByLabel('Full name').fill('Ada Example')
    await page.getByRole('button', { name: 'Save contact details' }).click()
    await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('button', { name: 'Skills' }).click()
    await page.getByLabel('Skill name').fill('TypeScript')
    await page.getByRole('button', { name: 'Add skill' }).click()
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Give every CV a clear target.' })).toBeVisible()
    await page.locator('.saved-jobs-page-header').getByRole('button', { name: 'New job' }).click()
    await page.getByLabel('Job title').fill('Systems engineer')
    await page.getByLabel('Company').fill('Example Systems')
    await page.getByLabel('Full job posting').fill('TypeScript experience is required.')
    await page.getByRole('button', { name: 'Save job' }).click()
    await page.getByRole('button', { name: 'Tailor CV', exact: true }).click()
    const authorize = async () => {
      await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
      await page.getByRole('button', { name: 'Authorize and start this run' }).click()
    }
    await authorize()
    await expect(page.getByRole('button', { name: 'Generate tailored draft' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Analyze posting' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Revoke this run' }).click()
    await authorize()
    await expect(page.getByRole('button', { name: 'Generate tailored draft' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Analyze posting' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Generate tailored draft' }).click()
    await expect(page.getByRole('region', { name: 'CV review' })).toBeVisible({ timeout: 30000 })
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
