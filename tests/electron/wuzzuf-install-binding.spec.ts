import { expect, test, _electron as electron } from '@playwright/test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wuzzufInstallationFingerprint, wuzzufPersonalLocalPolicyPath } from '../../src/main/wuzzuf-local-enablement'

const link = 'https://wuzzuf.net/jobs/p/SyntheticWuzzuf123'
const responseCount = (path: string) => { try { return readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean).length } catch { return 0 } }

test('one appData policy authorizes only its bound installation', async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'cv-wuzzuf-install-binding-'))
  const appData = join(root, 'appdata'), userData = join(root, 'workspace')
  const secondRoot = join(root, 'second-install')
  mkdirSync(appData); mkdirSync(userData); mkdirSync(secondRoot)
  cpSync(join(process.cwd(), 'out'), join(secondRoot, 'out'), { recursive:true })
  cpSync(join(process.cwd(), 'resources', 'cv-template'), join(secondRoot, 'resources', 'cv-template'), { recursive:true })
  cpSync(join(process.cwd(), 'package.json'), join(secondRoot, 'package.json'))
  symlinkSync(join(process.cwd(), 'node_modules'), join(secondRoot, 'node_modules'), 'junction')
  const policyDir = join(appData, 'CV Tailor Personal Local Policy')
  mkdirSync(policyDir)
  writeFileSync(wuzzufPersonalLocalPolicyPath(appData), JSON.stringify({ version:1, wuzzufPersonalLocalEnabled:true, acknowledgedNoticeVersion:1, installationFingerprint:wuzzufInstallationFingerprint(process.cwd()) }), { flag:'wx' })
  const environment = {
    ...process.env, APPDATA:appData, CV_TAILOR_TEST_STORAGE_ROOT:root,
    CV_TAILOR_TEST_APP_DATA_DIR:appData, CV_TAILOR_TEST_USER_DATA_DIR:userData,
    CV_TAILOR_TEST_NAMED_PREVIEW:'1', CV_TAILOR_SCRIPTED_POSTING_FETCH:'', CV_TAILOR_TEST_RESEARCH:''
  }
  let first: Awaited<ReturnType<typeof electron.launch>> | undefined
  let second: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    first = await electron.launch({ args:[join(process.cwd(), 'out/main/index.js')], env:environment, timeout:60_000 })
    const firstPage = await first.firstWindow()
    await expect(firstPage.locator('[data-ui-ready="true"]')).toBeVisible()
    expect(await firstPage.evaluate(() => (window as any).workbench.getWuzzufPersonalLocalEnablement())).toBe(true)
    const { token } = await firstPage.evaluate(async url => (window as any).workbench.startNamedPostingPreview(url, true), link)
    let preview: any
    await expect.poll(async () => {
      preview = await firstPage.evaluate(async value => (window as any).workbench.readNamedPostingPreview(value), token)
      return preview.status
    }).toBe('ready')
    const review = await firstPage.evaluate(async value => (window as any).workbench.reviewNamedPostingPreview(value, true, true), token)
    const saved = await firstPage.evaluate(async ({ value, reviewToken, candidate }) => (window as any).workbench.saveNamedPostingPreview(value, reviewToken, { title:candidate.title, company:candidate.employer, description:candidate.text }), { value:token, reviewToken:review.reviewToken, candidate:preview.candidate })
    expect(saved.ok).toBe(true)
    expect(await firstPage.evaluate(async () => (window as any).workbench.listJobs())).toHaveLength(1)
    await first.close(); first = undefined

    second = await electron.launch({ args:[join(secondRoot, 'out/main/index.js')], env:environment, timeout:60_000 })
    const secondPage = await second.firstWindow()
    await expect(secondPage.locator('[data-ui-ready="true"]')).toBeVisible()
    expect(await secondPage.evaluate(() => (window as any).workbench.getWuzzufPersonalLocalEnablement())).toBe(false)
    const denied = await secondPage.evaluate(async url => { try { await (window as any).workbench.startNamedPostingPreview(url, true); return 'allowed' } catch (error) { return error instanceof Error ? error.message : String(error) } }, link)
    expect(denied).toContain('bound to another installation')
    expect(responseCount(join(userData, 'named-preview-request-count.log'))).toBe(1)
    expect(await secondPage.evaluate(async () => (window as any).workbench.listJobs())).toHaveLength(1)
    await secondPage.getByRole('button', { name:'Saved jobs', exact:true }).click()
    await secondPage.locator('#content').getByRole('button', { name:'New job' }).click()
    await secondPage.getByRole('button', { name:'Import from link' }).click()
    await secondPage.getByLabel('Public job posting link').fill(link)
    await expect(secondPage.getByRole('button', { name:'Fetch Wuzzuf preview' })).toHaveCount(0)
  } finally {
    await second?.close().catch(() => {})
    await first?.close().catch(() => {})
    await rm(root, { recursive:true, force:true, maxRetries:10, retryDelay:300 })
  }
})
