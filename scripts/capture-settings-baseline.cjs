const assert = require('node:assert/strict')
const { mkdtempSync, existsSync, mkdirSync } = require('node:fs')
const { rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron: electron } = require('@playwright/test')

const executable = process.argv[2] ? resolve(process.argv[2]) : null
const output = resolve(process.argv[3] || join('.audit', 'pi-sdk-settings-baseline'))
const label = executable ? 'installed' : 'source'
const piMode = process.env.CV_TAILOR_SETTINGS_CAPTURE_MODE === 'pi'
const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-pi-baseline-'))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const launch = () => executable
  ? electron.launch({ executablePath: executable, args: [`--user-data-dir=${userData}`, '--disable-gpu'], env, timeout: 60000 })
  : electron.launch({ args: [resolve('out/main/index.js'), '--disable-gpu'], env: { ...env, CV_TAILOR_TEST_USER_DATA_DIR: userData }, timeout: 60000 })

async function main() {
  let app
  try {
    assert(!executable || existsSync(executable), 'The installed executable is missing.')
    mkdirSync(output, { recursive: true })
    app = await launch()
    const page = await app.firstWindow()
    await page.locator('[data-ui-ready="true"]').waitFor({ timeout: 30000 })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('heading', { name: 'Settings' }).waitFor()
    assert.equal(await page.getByRole('textbox', { name: piMode ? 'Provider/model reference' : 'OpenRouter model ID' }).inputValue(), piMode ? '' : 'xingchen-agi/xing4.0-29b-a4b:free')
    for (const [theme, width, height] of [['light', 1440, 900], ['light', 375, 812], ['dark', 1440, 900], ['dark', 375, 812]]) {
      await page.setViewportSize({ width, height })
      if (theme === 'dark') await page.getByRole('button', { name: 'Use dark mode' }).click()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Page overflows at ${width}px.`)
      await page.screenshot({ path: join(output, `${label}-settings-${theme}-${width}.png`), fullPage: true, animations: 'disabled' })
    }
    await app.close()
    app = undefined
    assert(existsSync(join(userData, 'workbench.sqlite')), 'SQLite workspace was not created.')
    app = await launch()
    const reopened = await app.firstWindow()
    await reopened.locator('[data-ui-ready="true"]').waitFor({ timeout: 30000 })
    assert.equal(await reopened.getByRole('button', { name: 'Use dark mode' }).getAttribute('aria-pressed'), 'true')
    await reopened.getByRole('button', { name: 'Settings', exact: true }).click()
    assert.equal(await reopened.getByRole('textbox', { name: piMode ? 'Provider/model reference' : 'OpenRouter model ID' }).inputValue(), piMode ? '' : 'xingchen-agi/xing4.0-29b-a4b:free')
    console.log(JSON.stringify({ label, executable, screenshotDirectory: output, screenshots: 4, sqliteReopen: true }))
  } finally {
    await app?.close().catch(() => {})
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
