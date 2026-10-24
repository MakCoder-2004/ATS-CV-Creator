import { test, expect, _electron as electron } from '@playwright/test'
import { openReviewDetails, closeReviewDetails } from './review-helpers'
import { selectScriptedPiModel } from './pi-model-fixture'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractCanonicalDocx } from '../../src/main/docx-export'

const executablePath = process.env.CV_TAILOR_INSTALLED_EXE
test.skip(!executablePath, 'Set CV_TAILOR_INSTALLED_EXE to a genuinely installed executable')

test('installed app opens and writes SQLite across reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-installed-'))
  const launch = () => electron.launch({ executablePath, args: [`--user-data-dir=${directory}`] })
  try {
    const first = await launch()
    const page = await first.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Use dark mode' }).click()
    await expect(page.getByRole('button', { name: 'Use dark mode' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const model = page.getByRole('region', { name: 'Pi preferences' }).getByRole('region', { name: 'Pi model' })
    await expect(model.getByLabel('Provider/model reference')).toHaveValue('')
    const selectedModel = process.env.CV_TAILOR_PI_TEST_MODEL
    const selectedEffort = process.env.CV_TAILOR_PI_TEST_THINKING ?? 'low'
    if (selectedModel) {
      await model.getByLabel('Provider/model reference').fill(selectedModel)
      await model.getByLabel('Thinking level').click()
      await page.getByRole('option', { name: selectedEffort, exact: true }).click()
      await model.getByRole('button', { name: 'Save Pi model' }).click()
      await expect(page.getByText('Pi model preference saved.')).toBeVisible()
    }
    await first.close()
    expect(existsSync(join(directory, 'workbench.sqlite'))).toBe(true)
    const reopened = await launch()
    const reopenedPage = await reopened.firstWindow()
    await expect(reopenedPage.getByRole('button', { name: 'Use dark mode' })).toHaveAttribute('aria-pressed', 'true')
    await reopenedPage.getByRole('button', { name: 'Settings', exact: true }).click()
    const reopenedModel = reopenedPage.getByRole('region', { name: 'Pi preferences' }).getByRole('region', { name: 'Pi model' })
    await expect(reopenedModel.getByLabel('Provider/model reference')).toHaveValue(selectedModel ?? '')
    await expect(reopenedModel.getByLabel('Thinking level')).toContainText(selectedModel ? selectedEffort : 'medium')
    await reopened.close()
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})

test('installed app upgrades released v1 and v2 backups and restores v3 without resuming work', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-installed-backup-upgrade-'))
  const backupFile = join(directory, 'baseline-v3.json')
  const v1File = join(directory, 'released-v1.json')
  const v2File = join(directory, 'released-v2.json')
  const userData = join(directory, 'workspace')
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ executablePath, args: [`--user-data-dir=${userData}`] })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    const saved = await page.evaluate(() => window.workbench.saveJob({ title: 'Installed backup role', company: 'Example', description: 'Complete installed backup wording.' }))
    if (!saved.ok) throw new Error(saved.error.message)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }) }, backupFile)
    await page.getByRole('button', { name: 'Back up workspace' }).click()
    await expect(page.getByText(/Workspace backup saved/i)).toBeVisible()
    const v3 = JSON.parse(readFileSync(backupFile, 'utf8'))
    expect(v3.version).toBe(3)
    const v1 = structuredClone(v3)
    v1.version = 1
    v1.tables.schema_migrations.rows = v1.tables.schema_migrations.rows.filter((row: { version: number }) => row.version !== 7)
    v1.tables.jobs.rows[0].data = JSON.stringify({ id: saved.value.id, title: 'Installed backup role', company: 'Example', description: 'Complete installed backup wording.', createdAt: saved.value.createdAt, updatedAt: saved.value.updatedAt })
    writeFileSync(v1File, JSON.stringify(v1))
    const v2 = structuredClone(v3)
    v2.version = 2
    for (const row of v2.tables.jobs.rows) {
      const job = JSON.parse(row.data)
      delete job.optionalDetails
      for (const revision of job.revisions) delete revision.optionalDetails
      if (job.sourceSnapshot) { delete job.sourceSnapshot.optionalDetails; delete job.sourceSnapshot.fieldOrigins.optionalDetails }
      row.data = JSON.stringify(job)
    }
    writeFileSync(v2File, JSON.stringify(v2))
    const restore = async (file: string) => {
      await app!.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, file)
      await page.getByRole('button', { name: 'Restore workspace' }).click()
      await page.getByRole('button', { name: 'Confirm workspace replacement' }).click()
      await expect(page.getByText(/Workspace restored/i)).toBeVisible()
    }
    await restore(v1File)
    expect(await page.evaluate(async id => { const job = await window.workbench.openJob(id); return job && { provenance: job.provenance, sourceSnapshot: job.sourceSnapshot, revisions: job.revisions.length } }, saved.value.id)).toEqual({ provenance: 'legacy-unknown', sourceSnapshot: null, revisions: 0 })
    await restore(v2File)
    expect(await page.evaluate(async id => { const job = await window.workbench.openJob(id); return job && { location: job.optionalDetails.location, revisionLocation: job.revisions[0]?.optionalDetails.location } }, saved.value.id)).toEqual({ location: { value: null, origin: 'unknown', source: null, uncertainty: 'none' }, revisionLocation: { value: null, origin: 'unknown', source: null, uncertainty: 'none' } })
    await restore(backupFile)
    expect(await page.evaluate(async id => { const job = await window.workbench.openJob(id); return job && { description: job.description, provenance: job.provenance, revisionCount: job.revisions.length } }, saved.value.id)).toMatchObject({ description: 'Complete installed backup wording.', provenance: 'manual', revisionCount: 1 })
  } finally {
    await app?.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})

