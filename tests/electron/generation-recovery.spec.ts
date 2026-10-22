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
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], timeout: 60000, env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'recovery' } })
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
    expect(setup.recovery).toMatchObject({ status: 'uncertain', uncertainAttempts: 1, canResume: true })
    await app.close(); app = undefined

    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], timeout: 60000, env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'generation' } })
    page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    const before = await page.evaluate(jobId => window.workbench.getGenerationRecovery(jobId), setup.jobId)
    expect(before?.runId).toBe(setup.recovery?.runId)
    await expect(page.getByRole('heading', { name: 'Interrupted generation' })).toHaveCount(0)
    await page.getByRole('button', { name: /Engineer Target Inc/ }).click()
    const recovery = page.getByRole('heading', { name: 'Interrupted generation' }).locator('..')
    await expect(recovery).toContainText('Retrying may duplicate it and use another attempt')
    await expect(recovery.locator(':scope > *')).toHaveCount(3)
    await expect(recovery.locator('.recovery-actions button')).toHaveCount(2)
    await page.setViewportSize({ width: 1440, height: 900 })
    const buttons = recovery.locator('.recovery-actions button')
    const [primary, secondary] = await Promise.all([buttons.nth(0).boundingBox(), buttons.nth(1).boundingBox()])
    expect(primary?.y).toBe(secondary?.y)
    expect((await recovery.locator('p').boundingBox())?.height).toBeLessThanOrEqual(26)
    expect((await recovery.boundingBox())?.width).toBeLessThanOrEqual(760)
    await recovery.screenshot({ path: 'test-results/recovery-compact-desktop.png' })
    await page.getByRole('button', { name: 'Use dark mode' }).click()
    await page.setViewportSize({ width: 375, height: 812 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const [mobilePrimary, mobileSecondary] = await Promise.all([buttons.nth(0).boundingBox(), buttons.nth(1).boundingBox()])
    expect(mobilePrimary?.y).toBe(mobileSecondary?.y)
    await recovery.screenshot({ path: 'test-results/recovery-compact-mobile.png' })
    const attemptsBefore = await page.evaluate(() => window.workbench.getAnalysisUsage().then(value => value.attempts))
    await expect(recovery.getByRole('button', { name: 'Retry generation' })).toBeVisible()
    expect(await page.evaluate(jobId => window.workbench.getGenerationRecovery(jobId).then(value => value?.runId), setup.jobId)).toBe(before?.runId)
    expect(await page.evaluate(() => window.workbench.getAnalysisUsage().then(value => value.attempts))).toBe(attemptsBefore)
    await recovery.getByRole('button', { name: 'Retry generation' }).click()
    await expect.poll(async () => page.evaluate(() => window.workbench.getAnalysisUsage().then(value => value.attempts)), { timeout: 10000 }).toBe(attemptsBefore + 1)
    await expect(page.getByRole('region', { name: 'CV review', exact: true })).toContainText('Finish reviewing', { timeout: 15000 })
    expect(await page.evaluate(jobId => window.workbench.getDraft(jobId).then(value => value?.content.experience.length), setup.jobId)).toBe(1)
    expect(await page.evaluate(jobId => window.workbench.getGenerationRecovery(jobId), setup.jobId)).toBeNull()
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})

test('hard Electron close during a delayed provider request preserves uncertainty until explicit retry', async () => {
  test.setTimeout(90000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-inflight-recovery-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], timeout: 60000, env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'delayed' } })
    let page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    const jobId = await page.evaluate(async () => {
      const { pacificDay, attempts, warning, ...budgets } = await window.workbench.getAnalysisUsage()
      void pacificDay; void attempts; void warning
      await window.workbench.setAnalysisBudgets({ ...budgets, minimumSpacingMs: 0, rateLimitWindowMs: 1000 })
      const role = await window.workbench.saveExperience({ kind: 'employment', title: 'Engineer', organization: 'Frozen Employer', description: 'Built reliable software systems.' })
      const job = await window.workbench.saveJob({ title: 'Engineer', company: 'Target Inc', description: 'Build reliable systems.' })
      if (!role.ok || !job.ok) throw new Error('Could not set up in-flight recovery fixture.')
      const consent = await window.workbench.prepareOutboundConsent(job.value.id)
      if (!consent.ok) throw new Error(consent.message)
      await window.workbench.acceptOutboundConsent(consent.token, true, true)
      await window.workbench.startAnalysis(consent.token)
      void window.workbench.generateDraft(consent.token)
      return job.value.id
    })
    await expect.poll(async () => page.evaluate(id => window.workbench.getGenerationRecovery(id).then(value => value?.status), jobId), { timeout: 15000 }).toBe('uncertain')
    const beforeCrash = await page.evaluate(id => window.workbench.getGenerationRecovery(id), jobId)
    expect(beforeCrash?.uncertainAttempts).toBe(1)
    const electronProcess = app.process()
    const exited = new Promise<void>(resolve => electronProcess.once('exit', () => resolve()))
    electronProcess.kill()
    await exited; app = undefined

    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], timeout: 60000, env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'generation' } })
    page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: /Engineer Target Inc/ }).click()
    const recovery = page.getByRole('heading', { name: 'Interrupted generation' }).locator('..')
    await expect(recovery).toContainText('may have been sent')
    const reopenedState = await page.evaluate(id => window.workbench.getGenerationRecovery(id), jobId)
    expect(reopenedState).toMatchObject({ uncertainAttempts: 1, attempts: beforeCrash?.attempts })
    await expect(recovery.getByRole('button', { name: 'Retry generation' })).toBeVisible()
    expect(reopenedState?.attempts).toBe(beforeCrash?.attempts)
    expect(await page.evaluate(id => window.workbench.getGenerationRecovery(id).then(value => value?.uncertainAttempts), jobId)).toBe(1)
  } finally {
    if (app) { const child = app.process(); if (child.exitCode === null && child.signalCode === null) { const exited = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill(); await Promise.race([exited, new Promise<void>(resolve => setTimeout(resolve, 3000))]) } }
    await Promise.race([rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }), new Promise<void>(resolve => setTimeout(resolve, 5000))])
  }
})
