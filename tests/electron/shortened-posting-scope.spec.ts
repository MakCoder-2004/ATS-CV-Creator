import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('analysis and qualification review label imported source requirements omitted from working text', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'cv-tailor-shortened-scope-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'out/main/index.js'), '--disable-gpu'], env: { ...process.env, CV_TAILOR_TEST_USER_DATA_DIR: userData, CV_TAILOR_SCRIPTED_POSTING_FETCH: '1', CV_TAILOR_SCRIPTED_ANALYSIS: 'generation' } })
    const page = await app.firstWindow()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()
    const saved = await page.evaluate(async () => {
      await window.workbench.saveContact({ fullName: 'Synthetic Candidate' })
      await window.workbench.saveSkill({ name: 'TypeScript', category: 'Programming' })
      await window.workbench.saveExperience({ kind: 'employment', title: 'Developer', organization: 'Example Employer', description: 'Built TypeScript services.' })
      const started = await window.workbench.startPostingFetch('https://api.lever.co/v0/postings/example-board/shortened-scope')
      let state = await window.workbench.readPostingPreview(started.token)
      for (let attempt = 0; attempt < 100 && state.status === 'fetching'; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 10))
        state = await window.workbench.readPostingPreview(started.token)
      }
      if (state.status !== 'ready') throw new Error('The scripted source fixture was not ready.')
      const working = 'WORKING_SCOPE_CANARY\nRequirements\nTypeScript is required.'
      const edit = await window.workbench.updatePostingPreview(started.token, 0, { title: state.preview.title, company: state.preview.company ?? '', description: working, optionalDetails: state.preview.optionalDetails })
      if (!edit.ok || edit.revision === undefined) throw new Error(edit.message ?? 'Preview edit failed.')
      const reviewed = await window.workbench.reviewPostingPreview(started.token, edit.revision, { completenessConfirmed: true, conflictResolutions: {} })
      if (!reviewed.ok) throw new Error(reviewed.message ?? 'Preview review failed.')
      const imported = await window.workbench.acceptPostingImport(started.token, edit.revision)
      if (!imported.ok) throw new Error(imported.error.message)
      return imported.value
    })
    await page.reload()
    await expect(page.locator('[data-ui-ready="true"]')).toBeVisible()

    await page.getByRole('button', { name: 'Saved jobs', exact: true }).click()
    await page.locator('.saved-job-row').filter({ hasText: saved.title }).getByRole('button', { name: 'Open posting' }).click()
    await expect(page.getByRole('heading', { name: saved.title, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Inspect outgoing data' }).click()
    await page.getByRole('button', { name: 'Authorize and start this run' }).click()
    const scopeNote = 'This assessment uses only the accepted working posting. The separately retained source snapshot differs, so source requirements absent from the working text were not assessed.'
    await expect(page.getByText(scopeNote, { exact: true })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Generate tailored draft' }).click()
    await expect(page.getByRole('region', { name: 'CV review' })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText(scopeNote, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Job match' }).click()
    await expect(page.getByRole('region', { name: 'Job requirement comparison' })).toContainText('This comparison uses the accepted working posting only. Its retained source snapshot differs; requirements absent from the working text were not assessed.')
  } finally {
    await app?.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
})
