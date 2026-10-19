import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkbench } from '../src/main/workbench'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

test('appearance persists across a reopened workspace in isolated SQLite', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-test-'))
  directories.push(directory)
  const first = createWorkbench(directory)
  expect(await first.api.getSettings()).toEqual({ appearance: 'light' })
  expect(await first.api.setAppearance('dark')).toEqual({ appearance: 'dark' })
  first.close()
  const reopened = createWorkbench(directory)
  expect(await reopened.api.getSettings()).toEqual({ appearance: 'dark' })
  reopened.close()
})

test('invalid settings cannot alter the persisted appearance', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-test-'))
  directories.push(directory)
  const workbench = createWorkbench(directory)
  await expect(workbench.api.setAppearance('system' as 'dark')).rejects.toThrow()
  expect(await workbench.api.getSettings()).toEqual({ appearance: 'light' })
  workbench.close()
})
