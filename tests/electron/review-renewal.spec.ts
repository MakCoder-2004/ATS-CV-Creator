import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

 test('stale posting review can explicitly reassess and renew unchanged CV wording', async () => {
  test.setTimeout(120000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-review-renewal-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], timeout: 60000, env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'generation' } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    const setup = await page.evaluate(async () => {
      const skill = await window.workbench.saveSkill({ name: 'TypeScript', category: 'Programming' })
      if (!skill.ok) throw new Error('Could not save test evidence')
      const job = await window.workbench.saveJob({ title: 'Software Engineer', company: 'Example Systems', description: 'TypeScript is required for this role.' })
      if (!job.ok) throw new Error('Could not save test posting')
      const preview = await window.workbench.prepareOutboundConsent(job.value.id)
      if (!preview.ok) throw new Error(preview.message)
      const accepted = await window.workbench.acceptOutboundConsent(preview.token, true, true)
      if (!accepted.ok) throw new Error(accepted.message)
      const analysis = await window.workbench.startAnalysis(preview.token)
      if (analysis.status !== 'complete') throw new Error(analysis.progress)
      const generated = await window.workbench.generateDraft(preview.token, 1)
      if (!generated.ok || !generated.draft) throw new Error(generated.message)
      return { job: job.value, content: JSON.stringify(generated.draft.content) }
    })

    await page.evaluate(async job => {
      const saved = await window.workbench.saveJob({ id: job.id, title: job.title, company: job.company, description: 'TypeScript and distributed-systems experience are required.' })
      if (!saved.ok) throw new Error(saved.error.message)
    }, setup.job)
    await page.reload()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Saved jobs' }).click()
    const savedRow = page.getByRole('row').filter({ hasText: 'Software Engineer' })
    await expect(savedRow.getByText('Earlier target', { exact: true })).toBeVisible()
    await savedRow.getByRole('button', { name: 'Open posting' }).click()
    const notice = page.getByRole('status', { name: 'Earlier posting review' })
    const attemptsBeforeRenewal = await page.evaluate(() => window.workbench.getAnalysisUsage().then(value => value.attempts))
    await expect(notice.getByRole('heading', { name: 'This CV targets an earlier posting' })).toBeVisible()
    await expect(notice).toContainText('approval does not cover the accepted posting revision')
    await page.setViewportSize({ width: 375, height: 812 })
    await page.getByRole('button', { name: 'Use dark mode' }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(notice).toBeVisible()
    expect(await page.evaluate(() => window.workbench.getAnalysisUsage().then(value => value.attempts))).toBe(attemptsBeforeRenewal)
    await page.setViewportSize({ width: 1440, height: 900 })
    expect(await page.evaluate(id => window.workbench.assertDraftExportable(id), setup.job.id)).toMatchObject({ ok: false })
    await notice.getByRole('button', { name: 'Review outgoing data for current posting' }).click()
    expect(await page.evaluate(() => window.workbench.getAnalysisUsage().then(value => value.attempts))).toBe(attemptsBeforeRenewal)
    const workflow = page.getByRole('region', { name: 'Tailoring workflow' })
    await workflow.getByRole('checkbox', { name: /reviewed what is sent/i }).check()
    await workflow.getByRole('button', { name: 'Authorize this run' }).click()
    const renewButton = workflow.getByRole('button', { name: 'Review existing CV against this posting' })
    await expect(renewButton).toBeVisible({ timeout: 30000 })
    await expect(workflow.getByRole('region', { name: 'Posting analysis' })).toContainText('Posting analysis ready')
    await renewButton.click()
    await expect(page.getByRole('article', { name: 'Draft CV review layout' })).toBeVisible()
    const renewed = await page.evaluate(async id => ({ draft: await window.workbench.getDraft(id), job: await window.workbench.openJob(id), export: await window.workbench.assertDraftExportable(id) }), setup.job.id)
    expect(JSON.stringify(renewed.draft?.content)).toBe(setup.content)
    expect(renewed.draft?.targetPostingUpdatedAt).toBe(renewed.job?.updatedAt)
    expect(renewed.draft?.approved).toBe(false)
    expect(renewed.export.ok).toBe(false)
    expect(await page.evaluate(id => window.workbench.checkDraft(id), setup.job.id)).toMatchObject({ passed: true })
    expect(await page.evaluate(id => window.workbench.approveDraft(id), setup.job.id)).toMatchObject({ ok: false, message: expect.stringMatching(/measure/i) })
    await expect(page.getByRole('checkbox', { name: 'I reviewed this CV and its wording.' })).toBeVisible()
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
