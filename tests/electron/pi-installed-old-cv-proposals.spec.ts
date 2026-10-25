import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'

const executablePath = process.env.CV_TAILOR_INSTALLED_EXE
const modelReference = process.env.CV_TAILOR_PI_LIVE_MODEL
const effort = process.env.CV_TAILOR_PI_LIVE_EFFORT
const configured = Boolean(executablePath && modelReference && effort)
test.skip(!configured, 'Set CV_TAILOR_INSTALLED_EXE, CV_TAILOR_PI_LIVE_MODEL, and CV_TAILOR_PI_LIVE_EFFORT for the explicit installed Pi check')

function makePdf(lines: string[]) {
  const objects: string[] = []
  const add = (value: string) => { objects.push(value); return objects.length }
  add(''); const pages = add(''); const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const commands = `BT /F1 10 Tf\n${lines.map((line, index) => `1 0 0 1 36 ${760 - index * 18} Tm (${line.replace(/[()\\]/g, '\\$&')}) Tj`).join('\n')}\nET`
  const content = add(`<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`)
  const page = add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`)
  objects[0] = `<< /Type /Catalog /Pages ${pages} 0 R >>`
  objects[pages - 1] = `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`
  let pdf = Buffer.from('%PDF-1.4\n'), offsets = [0]
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf = Buffer.concat([pdf, Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`)]) })
  const xref = pdf.length
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach(offset => { table += `${String(offset).padStart(10, '0')} 00000 n \n` })
  return Buffer.concat([pdf, Buffer.from(`${table}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)])
}

async function makeDocx() {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const lines = ['Synthetic CV for Noor Example', 'Technical Skills', 'Go, distributed systems', 'Experience', 'Platform Engineer | Fictional Systems | 2021 to 2024', 'Designed a resilient synthetic event-processing service for internal teams.']
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map(line => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

test('installed Pi structures synthetic PDF and DOCX CVs into reviewable, unconfirmed proposals', async () => {
  // One bounded run per format; Playwright retries are not enabled in playwright.config.ts.
  test.setTimeout(360_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-installed-old-cv-'))
  const userData = join(root, 'user-data')
  const pdfPath = join(root, 'synthetic-old-cv.pdf')
  const docxPath = join(root, 'synthetic-old-cv.docx')
  writeFileSync(pdfPath, makePdf([
    'NAME: Mira Sample',
    'EMAIL: mira@example.test',
    'SKILLS: TypeScript, product analytics',
    'EXPERIENCE: Data Engineer | Imaginary Labs | 2020 - 2023',
    'FACT: Built synthetic data-quality checks for internal reporting.',
    'A fictional career profile written only for this installed-app test.',
  ]))
  writeFileSync(docxPath, await makeDocx())
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ executablePath: executablePath!, args: [`--user-data-dir=${userData}`], timeout: 30_000 })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })

    // Configure the requested model once and do not change it during either consented run.
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('region', { name: 'Pi preferences' }).getByRole('region', { name: 'Pi model' })
    await settings.getByLabel('Provider/model reference').fill(modelReference!)
    await settings.getByLabel('Thinking level').click()
    await page.getByRole('option', { name: effort!, exact: true }).click()
    await settings.getByRole('button', { name: 'Save Pi model' }).click()
    await expect(page.getByText('Pi model preference saved.')).toBeVisible({ timeout: 15_000 })
    const selectedModel = (await page.evaluate(() => window.workbench.getSettings())).pi
    expect(`${selectedModel?.providerId}/${selectedModel?.modelId}`).toBe(modelReference)
    await page.getByRole('button', { name: 'My profile', exact: true }).click()

    const profileIsEmpty = async () => {
      expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ contact: null, skills: [] })
      expect(await page.evaluate(() => window.workbench.getExperience())).toMatchObject({ experience: [], projects: [] })
    }
    const structure = async (format: 'PDF' | 'Word', sourcePath: string, personalEmail: string) => {
      await app!.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
      }, sourcePath)
      await page.getByRole('button', { name: format === 'PDF' ? 'Upload CV' : 'Upload Word CV' }).click()
      const review = page.getByRole('region', { name: 'Review proposed profile details' })
      await expect(review).toBeVisible({ timeout: 30_000 })
      await page.getByRole('button', { name: 'Preview AI request' }).click()
      const consent = page.getByRole('region', { name: 'Review text sent through Pi' })
      await expect(consent).toBeVisible({ timeout: 30_000 })
      await expect(consent).toContainText(`Provider: ${selectedModel?.providerId}`)
      await expect(consent).toContainText(`Model: ${selectedModel?.modelId}`)
      await expect(consent).toContainText(`Thinking level: ${effort}`)
      const outgoing = consent.getByLabel('Exact outgoing text')
      const outgoingText = await outgoing.inputValue()
      expect(outgoingText.length).toBeGreaterThan(20)
      expect(outgoingText).not.toContain(personalEmail)
      await expect(consent.getByLabel(/I authorize this one-time request/)).not.toBeChecked()
      await expect(consent.getByRole('button', { name: 'Send text and structure' })).toBeDisabled()
      await profileIsEmpty()

      // This is the only dispatch click for this CV. A timeout/failure fails the test; it is not retried.
      await consent.getByLabel(/I authorize this one-time request/).check()
      await consent.getByRole('button', { name: 'Send text and structure' }).click()
      const success = page.getByRole('status').filter({ hasText: 'AI suggestions are ready for review.' })
      const failure = page.getByRole('alert').filter({ hasText: /structuring failed|provider|could not complete|request failed/i })
      await expect(success.or(failure).first()).toBeVisible({ timeout: 180_000 })
      if (await failure.isVisible()) throw new Error(`Installed ${format} structuring failed: ${(await failure.textContent())?.slice(0, 300)}`)
      await expect(consent).toHaveCount(0)
      await expect(review.locator('fieldset.pdf-proposal').first()).toBeVisible()
      await profileIsEmpty()
    }

    await structure('PDF', pdfPath, 'mira@example.test')
    await structure('Word', docxPath, 'noor@example.test')
  } finally {
    await app?.close().catch(() => {})
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
