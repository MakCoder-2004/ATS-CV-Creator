import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'profile-ai' } })
    const page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'My profile' }).click()
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, sourceFile)
    await page.getByRole('button', { name: 'Upload CV' }).click()
    const review = page.getByRole('region', { name: 'Review proposed profile details' })
    await expect(review).toBeVisible()
    await page.getByRole('button', { name: 'Optional AI structuring' }).click()
    const consent = page.getByRole('region', { name: 'Review text sent to OpenRouter' })
    await expect(consent).toBeVisible()
    const outgoing = consent.getByLabel('Exact outgoing text')
    await expect(outgoing).toContainText('[PERSONAL_1]')
    await expect(outgoing).not.toContainText('ada@example.test')
    await expect(outgoing).not.toContainText('+1 555 123 4567')
    await expect(consent).toContainText('does not make this anonymous')
    await page.setViewportSize({ width: 375, height: 800 })
    await page.getByRole('button', { name: 'Use dark mode' }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await expect(consent.getByRole('button', { name: 'Send text and structure' })).toBeDisabled()
    await consent.getByLabel(/I authorize this one-time request/).check()
    await consent.getByRole('button', { name: 'Send text and structure' }).click()
    await expect(consent).toHaveCount(0)
    await expect(review.getByRole('group', { name: 'Skill 1' }).getByLabel('Skill name')).toHaveValue('Python')
    expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ contact: null, skills: [] })
    await review.getByRole('button', { name: 'Apply accepted details' }).click()
    await expect(page.getByRole('status')).toContainText('added to your profile')
    expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ skills: [{ name: 'Python', category: 'Technical' }] })
  } finally { await running?.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})

test('cancels an authorized in-flight request and retains the local correction route', async () => {
  test.setTimeout(60_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-profile-ai-cancel-')), userData = join(root, 'workspace'), sourceFile = join(root, 'cv.pdf')
  writeFileSync(sourceFile, makePdf(['NAME: Ada Example', 'SKILLS: Python', 'A long enough supporting paragraph ensures this synthetic PDF meets the local text extraction threshold.']))
  let running: ElectronApplication | undefined
  try {
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'profile-ai-delayed' } })
    const page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'My profile' }).click()
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, sourceFile)
    await page.getByRole('button', { name: 'Upload CV' }).click()
    const review = page.getByRole('region', { name: 'Review proposed profile details' })
    await expect(review).toBeVisible()
    await page.getByRole('button', { name: 'Optional AI structuring' }).click()
    const consent = page.getByRole('region', { name: 'Review text sent to OpenRouter' })
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
