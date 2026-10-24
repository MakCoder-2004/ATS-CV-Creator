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

async function prepareReview(app: ElectronApplication, sourceFile: string) {
  const page = await app.firstWindow()
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); return true }, sourceFile)
  await page.getByRole('button', { name: 'Upload CV' }).click()
  const review = page.getByRole('region', { name: 'Review proposed profile details' })
  await expect(review).toBeVisible()
  return { page, review }
}

async function authorizeAndRun(page: Awaited<ReturnType<ElectronApplication['firstWindow']>>) {
  await page.getByRole('button', { name: 'Optional AI structuring' }).click()
  const consent = page.getByRole('region', { name: 'Review text sent to OpenRouter' })
  await expect(consent).toBeVisible()
  await consent.getByLabel(/I authorize this one-time request/).check()
  await consent.getByRole('button', { name: 'Send text and structure' }).click()
  return consent
}

test('rejects an AI-invented skill even when it cites a real CV passage', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-profile-ai-wrong-fact-')), userData = join(root, 'workspace'), sourceFile = join(root, 'cv.pdf')
  writeFileSync(sourceFile, makePdf(['NAME: Ada Example', 'SKILLS: Python', 'A much longer synthetic career passage with meaningful selectable text satisfies the bounded local PDF extraction requirement and the minimum usable-text threshold.']))
  let running: ElectronApplication | undefined
  try {
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'profile-ai-wrong-fact', CV_TAILOR_SCRIPTED_PI_MODEL: '1' } })
    const page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15_000 })
    await selectScriptedPiModel(page)
    await page.getByRole('button', { name: 'My profile' }).click()
    const { review } = await prepareReview(running, sourceFile)
    await authorizeAndRun(page)
    await expect(page.getByRole('alert')).toContainText('not present in its cited CV passages')
    await expect(review.getByRole('group', { name: 'Skill 1' }).getByLabel('Skill name')).toHaveValue('Python')
    expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ contact: null, skills: [] })
  } finally { await running?.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})

test('discards a non-abortable late response after cancel and protects the next CV preview', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-profile-ai-late-')), userData = join(root, 'workspace'), firstFile = join(root, 'first.pdf'), secondFile = join(root, 'second.pdf')
  writeFileSync(firstFile, makePdf(['SKILLS: Python', 'A lengthy synthetic career passage with selectable source wording satisfies the local PDF extraction minimum and preserves text review.']))
  writeFileSync(secondFile, makePdf(['SKILLS: SQL', 'A separate lengthy synthetic career passage with selectable source wording satisfies the local PDF extraction minimum and preserves text review.']))
  let running: ElectronApplication | undefined
  try {
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'profile-ai-late', CV_TAILOR_SCRIPTED_PI_MODEL: '1' } })
    const page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15_000 })
    await selectScriptedPiModel(page)
    await page.getByRole('button', { name: 'My profile' }).click()
    const { review } = await prepareReview(running, firstFile)
    const consent = await authorizeAndRun(page)
    await consent.getByRole('button', { name: 'Cancel AI request' }).click()
    await expect(consent).toHaveCount(0)
    await running.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); return true }, secondFile)
    await page.getByRole('button', { name: 'Upload CV' }).click()
    const currentReview = page.getByRole('region', { name: 'Review proposed profile details' })
    await expect(currentReview.getByRole('group', { name: 'Skill 1' }).getByLabel('Skill name')).toHaveValue('SQL')
    await expect(page.getByRole('status').filter({ hasText: 'Sending the authorized text' })).toHaveCount(0)
    await expect(currentReview.getByRole('group', { name: 'Skill 1' }).getByLabel('Skill name')).toHaveValue('SQL')
    await expect.poll(() => page.evaluate(() => window.workbench.getProfile())).toMatchObject({ contact: null, skills: [] })
  } finally { await running?.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})
