import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('development Electron keeps paragraph sources and local editing without advanced regeneration', async () => {
  test.setTimeout(120000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-paragraph-review-'))
  const dispatchLog = 'model-dispatches.log'
  const dispatches = () => {
    try {
      return readFileSync(join(userData, dispatchLog), 'utf8').trim().split(/\r?\n/).filter(Boolean)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_TEST_MODEL_DISPATCH_LOG: dispatchLog, CV_TAILOR_SCRIPTED_ANALYSIS: 'generation' }, timeout: 60000 })
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
    await page.getByLabel('Full job posting').fill('Build reliable services and evaluation tools.')
    await page.getByRole('button', { name: 'Save job' }).click()
    await page.getByRole('button', { name: 'Tailor CV', exact: true }).click()
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const flow = page.getByRole('region', { name: 'Tailoring workflow' })
    expect(dispatches()).toEqual([])
    expect(dispatches()).toEqual([])
    await flow.getByRole('button', { name: 'Authorize and start this run' }).click()
    await expect(flow.getByRole('button', { name: 'Generate tailored draft' })).toBeVisible({ timeout: 60000 })
    expect(dispatches()).toEqual(['qualification-extraction'])
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
    await expect(selected.getByRole('button', { name: 'Suggest different wording' })).toHaveCount(0)
    const beforeEditing = dispatches()
    expect(beforeEditing).toEqual(['qualification-extraction', 'evidence-scoring', 'generation'])
    await selected.getByRole('button', { name: 'Edit wording' }).click()
    await selected.getByRole('textbox', { name: 'Wording for this CV' }).fill('Built reliable services and supported deployment.')
    await selected.getByRole('button', { name: 'Save wording' }).click()
    await expect(paper.locator('.paper-entry--experience .paper-paragraph')).toContainText('supported deployment')
    expect(dispatches()).toEqual(beforeEditing)
    await paper.getByRole('button', { name: 'Review sources for Monitor' }).click()
    await expect(selected).toContainText('evaluation dashboard')
    await expect(flow.getByRole('region', { name: 'Compare suggestion' })).toHaveCount(0)
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
