import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selectScriptedPiModel } from './pi-model-fixture'

function makePdf(lines: string[]) {
  const objects: string[] = []; const add = (value: string) => { objects.push(value); return objects.length }
  add(''); const pages = add(''); const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const commands = `BT /F1 10 Tf\n${lines.map((line, index) => `1 0 0 1 36 ${760 - index * 18} Tm (${line.replace(/[()\\]/g, '\\$&')}) Tj`).join('\n')}\nET`
  const content = add(`<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`)
  const page = add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`)
  objects[0] = `<< /Type /Catalog /Pages ${pages} 0 R >>`; objects[pages - 1] = `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`
  let pdf = Buffer.from('%PDF-1.4\n'), offsets = [0]
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf = Buffer.concat([pdf, Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`)]) })
  const xref = pdf.length; let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`; offsets.slice(1).forEach(offset => { table += `${String(offset).padStart(10, '0')} 00000 n \n` })
  return Buffer.concat([pdf, Buffer.from(`${table}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)])
}

test('requires run-specific consent for the frozen minimized CV text and returns unconfirmed AI proposals', async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-profile-ai-')), userData = join(root, 'workspace'), sourceFile = join(root, 'cv.pdf')
  writeFileSync(sourceFile, makePdf(['NAME: Ada Example', 'EMAIL: ada@example.test', 'PHONE: +1 555 123 4567', 'SKILLS: Python', 'A long enough supporting paragraph ensures this synthetic PDF meets the local text extraction threshold.']))
  let running: ElectronApplication | undefined
  try {
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'profile-ai', CV_TAILOR_SCRIPTED_PI_MODEL: '1' } })
    const page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15_000 })
    await selectScriptedPiModel(page)
    await page.getByRole('button', { name: 'My profile' }).click()
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, sourceFile)
    await page.getByRole('button', { name: 'Upload CV' }).click()
    const review = page.getByRole('region', { name: 'Review proposed profile details' })
    await expect(review).toBeVisible()
    await page.getByRole('button', { name: 'Preview AI request' }).click()
    const consent = page.getByRole('region', { name: 'Review text sent through Pi' })
    await expect(consent).toBeVisible()
    const outgoing = consent.getByLabel('Exact outgoing text')
    await expect(outgoing).toContainText('Page 1 · passage 1')
    await expect(outgoing).not.toContainText('"unitId"')
    await expect(outgoing).toContainText('SKILLS: Python')
    await expect(outgoing).toContainText('[PERSONAL_1]')
    await expect(outgoing).not.toContainText('ada@example.test')
    await expect(outgoing).not.toContainText('+1 555 123 4567')
    await expect(consent).toContainText('does not make this anonymous')
    const invalidEffort = await page.evaluate(async () => {
      const workbench = window.workbench as typeof window.workbench & { setPiModel(input: { reference: string; thinkingLevel: string }): Promise<unknown> }
      try {
        await workbench.setPiModel({ reference: 'scripted/cv-tailor-fixture', thinkingLevel: 'invalid' })
        return false
      } catch {
        return true
      }
    })
    expect(invalidEffort).toBe(true)
    await expect(consent).toBeVisible()
    const rejectChangedSelection = async (reference: string, thinkingLevel: 'off' | 'low') => {
      await page.evaluate(input => window.workbench.setPiModel(input), { reference, thinkingLevel })
      await consent.getByLabel(/I authorize this one-time request/).check()
      await consent.getByRole('button', { name: 'Send text and structure' }).click()
      await expect(page.getByRole('alert')).toContainText(/Pi model or thinking level changed/i)
      expect((await page.evaluate(() => window.workbench.getProfile())).skills).toHaveLength(0)
      await consent.getByRole('button', { name: 'Decline AI assistance' }).click()
      await page.evaluate(() => window.workbench.setPiModel({ reference: 'scripted/cv-tailor-fixture', thinkingLevel: 'off' }))
      await page.getByRole('button', { name: 'Preview AI request' }).click()
      await expect(consent).toBeVisible()
    }
    await rejectChangedSelection('scripted/cv-tailor-fixture-alt', 'off')
    await rejectChangedSelection('scripted/cv-tailor-fixture', 'low')
    await page.setViewportSize({ width: 375, height: 800 })
    await page.getByRole('button', { name: 'Use dark mode' }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await expect(consent.getByRole('button', { name: 'Send text and structure' })).toBeDisabled()
    await consent.getByLabel(/I authorize this one-time request/).check()
    await consent.getByRole('button', { name: 'Send text and structure' }).click()
    await expect(consent).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('AI suggestions are ready')
    await expect(review.getByRole('group', { name: 'Skill 1' }).getByLabel('Skill name')).toHaveValue('Python')
    expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ contact: null, skills: [] })
    await review.getByRole('button', { name: 'Apply accepted details' }).click()
    await expect(page.getByRole('status')).toContainText('added to your profile')
    expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ skills: [expect.objectContaining({ name: 'Python', category: 'Technical' })] })
  } finally { await running?.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})

