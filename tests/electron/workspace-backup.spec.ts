import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

test('visible backup preview and confirmed restore replace the workspace without credentials', async () => {
  test.setTimeout(90000)
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-workspace-smoke-'))
  const backupFile = join(directory, 'personal-workspace.json')
  let running: ElectronApplication | undefined
  try {
    running = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: join(directory, 'workspace') } })
    const page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    await page.evaluate(async () => {
      await window.workbench.saveSkill({ name: 'Before backup', category: 'Technical' })
      await window.workbench.saveJob({ title: 'Backup role', company: 'Example', description: 'A saved original posting' })
    })
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByText(/backup files contain personal data/i)).toBeVisible()
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: selectedPath }); return true }, backupFile)
    await page.getByRole('button', { name: 'Back up workspace' }).click()
    await expect(page.getByText(/Workspace backup saved/i)).toBeVisible()
    const backup = JSON.parse(readFileSync(backupFile, 'utf8'))
    expect(backup.format).toBe('cv-tailor-workspace-backup')
    expect(JSON.stringify(backup)).not.toContain('ciphertext')
    await page.evaluate(async () => { await window.workbench.saveSkill({ name: 'After backup', category: 'Technical' }) })
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, backupFile)
    await page.getByRole('button', { name: 'Restore workspace' }).click()
    const preview = page.getByRole('dialog', { name: /Replace workspace from backup/i })
    await expect(preview).toContainText(/replace/i)
    await expect(preview).toContainText(/safety backup/i)
    await page.screenshot({ path: resolve('test-results/workspace-restore-preview.png') })
    await page.getByRole('button', { name: 'Cancel restore' }).click()
    await expect(preview).toHaveCount(0)
    expect((await page.evaluate(() => window.workbench.getProfile())).skills.map(skill => skill.name)).toContain('After backup')
    await page.getByRole('button', { name: 'Restore workspace' }).click()
    await expect(preview).toBeVisible()
    await page.getByRole('button', { name: 'Confirm workspace replacement' }).click()
    await expect(page.getByText(/Workspace restored/i)).toBeVisible()
    expect((await page.evaluate(() => window.workbench.getProfile())).skills.map(skill => skill.name)).toEqual(['Before backup'])
    expect((await page.evaluate(() => window.workbench.listJobs())).map(job => job.title)).toEqual(['Backup role'])
  } finally {
    await running?.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
