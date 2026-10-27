import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('cancel immediately invalidates regeneration consent when IPC cancellation rejects', async () => {
  test.setTimeout(120000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-regeneration-cancel-'))
  const dispatchLog = 'model-dispatches.log'
  const dispatches = () => {
    try { return readFileSync(join(userData, dispatchLog), 'utf8').trim().split(/\r?\n/).filter(Boolean) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  }
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_TEST_MODEL_DISPATCH_LOG: dispatchLog, CV_TAILOR_SCRIPTED_ANALYSIS: 'generation' }, timeout: 60000 })
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.evaluate(async () => {
      await window.workbench.saveContact({ fullName: 'Synthetic Candidate' })
      await window.workbench.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Example Systems', description: 'Built reliable services.' })
      await window.workbench.saveProject({ name: 'Monitor', description: 'Built an evaluation dashboard.' })
    })
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.getByLabel('Job title').fill('Engineer')
    await page.getByLabel('Company').fill('Target')
    await page.getByLabel('Full job posting').fill('Build reliable services.')
    await page.getByRole('button', { name: 'Save job' }).click()
    await page.getByRole('button', { name: 'Tailor CV', exact: true }).click()
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const flow = page.getByRole('region', { name: 'Tailoring workflow' })
    await flow.getByRole('button', { name: 'Authorize and start this run' }).click()
    await expect(flow.getByRole('button', { name: 'Generate tailored draft' })).toBeVisible({ timeout: 60000 })
    await flow.getByRole('button', { name: 'Generate tailored draft' }).click()
    await expect(page.getByRole('article', { name: 'Draft CV review layout' })).toBeVisible({ timeout: 60000 })
    const paper = page.getByRole('article', { name: 'Draft CV review layout' })
    await paper.getByRole('button', { name: /Review sources for Engineer/ }).click()
    const selected = page.getByRole('region', { name: 'Selected wording and sources' })
    await selected.getByRole('button', { name: 'Suggest different wording' }).click()
    const consent = flow.getByText('What will be shared for this suggestion').locator('..')
    await expect(consent.getByRole('button', { name: 'Authorize and propose' })).toBeEnabled()
    const beforeDispatches = dispatches()

    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('consent:outbound:cancel')
      ipcMain.handle('consent:outbound:cancel', async () => {
        await new Promise(resolve => { (globalThis as typeof globalThis & { releaseConsentCancel?: () => void }).releaseConsentCancel = () => resolve(undefined) })
        throw new Error('Synthetic cancellation failure')
      })
    })
    await consent.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(consent.getByRole('button', { name: 'Authorize and propose' })).toBeHidden()
    await app.evaluate(() => { (globalThis as typeof globalThis & { releaseConsentCancel?: () => void }).releaseConsentCancel?.() })
    await expect(flow.getByText(/authorization could not be cancelled/i)).toBeVisible()
    await expect(consent).toHaveCount(0)
    expect(dispatches()).toEqual(beforeDispatches)

    await flow.getByLabel('Regeneration section').selectOption('projects')
    await flow.getByLabel('Regeneration scope').selectOption('section')
    await flow.getByRole('button', { name: 'Review data for section regeneration' }).click()
    const freshConsent = flow.getByText('What will be shared for this suggestion').locator('..')
    await expect(freshConsent).toContainText('Target: projects · whole section')
    await expect(freshConsent.getByRole('button', { name: 'Authorize and propose' })).toBeEnabled()
    expect(dispatches()).toEqual(beforeDispatches)
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
