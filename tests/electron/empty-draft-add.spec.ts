import { openReviewDetails } from './review-helpers'
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('user can add locally authored content to the visible empty failed draft', async () => {
  test.setTimeout(90000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-empty-draft-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], timeout: 60000, env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'foreign-citation' } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'My profile' }).click()
    await page.getByLabel('Full name').fill('Local Candidate')
    await page.getByRole('button', { name: 'Save contact details' }).click()
    await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('button', { name: 'Experience' }).click()
    await page.getByRole('button', { name: 'Add role' }).click()
    await page.getByLabel('Role or training title').fill('Engineer')
    await page.getByLabel('Company or institution').fill('Example')
    await page.getByLabel('Original description').fill('Built reliable services.')
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
    await expect(draft).toContainText('Needs changes', { timeout: 60000 })
    await page.setViewportSize({ width: 1440, height: 900 })
    await openReviewDetails(page, 'sources')
    const wordingPanel = page.getByRole('region', { name: 'Selected wording and sources' })
    await expect(wordingPanel).toBeVisible()
    await expect(wordingPanel).toContainText('The suggested wording could not be validated, so no CV wording was created.')
    await expect(wordingPanel).not.toContainText('Add saved career facts before approving it')
    await openReviewDetails(page, 'notes')
    await expect(draft.getByRole('heading', { name: /review issues? to resolve/i })).toBeVisible()
    await expect(draft).toContainText("We couldn't use the suggested wording")
    await draft.getByLabel('Correction evidence').selectOption({ index: 1 })
    await draft.getByLabel('Your correction').fill('Built reliable services.')
    await draft.getByRole('button', { name: 'Save local correction' }).click()
    await expect(page.getByRole('article', { name: 'Draft CV review layout' })).toContainText('Built reliable services.')
    await expect(draft).toContainText('Needs changes')
    await expect(draft.getByRole('button', { name: 'Approve CV' })).toBeDisabled()
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})

test('malformed scripted generation keeps the draft absent and shows one actionable error', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-malformed-draft-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], timeout: 60_000, env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'invalid' } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    const jobId = await page.evaluate(async () => {
      const role = await window.workbench.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Example', description: 'Built reliable services.' })
      const job = await window.workbench.saveJob({ title: 'Engineer', company: 'Example', description: 'Engineering experience required.' })
      if (!role.ok || !job.ok) throw new Error('Synthetic source could not be saved.')
      return job.value.id
    })
    await page.reload()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Engineer Example' }).click()
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const review = page.getByRole('region', { name: 'Tailoring workflow' })
    await review.getByRole('button', { name: 'Authorize and start this run' }).click()
    await expect(review.getByRole('button', { name: 'Generate tailored draft' })).toBeVisible({ timeout: 30_000 })
    await review.getByRole('button', { name: 'Generate tailored draft' }).click()
    const error = review.getByRole('alert').first()
    await expect(error).toContainText('The provider returned invalid structured data.', { timeout: 30_000 })
    await expect(review.getByRole('alert')).toHaveCount(1)
    await expect(error).not.toContainText('Check the connection or Settings')
    await expect(review.getByRole('button', { name: 'Review outgoing data again' })).toBeVisible()
    expect(await page.evaluate(id => window.workbench.getDraft(id), jobId)).toBeNull()
    expect(await page.evaluate(id => window.workbench.getGenerationRecovery(id), jobId)).toBeNull()
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
