import { expect, test, _electron as electron } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const requestCount = (path: string) => existsSync(path) ? readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean).length : 0

test('Wuzzuf reviewed Save is hidden and denied by main IPC unless this installation has local policy', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-wuzzuf-off-'))
  const appData = join(root, 'appdata'), userData = join(root, 'workspace')
  mkdirSync(appData); mkdirSync(userData)
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args:[join(process.cwd(), 'out/main/index.js')], timeout:60_000, env:{
      ...process.env, APPDATA:appData, CV_TAILOR_TEST_STORAGE_ROOT:root,
      CV_TAILOR_TEST_APP_DATA_DIR:appData, CV_TAILOR_TEST_USER_DATA_DIR:userData,
      CV_TAILOR_TEST_NAMED_PREVIEW:'1', CV_TAILOR_SCRIPTED_POSTING_FETCH:'', CV_TAILOR_TEST_RESEARCH:''
    } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name:'Saved jobs', exact:true }).click()
    await page.getByRole('button', { name:'Import from link' }).click()
    const status = await page.evaluate(() => (window as any).workbench.getWuzzufPersonalLocalEnablement())
    expect(status).toBe(false)
    await page.getByLabel('Public job posting link').fill('https://wuzzuf.net/jobs/p/SyntheticWuzzuf123')
    await expect(page.getByRole('note').filter({ hasText:'Wuzzuf-specific reviewed Save is disabled' })).toBeVisible()
    await expect(page.getByRole('button', { name:'Fetch Wuzzuf preview' })).toHaveCount(0)
    await expect(page.getByRole('button', { name:'Fetch posting', exact:true })).toBeVisible()
    const bypass = await page.evaluate(async () => {
      try { await (window as any).workbench.startNamedPostingPreview('https://wuzzuf.net/jobs/p/SyntheticWuzzuf123', true); return 'allowed' }
      catch (error) { return error instanceof Error ? error.message : String(error) }
    })
    expect(bypass).toContain('disabled on this installation')
    expect(requestCount(join(userData, 'named-preview-request-count.log'))).toBe(0)
  } finally {
    await app?.close().catch(() => {})
    await rm(root, { recursive:true, force:true, maxRetries:10, retryDelay:300 })
  }
})
