import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syntheticPdf } from '../helpers/synthetic-pdf'

test('reference PDF stays local until editable facts are reviewed; cancel and confirm have different outcomes', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-pdf-smoke-'))
  const referencePath = join(userData, 'synthetic-reference.pdf')
  const reference = await syntheticPdf(doc => {
    doc.text('Example Candidate', 70, 70)
    doc.text('Sample Academy', 70, 110)
    doc.text('Certificate of Practice', 70, 150)
    doc.text('Certificate page', 70, 190, { link: 'https://example.test/certificate' })
  })
  writeFileSync(referencePath, reference)
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ args: ['.'], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: join(userData, 'workspace') } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, referencePath)
    await page.getByRole('button', { name: 'My profile' }).click()
    const selection = page.getByRole('region', { name: 'Reference PDF import' })
    await selection.getByRole('button', { name: 'Review reference PDF' }).click()
    const review = page.getByRole('region', { name: 'Extracted PDF review' })
    await expect(review).toContainText('Example Candidate')
    await expect(review).toContainText('reading order')
    const fields = review.getByRole('list', { name: 'Extracted fragments' }).getByRole('listitem')
    await fields.filter({ hasText: 'Example Candidate' }).getByRole('combobox', { name: 'Category' }).selectOption('contact')
    await fields.filter({ hasText: 'Example Candidate' }).getByRole('textbox', { name: 'Correct extracted text' }).fill('Corrected Candidate')
    await fields.filter({ hasText: 'Sample Academy' }).getByRole('combobox', { name: 'Category' }).selectOption('certificate')
    await fields.filter({ hasText: 'Sample Academy' }).getByRole('combobox', { name: 'Field' }).selectOption('organization')
    await fields.filter({ hasText: 'Certificate of Practice' }).getByRole('combobox', { name: 'Category' }).selectOption('certificate')
    await fields.filter({ hasText: 'Certificate of Practice' }).getByRole('combobox', { name: 'Field' }).selectOption('title')
    await fields.filter({ hasText: 'https://example.test/certificate' }).getByRole('combobox', { name: 'Category' }).selectOption('certificate')
    await fields.filter({ hasText: 'https://example.test/certificate' }).getByRole('combobox', { name: 'Field' }).selectOption('link')
    for (const item of await fields.all()) await item.getByRole('checkbox', { name: 'Reviewed' }).check()
    await review.getByRole('button', { name: 'Review replacement effects' }).click()
    await expect(page.getByRole('region', { name: 'Profile replacement effects' })).toContainText('Corrected Candidate')
    expect((await page.evaluate(() => window.workbench.getProfile())).contact).toBeNull()
    await page.getByRole('button', { name: 'Cancel PDF review' }).click()
    expect((await page.evaluate(() => window.workbench.getProfile())).contact).toBeNull()
    await selection.getByRole('button', { name: 'Review reference PDF' }).click()
    const second = page.getByRole('region', { name: 'Extracted PDF review' })
    const candidate = second.getByRole('list', { name: 'Extracted fragments' }).getByRole('listitem').filter({ hasText: 'Example Candidate' })
    await candidate.getByRole('combobox', { name: 'Category' }).selectOption('contact')
    await candidate.getByRole('textbox', { name: 'Correct extracted text' }).fill('Corrected Candidate')
    for (const item of await second.getByRole('list', { name: 'Extracted fragments' }).getByRole('listitem').all()) await item.getByRole('checkbox', { name: 'Reviewed' }).check()
    await second.getByRole('button', { name: 'Review replacement effects' }).click()
    await page.getByRole('button', { name: 'Apply reviewed PDF facts' }).click()
    await expect(page.getByRole('status')).toContainText('original PDF was not changed')
    expect((await page.evaluate(() => window.workbench.getProfile())).contact?.fullName).toBe('Corrected Candidate')
    expect(reference).toEqual(await import('node:fs/promises').then(fs => fs.readFile(referencePath)))
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})

test('cancelling the PDF dialog and choosing an invalid path do not claim an import', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-pdf-error-'))
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ args: ['.'], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: join(userData, 'workspace') } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'My profile' }).click()
    const region = page.getByRole('region', { name: 'Reference PDF import' })
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
    await region.getByRole('button', { name: 'Review reference PDF' }).click()
    await expect(page.getByRole('region', { name: 'Extracted PDF review' })).toHaveCount(0)
    await expect(region.getByRole('alert')).toHaveCount(0)
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, join(userData, 'missing.pdf'))
    await region.getByRole('button', { name: 'Review reference PDF' }).click()
    await expect(region.getByRole('alert')).toContainText('could not be read or extracted')
    expect((await page.evaluate(() => window.workbench.getProfile())).contact).toBeNull()
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
