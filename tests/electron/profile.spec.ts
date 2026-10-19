import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Exercise the visible renderer through the real preload, IPC, and local database.
test('profile contact and categorized skills can be created, edited, and deleted', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-profile-'))
  const launch = () => electron.launch({ args: ['.'], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
  try {
    const app = await launch()
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'My profile' }).click()
    await expect(page.getByRole('heading', { name: 'Your career record' })).toBeVisible()

    await page.getByLabel('Full name').fill('Ada Lovelace')
    await page.getByLabel('Professional headline').fill('Analytical engineer')
    await page.getByLabel('Email').fill('ada@example.test')
    await page.getByRole('button', { name: 'Save contact details' }).click()
    await expect(page.getByText('Contact details saved')).toBeVisible()

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

    await page.getByRole('button', { name: 'Edit contact details' }).click()
    await page.getByLabel('Professional headline').fill('Computing pioneer')
    await page.getByRole('button', { name: 'Save contact details' }).click()
    await expect(page.getByText('Computing pioneer')).toBeVisible()

    page.once('dialog', dialog => dialog.accept())
    await updatedSkill.getByRole('button', { name: 'Delete TypeScript programming' }).click()
    await expect(page.getByText('TypeScript programming', { exact: true })).toHaveCount(0)
    await app.close()

    const reopened = await launch()
    const reopenedPage = await reopened.firstWindow()
    await expect(reopenedPage.locator('[data-ui-ready="true"]')).toBeVisible()
    await reopenedPage.getByRole('button', { name: 'My profile' }).click()
    await expect(reopenedPage.getByText('Computing pioneer')).toBeVisible()
    await expect(reopenedPage.getByText('No skills added yet.')).toBeVisible()
    await reopened.close()
  } finally {
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
