import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('education editor persists and clearly labels local-only profile sections', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-extra-profile-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  const launch = () => electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
  try {
    app = await launch()
    let page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'My profile' }).click()
    await expect(page.getByRole('region', { name: 'Reference PDF import' })).toHaveCount(0)
    const sections = page.getByRole('navigation', { name: 'Profile sections' })
    const educationButton = sections.getByRole('button', { name: 'Education' })
    await expect(educationButton).not.toContainText('Soon')
    await educationButton.click()
    await page.getByLabel('Title').fill('BSc')
    await page.getByLabel('Institution').fill('Example University')
    await page.getByLabel('Degree or field').fill('Computing')
    await page.getByRole('button', { name: 'Start date', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Previous year' })).toBeFocused()
    await page.getByRole('button', { name: /^20\d{2}$/ }).first().click()
    await page.getByRole('option', { name: '2020' }).click()
    await page.getByRole('button', { name: 'Use year only' }).click()
    await page.getByRole('button', { name: 'End date', exact: true }).click()
    await page.getByRole('button', { name: /^20\d{2}$/ }).first().click()
    await page.getByRole('option', { name: '2024' }).click()
    await page.getByRole('button', { name: 'Use year only' }).click()
    await page.getByRole('button', { name: 'Add education' }).click()
    await expect(page.getByRole('heading', { name: 'BSc' })).toBeVisible()
    await page.getByRole('button', { name: 'Edit BSc' }).click()
    await page.getByLabel('Institution').fill('')
    await page.getByLabel('Degree or field').fill('')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect.poll(async () => page.evaluate(() => window.workbench.getProfile().then(profile => profile.education[0]?.revision))).toBe(2)
    const cleared = (await page.evaluate(() => window.workbench.getProfile())).education[0]
    expect(cleared).not.toHaveProperty('institution')
    expect(cleared).not.toHaveProperty('field')
    await sections.getByRole('button', { name: 'Summary' }).click()
    await expect(page.getByText('Saved in your profile, not included in CV output.')).toBeVisible()
    await page.getByRole('textbox', { name: 'Summary' }).fill('A local note')
    await page.getByRole('button', { name: 'Add summary' }).click()
    await expect(page.getByRole('heading', { level: 3, name: 'Summary', exact: true })).toBeVisible()
    await sections.getByRole('button', { name: 'Certificates' }).click()
    await page.getByLabel('Title').fill('Cloud Practitioner')
    await page.getByLabel('Issuer').fill('Fictional Academy')
    await page.getByRole('button', { name: 'Year', exact: true }).click()
    await page.getByRole('option', { name: '2024' }).click()
    await page.getByRole('button', { name: 'Add certificates' }).click()
    await expect(page.getByRole('heading', { name: 'Cloud Practitioner' })).toBeVisible()
    expect((await page.evaluate(() => window.workbench.getProfile())).certificates[0].year).toBe(2024)
    await app.close(); app = undefined
    app = await launch(); page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'My profile' }).click()
    await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('button', { name: 'Education' }).click()
    await expect(page.getByRole('heading', { name: 'BSc' })).toBeVisible()
    await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('button', { name: 'Certificates' }).click()
    await expect(page.getByRole('heading', { name: 'Cloud Practitioner' })).toBeVisible()
    await app.close(); app = undefined
  } finally { await app?.close(); await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
})
