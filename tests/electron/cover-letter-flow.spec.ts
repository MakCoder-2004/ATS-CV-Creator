import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractCanonicalDocx } from '../../src/main/docx-export'

// Only initial career facts/posting are seeded through public preload writes. All
// consent, generation, editing, review, approval and export use visible controls.
test('a separately reviewed cover letter preserves the CV and profile and exports real PDF and Word files in the five-stage workbench', async () => {
  test.setTimeout(180000)
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-cover-letter-flow-'))
  const userData = join(root, 'workspace')
  const pdfPath = join(root, 'cover-letter.pdf')
  const wordPath = join(root, 'cover-letter.docx')
  const editedWording = 'I use TypeScript in my work.'
  const recipient = 'Jordan Recruiter'
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      args: [join(process.cwd(), 'out/main/index.js'), '--disable-gpu'],
      timeout: 60000,
      env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'cover-letter-review-issue', CV_TAILOR_SCRIPTED_PI_MODEL: '1' },
    })
    // Check Electron's actual path before making any workspace writes.
    const actualUserData = await app.evaluate(({ app }) => app.getPath('userData'))
    expect(realpathSync.native(actualUserData)).toBe(realpathSync.native(userData))
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20000 })

    // Select the synthetic provider through production Settings, not a settings write seam.
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Settings', exact: true }).click()
    const model = page.getByRole('region', { name: 'Pi model', exact: true })
    await model.getByLabel('Provider/model reference').fill('scripted/cv-tailor-fixture')
    await model.getByRole('combobox', { name: 'Thinking level' }).click()
    await page.getByRole('option', { name: 'off', exact: true }).click()
    await model.getByRole('button', { name: 'Save Pi model' }).click()
    await expect(page.getByRole('region', { name: 'Pi preferences', exact: true }).getByRole('status')).toContainText('Pi model preference saved.')

    const seeded = await page.evaluate(async () => {
      const contact = await window.workbench.saveContact({ fullName: 'Riley Candidate', headline: 'Profile headline stays unchanged', email: 'riley@example.test' })
      const skill = await window.workbench.saveSkill({ name: 'TypeScript', category: 'Programming' })
      const experience = await window.workbench.saveExperience({ kind: 'employment', title: 'Software Engineer', organization: 'Example Systems', startDate: '2022-01', endDate: '2024-12', description: 'Built reliable services with TypeScript.', factualItems: [] })
      const job = await window.workbench.saveJob({ title: 'Platform Engineer', company: 'Example Co', description: 'Build reliable services with TypeScript. Kubernetes and cloud architecture are useful.' })
      if (!job.ok) throw new Error(job.error.message)
      return { contact, skill, experience, jobId: job.value.id }
    })
    expect(seeded.contact.ok).toBe(true)
    expect(seeded.skill.ok).toBe(true)
    expect(seeded.experience.ok).toBe(true)
    const jobId = seeded.jobId
    const originalProfile = await page.evaluate(async () => ({ profile: await window.workbench.getProfile(), experience: await window.workbench.getExperience() }))

    await page.reload()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20000 })
    await page.locator('.sidebar-job-items').getByRole('button', { name: /Platform Engineer/ }).click()
    const phases = page.getByRole('navigation', { name: 'Tailoring phases' })
    const assertPhase = async (name: string) => {
      await expect(phases.locator('.phase-label')).toHaveText(['Job posting', 'Outgoing data', 'Generate', 'Review evidence', 'Export'])
      await expect(phases.locator('[aria-current="step"]')).toContainText(name)
    }
    await assertPhase('Job posting')
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    await assertPhase('Outgoing data')
    const flow = page.getByRole('region', { name: 'Tailoring workflow' })
    const includeLetter = flow.getByRole('checkbox', { name: /Include a cover letter/ })
    await expect(includeLetter).not.toBeChecked()
    await includeLetter.check()
    await expect(includeLetter).toBeChecked()
    await flow.getByRole('button', { name: 'Authorize and start this run' }).click()
    const generate = flow.getByRole('button', { name: 'Generate tailored draft', exact: true })
    await expect(generate).toBeEnabled({ timeout: 20000 })
    await assertPhase('Generate')
    await expect(flow.getByRole('heading', { name: 'What this role calls for' })).toBeVisible()
    // Analysis must pause: authorizing did not create either document.
    expect(await page.evaluate(id => window.workbench.getDraft(id), jobId)).toBeNull()
    expect(await page.evaluate(id => window.workbench.getCoverLetter(id), jobId)).toBeNull()
    await generate.click()
    await expect(page.getByRole('region', { name: 'CV document', exact: true })).toBeVisible({ timeout: 30000 })
    await assertPhase('Review evidence')
    await expect(page.getByRole('button', { name: 'Check CV for issues', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Check page length', exact: true }).click()
    await expect.poll(() => page.evaluate(id => window.workbench.getDocumentFitReport(id).then(value => value?.actualPages ?? 0), jobId), { timeout: 45000 }).toBeGreaterThan(0)
    const cvBeforeLetterReview = await page.evaluate(id => window.workbench.getDraft(id), jobId)
    expect(cvBeforeLetterReview).not.toBeNull()
    expect(cvBeforeLetterReview?.approved).toBe(false)

    const selector = page.getByRole('group', { name: 'Select a document' })
    await selector.getByRole('button', { name: 'Cover letter', exact: true }).click()
    await expect(selector.getByRole('button', { name: 'Cover letter', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const review = page.getByRole('region', { name: 'Cover letter review', exact: true })
    const paper = review.getByRole('article', { name: 'Cover letter structured review' })
    await expect(paper).toBeVisible({ timeout: 20000 })
    await expect(paper).toContainText('Dear Hiring Manager,')
    await expect(paper).toContainText('I use Python.')
    await expect(review).toContainText('unsupported skill')
    await expect(review.getByRole('button', { name: 'Approve cover letter', exact: true })).toBeDisabled()
    const generatedLetter = await page.evaluate(id => window.workbench.getCoverLetterReadModel(id), jobId)
    expect(generatedLetter.generation.status).toBe('saved')
    expect(generatedLetter.letter?.cvRevisionId).toBe(cvBeforeLetterReview?.id)
    expect(generatedLetter.readiness.approved).toBe(false)
    expect(generatedLetter.readiness.canExport).toBe(false)
    expect(generatedLetter.readiness.findings.length).toBeGreaterThan(0)
    expect(generatedLetter.readiness.canApprove).toBe(false)

    const firstParagraph = review.getByRole('region', { name: 'Paragraph 1 review', exact: true })
    await firstParagraph.getByRole('button', { name: 'Edit paragraph 1', exact: true }).click()
    await firstParagraph.getByRole('textbox', { name: 'Paragraph 1 wording', exact: true }).fill(editedWording)
    await firstParagraph.getByRole('button', { name: 'Save wording', exact: true }).click()
    await expect(firstParagraph.getByRole('textbox', { name: 'Paragraph 1 wording', exact: true })).toHaveCount(0)
    await expect(firstParagraph).toContainText(editedWording)
    expect((await page.evaluate(id => window.workbench.getCoverLetterReadModel(id), jobId)).readiness.findings).toEqual([])
    await expect(review.getByText('Page fit: Not measured', { exact: true })).toBeVisible()

    await review.getByLabel('Recipient name (optional)', { exact: true }).fill(recipient)
    await expect(review.getByText('This name stays on this device and is not sent to Pi. No saved job contacts are selected automatically.', { exact: true })).toBeVisible()
    await review.getByRole('button', { name: 'Save recipient', exact: true }).click()
    await expect(paper).toContainText(`Dear ${recipient},`)
    const locallyEdited = await page.evaluate(id => window.workbench.getCoverLetterReadModel(id), jobId)
    expect(locallyEdited.letter?.revision).toBeGreaterThan(generatedLetter.letter!.revision)
    expect(locallyEdited.letter?.paragraphs[0].text).toBe(editedWording)
    expect(locallyEdited.letter?.recipient).toBe(recipient)
    expect(locallyEdited.readiness.currentFit).toBeNull()
    expect(locallyEdited.readiness.approved).toBe(false)
    expect(Object.values(locallyEdited.readiness.paragraphAcknowledgments).every(value => !value)).toBe(true)

    // Every current paragraph is reviewed via its visible source passages and action.
    const paragraphs = review.getByRole('region', { name: /^Paragraph \d+ review$/ })
    const paragraphCount = await paragraphs.count()
    expect(paragraphCount).toBeGreaterThan(0)
    for (let index = 0; index < paragraphCount; index++) {
      const paragraph = review.getByRole('region', { name: `Paragraph ${index + 1} review`, exact: true })
      await expect(paragraph.getByRole('heading', { name: `Source passages for paragraph ${index + 1}`, exact: true })).toBeVisible()
      await expect(paragraph.locator('blockquote').first()).toBeVisible()
      await paragraph.getByRole('button', { name: `Acknowledge sources for paragraph ${index + 1}`, exact: true }).click()
      await expect(paragraph.getByText('Source reviewed', { exact: true })).toBeVisible()
    }
    await expect(review.getByRole('status').filter({ hasText: `${paragraphCount} of ${paragraphCount} paragraphs acknowledged` })).toBeVisible()
    await review.getByRole('button', { name: 'Check for issues', exact: true }).click()
    await expect(review.getByText('Issues: No known issues', { exact: true })).toBeVisible()
    await review.getByRole('button', { name: 'Check one-page fit', exact: true }).click()
    await expect(review.getByText('Page fit: Fits one page', { exact: true })).toBeVisible({ timeout: 45000 })
    const checked = await page.evaluate(id => window.workbench.getCoverLetterReadModel(id), jobId)
    expect(checked.readiness.findings).toEqual([])
    expect(checked.readiness.currentFit).toMatchObject({ actualPages: 1, overflow: false })
    expect(Object.values(checked.readiness.paragraphAcknowledgments)).toEqual(Array(paragraphCount).fill(true))
    expect(checked.readiness.canApprove).toBe(true)
    await expect(review.getByRole('button', { name: 'Approve cover letter', exact: true })).toBeEnabled()
    await review.getByRole('button', { name: 'Approve cover letter', exact: true }).click()
    await assertPhase('Export')

    // This must be the real letter renderer, not the CV canvas or structured paper.
    const canvas = page.getByRole('img', { name: 'Compiled cover letter PDF page 1', exact: true })
    await expect(canvas).toBeVisible({ timeout: 30000 })
    expect(await canvas.evaluate(element => element instanceof HTMLCanvasElement && element.width > 0 && element.height > 0)).toBe(true)
    await expect(page.getByRole('img', { name: 'Compiled PDF page 1', exact: true })).toHaveCount(0)
    const approved = await page.evaluate(id => window.workbench.getCoverLetterReadModel(id), jobId)
    expect(approved.readiness.approved).toBe(true)
    expect(approved.readiness.canExport).toBe(true)

    // Stub only the native destination picker; rendering and writes remain real.
    await app.evaluate(({ dialog }, destinations) => {
      const remaining = [...destinations]
      ;(globalThis as any).__coverLetterSaveDialogs = []
      dialog.showSaveDialog = (async (...args: any[]) => {
        ;(globalThis as any).__coverLetterSaveDialogs.push(args[args.length - 1])
        const filePath = remaining.shift()
        if (!filePath) throw new Error('Unexpected extra cover-letter save dialog')
        return { canceled: false, filePath }
      }) as any
    }, [pdfPath, wordPath])
    await page.getByRole('button', { name: 'Export cover letter PDF', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Cover-letter PDF saved.' })).toBeVisible({ timeout: 30000 })
    expect(existsSync(pdfPath)).toBe(true)
    const pdfBytes = readFileSync(pdfPath)
    expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-')
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const loading = pdfjs.getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true })
    let pdfText = ''
    try {
      const pdf = await loading.promise
      expect(pdf.numPages).toBe(1)
      const firstPage = await pdf.getPage(1)
      expect(firstPage.view[2] - firstPage.view[0]).toBeCloseTo(612, 0)
      expect(firstPage.view[3] - firstPage.view[1]).toBeCloseTo(792, 0)
      pdfText = (await firstPage.getTextContent()).items.flatMap(item => 'str' in item ? [item.str] : []).join(' ')
    } finally { await loading.destroy() }

    await page.getByRole('button', { name: 'Export cover letter Word', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Editable cover-letter DOCX saved.' })).toBeVisible({ timeout: 30000 })
    expect(existsSync(wordPath)).toBe(true)
    const wordBytes = readFileSync(wordPath)
    expect(wordBytes.subarray(0, 2).toString()).toBe('PK')
    const word = await extractCanonicalDocx(wordBytes)
    const wordText = word.text.join(' ')
    for (const text of [pdfText, wordText]) {
      for (const expected of ['Riley Candidate', 'riley@example.test', `Dear ${recipient},`, editedWording, 'Sincerely,', approved.canonical!.subject]) expect(text).toContain(expected)
      for (const annotation of ['Source reviewed', 'Source passages', 'Acknowledge sources', 'Edit paragraph', 'Profile headline stays unchanged', 'Technical Skills', 'Example Systems']) expect(text).not.toContain(annotation)
    }
    const saveDialogs = await app.evaluate(() => (globalThis as any).__coverLetterSaveDialogs as Array<{ filters: Array<{ extensions: string[] }> }>)
    expect(saveDialogs).toHaveLength(2)
    expect(saveDialogs[0].filters.flatMap(filter => filter.extensions)).toContain('pdf')
    expect(saveDialogs[1].filters.flatMap(filter => filter.extensions)).toContain('docx')

    expect(await page.evaluate(id => window.workbench.getDraft(id), jobId)).toEqual(cvBeforeLetterReview)
    expect(await page.evaluate(async () => ({ profile: await window.workbench.getProfile(), experience: await window.workbench.getExperience() }))).toEqual(originalProfile)
    await page.getByRole('button', { name: 'Back to review', exact: true }).click()
    await assertPhase('Review evidence')
    await expect(paper).toBeVisible()
    expect((await page.evaluate(id => window.workbench.getCoverLetterReadModel(id), jobId)).readiness.approved).toBe(true)
    await selector.getByRole('button', { name: 'CV', exact: true }).click()
    await expect(page.getByRole('region', { name: 'CV document', exact: true })).toBeVisible()
    expect((await page.evaluate(id => window.workbench.getDraft(id), jobId))?.approved).toBe(false)
  } finally {
    await app?.close().catch(() => {})
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
