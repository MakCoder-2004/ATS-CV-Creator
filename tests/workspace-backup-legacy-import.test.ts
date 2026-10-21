import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createWorkbench } from '../src/main/workbench'
import { mapProfilePdfPages } from '../src/shared/profile-pdf-import'

const directories: string[] = [], instances: Array<ReturnType<typeof createWorkbench>> = []
afterEach(() => { for (const instance of instances.splice(0)) instance.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

test('restores a pre-provenance workspace backup as empty provenance while retaining profile and evidence history', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cv-tailor-legacy-pdf-backup-')); directories.push(directory)
  const workbench = createWorkbench(directory); instances.push(workbench)
  const sourceHash = 'a'.repeat(64), baseline = await workbench.api.getProfileImportBaseline()
  const draft = mapProfilePdfPages([{ page: 1, text: 'NAME: Ada Example\nSKILLS: TypeScript' }])
  const refs = [draft.contact?.proposalRef, ...draft.skills.map(item => item.proposalRef), ...draft.sources.map(source => source.proposalRef)].filter((ref): ref is string => Boolean(ref))
  const proposalIds = Object.fromEntries([...new Set(refs)].map(ref => [ref, randomUUID()]))
  const proposals = { ...draft, proposalIds, sources: draft.sources.map(source => ({ ...source, proposalId: proposalIds[source.proposalRef] })) }
  const imported = await workbench.api.importEmptyProfilePdf(sourceHash, baseline, proposals)
  expect(imported.ok).toBe(true)
  const legacy = JSON.parse(workbench.backup.createBackup())
  delete legacy.tables.profile_import_provenance
  legacy.tables.schema_migrations.rows = legacy.tables.schema_migrations.rows.filter((row: { version: number }) => row.version !== 6)
  const preview = workbench.backup.previewRestore(JSON.stringify(legacy))
  expect(preview.rowCounts.profile_import_provenance).toEqual({ current: 2, restored: 0 })
  workbench.backup.applyRestore(preview.token, content => content)
  expect(await workbench.api.getProfile()).toMatchObject({ contact: { fullName: 'Ada Example' }, skills: [{ name: 'TypeScript' }] })
  expect(JSON.parse(workbench.backup.createBackup()).tables.profile_import_provenance.rows).toEqual([])
})
