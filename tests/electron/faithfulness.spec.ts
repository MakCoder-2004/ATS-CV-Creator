import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('visible faithfulness report blocks a draft without requiring an OpenRouter key', async () => {
  test.setTimeout(90000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-faithfulness-'))
  const app = await electron.launch({ args: ['.'], timeout: 60000, env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'faithfulness' } })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.evaluate(async () => {
      await window.workbench.setFaithfulnessCheck(true)
      await window.workbench.saveContact({ fullName: 'Local Smoke Candidate' })
      await window.workbench.saveSkill({ name: 'TypeScript', category: 'Programming' })
      await window.workbench.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Private Local Employer', description: 'Built reliable TypeScript services.' })
      await window.workbench.saveJob({ title: 'Software Engineer', company: 'Example Company', description: 'TypeScript and reliable systems experience required.' })
    })
    await page.reload()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.locator('.saved-job-row').getByRole('button', { name: 'Open posting' }).click()
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const review = page.getByRole('region', { name: 'Tailoring workflow' })
    await review.getByRole('checkbox', { name: /reviewed what is sent/ }).check()
    await review.getByRole('button', { name: 'Authorize this run' }).click()
    await review.getByRole('button', { name: 'Analyze posting' }).click()
    await expect(review.getByRole('button', { name: 'Generate tailored draft' })).toBeVisible({ timeout: 60000 })
    await review.getByRole('button', { name: 'Generate tailored draft' }).click()
    const draft = review.getByRole('region', { name: 'Source-linked draft' })
    await expect(draft).toContainText('blocked by factual checks', { timeout: 60000 })
    await expect(draft).toContainText('Second-opinion faithfulness check')
    await expect(draft).toContainText('second opinions, not proof')
    expect(await page.evaluate(() => window.workbench.getSettings().then(value => value.openRouter.credential.configured))).toBe(false)
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
