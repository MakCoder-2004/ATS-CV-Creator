import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Settings exposes Pi model preferences without in-app credentials or analysis budgets', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-pi-settings-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    const modelCard = page.getByRole('region', { name: 'Pi preferences' }).getByRole('region', { name: 'Pi model' })
    await expect(modelCard.getByLabel('Provider/model reference')).toHaveValue('')
    await expect(modelCard.getByLabel('Thinking level')).toHaveValue('medium')
    await expect(page.getByText(/sign in through Pi outside CV Tailor/i)).toBeVisible()
    await expect(page.getByLabel('API key')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Analysis request budgets' })).toHaveCount(0)
    await expect(page.getByText(/credential is entered, stored, copied, or revealed/i)).toBeVisible()

    const faithfulness = page.getByRole('switch', { name: 'Enable optional faithfulness review for newly authorized runs' })
    await expect(faithfulness).toBeVisible()
    await expect(page.getByText(/LLM check is not proof/i)).toBeVisible()
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