test('continues through local review without opening an AI preview', async () => {
  test.setTimeout(60_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-local-cv-review-')), userData = join(root, 'workspace'), sourceFile = join(root, 'cv.pdf')
  writeFileSync(sourceFile, makePdf(['NAME: Ada Example', 'SKILLS: Python', 'Built a Python parser for sample reporting work and documented the data model.', 'Maintained internal tools with colleagues and recorded the exact supported workflow details for local review.']))
  let running: ElectronApplication | undefined
  try {
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'profile-ai', CV_TAILOR_SCRIPTED_PI_MODEL: '1' } })
    const page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15_000 })
    await selectScriptedPiModel(page)
    await page.getByRole('button', { name: 'My profile' }).click()
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, sourceFile)
    await page.getByRole('button', { name: 'Upload CV' }).click()
    const review = page.getByRole('region', { name: 'Review proposed profile details' })
    await expect(review).toBeVisible()
    await expect(review.getByRole('button', { name: 'Preview AI request' })).toBeVisible()
    await review.getByRole('button', { name: 'Continue locally' }).click()
    await expect(review).toContainText('Local review selected. No request was sent.')
    await expect(page.getByRole('region', { name: 'Review text sent through Pi' })).toHaveCount(0)
    expect((await page.evaluate(() => window.workbench.getProfile())).skills).toHaveLength(0)
    await review.getByRole('button', { name: 'Apply accepted details' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'added to your profile' })).toBeVisible()
    expect((await page.evaluate(() => window.workbench.getProfile())).skills).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Python' })]))
  } finally { await running?.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})

test('cancels an authorized in-flight request and retains the local correction route', async () => {
  test.setTimeout(60_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-profile-ai-cancel-')), userData = join(root, 'workspace'), sourceFile = join(root, 'cv.pdf')
  writeFileSync(sourceFile, makePdf(['NAME: Ada Example', 'SKILLS: Python', 'A long enough supporting paragraph ensures this synthetic PDF meets the local text extraction threshold.']))
  let running: ElectronApplication | undefined
  try {
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'profile-ai-delayed', CV_TAILOR_SCRIPTED_PI_MODEL: '1' } })
    const page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15_000 })
    await selectScriptedPiModel(page)
    await page.getByRole('button', { name: 'My profile' }).click()
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, sourceFile)
    await page.getByRole('button', { name: 'Upload CV' }).click()
    const review = page.getByRole('region', { name: 'Review proposed profile details' })
    await expect(review).toBeVisible()
    await page.getByRole('button', { name: 'Preview AI request' }).click()
    const consent = page.getByRole('region', { name: 'Review text sent through Pi' })
    await expect(consent).toBeVisible()
    await consent.getByLabel(/I authorize this one-time request/).check()
    await consent.getByRole('button', { name: 'Send text and structure' }).click()
    await expect(consent.getByRole('button', { name: 'Cancel AI request' })).toBeVisible()
    await consent.getByRole('button', { name: 'Cancel AI request' }).click()
    await expect(consent).toHaveCount(0)
    await expect(review.getByRole('group', { name: 'Skill 1' }).getByLabel('Skill name')).toHaveValue('Python')
    expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ contact: null, skills: [] })
  } finally { await running?.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})
