import type { Page } from '@playwright/test'

export async function selectScriptedPiModel(page: Page) {
  await page.evaluate(() => window.workbench.setPiModel({ reference: 'scripted/cv-tailor-fixture', thinkingLevel: 'off' }))
}
