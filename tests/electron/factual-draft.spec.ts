import { openReviewDetails } from './review-helpers'
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('visible failed-draft findings can be corrected and rechecked without losing the source draft', async () => {
  test.setTimeout(90000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-factual-ui-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], timeout: 60000, env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'factual' } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'My profile' }).click()
    await page.getByLabel('Full name').fill('Local Candidate')
    await page.getByRole('button', { name: 'Save contact details' }).click()
    await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('button', { name: 'Experience' }).click()
    await page.getByRole('button', { name: 'Add role' }).click()
    await page.getByLabel('Role or training title').fill('Engineer')
    await page.getByLabel('Company or institution').fill('Example')
    await page.getByLabel('Original description').fill('Reduced delivery time by 12 percent.')
    await page.getByRole('button', { name: 'Save role' }).click()
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.getByLabel('Job title').fill('Engineer')
    await page.getByLabel('Company').fill('Example')
    await page.getByLabel('Full job posting').fill('Engineering experience required.')
    await page.getByRole('button', { name: 'Save job' }).click()
    await page.getByRole('button', { name: 'Tailor CV', exact: true }).click()
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const review = page.getByRole('region', { name: 'Tailoring workflow' })
    await review.getByRole('button', { name: 'Authorize and start this run' }).click()
    await review.getByRole('button', { name: 'Generate tailored draft' }).click()
    const draft = review.getByRole('region', { name: 'CV review' })
    const jobId = await page.evaluate(() => window.workbench.listJobs().then(jobs => jobs[0].id))
    await openReviewDetails(page, 'skills')
    await expect(page.getByRole('region', { name: 'New skills to review' })).toBeVisible({ timeout: 60000 })
    const pendingSkills = (await page.evaluate(id => window.workbench.getDraft(id), jobId))?.suggestedSkills?.filter(skill => skill.status === 'pending') ?? []
    for (const skill of pendingSkills) await page.getByRole('region', { name: 'New skills to review' }).getByRole('button', { name: `Remove ${skill.name}` }).click()
    await expect(draft).toContainText('Needs changes', { timeout: 60000 })
    await draft.getByRole('button', { name: 'Review issues' }).click()
    await expect(page.getByRole('group', { name: 'Review issues' })).toBeVisible()
    await expect(draft).toContainText('900 percent')
    await expect(draft).toContainText('not present in the cited evidence')
    await page.getByRole('article', { name: 'Draft CV review layout' }).getByRole('button', { name: /Review sources for Engineer/ }).first().click()
    await openReviewDetails(page, 'sources')
    const selected = page.getByRole('region', { name: 'Selected wording and sources' })
    await selected.getByRole('button', { name: 'Edit wording' }).click()
    await selected.getByRole('textbox', { name: 'Wording for this CV' }).fill('Reduced delivery time by 12 percent.')
    await selected.getByRole('button', { name: 'Save wording' }).click()
    await expect(draft).toContainText('Finish reviewing', { timeout: 10000 })
    await expect(page.getByRole('article', { name: 'Draft CV review layout' })).toContainText('Reduced delivery time by 12 percent.')
    await expect(draft.getByRole('button', { name: 'Approve CV' })).toBeDisabled()
    await expect(review.getByRole('button', { name: 'Export editable DOCX' })).toHaveCount(0)
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
