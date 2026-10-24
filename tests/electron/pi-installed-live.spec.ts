import { expect, test, _electron as electron } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractCanonicalDocx } from '../../src/main/docx-export'
import { closeReviewDetails, openReviewDetails } from './review-helpers'

const executablePath = process.env.CV_TAILOR_INSTALLED_EXE
const modelReference = process.env.CV_TAILOR_PI_LIVE_MODEL
const effort = process.env.CV_TAILOR_PI_LIVE_EFFORT
const configured = Boolean(executablePath && modelReference && effort)
test.skip(!configured, 'Set CV_TAILOR_INSTALLED_EXE, CV_TAILOR_PI_LIVE_MODEL, and CV_TAILOR_PI_LIVE_EFFORT for the explicit live-provider check')

test('installed Pi migration: settings, consented cited CV, review, and exports', async () => {
  test.setTimeout(900_000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-pi-live-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const launch = () => electron.launch({ executablePath: executablePath!, args: [`--user-data-dir=${userData}`], timeout: 30_000 })
    app = await launch()
    let page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const model = page.getByRole('region', { name: 'Pi preferences' }).getByRole('region', { name: 'Pi model' })
    await model.getByLabel('Provider/model reference').fill(modelReference!)
    await model.getByLabel('Thinking level').click()
    await page.getByRole('option', { name: effort!, exact: true }).click()
    await model.getByRole('button', { name: 'Save Pi model' }).click()
    await expect(page.getByText('Pi model preference saved.')).toBeVisible({ timeout: 15_000 })
    await app.close(); app = undefined
    expect(existsSync(join(userData, 'workbench.sqlite'))).toBe(true)
    app = await launch(); page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const reopenedModel = page.getByRole('region', { name: 'Pi preferences' }).getByRole('region', { name: 'Pi model' })
    await expect(reopenedModel.getByLabel('Provider/model reference')).toHaveValue(modelReference!)
    await expect(reopenedModel.getByLabel('Thinking level')).toContainText(effort!)
    await page.getByRole('button', { name: 'Tailor CV', exact: true }).click()

    const setup = await page.evaluate(async () => {
      const contact = await window.workbench.saveContact({ fullName: 'Ari Example', headline: 'Synthetic Reliability Engineer', email: 'ari@example.test', links: [{ label: 'Portfolio', url: 'https://example.test/ari' }] })
      const skill = await window.workbench.saveSkill({ name: 'TypeScript', category: 'Programming' })
      const role = await window.workbench.saveExperience({ kind: 'employment', title: 'Systems Engineer', organization: 'Fictional Works', startDate: '2022-01', endDate: '2024-01', description: 'Built and maintained TypeScript services with documented reliability practices.', factualItems: [] })
      const job = await window.workbench.saveJob({ title: 'Reliability Engineer', company: 'Example Research', description: 'Responsibilities: maintain reliable software services and document operational decisions. Requirements: TypeScript and careful written communication.' })
      if (!contact.ok || !skill.ok || !role.ok || !job.ok) throw new Error('Could not create synthetic live-test records.')
      return { jobId: job.value.id }
    })
    await page.reload()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: /Reliability Engineer.*Example Research/ }).click()
    await expect(page.getByRole('button', { name: 'Inspect outgoing data' })).toBeVisible()
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const workflow = page.getByRole('region', { name: 'Tailoring workflow' })
    await workflow.getByText('Read the included posting and profile details').click()
    const outgoing = workflow.locator('.outbound-content-list')
    await expect(outgoing).toBeVisible()
    await expect(outgoing).not.toContainText('Ari Example')
    await expect(outgoing).not.toContainText('ari@example.test')
    await expect(outgoing).toContainText(/\[\[EMPLOYER_\d+\]\]/)
    await workflow.getByRole('checkbox', { name: /reviewed what is sent/i }).check()
    await workflow.getByRole('button', { name: 'Authorize this run' }).click()
    await expect(workflow.getByRole('button', { name: 'Generate tailored draft' })).toBeVisible({ timeout: 90_000 })

    await workflow.getByRole('button', { name: 'Generate tailored draft' }).click()
    const reviewReady = page.getByRole('region', { name: 'CV review', exact: true })
    const providerFailure = workflow.getByRole('alert').filter({ hasText: /provider returned|Pi could not|could not complete|failed to generate/i })
    await expect(reviewReady.or(providerFailure).first()).toBeVisible({ timeout: 360_000 })
    if (await providerFailure.isVisible()) throw new Error(`Installed provider request failed: ${(await providerFailure.textContent())?.slice(0, 300)}`)
    await expect(reviewReady).toContainText('Finish reviewing')
    const analysis = await page.evaluate(id => window.workbench.getAnalysis(id), setup.jobId)
    expect(analysis?.status, analysis?.progress).toBe('complete')
    const draft = await page.evaluate(id => window.workbench.getDraft(id), setup.jobId)
    expect(draft).not.toBeNull()
    expect(draft?.content.experience.length).toBeGreaterThan(0)
    expect(draft?.content.experience.every(item => item.citations.length > 0)).toBe(true)
    const pendingSkills = draft?.suggestedSkills?.filter(skill => skill.status === 'pending') ?? []

    await page.reload()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: /Reliability Engineer.*Example Research/ }).click()
    const review = page.getByRole('region', { name: 'CV review' })
    if (pendingSkills.length) {
      await openReviewDetails(page, 'skills')
      const skillReview = page.getByRole('region', { name: 'New skills to review' })
      await expect(review).toContainText(/Confirm or remove \d+ new skill/)
      for (const skill of pendingSkills) {
        await expect(skillReview).toContainText(skill.name)
        await skillReview.getByRole('button', { name: `Remove ${skill.name}` }).click()
      }
      await closeReviewDetails(page)
    }
    await expect(review).toBeVisible()
    await page.getByRole('button', { name: 'Check page length' }).click()
    await expect(page.getByRole('status')).toContainText(/Fits the selected target|page/i, { timeout: 45_000 })
    await page.getByRole('checkbox', { name: 'I reviewed this CV and its wording.' }).check()
    await page.getByRole('button', { name: 'Check CV for issues' }).click()
    await expect(page.getByRole('button', { name: 'Approve CV' })).toBeEnabled({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Approve CV' }).click()
    const pdfPath = join(userData, 'synthetic-approved.pdf')
    const docxPath = join(userData, 'synthetic-approved.docx')
    await app.evaluate(({ dialog }, paths) => { let next = 0; dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths[next++] }) }, [pdfPath, docxPath])
    await page.getByRole('button', { name: 'Export approved PDF' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Approved PDF saved' })).toBeVisible({ timeout: 45_000 })
    expect(readFileSync(pdfPath).subarray(0, 5).toString()).toBe('%PDF-')
    await page.getByRole('button', { name: 'Export editable Word document' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Editable DOCX saved' })).toBeVisible({ timeout: 30_000 })
    expect((await extractCanonicalDocx(readFileSync(docxPath))).text).toContain('Ari Example')
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
