import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { emptyPostingOptionalDetails } from '../../src/shared/jobs'

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const snapshot = (title: string, company: string, description: string, capturedAt: string) => ({
  title, company, description,
  submittedUrl: 'https://jobs.lever.co/synthetic-board/historical-role',
  finalUrl: 'https://jobs.lever.co/synthetic-board/historical-role',
  sourceIdentity: 'lever:synthetic-board/historical-role', capturedAt,
  extractionMethod: 'lever-json-v1', extractionVersion: 1,
  optionalDetails: emptyPostingOptionalDetails(), conflicts: [],
  hashes: { title: hash(title), company: hash(company), description: hash(description) },
  fieldOrigins: { title: 'source', company: 'source', description: 'source', optionalDetails: {} }
})

test('restored historical Lever posting remains editable and tailor-able while source reads stay paused', async () => {
  test.setTimeout(90_000)
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-historical-lever-'))
  const userData = join(directory, 'workspace')
  const backupFile = join(directory, 'workspace.json')
  let running: ElectronApplication | undefined
  try {
    running = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_TEST_RESEARCH: '1', CV_TAILOR_SCRIPTED_POSTING_FETCH: '1', CV_TAILOR_TEST_POSTING_REQUEST_COUNTER: '1' } })
    let page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    await page.evaluate(async () => { await window.workbench.saveJob({ title: 'Synthetic Lever role', company: 'Example Research', description: 'Working wording retained for tailoring.' }) })
    await page.getByRole('button', { name: 'Settings' }).click()
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: selectedPath }); return true }, backupFile)
    await page.getByRole('button', { name: 'Back up workspace' }).click()
    await expect(page.getByText(/Workspace backup saved/i)).toBeVisible()

    const backup = JSON.parse(readFileSync(backupFile, 'utf8'))
    const row = backup.tables.jobs.rows[0]
    const record = JSON.parse(row.data)
    const currentDate = record.revisions.at(-1)?.acceptedAt ?? record.createdAt
    const sourceDescription = 'Historical source wording from the original synthetic Lever capture.'
    const priorDescription = 'Earlier captured wording retained in source history.'
    record.provenance = 'imported'
    record.sourceSnapshot = snapshot(record.title, record.company, sourceDescription, currentDate)
    record.sourceHistory = [snapshot(record.title, record.company, priorDescription, currentDate)]
    record.revisions = record.revisions.map((revision: Record<string, unknown>) => ({ ...revision, provenance: 'imported' }))
    row.data = JSON.stringify(record)
    writeFileSync(backupFile, JSON.stringify(backup))

    await page.evaluate(async () => { await window.workbench.saveSkill({ name: 'Restore replacement marker', category: 'Technical' }) })
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, backupFile)
    await page.getByRole('button', { name: 'Restore workspace' }).click()
    await expect(page.getByRole('dialog', { name: /Replace workspace from backup/i })).toBeVisible()
    await page.getByRole('button', { name: 'Confirm workspace replacement' }).click()
    await expect(page.getByText(/Workspace restored/i)).toBeVisible()

    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    let jobRow = page.locator('.saved-job-row').filter({ hasText: 'Synthetic Lever role' })
    await jobRow.getByRole('button', { name: 'Edit Synthetic Lever role posting' }).click()
    const history = page.getByRole('region', { name: 'Posting source and revision history' })
    await expect(history).toContainText(sourceDescription)
    await expect(history).toContainText(priorDescription)
    await expect(page.getByLabel('Posting and requirements')).toHaveValue('Working wording retained for tailoring.')
    await page.getByLabel('Posting and requirements').fill('Manually corrected working wording stays separate from captured source history.')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('dialog', { name: /Edit job posting/i })).toHaveCount(0)

    await page.getByRole('button', { name: 'Tailor CV', exact: true }).click()
    await expect(page.getByText('Manually corrected working wording stays separate from captured source history.')).toBeVisible()
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.locator('#content').getByRole('button', { name: 'New job' }).click()
    await page.getByRole('button', { name: 'Import from link' }).click()
    await page.getByLabel('Public job posting link').fill('https://jobs.lever.co/synthetic-board/historical-role')
    const backupBeforePausedFetch = readFileSync(backupFile, 'utf8')
    await page.getByRole('button', { name: 'Fetch posting' }).click()
    await expect(page.getByRole('alert')).toContainText(/Lever.*paused|paused.*Lever/i)
    for (const name of ['scripted-posting-requests.log', 'research-direct-requests.log']) {
      const path = join(userData, name)
      expect(existsSync(path) ? readFileSync(path, 'utf8') : '').toBe('')
    }
    expect(readFileSync(backupFile, 'utf8')).toBe(backupBeforePausedFetch)

    const beforeClose = await page.evaluate(() => window.workbench.listJobs())
    expect(beforeClose[0].sourceSnapshot?.description).toBe(sourceDescription)
    expect(beforeClose[0].sourceHistory[0]?.description).toBe(priorDescription)
    expect(beforeClose[0].description).toBe('Manually corrected working wording stays separate from captured source history.')
    await running.close()
    running = undefined
    running = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 20_000 })
    const afterReopen = await page.evaluate(() => window.workbench.listJobs())
    expect(afterReopen[0]).toEqual(beforeClose[0])
  } finally {
    await running?.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
