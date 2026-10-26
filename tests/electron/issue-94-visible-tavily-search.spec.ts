import { expect, test, _electron as electron } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const countLines = (path: string) => existsSync(path) ? readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean).length : 0

test('visible incomplete-link search uses a synthetic key and transport only after explicit search', async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-issue-94-tavily-'))
  const userData = join(root, 'workspace'), appData = join(root, 'appdata')
  mkdirSync(userData); mkdirSync(appData)
  const directLog = join(userData, 'research-direct-requests.log')
  const searchLog = join(userData, 'research-tavily-requests.log')
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    mkdirSync('docs/validation/artifacts/issue-94', { recursive: true })
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], timeout: 45_000, env: {
      ...process.env, APPDATA: appData, CV_TAILOR_TEST_STORAGE_ROOT: root,
      CV_TAILOR_TEST_APP_DATA_DIR: appData, CV_TAILOR_TEST_USER_DATA_DIR: userData,
      CV_TAILOR_TEST_RESEARCH: '1', CV_TAILOR_TEST_TAVILY: '1', CV_TAILOR_TEST_KEY_CLIPBOARD: '1'
    } })
    const paths = await app.evaluate(({ app }) => ({ appData: app.getPath('appData'), userData: app.getPath('userData') }))
    expect(realpathSync.native(paths.appData)).toBe(realpathSync.native(appData))
    expect(realpathSync.native(paths.userData)).toBe(realpathSync.native(userData))
    const page = await app.firstWindow({ timeout: 20_000 })
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.evaluate(() => window.workbench.saveContact({ fullName: 'Synthetic Candidate', email: 'candidate-private@example.test' }))

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const card = page.getByRole('region', { name: 'Tavily search key' })
    await card.getByLabel('Tavily API key', { exact: true }).fill('tvly-synthetic-never-valid')
    await card.getByRole('button', { name: 'Save Tavily key' }).click()
    await expect(card.getByRole('button', { name: 'Replace', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.getByRole('button', { name: 'Import from link' }).click()
    await page.getByLabel('Public job posting link').fill('https://jobs.example.org/role/123?utm_source=synthetic-tag')
    await page.getByRole('button', { name: 'Fetch posting' }).click()
    await expect(page.getByRole('button', { name: 'Inspect captured findings' })).toBeVisible()
    expect(countLines(directLog)).toBe(1)
    expect(countLines(searchLog)).toBe(0)
    await page.getByRole('button', { name: 'Inspect captured findings' }).click()
    const research = page.getByRole('region', { name: 'Temporary job research' })
    await expect(research.getByRole('region', { name: 'Direct role source' })).toContainText('Partial direct text')
    expect(countLines(directLog)).toBe(1)
    expect(countLines(searchLog)).toBe(0)

    await research.getByRole('button', { name: 'Search indexed details' }).click()
    await expect(research).toContainText('Exact matching indexed role excerpt: review TypeScript systems and document operational decisions.')
    await expect(research).toContainText('Synthetic Engineer - Example Research')
    const calls = readFileSync(searchLog, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line) as { method: string; body: string })
    expect(calls.map(call => call.method)).toEqual(['GET', 'POST'])
    const queryBody = JSON.parse(calls[1]!.body) as { query: string; [key: string]: unknown }
    expect(queryBody.query).toBe('job site:jobs.example.org')
    expect(JSON.stringify(calls)).not.toContain('synthetic-tag')
    expect(JSON.stringify(calls)).not.toContain('Synthetic Candidate')
    expect(JSON.stringify(calls)).not.toContain('candidate-private@example.test')
    expect(countLines(directLog)).toBe(2)
    expect(await page.evaluate(() => window.workbench.listJobs())).toHaveLength(0)
    const backup = await page.evaluate(() => window.workbench.getWorkspaceBackupStatus())
    expect(backup).toBeDefined()
    await page.screenshot({ path: 'docs/validation/artifacts/issue-94/tavily-search-result.png', fullPage: true })
  } finally {
    await app?.close().catch(() => {})
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
