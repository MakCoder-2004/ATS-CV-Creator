import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, Packer, Paragraph } from 'docx'
import { selectScriptedPiModel } from './pi-model-fixture'

test('Word CV structuring through Pi leaves facts as proposals until review and apply', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-pi-word-structuring-'))
  const sourceFile = join(root, 'synthetic-cv.docx')
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const doc = new Document({ sections: [{ children: [
      new Paragraph('NAME: Ada Example'),
      new Paragraph('EMAIL: ada@example.test'),
      new Paragraph('SKILLS: Python'),
      new Paragraph('A synthetic career passage describes Python work with enough text for local extraction and source-backed review without using any real person or provider.'),
    ] }] })
    writeFileSync(sourceFile, await Packer.toBuffer(doc))
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: join(root, 'workspace'), CV_TAILOR_TEST_MODEL_DISPATCH_LOG: 'model-dispatches.log', CV_TAILOR_SCRIPTED_ANALYSIS: 'profile-ai', CV_TAILOR_SCRIPTED_PI_MODEL: '1' } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await selectScriptedPiModel(page)
    await page.getByRole('button', { name: 'My profile' }).click()
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, sourceFile)
    await page.getByRole('button', { name: 'Upload Word CV' }).click()
    const review = page.getByRole('region', { name: 'Review proposed profile details' })
    await expect(review).toBeVisible()
    await page.getByRole('button', { name: 'Preview AI request' }).click()
    const consent = page.getByRole('region', { name: 'Review text sent through Pi' })
    await expect(consent).toContainText('Provider: scripted')
    await expect(consent).toContainText('Thinking level: off')
    await expect(consent.getByLabel('Exact outgoing text')).not.toContainText('ada@example.test')
    await consent.getByLabel(/I authorize this one-time request/).check()
    await consent.getByRole('button', { name: 'Send text and structure' }).click()
    await expect(consent).toHaveCount(0)
    expect(readFileSync(join(root, 'workspace', 'model-dispatches.log'), 'utf8').trim().split(String.fromCharCode(10))).toEqual(['profile-import'])
    await expect(review.getByRole('group', { name: 'Skill 1' }).getByLabel('Skill name')).toHaveValue('Python')
    expect((await page.evaluate(() => window.workbench.getProfile())).skills).toHaveLength(0)
    await review.getByRole('button', { name: 'Apply accepted details' }).click()
    await expect(page.getByRole('status')).toContainText('added to your profile')
    expect((await page.evaluate(() => window.workbench.getProfile())).skills).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Python' })]))
  } finally {
    await app?.close().catch(() => {})
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
