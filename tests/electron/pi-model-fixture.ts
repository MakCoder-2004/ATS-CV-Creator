import type { Page } from '@playwright/test'

export async function selectScriptedPiModel(page: Page) {
  await page.evaluate(async () => {
    const workbench = window.workbench as typeof window.workbench & {
      setPiModel(input: { reference: string; thinkingLevel: string }): Promise<unknown>
    }
    await workbench.setPiModel({ reference: 'scripted/cv-tailor-fixture', thinkingLevel: 'off' })
  })
}
