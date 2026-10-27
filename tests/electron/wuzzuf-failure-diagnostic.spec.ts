import { expect, test, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wuzzufInstallationFingerprint, wuzzufPersonalLocalPolicyPath } from '../../src/main/wuzzuf-local-enablement'

const wuzzufUrl = 'https://wuzzuf.net/jobs/p/SyntheticWuzzufAmbiguous123'

test('visible preview presents a typed, actionable Wuzzuf ambiguity reason without exposing captured text', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-wuzzuf-diagnostic-'))
  const appData = join(root, 'appdata'), userData = join(root, 'workspace')
  mkdirSync(appData); mkdirSync(userData); mkdirSync(join(appData, 'CV Tailor Personal Local Policy'))
  writeFileSync(wuzzufPersonalLocalPolicyPath(appData), JSON.stringify({ version:1, wuzzufPersonalLocalEnabled:true, acknowledgedNoticeVersion:1, installationFingerprint:wuzzufInstallationFingerprint(process.cwd()) }), { flag:'wx' })
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
    await page.getByLabel('Public job posting link').fill(wuzzufUrl)
    await page.getByRole('checkbox', { name:/I understand and opt in for this run/ }).check()
    await page.getByRole('button', { name:'Fetch Wuzzuf preview' }).click()
    const diagnostic = page.getByRole('status').filter({ hasText:'The page declares multiple canonical links, so the exact posting identity is ambiguous.' })
    await expect(diagnostic).toBeVisible({ timeout:15_000 })
    await expect(page.getByRole('region', { name:'Temporary named posting preview' })).toHaveCount(0)
    await expect(page.getByRole('button', { name:'Save job' })).toHaveCount(0)
    expect(await page.evaluate(async () => (window as any).workbench.listJobs())).toEqual([])
  } finally {
    await app?.close().catch(() => {})
    await rm(root, { recursive:true, force:true, maxRetries:10, retryDelay:300 })
  }
})
