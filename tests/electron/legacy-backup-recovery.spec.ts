import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('opens an over-limit legacy workspace, warns, and allows only a size-reducing posting edit', async ({}, testInfo) => {
  testInfo.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-legacy-over-limit-'))
  let app: ElectronApplication | undefined
  const databasePath = join(userData, 'workbench.sqlite')
  const seedScript = `
    const Database = require('better-sqlite3');
    const db = new Database(${JSON.stringify(databasePath)});
    db.exec('CREATE TABLE jobs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL)');
    const id = '3b8fdc59-cdd0-4f9e-a4d9-e42f0f8f6b62';
    const createdAt = new Date().toISOString();
    const description = 'Released legacy posting text. '.repeat(700);
    const revisions = Array.from({length: 300}, (_, i) => ({title: 'Legacy role', company: 'Example', description, revision: i + 1, acceptedAt: createdAt, provenance: 'manual'}));
    const job = {id, title: 'Legacy role', company: 'Example', description, createdAt, updatedAt: createdAt, provenance: 'manual', sourceSnapshot: null, revisions};
    db.prepare('INSERT INTO jobs (id, created_at, updated_at, data) VALUES (?, ?, ?, ?)').run(id, createdAt, createdAt, JSON.stringify(job));
    db.close();
  `
  try {
    execFileSync(join(process.cwd(), 'node_modules/electron/dist/electron.exe'), ['-e', seedScript], { cwd: process.cwd(), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'pipe' })
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js')], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    const warning = page.getByRole('status', { name: 'Workspace backup limits' })
    await expect(warning).toContainText('above its backup safety limits')
    await expect(warning).toContainText('no history is deleted')
    await warning.getByRole('button', { name: 'Review saved postings' }).click()

    const row = page.locator('.saved-job-row').filter({ hasText: 'Legacy role' })
    await row.getByRole('button', { name: 'Edit Legacy role posting' }).click()
    await page.getByLabel('Posting and requirements').fill('A deliberately shortened working posting.')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Job saved on this device.', { exact: true })).toBeVisible()
    await expect(page.getByRole('status', { name: 'Workspace backup limits' })).toBeVisible()

    const reopenedRow = page.locator('.saved-job-row').filter({ hasText: 'Legacy role' })
    await reopenedRow.getByRole('button', { name: 'Edit Legacy role posting' }).click()
    await page.getByLabel('Posting and requirements').fill('A larger edit that would increase the stored legacy backup footprint.'.repeat(200))
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('alert')).toContainText(/exceed|backup|revision/i)
    await expect(page.getByLabel('Posting and requirements')).toHaveValue('A larger edit that would increase the stored legacy backup footprint.'.repeat(200))
    await expect(page.getByRole('status', { name: 'Workspace backup limits' })).toBeVisible()
  } finally {
    await app?.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
