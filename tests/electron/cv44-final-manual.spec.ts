import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const executablePath = process.env.CV_TAILOR_INSTALLED_EXE
const enabled = process.env.RUN_CV44_MANUAL === '1' && Boolean(executablePath)
test.skip(!enabled, 'Set RUN_CV44_MANUAL=1 and CV_TAILOR_INSTALLED_EXE to the reviewed installed executable')

const userData = resolve('release/cv44-final-userdata')
const results = resolve('test-results/cv44-final')
const progressFile = join(results, 'progress.json')
const profileJson = join(userData, 'cv44-profile-export.json')
const workspaceBackup = join(userData, 'cv44-workspace-backup.json')
const title = 'CV44 FINAL ISOLATED TEST'

type Stage = 'starting' | 'awaiting-pdf-picker-and-apply' | 'awaiting-docx-picker-and-apply' | 'exporting' | 'restoring' | 'reopening' | 'passed' | 'failed'
function progress(stage: Stage, detail: string) {
  writeFileSync(progressFile, JSON.stringify({ task: '#44', stage, detail, updatedAt: new Date().toISOString() }, null, 2))
}

async function snapshot(page: Awaited<ReturnType<ElectronApplication['firstWindow']>>) {
  return page.evaluate(async () => ({ profile: await window.workbench.getProfile(), experience: await window.workbench.getExperience() }))
}

async function waitForManualImport(page: Awaited<ReturnType<ElectronApplication['firstWindow']>>, button: 'Upload CV' | 'Upload Word CV', stage: Stage) {
  progress(stage, `In ${title}: click “${button}”, choose the real file in the OS picker, review it, then click “Apply accepted details”.`)
  await page.getByRole('button', { name: button, exact: true }).click()
  const review = page.getByRole('region', { name: 'Review proposed profile details' })
  await expect(review).toBeVisible({ timeout: 210_000 })
  await expect(review.getByRole('button', { name: 'Apply accepted details' })).toBeEnabled()
  // The real OS picker is deliberately not intercepted. The user must apply the visible review themselves.
  await expect(review).toHaveCount(0, { timeout: 210_000 })
  await expect(page.getByRole('status').filter({ hasText: /Accepted source passages are retained as personal data/i })).toBeVisible({ timeout: 15_000 })
}

