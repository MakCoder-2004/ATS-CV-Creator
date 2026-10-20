import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Exercise native dialog routing, visible preview/confirmation, preload, IPC and SQLite together.
test('user previews and confirms a profile JSON replacement', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-import-smoke-'))
  const importFile = join(userData, 'replacement.json')
  const exportFile = join(userData, 'exported-profile.json')
  writeFileSync(importFile, JSON.stringify({
    format: 'cv-tailor-profile', version: 1,
    profile: { contact: null, skills: [{ id: '45d4c602-85af-4e4c-aec5-cf94b806f196', revision: 1, name: 'Imported evidence', category: 'Technical' }], education: [], certificates: [], summary: [], languages: [], extras: [] },
    experience: { experience: [], projects: [] }
  }))
  let running: ElectronApplication | undefined
  try {
    running = await electron.launch({ args: ['.'], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: join(userData, 'workspace') } })
    const page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15000 })
    await running.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
      return true
    }, importFile)
    await page.getByRole('button', { name: 'My profile' }).click()
    await page.evaluate(() => window.workbench.saveSkill({ name: 'Existing evidence', category: 'Technical' }))
    await page.getByRole('button', { name: 'Import profile JSON' }).click()
    await expect(page.getByRole('dialog', { name: 'Replace profile from JSON?' })).toContainText('does not merge records')
    await expect(page.getByRole('list', { name: 'Replacement effects' })).toContainText('skills — remove: Existing evidence')
    await expect(page.getByRole('list', { name: 'Replacement effects' })).toContainText('skills — add: Imported evidence')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Replace profile from JSON?' })).toHaveCount(0)
    expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ skills: [{ name: 'Existing evidence' }] })
    const cancelled = await page.evaluate(async () => {
      const pending = await window.workbench.previewProfileImport()
      if (!pending.ok) throw Error(pending.message)
      const declined = await window.workbench.cancelProfileImport(pending.token)
      const lateApply = await window.workbench.applyProfileImport(pending.token)
      return { declined, lateApply }
    })
    expect(cancelled.declined.ok).toBe(true)
    expect(cancelled.lateApply.ok).toBe(false)
    await page.getByRole('button', { name: 'Import profile JSON' }).click()
    await expect(page.getByRole('dialog', { name: 'Replace profile from JSON?' })).toBeVisible()
    await page.getByRole('button', { name: 'Confirm replacement' }).click()
    await expect(page.getByRole('status')).toContainText('Profile replaced from JSON')
    expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ contact: null, skills: [{ name: 'Imported evidence' }] })
    await running.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); return true })
    await page.getByRole('button', { name: 'Import profile JSON' }).click()
    await expect(page.getByRole('dialog', { name: 'Replace profile from JSON?' })).toHaveCount(0)
    expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ skills: [{ name: 'Imported evidence' }] })
    await running.evaluate(({ dialog }, selectedPath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: selectedPath })
      return true
    }, exportFile)
    page.once('dialog', nativeDialog => nativeDialog.accept())
    await page.getByRole('button', { name: 'Export profile JSON' }).click()
    await expect(page.getByRole('status')).toContainText('Profile JSON exported')
    expect(JSON.parse(readFileSync(exportFile, 'utf8'))).toMatchObject({ format: 'cv-tailor-profile', version: 1, profile: { skills: [{ name: 'Imported evidence' }] } })
    const corrupt = join(userData, 'corrupt.json')
    writeFileSync(corrupt, '{')
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); return true }, corrupt)
    await page.getByRole('button', { name: 'Import profile JSON' }).click()
    await expect(page.getByRole('alert')).toContainText('invalid or incompatible')
    await running.evaluate(({ dialog }, directory) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: directory }); return true }, userData)
    page.once('dialog', nativeDialog => nativeDialog.accept())
    await page.getByRole('button', { name: 'Export profile JSON' }).click()
    await expect(page.getByRole('alert')).toContainText('could not complete')
    expect((await page.evaluate(() => window.workbench.getProfile())).skills[0].name).toBe('Imported evidence')
  } finally {
    await running?.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
