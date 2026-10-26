import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openReviewDetails } from './review-helpers'

const executablePath = process.env.CV_TAILOR_INSTALLED_EXE
const modelReference = process.env.CV_TAILOR_PI_LIVE_MODEL
const effort = process.env.CV_TAILOR_PI_LIVE_EFFORT
test.skip(!executablePath || !modelReference || !effort, 'Explicit installed Pi executable, model, and effort are required for real-provider checks')

test('installed Pi consented generation and regeneration leave the cited draft unchanged until accepted', async () => {
  test.setTimeout(900_000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-pi-regeneration-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const launch = () => electron.launch({ executablePath: executablePath!, args: [`--user-data-dir=${userData}`], timeout: 30_000 })
    app = await launch()
    let page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const preferences = page.getByRole('region', { name: 'Pi preferences' })
    const model = preferences.getByRole('region', { name: 'Pi model' })
    await model.getByLabel('Provider/model reference').fill(modelReference!)
    await model.getByLabel('Thinking level').click()
    await page.getByRole('option', { name: effort!, exact: true }).click()
    await model.getByRole('button', { name: 'Save Pi model' }).click()
    await expect(page.getByText('Pi model preference saved.')).toBeVisible()
    await page.getByRole('button', { name: 'Tailor CV', exact: true }).click()

    const setup = await page.evaluate(async () => {
      const contact = await window.workbench.saveContact({ fullName: 'Ari Example', headline: 'Synthetic Reliability Engineer', email: 'ari@example.test' })
      const skill = await window.workbench.saveSkill({ name: 'TypeScript', category: 'Programming' })
      const role = await window.workbench.saveExperience({ kind: 'employment', title: 'Systems Engineer', organization: 'Fictional Works', startDate: '2022-01', endDate: '2024-01', description: 'Built and maintained TypeScript services with documented reliability practices.', factualItems: [] })
      const job = await window.workbench.saveJob({ title: 'Reliability Engineer', company: 'Example Research', description: 'Responsibilities: maintain reliable software services and document operational decisions. Requirements: TypeScript and careful written communication.' })
      if (!contact.ok || !skill.ok || !role.ok || !job.ok) throw new Error('Could not create synthetic records.')
      return { jobId: job.value.id }
    })
    await page.reload()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: /Reliability Engineer.*Example Research/ }).click()
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const workflow = page.getByRole('region', { name: 'Tailoring workflow' })
    await workflow.getByText('Read the included posting and profile details').click()
    const outgoing = workflow.locator('.outbound-content-list')
    await expect(outgoing).not.toContainText('Ari Example')
    await expect(outgoing).not.toContainText('ari@example.test')
    await expect(outgoing).toContainText(/\[\[EMPLOYER_\d+\]\]/)
    await workflow.getByRole('button', { name: 'Authorize and start this run' }).click()
    await expect(workflow.getByRole('button', { name: 'Generate tailored draft' })).toBeVisible({ timeout: 90_000 })
    await workflow.getByRole('button', { name: 'Generate tailored draft' }).click()
    const review = page.getByRole('region', { name: 'CV review', exact: true })
    const failure = workflow.getByRole('alert').filter({ hasText: /provider returned|Pi could not|could not complete|failed to generate/i })
    await expect(review.or(failure).first()).toBeVisible({ timeout: 360_000 })
    if (await failure.isVisible()) throw new Error(`Installed generation failed: ${(await failure.textContent())?.slice(0, 300)}`)
    await expect(review).toContainText('Finish reviewing')
    const analysis = await page.evaluate(id => window.workbench.getAnalysis(id), setup.jobId)
    const draft = await page.evaluate(id => window.workbench.getDraft(id), setup.jobId)
    expect(analysis?.status, analysis?.progress).toBe('complete')
    expect(draft?.content.experience.length).toBeGreaterThan(0)
    expect(draft?.attempts).toBeGreaterThanOrEqual(3)
    const revision = draft!.revision

    await openReviewDetails(page, 'notes')
    await review.getByRole('button', { name: 'Improve a whole section' }).click()
    await review.getByLabel('Regeneration section').selectOption('experience')
    await review.getByLabel('Regeneration scope').selectOption('paragraph')
    await review.getByRole('button', { name: 'Review data for paragraph regeneration' }).click()
    const consent = review.getByText('What will be shared for this suggestion').locator('..')
    await expect(consent).toBeVisible()
    await expect(consent).not.toContainText('Ari Example')
    await expect(consent).not.toContainText('ari@example.test')
    await consent.getByRole('button', { name: 'Authorize and propose' }).click()
    const comparison = review.getByRole('region', { name: 'Compare suggestion' })
    const regenFailure = review.getByRole('status').filter({ hasText: /failed safely|could not|must complete|changed after consent/i })
    await expect(comparison.or(regenFailure).first()).toBeVisible({ timeout: 300_000 })
    if (await regenFailure.isVisible()) throw new Error(`Installed regeneration failed: ${(await regenFailure.textContent())?.slice(0, 300)}`)
    await expect(comparison).toContainText('Your CV will not change until you accept this suggestion.')
    expect((await page.evaluate(id => window.workbench.getDraft(id), setup.jobId))?.revision).toBe(revision)
    await comparison.getByRole('button', { name: 'Reject proposal' }).click()
    await expect(comparison).toContainText('Your CV was not changed.')
    expect((await page.evaluate(id => window.workbench.getDraft(id), setup.jobId))?.revision).toBe(revision)

    await app.close(); app = undefined
    app = await launch(); page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    expect((await page.evaluate(id => window.workbench.getDraft(id), setup.jobId))?.revision).toBe(revision)
    expect(await page.evaluate(id => window.workbench.getRegenerationProposal(id), setup.jobId)).toBeNull()
    expect((await page.evaluate(() => window.workbench.getSettings())).pi).toBeTruthy()
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
