import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('development Electron selects a generated paragraph and source, opens its editor, and compares a scoped replacement', async () => {
  test.setTimeout(120000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-paragraph-review-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'generation' }, timeout: 60000 })
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.evaluate(async () => {
      await window.workbench.saveContact({ fullName: 'Synthetic Candidate' })
      await window.workbench.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Example Systems', description: 'Built reliable services and supported deployment.' })
      await window.workbench.saveProject({ name: 'Monitor', description: 'Built an evaluation dashboard.' })
    })
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.getByLabel('Job title').fill('Engineer')
    await page.getByLabel('Company').fill('Target')
    await page.getByLabel('Posting and requirements').fill('Build reliable services and evaluation tools.')
    await page.getByRole('button', { name: 'Save job' }).click()
    await page.getByRole('button', { name: 'Tailor CV', exact: true }).click()
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const flow = page.getByRole('region', { name: 'Tailoring workflow' })
    await flow.getByRole('checkbox', { name: /reviewed what is sent/i }).check()
    await flow.getByRole('button', { name: 'Authorize this run' }).click()
    await expect(flow.getByRole('button', { name: 'Generate tailored draft' })).toBeVisible({ timeout: 60000 })
    await flow.getByRole('button', { name: 'Generate tailored draft' }).click()
    const paper = page.getByRole('article', { name: 'Draft CV review layout' })
    await expect(paper.locator('.paper-entry--experience .paper-paragraph')).toContainText('Built reliable services', { timeout: 45000 })
    await expect(paper.locator('.paper-entry--projects .paper-paragraph')).toContainText('evaluation dashboard')
    await paper.getByRole('button', { name: 'Review sources for Engineer' }).click()
    const selected = page.getByRole('region', { name: 'Selected wording and sources' })
    await expect(selected).toContainText('Built reliable services')
    await expect(selected).toContainText('supported deployment')
    await selected.getByRole('button', { name: 'Edit record' }).click()
    const editor = page.getByRole('dialog')
    await expect(editor.getByLabel('Experience details')).toHaveValue(/Built reliable services/)
    await editor.getByRole('button', { name: /Cancel/i }).click()
    await selected.getByRole('button', { name: 'Suggest different wording' }).click()
    const consent = flow.getByText('What will be shared for this suggestion').locator('..')
    await consent.getByRole('checkbox', { name: /reviewed this bundle/ }).check()
    await consent.getByRole('button', { name: 'Authorize and propose' }).click()
    const comparison = flow.getByRole('region', { name: 'Compare suggestion' })
    await expect(comparison.getByRole('heading', { name: 'Current', exact: true })).toBeVisible({ timeout: 30000 })
    await expect(comparison.getByRole('heading', { name: 'Suggested', exact: true })).toBeVisible()
    const jobId = await page.evaluate(() => window.workbench.listJobs().then(jobs => jobs[0].id))
    const before = await page.evaluate(id => window.workbench.getDraft(id), jobId)
    expect(before?.content.experience[0].descriptionFormat).toBe('paragraph')
    await comparison.getByRole('button', { name: 'Reject proposal' }).click()
    expect((await page.evaluate(id => window.workbench.getDraft(id), jobId))?.revision).toBe(before?.revision)
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