test('installed app compiles a generated draft with its bundled LaTeX toolchain', async () => {
  test.setTimeout(120000)
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-installed-latex-'))
  let dev: Awaited<ReturnType<typeof electron.launch>> | undefined
  let installed: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    // Create a real workspace through the public API. The scripted provider makes this fixture offline and deterministic.
    dev = await electron.launch({
      args: [join(process.cwd(), 'out/main/index.js'), '--disable-gpu'],
      timeout: 60000,
      env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: directory, CV_TAILOR_SCRIPTED_ANALYSIS: 'generation', CV_TAILOR_SCRIPTED_PI_MODEL: '1' },
    })
    let page = await dev.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20000 })
    await selectScriptedPiModel(page)
    const setup = await page.evaluate(async () => {
      const contact = await window.workbench.saveContact({ fullName: 'Zoë Candidate', headline: 'Staff Engineer', email: 'zoe@example.test', links: [{ label: 'Portfolio', url: 'https://example.test/portfolio' }] })
      const skill = await window.workbench.saveSkill({ name: 'CaféScript', category: 'Programming' })
      const role = await window.workbench.saveExperience({ kind: 'employment', title: 'Platform Engineer', organization: 'Northstar Systems', startDate: '2023-01', endDate: '2024-06', description: 'Built dependable service infrastructure.', factualItems: [] })
      const job = await window.workbench.saveJob({ title: 'Engineer', company: 'Example Co', description: 'Build software with CaféScript.' })
      if (!contact.ok || !skill.ok || !role.ok || !job.ok) throw new Error('Could not create installed LaTeX fixture.')
      const consent = await window.workbench.prepareOutboundConsent(job.value.id)
      if (!consent.ok) throw new Error(consent.message)
      const accepted = await window.workbench.acceptOutboundConsent(consent.token, true, true)
      if (!accepted.ok) throw new Error(accepted.message)
      const analysis = await window.workbench.startAnalysis(consent.token)
      if (analysis.status !== 'complete') throw new Error(analysis.progress)
      const generation = await window.workbench.generateDraft(consent.token)
      if (!generation.ok) throw new Error(generation.message)
      return { jobId: job.value.id }
    })
    await dev.close()
    dev = undefined

    // Reopen exactly that workspace with the genuinely installed executable. PDF compilation now exercises its packaged LaTeX assets.
    installed = await electron.launch({ executablePath, args: [`--user-data-dir=${directory}`], timeout: 60000 })
    page = await installed.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 30000 })
    await page.getByRole('button', { name: 'Engineer Example Co', exact: true }).click()
    await expect(page.getByRole('region', { name: 'CV document' }).getByText('Zoë Candidate')).toBeVisible({ timeout: 20000 })
    const canonical = await page.evaluate(id => window.workbench.getCanonicalDocument(id), setup.jobId)
    expect(canonical?.style).toMatchObject({ fontFamily: 'Lato', pageSize: 'Letter' })
    expect(canonical?.identity).not.toHaveProperty('headline')
    expect(canonical?.identity).not.toHaveProperty('summary')

    // This public preload call invokes the installed app's bundled LaTeX compiler, not the dev process.
    const pdf = await page.evaluate(id => window.workbench.getDocumentPdf(id), setup.jobId)
    const bytes = Buffer.from(pdf.pdfBase64, 'base64')
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
    const loaded = await loadingTask.promise
    expect(loaded.numPages).toBe(1)
    const pdfPage = await loaded.getPage(1)
    expect(pdfPage.view[2] - pdfPage.view[0]).toBeCloseTo(612, 0)
    expect(pdfPage.view[3] - pdfPage.view[1]).toBeCloseTo(792, 0)
    const items = (await pdfPage.getTextContent()).items
    const text = items.flatMap(item => 'str' in item ? [item.str] : []).join(' ')
    expect(text).toContain('Zoë Candidate')
    expect(text).toContain('Technical Skills')
    expect(text).toContain('CaféScript')
    expect(text).toContain('Platform Engineer')
    expect(text).not.toMatch(/professional summary|staff engineer/i)
    const links = await pdfPage.getAnnotations({ intent: 'display' })
    expect(links.flatMap(item => item.subtype === 'Link' && item.url ? [item.url] : [])).toContain('https://example.test/portfolio')
    await loadingTask.destroy()

    const pendingSkills = (await page.evaluate(id => window.workbench.getDraft(id), setup.jobId))?.suggestedSkills?.filter(skill => skill.status === 'pending') ?? []
    expect(pendingSkills).toContainEqual(expect.objectContaining({ name: 'TypeScript' }))
    await openReviewDetails(page, 'skills')
    const skillReview = page.getByRole('region', { name: 'New skills to review' })
    for (const skill of pendingSkills) await skillReview.getByRole('button', { name: `Remove ${skill.name}` }).click()
    await closeReviewDetails(page)
    await page.getByRole('button', { name: 'Check page length' }).click()
    await expect(page.getByText(/Fits the selected target/i)).toBeVisible({ timeout: 45000 })
    await page.getByRole('checkbox', { name: 'I reviewed this CV and its wording.' }).check()
    await page.getByRole('button', { name: 'Check CV for issues' }).click()
    await expect(page.getByRole('button', { name: 'Approve CV' })).toBeEnabled()
    await page.getByRole('button', { name: 'Approve CV' }).click()
    const preview = page.getByRole('region', { name: 'Compiled PDF preview' })
    await expect(preview.getByText('1 page', { exact: true })).toBeVisible({ timeout: 30000 })
    await expect(preview.locator('canvas[data-pdf-page="1"]')).toBeVisible()
    await page.screenshot({ path: 'test-results/installed-latex-preview.png', fullPage: true })

    const pdfPath = join(directory, 'approved.pdf'), docxPath = join(directory, 'approved.docx')
    await installed.evaluate(({ dialog }, destinations) => {
      let next = 0
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: destinations[next++] })
    }, [pdfPath, docxPath])
    await page.getByRole('button', { name: 'Export approved PDF' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Approved PDF saved and checked locally.' })).toBeVisible()
    expect(readFileSync(pdfPath)).toEqual(bytes)
    await page.getByRole('button', { name: 'Export editable Word document' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Editable DOCX saved' })).toBeVisible()
    expect((await extractCanonicalDocx(readFileSync(docxPath))).text).toContain('Zoë Candidate')

    await installed.close()
    installed = undefined
    installed = await electron.launch({ executablePath, args: [`--user-data-dir=${directory}`], timeout: 60000 })
    page = await installed.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    expect(await page.evaluate(id => window.workbench.getDraft(id).then(draft => draft?.approved), setup.jobId)).toBe(true)
    expect(await page.evaluate(id => window.workbench.assertDraftExportable(id), setup.jobId)).toMatchObject({ ok: true })
    await page.getByRole('button', { name: 'Engineer Example Co', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Export approved PDF' })).toBeVisible()
  } finally {
    await dev?.close().catch(() => {})
    await installed?.close().catch(() => {})
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
