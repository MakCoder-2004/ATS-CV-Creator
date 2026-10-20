import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('visible recovery waits for explicit resume after Electron close and reopen', async () => {
  test.setTimeout(60000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-recovery-ui-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: ['.'], timeout: 60000, env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'recovery' } })
    let page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    const setup = await page.evaluate(async () => {
      const role = await window.workbench.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Frozen Employer', description: 'Built reliable software systems.' })
      const job = await window.workbench.saveJob({ title: 'Engineer', company: 'Target Inc', description: 'Build reliable systems.' })
      if (!role.ok || !job.ok) throw new Error('Could not set up recovery fixture.')
      const consent = await window.workbench.prepareOutboundConsent(job.value.id)
      if (!consent.ok) throw new Error(consent.message)
      const accepted = await window.workbench.acceptOutboundConsent(consent.token, true, true)
      if (!accepted.ok) throw new Error(accepted.message)
      await window.workbench.startAnalysis(consent.token)
      const generation = await window.workbench.generateDraft(consent.token)
      return { jobId: job.value.id, generation, recovery: await window.workbench.getGenerationRecovery(job.value.id) }
    })
    expect(setup.generation.ok).toBe(false)
    expect(setup.recovery).toMatchObject({ status: 'paused', canResume: true })
    await app.close(); app = undefined

    app = await electron.launch({ args: ['.'], timeout: 60000, env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'generation' } })
    page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    const before = await page.evaluate(jobId => window.workbench.getGenerationRecovery(jobId), setup.jobId)
    expect(before?.runId).toBe(setup.recovery?.runId)
    await expect(page.getByRole('heading', { name: 'Interrupted generation' })).toHaveCount(0)
    await page.getByRole('button', { name: /Engineer Target Inc/ }).click()
    const recovery = page.getByRole('heading', { name: 'Interrupted generation' }).locator('..')
    await expect(recovery).toContainText('No requests will be sent until you choose to resume.')
    const attemptsBefore = await page.evaluate(() => window.workbench.getAnalysisUsage().then(value => value.attempts))
    await expect(recovery.getByRole('button', { name: 'Resume saved generation' })).toBeVisible()
    expect(await page.evaluate(jobId => window.workbench.getGenerationRecovery(jobId).then(value => value?.runId), setup.jobId)).toBe(before?.runId)
    expect(await page.evaluate(() => window.workbench.getAnalysisUsage().then(value => value.attempts))).toBe(attemptsBefore)
    await recovery.getByRole('button', { name: 'Resume saved generation' }).click()
    await expect(page.getByLabel('Source-linked draft')).toContainText('Draft · unverified and unapproved', { timeout: 15000 })
    expect(await page.evaluate(jobId => window.workbench.getDraft(jobId).then(value => value?.content.experience.length), setup.jobId)).toBe(1)
    expect(await page.evaluate(jobId => window.workbench.getGenerationRecovery(jobId), setup.jobId)).toBeNull()
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
