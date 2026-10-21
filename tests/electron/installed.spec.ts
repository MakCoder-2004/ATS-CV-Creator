import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
    await first.close()
    expect(existsSync(join(directory, 'workbench.sqlite'))).toBe(true)
    const reopened = await launch()
    await expect((await reopened.firstWindow()).getByRole('button', { name: 'Use dark mode' })).toHaveAttribute('aria-pressed', 'true')
    await reopened.close()
  } finally {
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
      env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: directory, CV_TAILOR_SCRIPTED_ANALYSIS: 'generation' },
    })
    let page = await dev.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20000 })
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

    await page.getByRole('button', { name: 'Remove TypeScript', exact: true }).click()
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
  } finally {
    await dev?.close().catch(() => {})
    await installed?.close().catch(() => {})
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
