import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('Saved jobs and public preload/main contracts expose manual-only posting entry', () => {
  const savedJobs = source('../src/renderer/SavedJobs.tsx')
  const preload = source('../src/preload/index.ts')
  const main = source('../src/main/index.ts')
  const workbench = source('../src/main/workbench.ts')
  expect(savedJobs).toContain('Full job posting')
  expect(savedJobs).toContain('Add contact')
  expect(savedJobs).not.toMatch(/Public job posting link|Import from link|Fetch posting|Open original posting|startPostingFetch|startJobResearch/i)
  for (const route of ['posting-import:start', 'posting-import:open-source', 'job-research:start', 'named-posting-preview:start', 'research-analysis:start']) {
    expect(preload).not.toContain(route)
    expect(main).not.toContain(route)
  }
  expect(workbench).not.toMatch(/startPostingFetch|startJobResearch|saveNamedPostingAcceptance|openPostingSource|acceptPostingRefresh|refreshPosting/)
  expect(savedJobs).toContain('openContactProfile(editingRecord.id, contact.id)')
  const openProfile = main.slice(main.indexOf("ipcMain.handle('contacts:open-profile'"), main.indexOf("ipcMain.handle('jobs:delete:preview'"))
  expect(openProfile).toContain('args.length !== 2')
  expect(openProfile).toContain('const contact = job?.contacts.find(item => item.id === contactId)')
  expect(openProfile).toContain('httpsProfileUrlSchema.parse(contact.profileUrl)')
  expect(openProfile).toContain('shell.openExternal(url)')
  expect(openProfile).not.toContain('fetch(')
  expect(preload).toContain('navigator.userActivation?.isActive')
  expect(main).toContain('Check the highlighted job and contact fields.')
  expect(savedJobs).toContain('aria-invalid={!!contactError(index, \'profileUrl\')}')
  expect(savedJobs).toContain('className="field-error"')
})
