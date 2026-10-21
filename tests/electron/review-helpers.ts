import { expect, type Page } from '@playwright/test'

export async function openReviewDetails(page: Page, category: 'skills' | 'notes' | 'sources' | 'match') {
  await expect(page.getByRole('region', { name: 'Review checklist' })).toBeVisible({ timeout: 60000 })
  const name = category === 'skills' ? /^New skills/ : category === 'notes' ? /^Checks & options/ : category === 'match' ? /^Job match$/ : /^Sources$/
  const tab = page.getByRole('button', { name })
  if (!await tab.isVisible()) await page.getByRole('button', { name: 'Sources & review details' }).click()
  await tab.click()
}

export async function closeReviewDetails(page: Page) {
  const close = page.getByRole('button', { name: 'Close review details' })
  if (await close.isVisible()) await close.click()
}
