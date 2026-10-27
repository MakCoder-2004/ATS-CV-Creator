import { test, expect as baseExpect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const expect = baseExpect.configure({ timeout: 10_000 })
const artifacts = 'docs/validation/artifacts/saved-jobs-alignment'

const titles = [
  'Senior Applied Machine Learning Engineer, Responsible Systems and Research',
  'Analyst',
  'Staff Platform Engineer for Distributed Data Infrastructure',
]

// Measure rendered controls, not React state: a long title must not move the other columns.
async function desktopRows(app: ElectronApplication) {
  const page = await app.firstWindow()
  return page.locator('.saved-jobs-table').evaluate(table => {
    const headers = Array.from(table.querySelectorAll('thead th'))
    const headerStarts = headers.map(header => header.getBoundingClientRect().left + parseFloat(getComputedStyle(header).paddingLeft))
    const rows = Array.from(table.querySelectorAll('.saved-job-row')).map(row => {
      const title = row.querySelector('.saved-job-posting-copy strong')!.getBoundingClientRect()
      const status = row.querySelector('.saved-job-draft-status')!.getBoundingClientRect()
      const actions = row.querySelector('.saved-job-actions')!.getBoundingClientRect()
      const buttons = Array.from(row.querySelectorAll('.saved-job-actions button')).map(button => {
        const rect = button.getBoundingClientRect()
        return { label: button.textContent?.trim(), left: rect.left, right: rect.right, top: rect.top, width: rect.width, height: rect.height }
      })
      return {
        statusLeft: status.left,
        actionsLeft: actions.left,
        titleTop: title.top,
        statusCenter: status.top + status.height / 2,
        actionsTop: actions.top,
        buttons,
      }
    })
    return { headerStarts, rows }
  })
}

test.use({ actionTimeout: 10_000 })

test('saved-job status and actions align for long and short postings at desktop and 375px', async () => {
  test.setTimeout(60_000)
  mkdirSync(artifacts, { recursive: true })
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-saved-alignment-'))
  let app: ElectronApplication | undefined
  const launch = async () => {
    app = await electron.launch({
      args: [join(process.cwd(), 'out/main/index.js')],
      timeout: 10_000,
      env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData },
    })
    return app
  }
  try {
    const running = await test.step('launch Electron', () => launch())
    const page = await test.step('wait for first window', () => running.firstWindow({ timeout: 10_000 }))
    await test.step('wait for ready UI', () => expect(page.locator('[data-ui-ready="true"]')).toBeVisible())
    await test.step('seed synthetic postings through the public preload', () => page.evaluate(async jobTitles => {
      for (const [index, title] of jobTitles.entries()) {
        const result = await window.workbench.saveJob({ title, company: `Synthetic Company ${index + 1}`, description: `Synthetic posting for ${title}.` })
        if (!result.ok) throw new Error(result.error.message)
      }
    }, titles))
    // A direct preload save does not update the already-mounted React job list.
    // Reload through the browser so the app reads the committed records from SQLite.
    await test.step('reload persisted postings and navigate to Saved jobs', async () => {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 10_000 })
      await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
      await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
      await expect(page.locator('.saved-job-row')).toHaveCount(3)
    })
    const table = page.getByRole('table')
    await expect(table.getByRole('columnheader')).toHaveText(['Posting', 'Draft status', 'Next action'])
    const rows = page.locator('.saved-job-row')
    await expect(rows).toHaveCount(3)
    await expect(page.locator('.saved-job-draft-status').filter({ hasText: 'No draft' })).toHaveCount(3)
    await expect(page.getByRole('checkbox', { name: 'Select all saved jobs' })).toBeVisible()
    await test.step('verify visible row controls and names', async () => {
      for (const [index, title] of titles.entries()) {
        const row = rows.filter({ hasText: title })
        await expect(row.getByRole('checkbox', { name: `Select ${title} at Synthetic Company ${index + 1}` })).toBeVisible()
        await expect(row.getByRole('button', { name: 'Open posting', exact: true })).toBeVisible()
        for (const action of ['Edit', 'Delete']) {
          await expect(row.getByRole('button', { name: `${action} ${title} posting` })).toBeVisible()
        }
      }
    })

    const desktop = await desktopRows(running)
    expect(desktop.rows).toHaveLength(3)
    const firstWidths = desktop.rows[0].buttons.map(button => button.width)
    for (const row of desktop.rows) {
      expect(Math.abs(row.statusLeft - desktop.headerStarts[1])).toBeLessThanOrEqual(1)
      expect(Math.abs(row.actionsLeft - desktop.headerStarts[2])).toBeLessThanOrEqual(1)
      expect(Math.abs(row.statusCenter - (row.titleTop + 11))).toBeLessThanOrEqual(2)
      expect(Math.abs(row.actionsTop - row.titleTop)).toBeLessThanOrEqual(1)
      expect(row.buttons.map(button => button.label)).toEqual(['Open posting', 'Edit', 'Delete'])
      expect(row.buttons.map(button => button.width)).toEqual(firstWidths)
      for (const button of row.buttons) expect(Math.abs(button.height - 44)).toBeLessThanOrEqual(0.5)
      for (let index = 1; index < row.buttons.length; index++) {
        expect(row.buttons[index].left - row.buttons[index - 1].right).toBeGreaterThanOrEqual(7.5)
        expect(Math.abs(row.buttons[index].top - row.buttons[0].top)).toBeLessThanOrEqual(1)
      }
    }

    // Tab through the real row controls, with a visible keyboard focus ring.
    const firstRow = rows.filter({ hasText: titles[0] })
    await firstRow.getByRole('checkbox').focus()
    await page.keyboard.press('Tab')
    const firstOpen = firstRow.getByRole('button', { name: 'Open posting', exact: true })
    await expect(firstOpen).toBeFocused()
    await expect(firstOpen).toHaveCSS('outline-style', 'solid')
    await page.keyboard.press('Tab')
    await expect(firstRow.getByRole('button', { name: `Edit ${titles[0]} posting` })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(firstRow.getByRole('button', { name: `Delete ${titles[0]} posting` })).toBeFocused()
    await page.screenshot({ path: join(artifacts, 'saved-jobs-desktop-light.png'), fullPage: true })

    await page.getByRole('button', { name: 'Use dark mode' }).click()
    await expect(page.getByRole('button', { name: 'Use dark mode' })).toHaveAttribute('aria-pressed', 'true')
    expect((await desktopRows(running)).rows.map(row => row.buttons.map(button => button.width))).toEqual(desktop.rows.map(row => row.buttons.map(button => button.width)))
    await page.screenshot({ path: join(artifacts, 'saved-jobs-desktop-dark.png'), fullPage: true })

    await page.setViewportSize({ width: 375, height: 812 })
    const narrow = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
      contentWidth: document.querySelector('.saved-jobs-page')!.scrollWidth,
      contentClientWidth: document.querySelector('.saved-jobs-page')!.clientWidth,
      rows: Array.from(document.querySelectorAll('.saved-job-row')).map(row => {
        const rect = row.getBoundingClientRect()
        const buttons = Array.from(row.querySelectorAll('.saved-job-actions button')).map(button => {
          const box = button.getBoundingClientRect()
          return { left: box.left, right: box.right, top: box.top, width: box.width, height: box.height }
        })
        return { left: rect.left, right: rect.right, buttons }
      }),
    }))
    expect(narrow.pageWidth).toBeLessThanOrEqual(narrow.viewportWidth)
    expect(narrow.contentWidth).toBeLessThanOrEqual(narrow.contentClientWidth)
    expect(narrow.rows).toHaveLength(3)
    for (const row of narrow.rows) {
      expect(row.left).toBeGreaterThanOrEqual(0)
      expect(row.right).toBeLessThanOrEqual(narrow.viewportWidth)
      expect(row.buttons).toHaveLength(3)
      expect(row.buttons.map(button => button.width)).toEqual(narrow.rows[0].buttons.map(button => button.width))
      for (const button of row.buttons) {
        expect(Math.abs(button.height - 44)).toBeLessThanOrEqual(0.5)
        expect(button.left).toBeGreaterThanOrEqual(0)
        expect(button.right).toBeLessThanOrEqual(narrow.viewportWidth)
      }
      for (let index = 1; index < row.buttons.length; index++) {
        const previous = row.buttons[index - 1]
        const current = row.buttons[index]
        if (Math.abs(previous.top - current.top) <= 1) expect(current.left - previous.right).toBeGreaterThanOrEqual(7.5)
        else expect(current.top - previous.top).toBeGreaterThanOrEqual(44)
      }
    }
    await page.screenshot({ path: join(artifacts, 'saved-jobs-375-dark.png'), fullPage: true })

    const shortRow = rows.filter({ hasText: 'Analyst' })
    const deleteButton = shortRow.getByRole('button', { name: 'Delete Analyst posting' })
    await deleteButton.click()
    const confirm = page.getByRole('dialog', { name: 'Delete this saved job?' })
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText('Analyst')
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(deleteButton).toBeFocused()
    await expect(rows).toHaveCount(3)
    await expect(shortRow.getByRole('checkbox', { name: 'Select Analyst at Synthetic Company 2' })).toBeChecked()
    await expect(page.getByRole('button', { name: 'Delete 1' })).toBeVisible()
  } finally {
    await app?.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
