import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Development-only, synthetic public source and Pi; the installed app never enables this seam.
test('delayed full source preview clears at the original fetch deadline, not 15 minutes after receipt', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-research-expiry-'))
  const userData = join(root, 'workspace'), appData = join(root, 'appdata')
  mkdirSync(userData); mkdirSync(appData)
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], timeout: 45_000, env: {
      ...process.env, APPDATA: appData, CV_TAILOR_TEST_STORAGE_ROOT: root, CV_TAILOR_TEST_APP_DATA_DIR: appData,
      CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_TEST_RESEARCH: 'full-delayed'
    } })
    const page = await app.firstWindow({ timeout: 20_000 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.getByRole('button', { name: 'Import from link' }).click()
    await page.getByLabel('Public job posting link').fill('https://jobs.example.org/role/123')
    await page.clock.install() // Before the first public read, not after the response.
    await page.getByRole('button', { name: 'Fetch posting' }).click()
    await expect(page.getByRole('button', { name: 'Fetching…' })).toBeVisible()
    await page.clock.fastForward(2 * 60_000) // Backend test fixture has not replied yet.
    await expect(page.getByRole('button', { name: 'Fetching…' })).toBeVisible()
    const temporary = page.getByRole('region', { name: 'Temporary direct posting preview' })
    await expect(temporary).toContainText('Synthetic Research Engineer')
    await page.clock.fastForward(13 * 60_000 + 5_000)
    await expect(temporary).toHaveCount(0)
    await expect(page.getByRole('alert').filter({ hasText: 'Temporary posting and research expired' })).toBeVisible()
    expect(readFileSync(join(userData, 'research-direct-requests.log'), 'utf8').trim().split('\n')).toHaveLength(1)
  } finally {
    await app?.close().catch(() => {})
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})

test('permitted generic HTTPS URL → full temporary review → outgoing consent → source-linked analysis without persistence', async () => {
  test.setTimeout(150_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-research-full-'))
  const userData = join(root, 'workspace'), appData = join(root, 'appdata')
  mkdirSync(userData); mkdirSync(appData)
  const count = (name: string) => existsSync(join(userData, name)) ? readFileSync(join(userData, name), 'utf8').trim().split('\n').length : 0
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], timeout: 45_000, env: {
      ...process.env, APPDATA: appData, CV_TAILOR_TEST_STORAGE_ROOT: root, CV_TAILOR_TEST_APP_DATA_DIR: appData,
      CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_TEST_RESEARCH: 'full', CV_TAILOR_SCRIPTED_ANALYSIS: '1', CV_TAILOR_SCRIPTED_PI_MODEL: '1'
    } })
    const page = await app.firstWindow({ timeout: 20_000 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const model = page.getByRole('region', { name: 'Pi preferences' }).getByRole('region', { name: 'Pi model' })
    await model.getByLabel('Provider/model reference').fill('scripted/cv-tailor-fixture')
    await model.getByRole('button', { name: 'Save Pi model' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Pi model preference saved.' })).toBeVisible()
    const backupStatus = await page.evaluate(() => window.workbench.getWorkspaceBackupStatus())
    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.getByRole('button', { name: 'Import from link' }).click()
    // A search-results URL must resolve to the selected ID, not the listing/keyword/geo query.
    await page.getByLabel('Public job posting link').fill('https://jobs.example.org/role/123')
    expect(count('research-direct-requests.log')).toBe(0)
    await page.getByRole('button', { name: 'Fetch posting' }).click()
    const temporary = page.getByRole('region', { name: 'Temporary direct posting preview' })
    await expect(temporary).toContainText('Synthetic Research Engineer')
    await expect(temporary).toContainText('https://jobs.example.org/role/123')
    await expect(temporary).not.toContainText('NOT-SENT')
    await expect(temporary.getByRole('button', { name: 'Save job' })).toHaveCount(0)
    await expect(temporary.getByRole('button', { name: 'Search indexed details' })).toHaveCount(0)
    expect(count('research-direct-requests.log')).toBe(1)
    expect(count('research-model-requests.log')).toBe(0)
    await temporary.getByRole('button', { name: 'Review temporary findings' }).click()
    await expect(temporary.getByRole('region', { name: 'Direct role source' })).toContainText('Full direct posting')
    expect(count('research-direct-requests.log')).toBe(1) // Single-use handoff, no second GET.
    await temporary.getByLabel('Include this role finding in review').check()
    await temporary.getByRole('button', { name: 'Review selected role findings' }).click()
    await expect(page.getByRole('button', { name: 'Inspect outgoing data' })).toBeVisible()
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    const outgoing = page.getByLabel('Exact outgoing analysis data')
    await expect(outgoing).toContainText('https://jobs.example.org/role/123')
    await expect(outgoing).toContainText('TypeScript')
    await expect(outgoing).not.toContainText('NOT-SENT')
    await expect(page.getByText('Full role evidence', { exact: true })).toBeVisible()
    expect(count('research-model-requests.log')).toBe(0)
    await expect(page.getByRole('button', { name: 'Authorize and start analysis' })).toBeVisible()
    expect(count('research-model-requests.log')).toBe(0)
    await page.getByRole('button', { name: 'Authorize and start analysis' }).click()
    await expect(page.getByRole('region', { name: 'Analysis suggestions' })).toContainText('finding 1')
    expect(count('research-model-requests.log')).toBe(1)
    expect(count('research-direct-requests.log')).toBe(1)
    expect(await page.evaluate(() => window.workbench.listJobs())).toHaveLength(0)
    await expect(page.getByRole('button', { name: 'Export PDF' })).toHaveCount(0)
    expect(await page.evaluate(() => window.workbench.getWorkspaceBackupStatus())).toEqual(backupStatus)
    // Advance only the visible renderer clock: backend eager eviction has separate fake-timer unit tests.
    await page.clock.install()
    await page.clock.fastForward(15 * 60_000 + 1)
    await expect(temporary).toHaveCount(0)
    await expect(outgoing).toHaveCount(0)
    await expect(page.getByRole('alert').filter({ hasText: 'Temporary posting and research expired' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Fetch posting', exact: true })).toBeVisible()
    expect(count('research-direct-requests.log')).toBe(1)
    await app.close(); app = undefined
    // Query the actual native database with Electron's ABI, not Node's incompatible SQLite binding.
    const sqlite = join(userData, 'workbench.sqlite')
    const script = `const Database=require('better-sqlite3');const db=new Database(process.argv[1],{readonly:true});console.log(JSON.stringify(['jobs','outbound_consents','posting_analysis_cache','analysis_run_state','generation_recovery','draft_revisions'].map(t=>[t,db.prepare('SELECT COUNT(*) AS n FROM '+t).get().n])));db.close()`
    const rows = JSON.parse(execFileSync(join(process.cwd(), 'node_modules/electron/dist/electron.exe'), ['-e', script, sqlite], { cwd: process.cwd(), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 15_000 })) as Array<[string, number]>
    expect(rows).toEqual(rows.map(([table]) => [table, 0]))
  } finally {
    await app?.close().catch(() => {})
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
