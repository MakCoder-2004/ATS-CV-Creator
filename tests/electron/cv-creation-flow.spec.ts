import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractCanonicalDocx } from '../../src/main/docx-export'

test('visible CV creation reviews new skills, preserves profile evidence, and exports the approved draft', async () => {
  test.setTimeout(180000)
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-approved-flow-'))
  const userData = join(root, 'workspace')
  const pdfPath = join(root, 'AI-ML Engineer.pdf')
  const docxPath = join(root, 'AI-ML Engineer.docx')
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      args: [join(process.cwd(), 'out/main/index.js')], timeout: 60000,
      env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'tailored-flow' }
    })
    let page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20000 })
    const seeded = await page.evaluate(async () => {
      const contact = await window.workbench.saveContact({ fullName: 'Ada Example', headline: 'Software Engineer', email: 'ada@example.test' })
      const skill = await window.workbench.saveSkill({ name: 'Python', category: 'Programming' })
      const role = await window.workbench.saveExperience({ kind: 'employment', title: 'Software Engineer', organization: 'Example Systems', startDate: '2021-01', endDate: '2024-06', description: 'Built Python APIs and maintained Docker deployments.' })
      const project = await window.workbench.saveProject({ name: 'Research assistant', description: 'Classified project intent with a natural-language processing pipeline.', technologies: [{ text: 'Python' }, { text: 'spaCy' }] })
      const job = await window.workbench.saveJob({ title: 'AI/ML Developer Level II', company: 'Northstar AI', description: 'Build Python RASA services on Google Cloud Platform. Apply spaCy NLP to product data.' })
      return { contact, skill, role, project, job }
    })
    expect(seeded.contact.ok && seeded.skill.ok && seeded.role.ok && seeded.project.ok && seeded.job.ok).toBe(true)
    const jobId = seeded.job.ok ? seeded.job.value.id : ''
    await page.reload()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.locator('.sidebar-job-items').getByRole('button', { name: /AI\/ML Developer Level II/ }).click()

    const phases = page.getByRole('navigation', { name: 'Tailoring phases' })
    await expect(phases.getByRole('listitem')).toHaveText(['Job posting', 'Outgoing data', 'Generate', 'Review evidence', 'Export'])
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const flow = page.getByRole('region', { name: 'Tailoring workflow' })
    await flow.getByRole('checkbox', { name: /reviewed what is sent/i }).check()
    await flow.getByRole('button', { name: 'Authorize this run' }).click()
    await expect(flow.getByRole('heading', { name: 'Required qualifications' })).toBeVisible({ timeout: 30000 })
    await expect(flow.getByRole('heading', { name: 'Preferred qualifications' })).toBeVisible()
    await expect(flow.getByRole('button', { name: 'Generate tailored draft' })).toBeVisible()
    await expect(flow.getByRole('button', { name: 'Analyze posting' })).toHaveCount(0)
    await flow.getByRole('button', { name: 'Generate tailored draft' }).click()

    const preview = page.getByRole('article', { name: 'Draft CV preview' })
    await expect(preview).toBeVisible({ timeout: 60000 })
    await expect(preview).toContainText('AI/ML Engineer')
    await expect(preview).toContainText('Software Engineer')
    await expect(preview).toContainText('Example Systems')
    await expect(preview).toContainText('Python')
    await expect(preview).toContainText('spaCy')
    await expect(preview.locator('h2').first()).toHaveText('Professional summary')
    await expect(preview.locator('h2')).toHaveText(['Professional summary', 'Education', 'Experience', 'Projects', 'Technical skills'])
    await expect.poll(() => page.evaluate(id => window.workbench.getDocumentFitReport(id).then(report => report?.actualPages ?? 0), jobId), { timeout: 45000 }).toBeGreaterThan(0)
    const draftBeforeDecisions = await page.evaluate(id => window.workbench.getDraft(id), jobId)
    expect(draftBeforeDecisions?.tailoring?.headline).toBe('AI/ML Engineer')
    expect(draftBeforeDecisions?.suggestedSkills?.length).toBeGreaterThan(0)
    const pending = draftBeforeDecisions!.suggestedSkills!.filter(skill => skill.status === 'pending')
    expect(pending.length).toBeGreaterThan(1)

    const suggestions = page.getByRole('region', { name: 'New skills to review' })
    await expect(suggestions).toBeVisible()
    for (const skill of pending) {
      const item = suggestions.getByText(skill.name, { exact: true }).locator('..')
      await expect(item).toContainText('Not in your profile')
    }
    const confirmSkill = pending.find(skill => skill.name.toLocaleLowerCase() === 'rasa')
    expect(confirmSkill, 'scripted fixture should suggest RASA').toBeDefined()
    await suggestions.getByRole('button', { name: 'Confirm RASA' }).click()
    for (const skill of pending.filter(skill => skill.id !== confirmSkill!.id)) {
      await suggestions.getByRole('button', { name: `Remove ${skill.name}` }).click()
    }
    await expect(suggestions).not.toContainText('Not in your profile')
    await expect(page.getByRole('button', { name: 'Approve CV' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Export approved PDF' })).toHaveCount(0)
    expect(await page.evaluate(id => window.workbench.approveDraft(id), jobId)).toMatchObject({ ok: false })
    expect(await page.evaluate(id => window.workbench.assertDraftExportable(id), jobId)).toMatchObject({ ok: false })

    await expect(preview).toContainText('RASA')
    await expect(preview).not.toContainText('Google Cloud Platform')
    const profileBeforeEdit = await page.evaluate(() => window.workbench.getProfile())
    expect(profileBeforeEdit.skills.map(skill => skill.name)).toEqual(['Python'])
    expect(await page.evaluate(id => window.workbench.getEvidenceHistory(id), seeded.role.ok ? seeded.role.value.experience[0].id : '')).toHaveLength(1)

    const reviewAcknowledgment = page.getByRole('checkbox', { name: 'I reviewed this CV and its wording.' })
    await reviewAcknowledgment.check()
    await page.getByRole('button', { name: 'Check page length' }).click()
    await expect(page.getByRole('status').filter({ hasText: /Fits the selected target/i })).toBeVisible({ timeout: 45000 })
    await page.getByRole('button', { name: 'Check CV for issues' }).click()
    await expect(page.getByRole('button', { name: 'Approve CV' })).toBeEnabled({ timeout: 30000 })
    await page.getByRole('button', { name: 'Approve CV' }).click()
    expect(await page.evaluate(id => window.workbench.assertDraftExportable(id), jobId)).toMatchObject({ ok: true })

    const approvedDraft = await page.evaluate(id => window.workbench.getDraft(id), jobId)
    const corrected = await page.evaluate(({ id, draftId }) => window.workbench.correctDraftTailoring({ jobId: id, draftId, field: 'summary', text: 'A revised, evidence-grounded summary.' }), { id: jobId, draftId: approvedDraft!.id })
    expect(corrected?.approved).toBe(false)
    expect(await page.evaluate(id => window.workbench.assertDraftExportable(id), jobId)).toMatchObject({ ok: false })
    await expect(page.getByRole('button', { name: 'Approve CV' })).toBeDisabled()
    await expect(reviewAcknowledgment).not.toBeChecked()
    await expect(preview).toContainText('A revised, evidence-grounded summary.')
    await reviewAcknowledgment.check()
    await page.getByRole('button', { name: 'Check page length' }).click()
    await expect(page.getByRole('status').filter({ hasText: /Fits the selected target/i })).toBeVisible({ timeout: 45000 })
    await page.getByRole('button', { name: 'Check CV for issues' }).click()
    await page.getByRole('button', { name: 'Approve CV' }).click()

    await app.evaluate(({ dialog }, destinations) => {
      let next = 0
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: destinations[next++] })
      return true
    }, [pdfPath, docxPath])
    await page.getByRole('button', { name: 'Export approved PDF' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Approved PDF saved and checked locally.' })).toBeVisible({ timeout: 30000 })
    await page.getByRole('button', { name: 'Export editable DOCX' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Editable DOCX saved' })).toBeVisible({ timeout: 30000 })
    expect(existsSync(pdfPath)).toBe(true)
    expect(existsSync(docxPath)).toBe(true)
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), useSystemFonts: true }).promise
    const pdfText = (await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => (await (await pdf.getPage(index + 1)).getTextContent()).items.flatMap(item => 'str' in item ? [item.str] : [])))).flat().join(' ')
    const docx = await extractCanonicalDocx(readFileSync(docxPath))
    for (const text of ['AI/ML Engineer', 'A revised, evidence-grounded summary.', 'Software Engineer', 'Research assistant', 'RASA']) {
      expect(pdfText).toContain(text)
      expect(docx.text.join(' ')).toContain(text)
    }
    expect(pdfText).not.toContain('Not in your profile')
    expect(docx.text.join(' ')).not.toContain('Not in your profile')
    const foldedPdfText = pdfText.toLocaleLowerCase()
    expect(foldedPdfText.indexOf('professional summary')).toBeLessThan(foldedPdfText.indexOf('experience'))
    expect(foldedPdfText).not.toMatch(/\beducation\b/)
    const foldedDocxText = docx.text.join(' ').toLocaleLowerCase()
    expect(foldedDocxText.indexOf('professional summary')).toBeLessThan(foldedDocxText.indexOf('experience'))
    expect(foldedDocxText).not.toMatch(/\beducation\b/)

    await app.close(); app = undefined
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], timeout: 60000, env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'tailored-flow' } })
    page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.locator('.sidebar-job-items').getByRole('button', { name: /AI\/ML Developer Level II/ }).click()
    const restored = await page.evaluate(id => window.workbench.getDraft(id), jobId)
    expect(restored?.suggestedSkills?.find(skill => skill.id === confirmSkill!.id)?.status).toBe('confirmed')
    expect(restored?.suggestedSkills?.filter(skill => skill.id !== confirmSkill!.id).every(skill => skill.status === 'removed')).toBe(true)
    expect(await page.evaluate(() => window.workbench.getProfile().then(profile => profile.skills.map(skill => skill.name)))).toEqual(['Python'])
    expect(await page.evaluate(id => window.workbench.assertDraftExportable(id), jobId)).toMatchObject({ ok: true })
  } finally {
    await app?.close().catch(() => {})
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
