import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeProfileAiBaselineDocx, makeProfileAiBaselinePdf } from '../fixtures/profile-ai-upload-baseline'
import { selectScriptedPiModel } from './pi-model-fixture'

const lines = [
  'NAME: Riley Example', 'EMAIL: riley@example.test', 'SKILLS: TypeScript',
  'EXPERIENCE: Northwind Labs | Software Engineer | 2021-01 - 2024-12',
  'FACT: Maintained the billing service.', 'PROJECT: Atlas | React',
  'PROJECT LINK: Repository | https://github.com/riley/atlas',
  'UNKNOWN: Community mentor, dates not stated.'
]

for (const format of ['pdf', 'docx'] as const) test(`consented ${format} full-fact import keeps contact, role, project, skill and link after reopen`, async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), `cv-tailor-ai-fixture-${format}-`))
  const userData = join(root, 'workspace'), source = join(root, `synthetic.${format}`)
  writeFileSync(source, format === 'pdf' ? makeProfileAiBaselinePdf(lines) : await makeProfileAiBaselineDocx())
  let running: Awaited<ReturnType<typeof electron.launch>> | undefined
  const launch = () => electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_ANALYSIS: 'profile-ai', CV_TAILOR_SCRIPTED_PI_MODEL: '1' } })
  try {
    running = await launch()
    const page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15_000 })
    await selectScriptedPiModel(page)
    await page.getByRole('button', { name: 'My profile' }).click()
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }) }, source)
    await page.getByRole('button', { name: format === 'pdf' ? 'Upload CV' : 'Upload Word CV' }).click()
    const review = page.getByRole('region', { name: 'Review proposed profile details' })
    await expect(review.getByLabel('Full name')).toHaveValue('Riley Example')
    expect((await page.evaluate(() => window.workbench.getProfile())).skills).toHaveLength(0)
    let backupCount = 0
    const dispatchedAttempts = async () => {
      const backupFile = join(root, `attempt-count-${++backupCount}.json`)
      await running!.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }) }, backupFile)
      const result = await page.evaluate(() => window.workbench.exportWorkspaceBackup())
      expect(result.ok, JSON.stringify(result)).toBe(true)
      return (JSON.parse(readFileSync(backupFile, 'utf8')).tables.analysis_attempts.rows as Array<{ run_id: string }>).filter(row => row.run_id.startsWith('profile-import:')).length
    }
    if (format === 'pdf') expect(await dispatchedAttempts()).toBe(0)
    await review.getByRole('button', { name: 'Preview AI request' }).click()
    const consent = page.getByRole('region', { name: 'Review text sent through Pi' })
    await expect(consent.getByLabel('Exact outgoing text')).toContainText('PROJECT: Atlas')
    if (format === 'pdf') expect(await dispatchedAttempts()).toBe(0)
    await consent.getByLabel(/I authorize this one-time request/).check()
    await consent.getByRole('button', { name: 'Send text and structure' }).click()
    await expect(consent).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('AI suggestions are ready')
    if (format === 'pdf') expect(await dispatchedAttempts()).toBe(1)
    await expect(review.getByLabel('Full name')).toHaveValue('Riley Example')
    await expect(review.getByRole('group', { name: 'Experience 1' }).getByLabel('Organization')).toHaveValue('Northwind Labs')
    await expect(review.getByRole('group', { name: 'Project 1' })).toContainText('https://github.com/riley/atlas')
    await expect(review).toContainText(format === 'pdf' ? 'UNKNOWN: Community mentor' : 'A later note repeats Northwind Labs')
    if (format === 'pdf') await page.screenshot({ path: join(process.cwd(), 'docs/validation/artifacts/spec-73-ai-upload-pdf-review.png') })
    await review.getByRole('button', { name: 'Apply accepted details' }).click()
    await expect(page.getByRole('status')).toContainText('added to your profile')
    await running.close(); running = undefined
    running = await launch()
    const reopened = await running.firstWindow()
    await expect(reopened.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15_000 })
    const profile = await reopened.evaluate(() => window.workbench.getProfile())
    const experience = await reopened.evaluate(() => window.workbench.getExperience())
    expect(profile.contact).toMatchObject({ fullName: 'Riley Example', email: 'riley@example.test' })
    expect(profile.skills).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'TypeScript' })]))
    expect(experience.experience).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Software Engineer', organization: 'Northwind Labs', factualItems: expect.arrayContaining([expect.objectContaining({ text: 'Maintained the billing service.' })]) })]))
    expect(experience.projects).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Atlas', technologies: expect.arrayContaining([expect.objectContaining({ text: 'React' })]), links: [{ url: 'https://github.com/riley/atlas', label: 'Repository' }] })]))
  } finally { await running?.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})

test('a stale Word review keeps its token until explicit merge refresh and preserves newer facts', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-tailor-ai-docx-rebase-')), userData = join(root, 'workspace'), source = join(root, 'synthetic.docx')
  writeFileSync(source, await makeProfileAiBaselineDocx())
  let running: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    running = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    const page = await running.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'My profile' }).click()
    await running.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }) }, source)
    await page.getByRole('button', { name: 'Upload Word CV' }).click()
    const review = page.getByRole('region', { name: 'Review proposed profile details' })
    await expect(review.getByLabel('Full name')).toHaveValue('Riley Example')
    await page.evaluate(() => window.workbench.saveSkill({ name: 'Newer local fact', category: 'Other' }))
    await review.getByRole('button', { name: 'Apply accepted details' }).click()
    await expect(review.getByRole('button', { name: 'Refresh merge choices' })).toBeVisible()
    expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ contact: null, skills: [{ name: 'Newer local fact' }] })
    await review.getByRole('button', { name: 'Refresh merge choices' }).click()
    await expect(review.getByRole('button', { name: 'Refresh merge choices' })).toHaveCount(0)
    await review.getByRole('button', { name: 'Apply accepted details' }).click()
    await expect(page.getByRole('status')).toContainText('decisions were applied')
    expect(await page.evaluate(() => window.workbench.getProfile())).toMatchObject({ contact: { fullName: 'Riley Example' }, skills: expect.arrayContaining([expect.objectContaining({ name: 'Newer local fact' }), expect.objectContaining({ name: 'TypeScript' })]) })
  } finally { await running?.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})
