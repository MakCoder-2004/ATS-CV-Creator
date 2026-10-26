import { openReviewDetails, closeReviewDetails } from './review-helpers'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The public preload API and visible review flow cross the real renderer, main process, SQLite, bundled pdfLaTeX and filesystem boundaries.
test('user approves and exports a selectable PDF, while cancellation and overwrite failures preserve existing files', async () => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-export-pdf-'))
  const userData = join(root, 'workspace'), output = join(root, 'Zoe Candidate - Example Co - Engineer.pdf')
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js'), '--disable-gpu'], timeout: 60000, env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'generation' } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20000 })
    const saved = await page.evaluate(async () => {
      const contact = await window.workbench.saveContact({ fullName: 'Zoë Candidate', headline: 'Staff Engineer', email: 'zoe@example.test', links: [{ label: 'Portfolio', url: 'https://example.test/portfolio' }] })
      const skill = await window.workbench.saveSkill({ name: 'CaféScript', category: 'Programming' })
      const newer = await window.workbench.saveExperience({ kind: 'employment', title: 'Platform Engineer', organization: 'Northstar Systems', startDate: '2023-01', endDate: '2024-06', description: 'Built dependable service infrastructure.', factualItems: [] })
      const older = await window.workbench.saveExperience({ kind: 'employment', title: 'Software Engineer', organization: 'Harbor Technologies', startDate: '2020-01', endDate: '2022-12', description: 'Led a careful platform migration.', factualItems: [] })
      return { contact, skill, newer, older }
    })
    expect(saved.contact.ok).toBe(true)
    expect(saved.skill.ok).toBe(true)
    expect(saved.newer.ok).toBe(true)
    expect(saved.older.ok).toBe(true)
    await page.getByRole('button', { name: 'Open saved jobs' }).click()
    await page.getByLabel('Job title').fill('Engineer')
    await page.getByLabel('Company').fill('Example Co')
    await page.getByLabel('Posting and requirements').fill('Build software with CaféScript.')
    await page.getByRole('button', { name: 'Save job' }).click()
    await page.getByRole('button', { name: 'Tailor CV', exact: true }).click()
    const jobId = await page.evaluate(async () => (await window.workbench.listJobs())[0].id)
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = (async () => ({ canceled: true })) as any
      return true
    })
    const blocked = await page.evaluate(id => window.workbench.exportApprovedPdf(id), jobId)
    expect(blocked).toMatchObject({ ok: false, cancelled: false })
    expect(blocked.message).toMatch(/approve/i)

    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const flow = page.getByRole('region', { name: 'Tailoring workflow' })
    await flow.getByRole('button', { name: 'Authorize and start this run' }).click()
    await expect(flow.getByRole('button', { name: 'Generate tailored draft' })).toBeVisible({ timeout: 15000 })
    await flow.getByRole('button', { name: 'Generate tailored draft' }).click()
    await expect(page.getByRole('region', { name: 'CV document' }).getByText('Zoë Candidate')).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'Check page length' }).click()
    await expect(page.getByText(/Fits the selected target/i)).toBeVisible({ timeout: 45000 })
    await openReviewDetails(page, 'skills')
    const skillReview = page.getByRole('region', { name: 'New skills to review' })
    const pendingSkills = (await page.evaluate(id => window.workbench.getDraft(id), jobId))?.suggestedSkills?.filter(skill => skill.status === 'pending') ?? []
    for (const skill of pendingSkills) await skillReview.getByRole('button', { name: `Remove ${skill.name}` }).click()
    await closeReviewDetails(page)
    await page.getByRole('button', { name: 'Check page length' }).click()
    await expect(page.getByText(/Fits the selected target/i)).toBeVisible({ timeout: 45000 })
    await page.getByRole('checkbox', { name: 'I reviewed this CV and its wording.' }).check()
    await page.getByRole('button', { name: 'Check CV for issues' }).click()
    await expect(page.getByRole('button', { name: 'Approve CV' })).toBeEnabled()
    await page.getByRole('button', { name: 'Approve CV' }).click()
    await expect(page.getByRole('button', { name: 'Export approved PDF' })).toBeEnabled()
    const compiledPreview = page.getByRole('region', { name: 'Compiled PDF preview' })
    await expect(compiledPreview.locator('canvas[data-pdf-page="1"]')).toBeVisible({ timeout: 30000 })

    // A cancelled native destination selection never opens a PDF renderer or reports success.
    await page.getByRole('button', { name: 'Export approved PDF' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'PDF export cancelled' })).toBeVisible()
    expect(existsSync(output)).toBe(false)

    let suggested = ''
    await app.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = (async (...args: any[]) => {
        ;(globalThis as any).__suggestedPdfName = args[1]?.defaultPath
        return { canceled: false, filePath: destination }
      }) as any
      return true
    }, output)
    await page.getByRole('button', { name: 'Export approved PDF' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Approved PDF saved and checked locally.' })).toBeVisible({ timeout: 20000 })
    suggested = await app.evaluate(() => (globalThis as any).__suggestedPdfName)
    expect(suggested).toBe('Zoë Candidate - Example Co - Engineer.pdf')
    const bytes = readFileSync(output)
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
    const loaded = await loadingTask.promise
    expect(loaded.numPages).toBe(1)
    const pdfText: string[] = [], targets: string[] = []
    for (let i = 1; i <= loaded.numPages; i++) {
      const pdfPage = await loaded.getPage(i)
      pdfText.push(...(await pdfPage.getTextContent()).items.flatMap(item => 'str' in item ? [item.str] : []))
      targets.push(...(await pdfPage.getAnnotations({ intent: 'display' })).flatMap(item => item.subtype === 'Link' && item.url ? [item.url] : []))
    }
    const joined = pdfText.join(' ')
    expect(joined).toContain('Zoë Candidate')
    expect(joined).toContain('CaféScript')
    expect(joined).toContain('Technical Skills')
    const folded = joined.toLocaleLowerCase()
    expect(folded).not.toMatch(/\beducation\b/)
    expect(folded).not.toContain('professional summary')
    expect(folded).not.toContain('staff engineer')
    expect(folded).not.toMatch(/\bprojects\b/)
    expect(folded).not.toMatch(/\bcertificates\b/)
    const firstPage = await loaded.getPage(1)
    expect(firstPage.view[2] - firstPage.view[0]).toBeCloseTo(612, 0)
    expect(firstPage.view[3] - firstPage.view[1]).toBeCloseTo(792, 0)
    const orderedExperience = ['Northstar Systems', 'Jan 2023 – Jun 2024', 'Platform Engineer', 'Built dependable service infrastructure.', 'Harbor Technologies', 'Jan 2020 – Dec 2022', 'Software Engineer', 'Led a careful platform migration.']
    let orderCursor = 0
    for (const part of orderedExperience) { const found = joined.indexOf(part, orderCursor); expect(found, `expected extracted text in canonical order: ${part}`).toBeGreaterThanOrEqual(0); orderCursor = found + part.length }
    expect(targets).toContain('https://example.test/portfolio')
    await loadingTask.destroy()

    // Explicit overwrite decline leaves the old artifact byte-for-byte intact.
    const before = readFileSync(output)
    await app.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: destination })) as any
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as any
      return true
    }, output)
    await page.getByRole('button', { name: 'Export approved PDF' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'existing file was kept' })).toBeVisible()
    expect(readFileSync(output).equals(before)).toBe(true)
    writeFileSync(output, 'old artifact')
    await app.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: destination })) as any
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as any
      return true
    }, output)
    await page.getByRole('button', { name: 'Export approved PDF' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Approved PDF saved and checked locally' })).toBeVisible()
    expect(readFileSync(output).subarray(0, 5).toString()).toBe('%PDF-')

    // A write/rename failure is reported and does not claim success.
    const directoryTarget = join(root, 'existing-directory')
    const marker = join(directoryTarget, 'keep.txt')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(directoryTarget); writeFileSync(marker, 'keep')
    await app.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: destination })) as any
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as any
      return true
    }, directoryTarget)
    await page.getByRole('button', { name: 'Export approved PDF' }).click()
    await expect(page.getByRole('status').filter({ hasText: /EPERM|failed|could not/i })).toBeVisible()
    expect(readFileSync(marker, 'utf8')).toBe('keep')
  } finally {
    await app?.close().catch(() => {})
    rmSync(root, { recursive: true, force: true, maxRetries: 10 })
  }
})
