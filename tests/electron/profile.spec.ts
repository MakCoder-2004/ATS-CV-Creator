import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Exercise the visible renderer through the real preload, IPC, and local database.
test('profile contact and categorized skills can be created, edited, and deleted', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-profile-'))
  let running: ElectronApplication | undefined
  const launch = async () => {
    running = await electron.launch({ args: ['.'], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    return running
  }
  try {
    const app = await launch()
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'My profile' }).click()
    await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible()
    const sections = page.getByRole('navigation', { name: 'Profile sections' })
    await expect(sections).toHaveCSS('flex-direction', 'row')
    await expect(sections.getByRole('button')).toHaveCount(9)
    await page.setViewportSize({ width: 680, height: 700 })
    await expect(sections.getByRole('button', { name: /Extras/ })).toBeVisible()
    await expect(sections.getByRole('button', { name: 'Personal', exact: true })).toHaveAttribute('aria-current', 'page')
    await sections.getByRole('button', { name: /Experience/ }).click()
    await expect(page.getByText('Experience editing is coming later.')).toBeVisible()
    await sections.getByRole('button', { name: 'Personal', exact: true }).click()

    await page.getByLabel('Full name').fill('Ada Lovelace')
    await page.getByLabel('Professional headline').fill('Analytical engineer')
    await page.getByLabel('Email').fill('not-an-email')
    await page.getByRole('button', { name: 'Save contact details' }).click()
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
    await page.getByLabel('Email').fill('ada@example.test')
    await page.getByRole('button', { name: 'Add link' }).click()
    await page.getByLabel('Link URL 1').fill('not-a-url')
    await page.getByRole('button', { name: 'Save contact details' }).click()
    await expect(page.getByLabel('Link name 1')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Link URL 1')).toHaveAttribute('aria-invalid', 'true')
    await page.getByLabel('Link name 1').fill('GitHub')
    await page.getByLabel('Link URL 1').fill('https://github.com/example')
    await page.getByRole('button', { name: 'Add link' }).click()
    await page.getByLabel('Link name 2').fill('Portfolio')
    await page.getByLabel('Link URL 2').fill('https://example.test')
    await page.getByRole('button', { name: 'Save contact details' }).click()
    await expect(page.getByText('Contact details saved')).toBeVisible()
    await expect(page.getByText('GitHub', { exact: true })).toBeVisible()
    await expect(page.getByText('https://github.com/example')).toBeVisible()
    await sections.getByRole('button', { name: 'Skills', exact: true }).click()
    await expect(page.getByLabel('Skill name')).toBeVisible()

    await page.getByLabel('Skill name').fill('TypeScript')
    await page.getByLabel('Skill category').selectOption({ label: 'Technical' })
    await page.getByLabel('Proficiency (optional)').selectOption('advanced')
    await page.getByLabel('Years of experience (optional)').fill('4')
    await page.getByRole('button', { name: 'Add skill' }).click()
    const skill = page.getByRole('listitem').filter({ hasText: 'TypeScript' })
    await expect(skill).toContainText('Technical')
    await expect(skill).toContainText('Advanced')

    await skill.getByRole('button', { name: 'Edit TypeScript' }).click()
    await page.getByLabel('Skill name').fill('TypeScript programming')
    await page.getByRole('button', { name: 'Save skill' }).click()
    const updatedSkill = page.getByRole('listitem').filter({ hasText: 'TypeScript programming' })
    await expect(updatedSkill).toContainText('Technical')

    await sections.getByRole('button', { name: 'Personal', exact: true }).click()
    await page.getByRole('button', { name: 'Edit contact details' }).click()
    await page.getByLabel('Professional headline').fill('Computing pioneer')
    await page.getByRole('button', { name: 'Remove Portfolio' }).click()
    await page.getByLabel('Link name 1').fill('GitHub profile')
    await page.getByRole('button', { name: 'Save contact details' }).click()
    await expect(page.getByRole('region', { name: 'Contact details' }).getByText('Computing pioneer')).toBeVisible()
    await expect(page.getByText('GitHub profile')).toBeVisible()
    await expect(page.getByText('Portfolio')).toHaveCount(0)

    await sections.getByRole('button', { name: 'Skills', exact: true }).click()
    page.once('dialog', dialog => dialog.accept())
    await updatedSkill.getByRole('button', { name: 'Delete TypeScript programming' }).click()
    await expect(page.getByText('TypeScript programming', { exact: true })).toHaveCount(0)
    await app.close()
    running = undefined

    const reopened = await launch()
    const reopenedPage = await reopened.firstWindow()
    await expect(reopenedPage.locator('[data-ui-ready="true"]')).toBeVisible()
    await reopenedPage.getByRole('button', { name: 'My profile' }).click()
    await expect(reopenedPage.getByRole('region', { name: 'Contact details' }).getByText('Computing pioneer')).toBeVisible()
    await expect(reopenedPage.getByText('GitHub profile')).toBeVisible()
    await expect(reopenedPage.getByText('https://github.com/example')).toBeVisible()
    await reopenedPage.getByRole('navigation', { name: 'Profile sections' }).getByRole('button', { name: 'Skills', exact: true }).click()
    await expect(reopenedPage.getByText('No skills added yet.')).toBeVisible()
    await reopened.close()
    running = undefined
  } finally {
    await running?.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
