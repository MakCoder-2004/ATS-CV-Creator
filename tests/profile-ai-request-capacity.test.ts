import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createWorkbench } from '../src/main/workbench'
import type { AnalysisTransport } from '../src/main/posting-analysis'

const directories: string[] = []
const opened: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const workspace of opened.splice(0)) workspace.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

test('oversized complete serialized schema is rejected before the shared dispatcher records or sends an attempt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'profile-ai-request-limit-')); directories.push(directory)
  let calls = 0
  const transport: AnalysisTransport = { async generate() { calls++; return '{}' } }
  const workspace = createWorkbench(directory, undefined, transport); opened.push(workspace)
  const runId = `profile-import:${randomUUID()}`
  workspace.api.authorizeProfileImportAi(runId)
  await expect(workspace.api.generateProfileImportAi(runId, 'minimax/minimax-m3.1-flash:free', 'small authorized input', z.string().describe('oversized schema context '.repeat(5_000)))).rejects.toThrow(/complete AI request.*64 KiB/)
  expect(calls).toBe(0)
  expect(await workspace.api.getAnalysisUsage()).toMatchObject({ attempts: 0 })
})