test('CV-44 final installed-app manual PDF and DOCX picker gate', async () => {
  test.setTimeout(270_000)
  if (!executablePath) throw new Error('CV_TAILOR_INSTALLED_EXE is required.')
  mkdirSync(results, { recursive: true })
  progress('starting', 'Preparing a new isolated userData directory. No application launched unless this gated test is explicitly enabled.')
  writeFileSync(join(results, 'evidence.json'), JSON.stringify({ task: '#44', status: 'prepared', passed: false, userDataIsolated: true }, null, 2))
  if (existsSync(userData)) throw new Error(`Refusing to reuse existing data; move or remove this isolated directory before running: ${userData}`)
  mkdirSync(dirname(userData), { recursive: true })
  mkdirSync(userData)

  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ executablePath, args: [`--user-data-dir=${userData}`], timeout: 45_000 })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 30_000 })
    await app.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window?.setTitle('CV44 FINAL ISOLATED TEST')
      return { userData: app.getPath('userData'), executable: app.getPath('exe') }
    }).then(paths => {
      expect(resolve(paths.userData)).toBe(userData)
      expect(realpathSync(paths.executable)).toBe(realpathSync(executablePath!))
    })
    await page.evaluate(() => { document.title = 'CV44 FINAL ISOLATED TEST' })
    await expect.poll(() => page.title()).toBe(title)
    await page.getByRole('button', { name: 'My profile' }).click()
    await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible()

    await waitForManualImport(page, 'Upload CV', 'awaiting-pdf-picker-and-apply')
    const afterPdf = await snapshot(page)
    expect(afterPdf.profile.contact || afterPdf.profile.skills.length || afterPdf.profile.education.length || afterPdf.profile.certificates.length || afterPdf.profile.summary.length || afterPdf.profile.languages.length || afterPdf.experience.experience.length || afterPdf.experience.projects.length).toBeTruthy()
    await waitForManualImport(page, 'Upload Word CV', 'awaiting-docx-picker-and-apply')
    const imported = await snapshot(page)
    expect(imported.profile.contact || imported.profile.skills.length || imported.profile.education.length || imported.profile.certificates.length || imported.profile.summary.length || imported.profile.languages.length || imported.experience.experience.length || imported.experience.projects.length).toBeTruthy()

    progress('exporting', 'Exporting profile JSON and complete workspace backup through only their narrowly matched dialogs.')
    await app.evaluate(({ dialog }, jsonPath) => {
      const save = dialog.showSaveDialog.bind(dialog)
      dialog.showSaveDialog = async (...args: any[]) => args[1]?.title === 'Export profile JSON'
        ? { canceled: false, filePath: jsonPath }
        : args[1]?.title === 'Back up personal workspace'
          ? { canceled: false, filePath: jsonPath.replace('cv44-profile-export.json', 'cv44-workspace-backup.json') }
          : save(...args as [any, any])
      const open = dialog.showOpenDialog.bind(dialog)
      dialog.showOpenDialog = async (...args: any[]) => args[1]?.title === 'Select workspace backup'
        ? { canceled: false, filePaths: [jsonPath.replace('cv44-profile-export.json', 'cv44-workspace-backup.json')] }
        : open(...args as [any, any])
      return true
    }, profileJson)
    page.once('dialog', nativeDialog => nativeDialog.accept())
    await page.getByRole('button', { name: 'Export profile JSON' }).click()
    await expect(page.getByRole('status').filter({ hasText: /Profile JSON exported/i })).toBeVisible({ timeout: 15_000 })
    expect(existsSync(profileJson)).toBe(true)
    const profileExchange = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(profileJson, 'utf8')))
    expect(profileExchange).toMatchObject({ format: 'cv-tailor-profile', version: 1 })

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Back up workspace' }).click()
    await expect(page.getByRole('region', { name: 'Workspace backup' }).getByRole('status')).toContainText(/Workspace backup saved/i, { timeout: 15_000 })
    expect(existsSync(workspaceBackup)).toBe(true)
    const backup = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(workspaceBackup, 'utf8')))
    expect(backup.format).toBe('cv-tailor-workspace-backup')

    progress('restoring', 'Restoring the just-exported complete backup through the app’s visible restore confirmation flow.')
    await page.evaluate(async () => {
      const result = await window.workbench.saveSkill({ name: 'CV44 isolated restore sentinel', category: 'Technical' })
      if (!result.ok) throw new Error('Could not create isolated restore sentinel.')
    })
    await page.getByRole('button', { name: 'Restore workspace' }).click()
    await expect(page.getByRole('dialog', { name: 'Replace workspace from backup?' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Confirm workspace replacement' }).click()
    await expect(page.getByRole('region', { name: 'Workspace backup' }).getByRole('status')).toContainText(/Workspace restored/i, { timeout: 20_000 })
    const restored = await snapshot(page)
    expect(restored).toEqual(imported)
    expect(restored.profile.skills.map(skill => skill.name)).not.toContain('CV44 isolated restore sentinel')

    progress('reopening', 'Closing and reopening the installed executable against the same isolated userData directory.')
    await app.close()
    app = await electron.launch({ executablePath, args: [`--user-data-dir=${userData}`], timeout: 45_000 })
    const reopenedPage = await app.firstWindow()
    await expect(reopenedPage.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 30_000 })
    const reopenedPaths = await app.evaluate(({ app }) => ({ userData: app.getPath('userData'), executable: app.getPath('exe') }))
    expect(resolve(reopenedPaths.userData)).toBe(userData)
    expect(realpathSync(reopenedPaths.executable)).toBe(realpathSync(executablePath))
    await reopenedPage.getByRole('button', { name: 'My profile' }).click()
    expect(await snapshot(reopenedPage)).toEqual(imported)

    // Evidence contains only stage names and record counts, never profile content or file paths beyond the isolated location.
    writeFileSync(join(results, 'evidence.json'), JSON.stringify({ task: '#44', passed: true, reopened: true, userDataIsolated: true, counts: { skills: imported.profile.skills.length, experience: imported.experience.experience.length, projects: imported.experience.projects.length, education: imported.profile.education.length } }, null, 2))
    progress('passed', 'Both real OS-picker imports were applied; JSON export, full backup/restore, and same-directory reopen all passed.')
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}; inspect the Playwright output for details.` : 'Unknown failure; inspect the Playwright output for details.'
    progress('failed', detail)
    writeFileSync(join(results, 'evidence.json'), JSON.stringify({ task: '#44', status: 'failed', passed: false, userDataIsolated: true, detail }, null, 2))
    throw error
  } finally {
    await app?.close().catch(() => {})
  }
})
